import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { evaluateBotTradeResponse } from '@/lib/trade/bot-trade-evaluator';
import {
  evaluateTradeFairness,
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
    const callerClient = await createServerClient();

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

    // The existing trade RPC authorizes the room host to act for bot franchises.
    const isProposerParticipant = participant?.team_id === trade.proposer_team_id;
    if (!isHost && !isProposerParticipant) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: caller did not propose this trade' },
        { status: 403 }
      );
    }
    if (!isHost && isProposerParticipant) {
      return NextResponse.json(
        { success: false, error: 'Only the room host can process bot franchise decisions' },
        { status: 403 }
      );
    }

    if (trade.status !== 'PENDING') {
      return NextResponse.json(
        { success: false, error: `Trade is not pending (current status: ${trade.status})` },
        { status: 400 }
      );
    }

    // Expiration is a state mutation, so do it only after the caller is authorized
    // for this room. The admin client bypasses RLS and must not be reached by an
    // authenticated user who merely knows an expired trade ID.
    if (trade.expires_at && new Date(trade.expires_at).getTime() <= Date.now()) {
      await admin
        .from('trades')
        .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
        .eq('id', trade.id)
        .eq('status', 'PENDING');

      return NextResponse.json(
        { success: false, error: 'Trade proposal has expired' },
        { status: 400 }
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
        .eq('id', trade.id)
        .eq('status', 'PENDING');

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

    // 7. Apply the bot decision through the authoritative RPC lifecycle.
    if (decisionResult.decision === 'REJECT') {
      const { data, error } = await callerClient.rpc('v3_respond_trade', {
        p_trade_id: trade.id,
        p_action: 'REJECT',
        p_notes: decisionResult.reason,
      });
      if (error || !data?.success) {
        return NextResponse.json(
          { success: false, error: error?.message || data?.error || 'Bot rejection was not recorded' },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        decision: 'REJECT',
        reason: decisionResult.reason,
      });
    }

    if (decisionResult.decision === 'COUNTER' && decisionResult.counterOffer) {
      const counterProposerPlayers = outgoingPlayers.filter(player =>
        decisionResult.counterOffer!.proposerPlayerIds.includes(player.id)
      );
      const counterReceiverPlayers = proposerRoster.filter(player =>
        decisionResult.counterOffer!.receiverPlayerIds.includes(player.id)
      );
      const counterFairness = evaluateTradeFairness({
        proposerTeam: receiverTeam,
        receiverTeam: proposerTeam,
        proposerPlayers: counterProposerPlayers,
        receiverPlayers: counterReceiverPlayers,
        proposerRoster: botRoster,
        receiverRoster: proposerRoster,
        maxOverseas,
      });
      const { data: newTrade, error: counterErr } = await callerClient.rpc('v3_propose_trade', {
        p_auction_id: trade.auction_id,
        p_proposer_team_id: receiverTeam.id,
        p_receiver_team_id: proposerTeam.id,
        p_proposer_player_ids: decisionResult.counterOffer.proposerPlayerIds,
        p_receiver_player_ids: decisionResult.counterOffer.receiverPlayerIds,
        p_notes: decisionResult.counterOffer.notes,
        p_parent_trade_id: trade.id,
        p_fair_value: counterFairness,
      });

      if (counterErr || !newTrade?.success) {
        console.error('Failed to create bot counter trade:', counterErr || newTrade?.error);
        return NextResponse.json(
          { success: false, error: counterErr?.message || newTrade?.error || 'Bot counter-offer was not recorded' },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        decision: 'COUNTER',
        reason: decisionResult.counterOffer.notes,
        counterTradeId: newTrade.trade_id,
      });
    }

    if (decisionResult.decision === 'ACCEPT') {
      // This is a server-evaluated bot action, not a human acceptance. The
      // authenticated host has already been mapped and checked against the
      // room above; use the server-only client so the RPC sees its trusted
      // service_role identity. Never retry a rejected user RPC with privilege.
      const { data, error } = await admin.rpc('v3_respond_bot_trade', {
        p_trade_id: trade.id,
        p_host_clerk_user_id: userId,
        p_notes: decisionResult.reason,
      });
      if (error || !data?.success) {
        return NextResponse.json(
          { success: false, error: error?.message || data?.error || 'Bot acceptance was not recorded' },
          { status: 409 }
        );
      }

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
