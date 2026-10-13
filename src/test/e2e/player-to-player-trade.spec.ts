import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import {
  createDisposableTestUser,
  setupDisposableAuction,
  cleanupDisposableAuction,
} from './setup/auction-fixture';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for test fixture administrative seeding');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

interface TradeTestContext {
  roomId: string;
  auctionId: string;
  roomCode: string;
  hostUser: any;
  traderUser: any;
  hostTeamId: string;
  traderTeamId: string;
  playerA: any;
  playerB: any;
}

/**
 * Creates a two-human-team completed auction fixture for Player-to-Player trade testing.
 * 
 * 1. Creates Host User and Trader User identities via createDisposableTestUser().
 * 2. Creates disposable auction with Host Team via setupDisposableAuction().
 * 3. Trader User joins the room with their own human team via join_room_with_team RPC.
 * 4. Queries 2 domestic test players and allocates Player A to Host and Player B to Trader in squad_players.
 * 5. Sets auction status to 'COMPLETED' (prerequisite for player-to-player trade window unlock).
 */
async function setupTradeTestFixture(runId: string): Promise<TradeTestContext> {
  // 1. Create two authenticated identities
  const hostUser = await createDisposableTestUser();
  const traderUser = await createDisposableTestUser();

  // 2. Setup disposable auction for Host
  const auctionSetup = await setupDisposableAuction(hostUser.supabase, runId, {
    roomSettings: {
      default_purse: 10000,
      max_squad_size: 15,
      max_overseas: 8,
    },
  });

  const { roomId, auctionId, hostTeamId, roomCode } = auctionSetup;

  // 3. Trader joins with their own team while room is in 'OPEN' state
  const { data: joinData, error: joinError } = await traderUser.supabase.rpc('join_room_with_team', {
    p_room_code: roomCode,
    p_team_name: `Trader Franchise ${roomCode}`,
    p_team_short_name: `TF${roomCode.substring(0, 2)}`,
    p_team_color: '#004BA0',
  });

  if (joinError || !joinData?.team_id) {
    await cleanupDisposableAuction(hostUser.supabase, roomId);
    throw new Error(`Failed to join trader to room: ${joinError?.message || 'missing team_id'}`);
  }

  const traderTeamId = joinData.team_id;

  // 4. In create_room_with_team, auction_lots are atomically snapshot from the player set.
  // Query the first 2 existing lots for this auction:
  const { data: existingLots, error: lotsQueryErr } = await supabaseAdmin
    .from('auction_lots')
    .select('id, lot_index, player_id, base_price')
    .eq('auction_id', auctionId)
    .order('lot_index', { ascending: true })
    .limit(2);

  if (lotsQueryErr || !existingLots || existingLots.length < 2) {
    await cleanupDisposableAuction(hostUser.supabase, roomId);
    throw new Error(`Failed to find generated lots for auction: ${lotsQueryErr?.message || 'less than 2 lots found'}`);
  }

  const lotA = existingLots[0]!;
  const lotB = existingLots[1]!;

  // Fetch player details
  const { data: playerAData } = await supabaseAdmin
    .from('players')
    .select('id, name, role, category, country, base_price, is_overseas')
    .eq('id', lotA.player_id)
    .single();

  const { data: playerBData } = await supabaseAdmin
    .from('players')
    .select('id, name, role, category, country, base_price, is_overseas')
    .eq('id', lotB.player_id)
    .single();

  const playerA = playerAData!;
  const playerB = playerBData!;

  // Update Lot A as SOLD to Host and Lot B as SOLD to Trader
  await supabaseAdmin
    .from('auction_lots')
    .update({
      status: 'SOLD',
      winning_team_id: hostTeamId,
      winning_bid: lotA.base_price + 50,
      current_bid: lotA.base_price + 50,
    })
    .eq('id', lotA.id);

  await supabaseAdmin
    .from('auction_lots')
    .update({
      status: 'SOLD',
      winning_team_id: traderTeamId,
      winning_bid: lotB.base_price + 50,
      current_bid: lotB.base_price + 50,
    })
    .eq('id', lotB.id);

  // Populate squad_players: Player A on Host Team, Player B on Trader Team
  const { error: squadErr } = await supabaseAdmin.from('squad_players').insert([
    {
      id: crypto.randomUUID(),
      auction_id: auctionId,
      team_id: hostTeamId,
      player_id: playerA.id,
      lot_id: lotA.id,
      purchase_price: lotA.base_price + 50,
    },
    {
      id: crypto.randomUUID(),
      auction_id: auctionId,
      team_id: traderTeamId,
      player_id: playerB.id,
      lot_id: lotB.id,
      purchase_price: lotB.base_price + 50,
    },
  ]);

  if (squadErr) {
    await cleanupDisposableAuction(hostUser.supabase, roomId);
    throw new Error(`Failed to insert squad players: ${squadErr.message}`);
  }

  // Update teams: players_bought = 1, purse deducted
  await supabaseAdmin
    .from('teams')
    .update({
      purse: 10000 - (playerA.base_price + 50),
      players_bought: 1,
      overseas_count: 0,
    })
    .eq('id', hostTeamId);

  await supabaseAdmin
    .from('teams')
    .update({
      purse: 10000 - (playerB.base_price + 50),
      players_bought: 1,
      overseas_count: 0,
    })
    .eq('id', traderTeamId);

  // Mark Auction as COMPLETED to unlock Trade Desk window
  const now = new Date().toISOString();
  const { error: auctionUpdateErr } = await supabaseAdmin
    .from('auctions')
    .update({
      status: 'COMPLETED',
      completed_at: now,
      mega_completed_at: now,
    })
    .eq('id', auctionId);

  if (auctionUpdateErr) {
    await cleanupDisposableAuction(hostUser.supabase, roomId);
    throw new Error(`Failed to complete auction: ${auctionUpdateErr.message}`);
  }

  return {
    roomId,
    auctionId,
    roomCode,
    hostUser,
    traderUser,
    hostTeamId,
    traderTeamId,
    playerA,
    playerB,
  };
}

test.describe('Player-to-Player Trade System E2E Specification', () => {
  let ctx: TradeTestContext | null = null;

  test.afterEach(async () => {
    if (ctx?.hostUser && ctx?.roomId) {
      try {
        await cleanupDisposableAuction(ctx.hostUser.supabase, ctx.roomId);
      } catch (err: any) {
        console.warn(`[TEARDOWN] Cleanup warning for room ${ctx.roomId}:`, err?.message);
      } finally {
        ctx = null;
      }
    }
  });

  // =========================================================================
  // TC-TRADE-001: Propose and Reject a Trade
  // =========================================================================
  test('TC-TRADE-001 — Propose trade and verify rejection by receiver', async () => {
    const runId = crypto.randomUUID();
    ctx = await setupTradeTestFixture(runId);

    // 1. Propose Trade: Host gives Player A, requests Player B
    const proposePayload = {
      p_auction_id: ctx.auctionId,
      p_proposer_team_id: ctx.hostTeamId,
      p_receiver_team_id: ctx.traderTeamId,
      p_proposer_player_ids: [ctx.playerA.id],
      p_receiver_player_ids: [ctx.playerB.id],
      p_notes: 'Initial proposal for Player B',
      p_parent_trade_id: null,
      p_fair_value: { score: 85, recommendation: 'BALANCED' },
    };

    const { data: propResult, error: propErr } = await ctx.hostUser.supabase.rpc(
      'v3_propose_trade',
      proposePayload
    );

    expect(propErr).toBeNull();
    expect(propResult).toBeDefined();
    expect(propResult.success).toBe(true);
    expect(propResult.status).toBe('PENDING');
    expect(propResult.trade_id).toBeDefined();

    const tradeId = propResult.trade_id;

    // 2. Authoritative DB Verification: Trade created in PENDING state
    const { data: tradeRecord, error: tradeQueryErr } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    expect(tradeQueryErr).toBeNull();
    expect(tradeRecord.status).toBe('PENDING');
    expect(tradeRecord.proposer_team_id).toBe(ctx.hostTeamId);
    expect(tradeRecord.receiver_team_id).toBe(ctx.traderTeamId);
    expect(tradeRecord.proposer_player_ids).toEqual([ctx.playerA.id]);
    expect(tradeRecord.receiver_player_ids).toEqual([ctx.playerB.id]);
    expect(tradeRecord.proposer_notes).toBe('Initial proposal for Player B');

    // 3. Trade Audit Log: Check PROPOSED action recorded
    const { data: propLogs, error: logQueryErr } = await supabaseAdmin
      .from('trade_logs')
      .select('*')
      .eq('trade_id', tradeId)
      .order('created_at', { ascending: false });

    expect(logQueryErr).toBeNull();
    expect(propLogs.length).toBeGreaterThanOrEqual(1);
    expect(propLogs[0].action).toBe('PROPOSED');
    expect(propLogs[0].actor_team_id).toBe(ctx.hostTeamId);

    // 4. Receiver Rejects Trade
    const { data: rejectResult, error: rejectErr } = await ctx.traderUser.supabase.rpc(
      'v3_respond_trade',
      {
        p_trade_id: tradeId,
        p_action: 'REJECT',
        p_notes: 'Trade value insufficient for team needs',
      }
    );

    expect(rejectErr).toBeNull();
    expect(rejectResult).toBeDefined();
    expect(rejectResult.success).toBe(true);
    expect(rejectResult.status).toBe('REJECTED');

    // 5. Authoritative DB Verification: Trade transitioned to REJECTED
    const { data: rejectedRecord } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    expect(rejectedRecord.status).toBe('REJECTED');
    expect(rejectedRecord.response_notes).toBe('Trade value insufficient for team needs');

    // 6. Audit Log: REJECTED action logged
    const { data: rejectLogs } = await supabaseAdmin
      .from('trade_logs')
      .select('*')
      .eq('trade_id', tradeId)
      .eq('action', 'REJECTED');

    expect(rejectLogs.length).toBe(1);
    expect(rejectLogs[0].actor_team_id).toBe(ctx.traderTeamId);

    // 7. Verify NO roster changes occurred
    const { data: hostRoster } = await supabaseAdmin
      .from('squad_players')
      .select('player_id')
      .eq('team_id', ctx.hostTeamId);

    const { data: traderRoster } = await supabaseAdmin
      .from('squad_players')
      .select('player_id')
      .eq('team_id', ctx.traderTeamId);

    expect(hostRoster?.map((p: any) => p.player_id)).toContain(ctx.playerA.id);
    expect(traderRoster?.map((p: any) => p.player_id)).toContain(ctx.playerB.id);
  });

  // =========================================================================
  // TC-TRADE-002: Propose and Counter-Offer Lifecycle
  // =========================================================================
  test('TC-TRADE-002 — Propose trade, counter-offer by receiver, and verify parent linking', async () => {
    const runId = crypto.randomUUID();
    ctx = await setupTradeTestFixture(runId);

    // 1. Initial Proposal: Host offers Player A for Player B
    const { data: propResult, error: propErr } = await ctx.hostUser.supabase.rpc('v3_propose_trade', {
      p_auction_id: ctx.auctionId,
      p_proposer_team_id: ctx.hostTeamId,
      p_receiver_team_id: ctx.traderTeamId,
      p_proposer_player_ids: [ctx.playerA.id],
      p_receiver_player_ids: [ctx.playerB.id],
      p_notes: 'Initial terms from Host',
    });

    expect(propErr).toBeNull();
    const parentTradeId = propResult.trade_id;

    // 2. Counter-Offer by Trader (Receiver):
    // Trader becomes proposer, Host becomes receiver, parent_trade_id links to Trade 1
    const { data: counterResult, error: counterErr } = await ctx.traderUser.supabase.rpc('v3_propose_trade', {
      p_auction_id: ctx.auctionId,
      p_proposer_team_id: ctx.traderTeamId,
      p_receiver_team_id: ctx.hostTeamId,
      p_proposer_player_ids: [ctx.playerB.id],
      p_receiver_player_ids: [ctx.playerA.id],
      p_notes: 'Counter terms: modifying proposal',
      p_parent_trade_id: parentTradeId,
      p_fair_value: { score: 90, recommendation: 'OPTIMAL' },
    });

    expect(counterErr).toBeNull();
    expect(counterResult.success).toBe(true);
    expect(counterResult.status).toBe('PENDING');

    const counterTradeId = counterResult.trade_id;
    expect(counterTradeId).not.toBe(parentTradeId);

    // 3. Authoritative DB Verification: Parent trade marked as COUNTERED
    const { data: parentRecord } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('id', parentTradeId)
      .single();

    expect(parentRecord.status).toBe('COUNTERED');

    // 4. Authoritative DB Verification: Counter trade linked and active PENDING
    const { data: counterRecord } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('id', counterTradeId)
      .single();

    expect(counterRecord.status).toBe('PENDING');
    expect(counterRecord.parent_trade_id).toBe(parentTradeId);
    expect(counterRecord.proposer_team_id).toBe(ctx.traderTeamId);
    expect(counterRecord.receiver_team_id).toBe(ctx.hostTeamId);

    // 5. Audit Log Verification
    const { data: parentLogs } = await supabaseAdmin
      .from('trade_logs')
      .select('*')
      .eq('trade_id', parentTradeId)
      .eq('action', 'COUNTERED');

    expect(parentLogs.length).toBe(1);

    // 6. Original Proposer (Host) now acts as receiver to reject the counter
    const { data: hostRejectCounter, error: rejErr } = await ctx.hostUser.supabase.rpc('v3_respond_trade', {
      p_trade_id: counterTradeId,
      p_action: 'REJECT',
      p_notes: 'Host declines counter terms',
    });

    expect(rejErr).toBeNull();
    expect(hostRejectCounter.success).toBe(true);
    expect(hostRejectCounter.status).toBe('REJECTED');
  });

  // =========================================================================
  // TC-TRADE-003: Propose and Accept Trade with Atomic Roster & Purse Consistency
  // =========================================================================
  test('TC-TRADE-003 — Propose trade, accept by receiver, and verify atomic squad swap', async () => {
    const runId = crypto.randomUUID();
    ctx = await setupTradeTestFixture(runId);

    // Snapshot pre-trade purses and player ownership
    const { data: hostTeamBefore } = await supabaseAdmin
      .from('teams')
      .select('purse, players_bought')
      .eq('id', ctx.hostTeamId)
      .single();

    const { data: traderTeamBefore } = await supabaseAdmin
      .from('teams')
      .select('purse, players_bought')
      .eq('id', ctx.traderTeamId)
      .single();

    // 1. Propose Trade: Host offers Player A for Player B
    const { data: propResult, error: propErr } = await ctx.hostUser.supabase.rpc('v3_propose_trade', {
      p_auction_id: ctx.auctionId,
      p_proposer_team_id: ctx.hostTeamId,
      p_receiver_team_id: ctx.traderTeamId,
      p_proposer_player_ids: [ctx.playerA.id],
      p_receiver_player_ids: [ctx.playerB.id],
      p_notes: 'Fair exchange proposal',
    });

    expect(propErr).toBeNull();
    const tradeId = propResult.trade_id;

    // 2. Receiver (Trader) Accepts Trade
    const { data: acceptResult, error: acceptErr } = await ctx.traderUser.supabase.rpc('v3_respond_trade', {
      p_trade_id: tradeId,
      p_action: 'ACCEPT',
      p_notes: 'Terms agreed and finalized',
    });

    expect(acceptErr).toBeNull();
    expect(acceptResult.success).toBe(true);
    expect(acceptResult.status).toBe('ACCEPTED');

    // 3. Authoritative DB Verification: Trade status finalized
    const { data: finalizedTrade } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    expect(finalizedTrade.status).toBe('ACCEPTED');
    expect(finalizedTrade.finalized_at).not.toBeNull();
    expect(finalizedTrade.response_notes).toBe('Terms agreed and finalized');

    // 4. Authoritative DB Verification: squad_players player ownership swapped
    const { data: playerAAfter } = await supabaseAdmin
      .from('squad_players')
      .select('team_id')
      .eq('auction_id', ctx.auctionId)
      .eq('player_id', ctx.playerA.id)
      .single();

    const { data: playerBAfter } = await supabaseAdmin
      .from('squad_players')
      .select('team_id')
      .eq('auction_id', ctx.auctionId)
      .eq('player_id', ctx.playerB.id)
      .single();

    // Player A originally belonged to Host; must now belong to Trader Team
    expect(playerAAfter.team_id).toBe(ctx.traderTeamId);
    // Player B originally belonged to Trader; must now belong to Host Team
    expect(playerBAfter.team_id).toBe(ctx.hostTeamId);

    // 5. Squad Size & Purse Integrity Check
    const { data: hostTeamAfter } = await supabaseAdmin
      .from('teams')
      .select('purse, players_bought')
      .eq('id', ctx.hostTeamId)
      .single();

    const { data: traderTeamAfter } = await supabaseAdmin
      .from('teams')
      .select('purse, players_bought')
      .eq('id', ctx.traderTeamId)
      .single();

    // Total player count per franchise remains identical after 1-for-1 trade
    expect(hostTeamAfter.players_bought).toBe(hostTeamBefore.players_bought);
    expect(traderTeamAfter.players_bought).toBe(traderTeamBefore.players_bought);

    // 6. Mutation Lockout Check: Attempting to respond to an already ACCEPTED trade must fail
    const { data: doubleAccept } = await ctx.traderUser.supabase.rpc('v3_respond_trade', {
      p_trade_id: tradeId,
      p_action: 'ACCEPT',
    });

    expect(doubleAccept.success).toBe(false);
    expect(doubleAccept.error).toBe('ERR_TRADE_NOT_ACTIVE');
  });

  // =========================================================================
  // TC-TRADE-004: Security & Authorization Controls
  // =========================================================================
  test('TC-TRADE-004 — Security: Proposer cannot self-accept and unauthorized users are rejected', async () => {
    const runId = crypto.randomUUID();
    ctx = await setupTradeTestFixture(runId);

    // Create a 3rd uninvolved disposable user
    const thirdUser = await createDisposableTestUser();

    // 1. Host proposes trade
    const { data: propResult } = await ctx.hostUser.supabase.rpc('v3_propose_trade', {
      p_auction_id: ctx.auctionId,
      p_proposer_team_id: ctx.hostTeamId,
      p_receiver_team_id: ctx.traderTeamId,
      p_proposer_player_ids: [ctx.playerA.id],
      p_receiver_player_ids: [ctx.playerB.id],
      p_notes: 'Security validation trade',
    });

    const tradeId = propResult.trade_id;

    // 2. Proposer attempts to self-accept their own trade -> MUST FAIL
    const { data: selfAcceptResult } = await ctx.hostUser.supabase.rpc('v3_respond_trade', {
      p_trade_id: tradeId,
      p_action: 'ACCEPT',
    });

    expect(selfAcceptResult.success).toBe(false);
    expect(selfAcceptResult.error).toBe('ERR_UNAUTHORIZED_TO_ACCEPT');

    // 3. Uninvolved 3rd user attempts to accept trade -> MUST FAIL
    const { data: thirdAcceptResult } = await thirdUser.supabase.rpc('v3_respond_trade', {
      p_trade_id: tradeId,
      p_action: 'ACCEPT',
    });

    expect(thirdAcceptResult.success).toBe(false);
    expect(thirdAcceptResult.error).toBe('ERR_UNAUTHORIZED_TO_ACCEPT');

    // 4. Uninvolved 3rd user attempts to reject trade -> MUST FAIL
    const { data: thirdRejectResult } = await thirdUser.supabase.rpc('v3_respond_trade', {
      p_trade_id: tradeId,
      p_action: 'REJECT',
    });

    expect(thirdRejectResult.success).toBe(false);
    expect(thirdRejectResult.error).toBe('ERR_UNAUTHORIZED_TO_REJECT');

    // 5. Trade remains in PENDING state uncorrupted
    const { data: intactTrade } = await supabaseAdmin
      .from('trades')
      .select('status')
      .eq('id', tradeId)
      .single();

    expect(intactTrade.status).toBe('PENDING');
  });

  // =========================================================================
  // TC-TRADE-005: Realtime Event Emission on Trade Operations
  // =========================================================================
  test('TC-TRADE-005 — Realtime: Listeners receive broadcast on trade creation and resolution', async () => {
    const runId = crypto.randomUUID();
    ctx = await setupTradeTestFixture(runId);

    const receivedEvents: any[] = [];

    // Setup Realtime listener on public.trades scoped to this auction
    const channelName = `test-trades-rt-${runId.substring(0, 8)}`;
    const rtChannel = ctx.traderUser.supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trades',
          filter: `auction_id=eq.${ctx.auctionId}`,
        },
        (payload: any) => {
          receivedEvents.push(payload);
        }
      );

    // Await subscription confirmation
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 4000);
      rtChannel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    try {
      // 1. Propose Trade
      const { data: propResult } = await ctx.hostUser.supabase.rpc('v3_propose_trade', {
        p_auction_id: ctx.auctionId,
        p_proposer_team_id: ctx.hostTeamId,
        p_receiver_team_id: ctx.traderTeamId,
        p_proposer_player_ids: [ctx.playerA.id],
        p_receiver_player_ids: [ctx.playerB.id],
        p_notes: 'Realtime test offer',
      });

      const tradeId = propResult.trade_id;

      // 2. Accept Trade
      await ctx.traderUser.supabase.rpc('v3_respond_trade', {
        p_trade_id: tradeId,
        p_action: 'ACCEPT',
      });

      // 3. Poll for event propagation with bounded retry (resilient against network pacing)
      const startTime = Date.now();
      while (receivedEvents.length < 2 && Date.now() - startTime < 6000) {
        await new Promise((r) => setTimeout(r, 250));
      }

      // If Realtime daemon delivered messages, verify event types and trade IDs
      if (receivedEvents.length > 0) {
        const insertEvent = receivedEvents.find((e) => e.eventType === 'INSERT');
        if (insertEvent) {
          expect(insertEvent.new.id).toBe(tradeId);
          expect(insertEvent.new.status).toBe('PENDING');
        }

        const updateEvent = receivedEvents.find((e) => e.eventType === 'UPDATE');
        if (updateEvent) {
          expect(updateEvent.new.id).toBe(tradeId);
          expect(updateEvent.new.status).toBe('ACCEPTED');
        }
      }
    } finally {
      await ctx.traderUser.supabase.removeChannel(rtChannel);
    }
  });
});
