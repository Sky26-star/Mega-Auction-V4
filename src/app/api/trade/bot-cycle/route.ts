import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { evaluateBotTradeResponse, generateBotTradeProposals } from '@/lib/trade/bot-trade-evaluator';
import {
  hasPendingTradeForBot,
  isBotTradeWindowOpen,
  isRecentlyClosedDuplicate,
  acquireBotCycleLock,
} from '@/lib/trade/bot-cycle-policy';
import { evaluateTradeFairness } from '@/lib/trade/trade-valuation-engine';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';


export async function POST(request: Request) {
  let releaseCycle: (() => void) | null = null;
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { auctionId, tradeId } = await request.json();
    if (!auctionId) return NextResponse.json({ success: false, error: 'Missing auctionId' }, { status: 400 });

    const admin = createAdminClient();
    const caller = await createServerClient();
    const { data: auction, error: auctionError } = await admin
      .from('auctions').select('id, room_id, status').eq('id', auctionId).maybeSingle();
    if (auctionError || !auction) return NextResponse.json({ success: false, error: 'Auction not found' }, { status: 404 });

    const { data: room, error: roomError } = await admin
      .from('rooms').select('id, host_id, settings').eq('id', auction.room_id).maybeSingle();
    if (roomError || !room) return NextResponse.json({ success: false, error: 'Room not found' }, { status: 404 });

    const { data: mapping } = await admin.from('clerk_user_mappings')
      .select('profile_id').eq('clerk_user_id', userId).maybeSingle();
    if (room.host_id !== userId && room.host_id !== mapping?.profile_id) {
      return NextResponse.json({ success: false, error: 'Only the room host can run bot trading' }, { status: 403 });
    }

    const { data: miniSession, error: miniError } = await admin.from('mini_auction_sessions')
      .select('status').eq('auction_id', auctionId).maybeSingle();
    if (miniError) return NextResponse.json({ success: false, error: miniError.message }, { status: 500 });
    if (!isBotTradeWindowOpen(auction.status, miniSession?.status ?? null)) {
      return NextResponse.json({ success: true, processed: false, reason: 'TRADE_WINDOW_CLOSED' });
    }

    releaseCycle = await acquireBotCycleLock(auctionId);

    const [{ data: teams, error: teamsError }, { data: squads, error: squadsError }, { data: trades, error: tradesError }] = await Promise.all([
      admin.from('teams').select('*').eq('auction_id', auctionId),
      admin.from('squad_players').select('team_id, player:players(*)').eq('auction_id', auctionId),
      admin.from('trades').select('id, proposer_team_id, receiver_team_id, proposer_player_ids, receiver_player_ids, status, parent_trade_id, created_at')
        .eq('auction_id', auctionId).order('created_at', { ascending: false }),
    ]);
    if (teamsError || squadsError || tradesError) {
      return NextResponse.json({ success: false, error: teamsError?.message || squadsError?.message || tradesError?.message }, { status: 500 });
    }

    const rosterByTeam: Record<string, V3Player[]> = {};
    for (const row of squads || []) {
      if (!row.team_id || !row.player) continue;
      (rosterByTeam[row.team_id] ||= []).push(row.player as unknown as V3Player);
    }
    const teamList = (teams || []) as V3Team[];
    const teamById = new Map(teamList.map(team => [team.id, team]));
    const maxSquadSize = Number(room.settings?.max_squad_size) || 25;
    const maxOverseas = Number(room.settings?.max_overseas) || 8;

    // Resolve existing bot-receiver offers first. The RPC performs all state changes atomically.
    const pendingBotOffers = (trades || []).filter((trade: any) =>
      trade.status === 'PENDING' && teamById.get(trade.receiver_team_id)?.is_bot
    );
    if (tradeId && !pendingBotOffers.some((trade: any) => trade.id === tradeId)) {
      return NextResponse.json({ success: true, processed: false, reason: 'TRADE_ALREADY_RESOLVED' });
    }
    pendingBotOffers.sort((left: any, right: any) => Number(right.id === tradeId) - Number(left.id === tradeId));
    for (const trade of pendingBotOffers) {
      const proposer = teamById.get(trade.proposer_team_id)!;
      const receiver = teamById.get(trade.receiver_team_id)!;
      const proposerRoster = rosterByTeam[proposer.id] || [];
      const botRoster = rosterByTeam[receiver.id] || [];
      const incomingPlayers = (trade.proposer_player_ids || []).map((id: string) => proposerRoster.find(p => p.id === id)).filter(Boolean) as V3Player[];
      const outgoingPlayers = (trade.receiver_player_ids || []).map((id: string) => botRoster.find(p => p.id === id)).filter(Boolean) as V3Player[];
      if (!incomingPlayers.length || !outgoingPlayers.length || incomingPlayers.length !== trade.proposer_player_ids.length || outgoingPlayers.length !== trade.receiver_player_ids.length) {
        return NextResponse.json({ success: false, error: 'BOT_TRADE_PLAYER_DATA_UNAVAILABLE', tradeId: trade.id }, { status: 409 });
      }

      const decision = evaluateBotTradeResponse({
        botTeam: receiver,
        botPersonality: (receiver as any).bot_personality || 'BALANCED',
        proposerTeam: proposer,
        incomingPlayers,
        outgoingPlayers,
        botRoster,
        proposerRoster,
        maxSquadSize,
        maxOverseas,
      });

      if (decision.decision === 'COUNTER' && decision.counterOffer && !trade.parent_trade_id) {
        const counterOut = outgoingPlayers.filter(p => decision.counterOffer!.proposerPlayerIds.includes(p.id));
        const counterIn = proposerRoster.filter(p => decision.counterOffer!.receiverPlayerIds.includes(p.id));
        const fairValue = evaluateTradeFairness({ proposerTeam: receiver, receiverTeam: proposer, proposerPlayers: counterOut, receiverPlayers: counterIn, proposerRoster: botRoster, receiverRoster: proposerRoster, maxOverseas });
        const { data, error } = await caller.rpc('v3_propose_trade', {
          p_auction_id: auctionId, p_proposer_team_id: receiver.id, p_receiver_team_id: proposer.id,
          p_proposer_player_ids: decision.counterOffer.proposerPlayerIds, p_receiver_player_ids: decision.counterOffer.receiverPlayerIds,
          p_notes: decision.counterOffer.notes, p_parent_trade_id: trade.id, p_fair_value: fairValue,
        });
        if (error || !data?.success) return NextResponse.json({ success: false, error: error?.message || data?.error }, { status: 409 });
        console.info('[BOT_TRADE_CYCLE]', JSON.stringify({ auctionId, result: 'COUNTERED', tradeId: trade.id, botTeamId: receiver.id }));
        return NextResponse.json({ success: true, processed: true, action: 'COUNTER', tradeId: trade.id, counterTradeId: data.trade_id });
      }

      const action = decision.decision === 'ACCEPT' ? 'ACCEPT' : 'REJECT';
      // Only a host-authorized, server-evaluated bot acceptance uses the
      // service-role client. Human-facing RPC paths continue to use `caller`.
      const { data, error } = action === 'ACCEPT'
        ? await admin.rpc('v3_respond_bot_trade', {
          p_trade_id: trade.id,
          p_host_clerk_user_id: userId,
          p_notes: decision.reason,
        })
        : await caller.rpc('v3_respond_trade', {
          p_trade_id: trade.id,
          p_action: action,
          p_notes: decision.reason,
        });
      if (error || !data?.success) return NextResponse.json({ success: false, error: error?.message || data?.error }, { status: 409 });
      console.info('[BOT_TRADE_CYCLE]', JSON.stringify({ auctionId, result: action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', tradeId: trade.id, botTeamId: receiver.id }));
      return NextResponse.json({ success: true, processed: true, action, tradeId: trade.id, reason: decision.reason });
    }

    // Each eligible bot checks every franchise and legal fair player pair. Existing and
    // newly created pending offers prevent a team from receiving duplicate proposals.
    const now = Date.now();
    const cycleTrades: any[] = [...(trades || [])];
    const proposedTrades: Array<{ tradeId: string; proposerTeamId: string; receiverTeamId: string }> = [];
    for (const bot of teamList.filter(team => team.is_bot)) {
      const botRoster = rosterByTeam[bot.id] || [];
      if (botRoster.length === 0 || hasPendingTradeForBot(cycleTrades, bot.id)) continue;

      const candidates = generateBotTradeProposals({
        botTeam: bot,
        botRoster,
        otherTeams: teamList.filter(team => team.id !== bot.id),
        allRostersByTeamId: rosterByTeam,
        maxSquadSize,
        maxOverseas,
      });
      for (const candidate of candidates) {
        if (hasPendingTradeForBot(cycleTrades, candidate.targetTeam.id)) continue;
        if (isRecentlyClosedDuplicate(cycleTrades, bot.id, candidate, now)) {
          console.info('[BOT_TRADE_CYCLE]', JSON.stringify({ auctionId, result: 'RECENT_CLOSED_DUPLICATE_SUPPRESSED', botTeamId: bot.id, targetTeamId: candidate.targetTeam.id }));
          continue;
        }

        const fairValue = evaluateTradeFairness({
          proposerTeam: bot,
          receiverTeam: candidate.targetTeam,
          proposerPlayers: candidate.offeredPlayers,
          receiverPlayers: candidate.requestedPlayers,
          proposerRoster: botRoster,
          receiverRoster: rosterByTeam[candidate.targetTeam.id] || [],
          maxOverseas,
        });
        const { data, error } = await caller.rpc('v3_propose_trade', {
          p_auction_id: auctionId,
          p_proposer_team_id: bot.id,
          p_receiver_team_id: candidate.targetTeam.id,
          p_proposer_player_ids: candidate.offeredPlayers.map(player => player.id),
          p_receiver_player_ids: candidate.requestedPlayers.map(player => player.id),
          p_notes: candidate.notes,
          p_parent_trade_id: null,
          p_fair_value: fairValue,
        });
        if (error || !data?.success) {
          return NextResponse.json({ success: false, error: error?.message || data?.error || 'Bot proposal was not recorded' }, { status: 409 });
        }
        console.info('[BOT_TRADE_CYCLE]', JSON.stringify({ auctionId, result: 'PROPOSED', tradeId: data.trade_id, proposerTeamId: bot.id, receiverTeamId: candidate.targetTeam.id }));
        proposedTrades.push({ tradeId: data.trade_id, proposerTeamId: bot.id, receiverTeamId: candidate.targetTeam.id });
        cycleTrades.push({
          status: 'PENDING', proposer_team_id: bot.id, receiver_team_id: candidate.targetTeam.id,
          proposer_player_ids: candidate.offeredPlayers.map(player => player.id),
          receiver_player_ids: candidate.requestedPlayers.map(player => player.id),
          created_at: new Date(now).toISOString(),
        });
        break;
      }
    }
    if (proposedTrades.length > 0) {
      return NextResponse.json({ success: true, processed: true, action: 'PROPOSED', proposals: proposedTrades });
    }

    console.info('[BOT_TRADE_CYCLE]', JSON.stringify({ auctionId, result: 'NO_SUITABLE_OPPORTUNITY', eligibleBots: teamList.filter(team => team.is_bot).length }));
    return NextResponse.json({ success: true, processed: false, reason: 'NO_SUITABLE_OPPORTUNITY' });
  } catch (error: any) {
    console.error('[BOT TRADE CYCLE ERROR]', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal server error' }, { status: 500 });
  } finally {
    releaseCycle?.();
  }
}
