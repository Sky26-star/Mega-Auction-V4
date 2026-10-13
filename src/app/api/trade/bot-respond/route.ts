import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { evaluateBotTradeResponse } from '@/lib/trade/bot-trade-evaluator';
import {
  DEFAULT_MAX_SQUAD_SIZE,
  DEFAULT_MAX_OVERSEAS,
} from '@/lib/trade/trade-valuation-engine';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { tradeId } = body || {};
    if (!tradeId) {
      return NextResponse.json(
        { success: false, error: 'Missing tradeId parameter' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // 1. Resolve Clerk User identity to internal profile ID
    const { data: mapping } = await admin
      .from('clerk_user_mappings')
      .select('profile_id')
      .eq('clerk_user_id', userId)
      .maybeSingle();

    const profileId = mapping?.profile_id || userId;
    const userIdsToCheck = [userId];
    if (mapping?.profile_id && mapping.profile_id !== userId) {
      userIdsToCheck.push(mapping.profile_id);
    }

    // 2. Fetch the target trade record
    const { data: trade, error: tradeErr } = await admin
      .from('trades')
      .select(`
        id,
        auction_id,
        room_id,
        proposer_team_id,
        receiver_team_id,
        proposer_player_ids,
        receiver_player_ids,
        status,
        expires_at,
        proposer_notes
      `)
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeErr || !trade) {
      return NextResponse.json(
        { success: false, error: 'Trade not found' },
        { status: 404 }
      );
    }

    if (trade.status !== 'PENDING') {
      return NextResponse.json(
        { success: false, error: `Trade is not pending (current status: ${trade.status})` },
        { status: 400 }
      );
    }

    if (trade.expires_at && new Date(trade.expires_at).getTime() <= Date.now()) {
      await admin
        .from('trades')
        .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
        .eq('id', trade.id);

      return NextResponse.json(
        { success: false, error: 'Trade proposal has expired' },
        { status: 400 }
      );
    }

    // 3. Authorize room membership and caller legitimacy
    const { data: room, error: roomErr } = await admin
      .from('rooms')
      .select('id, host_id, settings')
      .eq('id', trade.room_id)
      .maybeSingle();

    if (roomErr || !room) {
      return NextResponse.json(
        { success: false, error: 'Room not found' },
        { status: 404 }
      );
    }

    const isHost =
      room.host_id === userId ||
      (mapping?.profile_id ? room.host_id === mapping.profile_id : false);

    const { data: participant } = await admin
      .from('room_participants')
      .select('id, team_id')
      .eq('room_id', trade.room_id)
      .in('user_id', userIdsToCheck)
      .maybeSingle();

    if (!isHost && !participant) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: caller is not in this room' },
        { status: 403 }
      );
    }

    // Must be either the room host or belonging to the proposer team
    const isProposerParticipant = participant?.team_id === trade.proposer_team_id;
    if (!isHost && !isProposerParticipant) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: caller did not propose this trade' },
        { status: 403 }
      );
    }

    // 4. Verify receiver is indeed a bot
    const { data: teams, error: teamsErr } = await admin
      .from('teams')
      .select('*')
      .eq('auction_id', trade.auction_id)
      .in('id', [trade.proposer_team_id, trade.receiver_team_id]);

    if (teamsErr || !teams || teams.length < 2) {
      return NextResponse.json(
        { success: false, error: 'Franchise teams not found' },
        { status: 404 }
      );
    }

    const proposerTeam = teams.find(t => t.id === trade.proposer_team_id) as V3Team | undefined;
    const receiverTeam = teams.find(t => t.id === trade.receiver_team_id) as V3Team | undefined;

    if (!proposerTeam || !receiverTeam) {
      return NextResponse.json(
        { success: false, error: 'Franchise teams invalid' },
        { status: 400 }
      );
    }

    if (!receiverTeam.is_bot) {
      return NextResponse.json(
        { success: false, error: 'Receiving franchise is not a bot' },
        { status: 400 }
      );
    }

    // 5. Query squad ownership and player records
    const { data: squadRows, error: squadErr } = await admin
      .from('squad_players')
      .select(`
        id,
        team_id,
        player_id,
        player:players (*)
      `)
      .eq('auction_id', trade.auction_id)
      .in('team_id', [trade.proposer_team_id, trade.receiver_team_id]);

    if (squadErr || !squadRows) {
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve squad players' },
        { status: 500 }
      );
    }

    // Recheck current ownership of offered & requested players
    const proposerOwnedPlayerIds = new Set(
      squadRows
        .filter(sp => sp.team_id === trade.proposer_team_id)
        .map(sp => sp.player_id)
    );
    const receiverOwnedPlayerIds = new Set(
      squadRows
        .filter(sp => sp.team_id === trade.receiver_team_id)
        .map(sp => sp.player_id)
    );

    const proposerHasAll = trade.proposer_player_ids.every((pid: string) =>
      proposerOwnedPlayerIds.has(pid)
    );
    const receiverHasAll = trade.receiver_player_ids.every((pid: string) =>
      receiverOwnedPlayerIds.has(pid)
    );

    if (!proposerHasAll || !receiverHasAll) {
      await admin
        .from('trades')
        .update({
          status: 'EXPIRED',
          response_notes: 'One or more players in proposal are no longer with their franchises',
          updated_at: new Date().toISOString(),
        })
        .eq('id', trade.id);

      return NextResponse.json(
        { success: false, error: 'Player ownership changed; trade proposal expired' },
        { status: 400 }
      );
    }

    // Build player lists
    const botRoster: V3Player[] = squadRows
      .filter(sp => sp.team_id === trade.receiver_team_id && sp.player)
      .map(sp => sp.player as unknown as V3Player);

    const proposerRoster: V3Player[] = squadRows
      .filter(sp => sp.team_id === trade.proposer_team_id && sp.player)
      .map(sp => sp.player as unknown as V3Player);

    const incomingPlayers: V3Player[] = trade.proposer_player_ids
      .map((pid: string) => proposerRoster.find(p => p.id === pid))
      .filter(Boolean) as V3Player[];

    const outgoingPlayers: V3Player[] = trade.receiver_player_ids
      .map((pid: string) => botRoster.find(p => p.id === pid))
      .filter(Boolean) as V3Player[];

    const maxSquadSize = Number(room.settings?.max_squad_size) || DEFAULT_MAX_SQUAD_SIZE;
    const maxOverseas = Number(room.settings?.max_overseas) || DEFAULT_MAX_OVERSEAS;
    const botPersonality = (receiverTeam as any).bot_personality || 'BALANCED';

    // 6. Run deterministic server evaluation
    const decisionResult = evaluateBotTradeResponse({
      botTeam: receiverTeam,
      botPersonality,
      proposerTeam,
      incomingPlayers,
      outgoingPlayers,
      botRoster,
      proposerRoster,
      maxSquadSize,
      maxOverseas,
    });

    const nowIso = new Date().toISOString();

    // 7. Apply decision securely
    if (decisionResult.decision === 'REJECT') {
      await admin
        .from('trades')
        .update({
          status: 'REJECTED',
          response_notes: decisionResult.reason,
          updated_at: nowIso,
        })
        .eq('id', trade.id);

      await admin.from('trade_logs').insert({
        trade_id: trade.id,
        auction_id: trade.auction_id,
        action: 'REJECTED',
        actor_team_id: receiverTeam.id,
        actor_user_id: null,
        payload: {
          reason: decisionResult.reason,
          bot_decision: true,
          bot_personality: botPersonality,
        },
      });

      return NextResponse.json({
        success: true,
        decision: 'REJECT',
        reason: decisionResult.reason,
      });
    }

    if (decisionResult.decision === 'COUNTER' && decisionResult.counterOffer) {
      // Mark parent trade as COUNTERED
      await admin
        .from('trades')
        .update({
          status: 'COUNTERED',
          response_notes: decisionResult.reason,
          updated_at: nowIso,
        })
        .eq('id', trade.id);

      // Create new trade offer from bot to proposer
      const { data: newTrade, error: counterErr } = await admin
        .from('trades')
        .insert({
          auction_id: trade.auction_id,
          room_id: trade.room_id,
          proposer_team_id: receiverTeam.id,
          receiver_team_id: proposerTeam.id,
          proposer_player_ids: decisionResult.counterOffer.proposerPlayerIds,
          receiver_player_ids: decisionResult.counterOffer.receiverPlayerIds,
          status: 'PENDING',
          parent_trade_id: trade.id,
          proposer_notes: decisionResult.counterOffer.notes,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (counterErr) {
        console.error('Failed to create bot counter trade:', counterErr);
        return NextResponse.json(
          { success: false, error: counterErr.message },
          { status: 500 }
        );
      }

      await admin.from('trade_logs').insert([
        {
          trade_id: trade.id,
          auction_id: trade.auction_id,
          action: 'COUNTERED',
          actor_team_id: receiverTeam.id,
          actor_user_id: null,
          payload: {
            reason: decisionResult.reason,
            counter_trade_id: newTrade?.id,
            bot_decision: true,
          },
        },
        {
          trade_id: newTrade.id,
          auction_id: trade.auction_id,
          action: 'PROPOSED',
          actor_team_id: receiverTeam.id,
          actor_user_id: null,
          payload: {
            notes: decisionResult.counterOffer.notes,
            parent_trade_id: trade.id,
            bot_decision: true,
          },
        },
      ]);

      return NextResponse.json({
        success: true,
        decision: 'COUNTER',
        reason: decisionResult.counterOffer.notes,
        counterTradeId: newTrade.id,
      });
    }

    if (decisionResult.decision === 'ACCEPT') {
      // 8. Execute atomic roster transfer
      const pCount = trade.proposer_player_ids.length;
      const rCount = trade.receiver_player_ids.length;

      const pOverseasCount = incomingPlayers.filter(p => p.is_overseas).length;
      const rOverseasCount = outgoingPlayers.filter(p => p.is_overseas).length;

      // Transfer Proposer Players -> Receiver (Bot) Team
      const { error: pTransferErr } = await admin
        .from('squad_players')
        .update({ team_id: receiverTeam.id })
        .eq('auction_id', trade.auction_id)
        .in('player_id', trade.proposer_player_ids);

      if (pTransferErr) {
        console.error('Error transferring proposer players:', pTransferErr);
        return NextResponse.json(
          { success: false, error: 'Failed to transfer proposer players' },
          { status: 500 }
        );
      }

      // Transfer Receiver (Bot) Players -> Proposer Team
      const { error: rTransferErr } = await admin
        .from('squad_players')
        .update({ team_id: proposerTeam.id })
        .eq('auction_id', trade.auction_id)
        .in('player_id', trade.receiver_player_ids);

      if (rTransferErr) {
        console.error('Error transferring receiver players:', rTransferErr);
        return NextResponse.json(
          { success: false, error: 'Failed to transfer receiver players' },
          { status: 500 }
        );
      }

      // Update denormalized counts on teams
      await admin
        .from('teams')
        .update({
          players_bought: (proposerTeam.players_bought || 0) - pCount + rCount,
          overseas_count: (proposerTeam.overseas_count || 0) - pOverseasCount + rOverseasCount,
        })
        .eq('id', proposerTeam.id);

      await admin
        .from('teams')
        .update({
          players_bought: (receiverTeam.players_bought || 0) - rCount + pCount,
          overseas_count: (receiverTeam.overseas_count || 0) - rOverseasCount + pOverseasCount,
        })
        .eq('id', receiverTeam.id);

      // Finalize the trade
      await admin
        .from('trades')
        .update({
          status: 'ACCEPTED',
          response_notes: decisionResult.reason,
          finalized_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', trade.id);

      // Expire competing pending trades that involve any of the transferred players
      const allTradedPlayerIds = [
        ...trade.proposer_player_ids,
        ...trade.receiver_player_ids,
      ];

      const { data: competingTrades } = await admin
        .from('trades')
        .select('id, proposer_player_ids, receiver_player_ids')
        .eq('auction_id', trade.auction_id)
        .eq('status', 'PENDING')
        .neq('id', trade.id);

      if (competingTrades && competingTrades.length > 0) {
        const toExpireIds = competingTrades
          .filter(t =>
            t.proposer_player_ids?.some((pid: string) => allTradedPlayerIds.includes(pid)) ||
            t.receiver_player_ids?.some((pid: string) => allTradedPlayerIds.includes(pid))
          )
          .map(t => t.id);

        if (toExpireIds.length > 0) {
          await admin
            .from('trades')
            .update({
              status: 'EXPIRED',
              response_notes: 'Competing trade finalized; players no longer available',
              updated_at: nowIso,
            })
            .in('id', toExpireIds);
        }
      }

      // Record audit log
      await admin.from('trade_logs').insert({
        trade_id: trade.id,
        auction_id: trade.auction_id,
        action: 'ACCEPTED',
        actor_team_id: receiverTeam.id,
        actor_user_id: null,
        payload: {
          reason: decisionResult.reason,
          bot_decision: true,
          transferred_proposer_players: trade.proposer_player_ids,
          transferred_receiver_players: trade.receiver_player_ids,
        },
      });

      return NextResponse.json({
        success: true,
        decision: 'ACCEPT',
        reason: decisionResult.reason,
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Unhandled bot evaluation state',
    });
  } catch (err: any) {
    console.error('[BOT TRADE RESPOND ERROR]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
