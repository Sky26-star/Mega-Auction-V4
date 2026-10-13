import { test, expect } from '@playwright/test';
import {
  createDisposableTestUser,
  setupDisposableAuction,
  cleanupDisposableAuction,
  createBoundedTestPlayerSet,
  cleanupBoundedTestPlayerSet,
} from './setup/auction-fixture';
import crypto from 'crypto';

import { computeFutureQualityMap, computeFutureOverseasByRole,  getNextBidAmount, evaluateBotsForLot, type AuctionContext } from '../../lib/auction/server-bot-engine';
import { getBotIntelligenceContext } from '../../lib/auction/bot-intelligence-orchestrator';
import { buildStrategicDecisionPolicy } from '../../lib/auction/bot-strategic-adapter';
import { computeCandidateAlignment } from '../../lib/auction/bot-candidate-alignment';

// ============================================================
// Helper: Poll DB state until condition or timeout
// ============================================================
async function pollUntil(
  supabase: any,
  query: () => Promise<any>,
  condition: (data: any) => boolean,
  maxWaitMs: number = 45000,
  intervalMs: number = 1000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await query();
    if (condition(result)) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

// ============================================================
// CORE LIFECYCLE TEST SUITE
// Bounded fixture: 3 test players, default settings
// ============================================================
test.describe.serial('Phase 13A — Core Lifecycle (Bounded Fixture)', () => {
  let supabase: any;
  let runId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let playerSetId: string;
  let botTeams: any[];

  // Lot tracking
  let lot1Id: string;
  let lot2Id: string;

  // Variables for sharing state between scenarios
  let firstBotBidderId: string;

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    runId = setup.runId;

    const ps = await createBoundedTestPlayerSet(supabase);
    playerSetId = ps.playerSetId;

    const auction = await setupDisposableAuction(supabase, runId, {
      playerSetId,
      roomSettings: {
        default_purse: 100, // 10000 Lakhs
        max_squad_size: 25,
        max_overseas: 8,
      },
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;
    hostTeamId = auction.hostTeamId;

    const { data: t } = await supabase
      .from('teams')
      .select('*')
      .eq('auction_id', auctionId)
      .eq('is_bot', true);
    botTeams = t || [];
  });

  test.afterAll(async () => {
    if (roomId && supabase) {
      try { await cleanupDisposableAuction(supabase, roomId); } catch (e) { }
    }
    if (playerSetId && supabase) {
      await cleanupBoundedTestPlayerSet(supabase, playerSetId);
    }
  });

  test('S1: Auction Start', async () => {
    const { data, error } = await supabase.rpc('v3_start_auction', { p_room_id: roomId });
    expect(error).toBeNull();
    expect(data.success).toBe(true);
    expect(data.status).toBe('IN_PROGRESS');
    expect(data.lot_status).toBe('GET_READY');
    lot1Id = data.lot_id;
    expect(lot1Id).toBeDefined();
  });

  test('S2: GET_READY → BIDDING', async () => {
    const result = await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lot1Id).single(),
      (r) => r.data?.status === 'BIDDING',
      15000
    );
    expect(result).not.toBeNull();
    expect(result.data.status).toBe('BIDDING');
  });

  test('S5: Bot Bid (Initial)', async () => {
    // Wait for the first bot bid to arrive
    const result = await pollUntil(
      supabase,
      () => supabase.from('bids').select('team_id, amount').eq('lot_id', lot1Id).eq('is_bot', true).order('created_at', { ascending: true }),
      (r) => r.data && r.data.length > 0,
      25000
    );
    expect(result).not.toBeNull();
    expect(result.data.length).toBeGreaterThan(0);
    firstBotBidderId = result.data[0].team_id;
  });

  test('S7: Human Outbids Bot (Causal Transition)', async () => {
    // Ensure Bot is currently highest bidder before human bids
    const { data: beforeState } = await supabase
      .from('auction_lots')
      .select('highest_bidder_team_id, current_bid')
      .eq('id', lot1Id)
      .single();
    
    expect(beforeState.highest_bidder_team_id).toBeDefined();
    expect(beforeState.highest_bidder_team_id).not.toBe(hostTeamId);
    const botIds = botTeams.map(b => b.id);
    expect(botIds).toContain(beforeState.highest_bidder_team_id);
    const currentBidBefore = beforeState.current_bid;

    // Human bids
    const { data: bidData, error } = await supabase.rpc('v3_place_bid', {
      p_auction_id: auctionId,
      p_lot_id: lot1Id,
      p_team_id: hostTeamId,
      p_request_id: crypto.randomUUID(),
      p_is_bot: false,
    });
    expect(error).toBeNull();
    expect(bidData.success).toBe(true);

    // Assert human is now highest and bid increased
    const { data: afterState } = await supabase
      .from('auction_lots')
      .select('highest_bidder_team_id, current_bid')
      .eq('id', lot1Id)
      .single();
    
    expect(afterState.highest_bidder_team_id).toBe(hostTeamId);
    expect(afterState.current_bid).toBeGreaterThan(currentBidBefore);
  });

  test('S8: Bot Outbids Human (Causal Transition)', async () => {
    // Rely on the human bid placed in S7.
    // Wait for Bot to outbid naturally via Ticker
    const result = await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('highest_bidder_team_id, current_bid').eq('id', lot1Id).single(),
      (r) => r.data?.highest_bidder_team_id && r.data.highest_bidder_team_id !== hostTeamId,
      20000
    );

    expect(result).not.toBeNull();
    const afterState = result.data;
    expect(afterState.highest_bidder_team_id).not.toBe(hostTeamId);
    
    // MUST be a provisioned bot team
    const botIds = botTeams.map(b => b.id);
    expect(botIds).toContain(afterState.highest_bidder_team_id);
  });

  test('S6: Bot Re-evaluation (Causal)', async () => {
    // We know `firstBotBidderId` was outbid by the human in S7.
    // Let's wait to see if `firstBotBidderId` evaluates and bids AGAIN.
    // We prove this by checking the bids table for a new bid by `firstBotBidderId`
    // that happened AFTER the human's bid.
    
    // First find the human's bid ID/timestamp
    const { data: humanBids } = await supabase
      .from('bids')
      .select('created_at')
      .eq('lot_id', lot1Id)
      .eq('team_id', hostTeamId)
      .order('created_at', { ascending: false })
      .limit(1);
    
    const humanBidTime = new Date(humanBids[0].created_at).getTime();

    // Now wait for firstBotBidderId to place a bid with created_at > humanBidTime
    const result = await pollUntil(
      supabase,
      () => supabase
        .from('bids')
        .select('created_at')
        .eq('lot_id', lot1Id)
        .eq('team_id', firstBotBidderId)
        .order('created_at', { ascending: false })
        .limit(1),
      (r) => r.data && r.data.length > 0 && new Date(r.data[0].created_at).getTime() > humanBidTime,
      25000
    );

    expect(result).not.toBeNull();
    expect(new Date(result.data[0].created_at).getTime()).toBeGreaterThan(humanBidTime);
  });

  test.skip('S18: Multi-bot Participation — NOT PROVEN', async () => {
    // Sequential execution of S7, S8, S9 on Lot 1 drives the price up so fast
    // that Bot 2 and Bot 3 often do not bid before hitting their valuation ceiling.
    // Multi-bot participation requires either a fresh lot or non-interference.
  });

  test('S9: Valuation Safety (Ceiling Enforcement)', async () => {
    // We are evaluating the boundary behavior of ONE identified bot.
    const testedBotId = firstBotBidderId;

    // 1. Initial Snapshot for Context Reconstruction
    const { data: room } = await supabase.from('rooms').select('settings').eq('id', roomId).single();
    const { data: allTeamsData } = await supabase.from('teams').select('*').eq('auction_id', auctionId);
    
    // We loop until the bot yields (human is highest bidder and ticker has time to process)
    const MAX_LOOP = 20;
    let loopCount = 0;
    let lotStateFinal = null;
    
    for (; loopCount < MAX_LOOP; loopCount++) {
      const { data: lotState } = await supabase
        .from('auction_lots')
        .select('status, highest_bidder_team_id, current_bid')
        .eq('id', lot1Id)
        .single();
        
      if (!lotState || lotState.status !== 'BIDDING') {
        lotStateFinal = lotState;
        break;
      }
      
      if (lotState.highest_bidder_team_id !== hostTeamId) {
         // Place human bid to outbid the bot
         await supabase.rpc('v3_place_bid', {
           p_auction_id: auctionId,
           p_lot_id: lot1Id,
           p_team_id: hostTeamId,
           p_request_id: crypto.randomUUID(),
           p_is_bot: false,
         });
         
         // Give ticker time to process the human bid
         await new Promise(r => setTimeout(r, 2000));
      } else {
         // Human is highest. Wait a bit more to see if bot counters.
         await new Promise(r => setTimeout(r, 3000));
         const { data: afterWait } = await supabase
           .from('auction_lots')
           .select('highest_bidder_team_id, current_bid, status')
           .eq('id', lot1Id)
           .single();
           
         if (afterWait?.highest_bidder_team_id === hostTeamId) {
            // Bot yielded (ticker had ample time and did not outbid human)
            lotStateFinal = afterWait;
            break;
         }
      }
    }
    
    const isTimeout = loopCount >= MAX_LOOP;

    // 2. Fetch Final Authoritative State for the snapshot that matters
    const { data: finalLots } = await supabase
      .from('auction_lots')
      .select(`
        id, player_id, status, base_price, winning_team_id, winning_bid, current_bid, highest_bidder_team_id,
        players (id, role, category, base_price, is_overseas)
      `)
      .eq('auction_id', auctionId);
      
    const bot = allTeamsData.find((t: any) => t.id === testedBotId);
    const lot = finalLots.find((l: any) => l.id === lot1Id);
    const player = lot.players as any;

    const settings = room.settings || {};
    const rosters: Record<string, any[]> = {};
    const purchasePrices: Record<string, number[]> = {};
    const futurePlayers: any[] = [];
    
    for (const l of finalLots) {
      const p = l.players as any;
      const tid = l.winning_team_id;
      if (l.status === 'SOLD' && tid && p) {
        if (!rosters[tid]) rosters[tid] = [];
        rosters[tid].push(p);
        if (!purchasePrices[tid]) purchasePrices[tid] = [];
        purchasePrices[tid].push(l.winning_bid || l.base_price);
      }
      if (l.status === 'PENDING' && p) {
        futurePlayers.push({
          player_id: l.player_id || p.id,
          role: p.role || 'BATSMAN',
          category: p.category || 'D',
          base_price: p.base_price || l.base_price,
          is_overseas: p.is_overseas || false
        });
      }
    }
    
    const futureByRole: Record<string, number> = {};
    for (const fp of futurePlayers) futureByRole[fp.role] = (futureByRole[fp.role] || 0) + 1;
    const bps = futurePlayers.map(fp => fp.base_price);
    const lotsCompleted = finalLots.filter((l: any) => l.status === 'SOLD' || l.status === 'UNSOLD').length;
    
    const ctx: AuctionContext = {
      maxSquadSize: settings.max_squad_size || 25,
      maxOverseas: settings.max_overseas || 8,
      totalLots: finalLots.length,
      futurePlayers,
      futureByRole,
      futureOverseasCount: futurePlayers.filter(fp => fp.is_overseas).length,
      futureAvgBasePrice: bps.length > 0 ? bps.reduce((s, v) => s + v, 0) / bps.length : 50,
      futureMinBasePrice: bps.length > 0 ? Math.min(...bps) : 20,
      teamPurchasePrices: purchasePrices,
      lotsCompleted,
      lotsRemaining: futurePlayers.length,
      auctionProgress: finalLots.length > 0 ? lotsCompleted / finalLots.length : 0,
      futureByRoleAndQuality: computeFutureQualityMap(futurePlayers),
      futureOverseasByRole: computeFutureOverseasByRole(futurePlayers),
    };

    const v3Bot = {
      id: bot.id,
      name: bot.name,
      short_name: bot.short_name,
      purse: bot.purse,
      initial_purse: bot.initial_purse || 10000,
      players_bought: rosters[bot.id]?.length || 0,
      overseas_count: rosters[bot.id]?.filter((p: any) => p.is_overseas).length || 0,
      is_bot: true
    };
    
    const botRoster = rosters[bot.id] || [];

    // 3. Obtain Strategic Policy using identical production logic
    const intelCtx = getBotIntelligenceContext({
      team: v3Bot,
      roster: botRoster,
      maxSquadSize: ctx.maxSquadSize,
      maxOverseas: ctx.maxOverseas
    });
    
    const candidateAlignment = computeCandidateAlignment({
      candidateRole: player.role,
      targetState: intelCtx.squadTargetState,
      alternativeState: intelCtx.squadAlternativeState
    });
    
    const strategicPolicy = buildStrategicDecisionPolicy(player.role, intelCtx, candidateAlignment);

    // 4. Compute Final maxBid boundary using the final currentBid (before bot would have bid again)
    // The final DB snapshot reconstructs the production valuation inputs at the observed boundary and reproduces the production valuation calculation.
    const snapshotBid = lotStateFinal ? lotStateFinal.current_bid : lot.current_bid;
    
    // 5. Native Q/TV Evaluation from Production Path
    // Instead of reproducing legacy valuation, we capture the ACTUAL BOT DECISION EVIDENCE.
    const evidenceArr: any[] = [];
    const _bids = await evaluateBotsForLot(
      [v3Bot],
      player as any,
      snapshotBid,
      player.base_price,
      testedBotId === 'some-other-id' ? 'some-other-id' : 'mock-highest-bidder',
      'Normal',
      [v3Bot, { id: 'mock-highest-bidder' } as any],
      { [testedBotId]: botRoster as any },
      ctx,
      null,
      evidenceArr
    );
    
    const evidence = evidenceArr[0];
    const productionMaxBid = evidence ? evidence.tv : 0;
    
    // 6. Query All Actual Bids for the Tested Bot
    const { data: botBids, error: bidsErr } = await supabase
      .from('bids')
      .select('amount')
      .eq('lot_id', lot1Id)
      .eq('team_id', testedBotId)
      .order('amount', { ascending: false });
      
    expect(bidsErr).toBeNull();
    
    let highestObservedBotBid = 0;
    if (botBids && botBids.length > 0) {
      highestObservedBotBid = botBids[0].amount;
    }
    
    const nextLegalBid = getNextBidAmount(highestObservedBotBid, player.base_price);
    
    console.log(`
      [S9 FINAL SNAPSHOT]
      testedBotId: ${v3Bot.short_name} (${testedBotId})
      player: ${player.id}
      purse: ${v3Bot.purse}
      snapshotCurrentBid: ${snapshotBid}
      
      [PRODUCTION Q/TV EVIDENCE]
      decision: ${evidence?.decision}
      actionReason: ${evidence?.actionReason}
      TV: ${evidence?.tv}
      
      [RUNTIME OBSERVED]
      highestObservedBotBid: ${highestObservedBotBid}
      nextLegalBid: ${nextLegalBid}
      timeoutReached: ${isTimeout}
    `);

    // 7. Evaluating Claims
    
    // CLAIM A: Q/TV correctly boundaries the logic
    let claimA = false;
    if (evidence && typeof evidence.tv === 'number' && evidence.tv > 0) {
      claimA = true;
      console.log('CLAIM A (Production Q/TV executed): PROVEN');
    } else {
      console.log('CLAIM A (Production Q/TV executed): NOT PROVEN');
    }
    
    // CLAIM B: Bot never exceeded production maxBid
    let claimB = false;
    if (highestObservedBotBid <= productionMaxBid) {
      claimB = true;
      console.log('CLAIM B (Bot never exceeded maxBid): PROVEN');
    } else {
      console.log('CLAIM B (Bot never exceeded maxBid): NOT PROVEN');
    }
    
    // CLAIM C: Bot stopped specifically because of valuation ceiling
    let claimC = false;
    if (evidence && (evidence.actionReason === 'PRICE_EXCEEDS_TV' || evidence.actionReason === 'Q_INFERIOR')) {
      claimC = true;
      console.log('CLAIM C (Production Decision-Function Causal Proof): PROVEN');
      console.log(`Explanation: Live runtime causal proof is not persisted in E2E, but the authoritative production function explicitly yields due to ${evidence.actionReason}.`);
    } else {
      console.log('CLAIM C (Production Decision-Function Causal Proof): NOT PROVEN');
      console.log('Explanation: The boundary condition is established, but the causal decision reason is not independently observable from this test.');
    }
    
    // Explicit final assertion: We require Claim A, B, and C for the test to pass execution.
    expect(claimA).toBe(true);
    expect(claimB).toBe(true);
    expect(claimC).toBe(true);
  });

  test('S22: Post-Loss Observable Outcome', async () => {
    // Observable Outcome:
    // Bot placed bids -> Human outbid bot -> Bot did not counter -> Lot settled to Human.
    // We push the price until the bot yields.
    for (let i = 0; i < 15; i++) {
      const { data: lotState } = await supabase
        .from('auction_lots')
        .select('status, highest_bidder_team_id')
        .eq('id', lot1Id)
        .single();

      if (!lotState || lotState.status !== 'BIDDING') break;

      if (lotState.highest_bidder_team_id === hostTeamId) {
        await new Promise(r => setTimeout(r, 4000));
        const { data: afterWait } = await supabase
          .from('auction_lots')
          .select('highest_bidder_team_id, status')
          .eq('id', lot1Id)
          .single();
        if (afterWait?.highest_bidder_team_id === hostTeamId) break; // Bot yielded
      }

      await supabase.rpc('v3_place_bid', {
        p_auction_id: auctionId,
        p_lot_id: lot1Id,
        p_team_id: hostTeamId,
        p_request_id: crypto.randomUUID(),
        p_is_bot: false,
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    // Wait for SOLD
    const settled = await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status, winning_team_id').eq('id', lot1Id).single(),
      (r) => r.data?.status === 'SOLD',
      60000
    );
    
    expect(settled).not.toBeNull();
    expect(settled.data.winning_team_id).toBe(hostTeamId);
  });

  test('S13 & S14: Timer Expiry → SOLD', async () => {
    // Lot 1 already settled in S9
    const { data: lotState } = await supabase
      .from('auction_lots')
      .select('status, winning_bid')
      .eq('id', lot1Id)
      .single();
    expect(lotState.status).toBe('SOLD');
    expect(lotState.winning_bid).toBeGreaterThan(0);
  });

  test('S21: Post-Win State', async () => {
    const { data: lotData } = await supabase
      .from('auction_lots')
      .select('winning_team_id, winning_bid')
      .eq('id', lot1Id)
      .single();
    
    const { data: teamData } = await supabase
      .from('teams')
      .select('purse, initial_purse, players_bought')
      .eq('id', lotData.winning_team_id)
      .single();

    expect(teamData.purse).toBe(teamData.initial_purse - lotData.winning_bid);
    expect(teamData.players_bought).toBe(1);
  });

  test('S20: Multi-Lot Transition', async () => {
    const result = await pollUntil(
      supabase,
      () => supabase.from('auctions').select('current_lot_id, status').eq('id', auctionId).single(),
      (r) => r.data?.current_lot_id && r.data.current_lot_id !== lot1Id,
      20000
    );
    expect(result).not.toBeNull();
    lot2Id = result.data.current_lot_id;
    expect(lot2Id).not.toBe(lot1Id);
  });

  test('S26: Full Lot Lifecycle (Lot 2)', async () => {
    test.setTimeout(150000); // Allow time for long bidding war
    await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lot2Id).single(),
      (r) => r.data?.status === 'BIDDING',
      15000
    );

    const result = await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lot2Id).single(),
      (r) => r.data?.status === 'SOLD' || r.data?.status === 'UNSOLD',
      120000,
      2000
    );
    expect(result).not.toBeNull();
    expect(['SOLD', 'UNSOLD']).toContain(result.data.status);
  });

  test('S27: Auction Completion', async () => {
    test.setTimeout(150000);
    const result = await pollUntil(
      supabase,
      () => supabase.from('auctions').select('status').eq('id', auctionId).single(),
      (r) => r.data?.status === 'COMPLETED',
      120000,
      3000
    );
    expect(result).not.toBeNull();
    expect(result.data.status).toBe('COMPLETED');
  });
});

// ============================================================
// UNSOLD TEST SUITE
// ============================================================
test.describe.serial('Phase 13A — UNSOLD Scenario', () => {
  let supabase: any;
  let runId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let playerSetId: string;

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    runId = setup.runId;

    const ps = await createBoundedTestPlayerSet(supabase);
    playerSetId = ps.playerSetId;

    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: {
        default_purse: 5, // 5 Crores → 500 Lakhs for bots
        max_squad_size: 25,
        max_overseas: 8,
      },
      defaultPurse: 500, // Host purse
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;
    hostTeamId = auction.hostTeamId;
  });

  test.afterAll(async () => {
    if (roomId && supabase) {
      try { await cleanupDisposableAuction(supabase, roomId); } catch (e) { }
    }
    if (playerSetId && supabase) {
      await cleanupBoundedTestPlayerSet(supabase, playerSetId);
    }
  });

  test('S15: UNSOLD — Timer Expiry with No Bids', async () => {
    test.setTimeout(180000); // Allow time for ticker to cycle
    const { error: startErr } = await supabase.rpc('v3_start_auction', { p_room_id: roomId });
    expect(startErr).toBeNull();

    // Wait until at least one lot becomes UNSOLD or the auction completes
    const result = await pollUntil(
      supabase,
      async () => {
        const { data: unsoldLots, error: lotsErr } = await supabase
          .from('auction_lots')
          .select('id, status, base_price')
          .eq('auction_id', auctionId)
          .eq('status', 'UNSOLD');
        expect(lotsErr).toBeNull();
        return unsoldLots;
      },
      (lots) => lots && lots.length > 0,
      120000
    );

    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThan(0);
    const unsoldLotId = result[0].id;

    // Verify there are no bids for this lot
    const { data: bids } = await supabase
      .from('bids')
      .select('id')
      .eq('lot_id', unsoldLotId);
      
    expect(bids?.length || 0).toBe(0);
  });
});

// ============================================================
// PURSE SAFETY TEST SUITE
// ============================================================
test.describe.serial('Phase 13A — Purse Safety', () => {
  let supabase: any;
  let runId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let playerSetId: string;

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    runId = setup.runId;

    const ps = await createBoundedTestPlayerSet(supabase);
    playerSetId = ps.playerSetId;

    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: { default_purse: 100, max_squad_size: 25, max_overseas: 8 },
      defaultPurse: 50, // 50 Lakhs (insufficient for base_price 100L)
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;
    hostTeamId = auction.hostTeamId;
  });

  test.afterAll(async () => {
    if (roomId && supabase) {
      try { await cleanupDisposableAuction(supabase, roomId); } catch (e) { }
    }
    if (playerSetId && supabase) {
      await cleanupBoundedTestPlayerSet(supabase, playerSetId);
    }
  });

  test('S10: Purse Safety — ERR_INSUFFICIENT_PURSE', async () => {
    const { data: startData } = await supabase.rpc('v3_start_auction', { p_room_id: roomId });
    const lotId = startData.lot_id;

    await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lotId).single(),
      (r) => r.data?.status === 'BIDDING',
      15000
    );

    const { data: bidData, error: bidErr } = await supabase.rpc('v3_place_bid', {
      p_auction_id: auctionId,
      p_lot_id: lotId,
      p_team_id: hostTeamId,
      p_request_id: crypto.randomUUID(),
      p_is_bot: false,
    });
    
    expect(bidErr).toBeNull();
    expect(bidData.success).toBe(false);
    expect(bidData.error).toBe('ERR_INSUFFICIENT_PURSE');
  });
});

// ============================================================
// SQUAD SAFETY TEST SUITE
// ============================================================
test.describe.serial('Phase 13A — Squad Safety', () => {
  let supabase: any;
  let runId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let playerSetId: string;

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    runId = setup.runId;

    const ps = await createBoundedTestPlayerSet(supabase);
    playerSetId = ps.playerSetId;

    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: { default_purse: 100, max_squad_size: 1, max_overseas: 8 },
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;
    hostTeamId = auction.hostTeamId;
  });

  test.afterAll(async () => {
    if (roomId && supabase) {
      try { await cleanupDisposableAuction(supabase, roomId); } catch (e) { }
    }
    if (playerSetId && supabase) {
      await cleanupBoundedTestPlayerSet(supabase, playerSetId);
    }
  });

  test('S11: Squad Safety — ERR_SQUAD_LIMIT_REACHED', async () => {
    const { data: startData } = await supabase.rpc('v3_start_auction', { p_room_id: roomId });
    const lot1Id = startData.lot_id;

    await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lot1Id).single(),
      (r) => r.data?.status === 'BIDDING',
      15000
    );

    // Explicit prerequisite: Human MUST bid and win Lot 1
    // Keep bidding until we are highest and wait for SOLD
    // Explicit prerequisite: Human MUST bid and win Lot 1
    // Keep bidding until we are highest and wait for SOLD
    const MAX_S11_LOOP = 30;
    let s11LoopCount = 0;
    for (; s11LoopCount < MAX_S11_LOOP; s11LoopCount++) {
      const { data: lotState } = await supabase
        .from('auction_lots')
        .select('status, highest_bidder_team_id')
        .eq('id', lot1Id)
        .single();
        
      if (lotState?.status === 'SOLD' || lotState?.status === 'UNSOLD') break;
      
      if (lotState?.highest_bidder_team_id !== hostTeamId) {
        await supabase.rpc('v3_place_bid', {
          p_auction_id: auctionId,
          p_lot_id: lot1Id,
          p_team_id: hostTeamId,
          p_request_id: crypto.randomUUID(),
          p_is_bot: false,
        });
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    expect(s11LoopCount).toBeLessThan(MAX_S11_LOOP); // Prevent silent timeout success

    const settledResult = await supabase.from('auction_lots').select('status, winning_team_id').eq('id', lot1Id).single();
    
    // Explicit Assertions for Prerequisites
    expect(settledResult).not.toBeNull();
    expect(settledResult.data.status).toBe('SOLD');
    expect(settledResult.data.winning_team_id).toBe(hostTeamId);

    const { data: teamState } = await supabase
      .from('teams')
      .select('players_bought')
      .eq('id', hostTeamId)
      .single();
    
    expect(teamState.players_bought).toBe(1);

    // Wait for Lot 2
    const lot2Result = await pollUntil(
      supabase,
      () => supabase.from('auctions').select('current_lot_id').eq('id', auctionId).single(),
      (r) => r.data?.current_lot_id && r.data.current_lot_id !== lot1Id,
      20000
    );
    
    expect(lot2Result).not.toBeNull();
    const lot2Id = lot2Result.data.current_lot_id;

    await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lot2Id).single(),
      (r) => r.data?.status === 'BIDDING',
      15000
    );

    // Attempt bid on Lot 2
    const { data: bidData } = await supabase.rpc('v3_place_bid', {
      p_auction_id: auctionId,
      p_lot_id: lot2Id,
      p_team_id: hostTeamId,
      p_request_id: crypto.randomUUID(),
      p_is_bot: false,
    });
    
    expect(bidData.success).toBe(false);
    expect(bidData.error).toBe('ERR_SQUAD_LIMIT_REACHED');
  });
});

// ============================================================
// OVERSEAS SAFETY TEST SUITE
// ============================================================
test.describe.serial('Phase 13A — Overseas Safety', () => {
  let supabase: any;
  let runId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let playerSetId: string;

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    runId = setup.runId;

    const { data: { user } } = await supabase.auth.getUser();
    playerSetId = crypto.randomUUID();

    await supabase.from('player_sets').insert({
      id: playerSetId,
      name: `Overseas Test Set ${playerSetId.substring(0, 8)}`,
      description: 'Test set for overseas limit validation',
      created_by: user!.id,
      is_public: false,
    });

    await supabase.from('players').insert([
      { id: crypto.randomUUID(), player_set_id: playerSetId, name: 'Overseas 1', role: 'BATSMAN', category: 'D', base_price: 100, is_overseas: true, country: 'Australia' },
      { id: crypto.randomUUID(), player_set_id: playerSetId, name: 'Overseas 2', role: 'BOWLER', category: 'D', base_price: 100, is_overseas: true, country: 'England' },
      { id: crypto.randomUUID(), player_set_id: playerSetId, name: 'Overseas 3', role: 'ALL_ROUNDER', category: 'D', base_price: 100, is_overseas: true, country: 'South Africa' },
    ]);

    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: { default_purse: 100, max_squad_size: 25, max_overseas: 1 },
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;
    hostTeamId = auction.hostTeamId;
  });

  test.afterAll(async () => {
    if (roomId && supabase) {
      try { await cleanupDisposableAuction(supabase, roomId); } catch (e) { }
    }
    if (playerSetId && supabase) {
      await cleanupBoundedTestPlayerSet(supabase, playerSetId);
    }
  });

  test('S12: Overseas Safety — ERR_OVERSEAS_LIMIT', async () => {
    const { data: startData } = await supabase.rpc('v3_start_auction', { p_room_id: roomId });
    const lot1Id = startData.lot_id;

    // Prerequisite: Assert Lot 1 is overseas
    const { data: lot1Info } = await supabase
      .from('auction_lots')
      .select('players(is_overseas)')
      .eq('id', lot1Id)
      .single();
    expect(lot1Info.players.is_overseas).toBe(true);

    await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lot1Id).single(),
      (r) => r.data?.status === 'BIDDING',
      15000
    );

    // Human bids on overseas Lot 1 and wins it
    // Human bids on overseas Lot 1 and wins it
    const MAX_S12_LOOP = 30;
    let s12LoopCount = 0;
    for (; s12LoopCount < MAX_S12_LOOP; s12LoopCount++) {
      const { data: lotState } = await supabase
        .from('auction_lots')
        .select('status, highest_bidder_team_id')
        .eq('id', lot1Id)
        .single();
        
      if (lotState?.status === 'SOLD' || lotState?.status === 'UNSOLD') break;
      
      if (lotState?.highest_bidder_team_id !== hostTeamId) {
        await supabase.rpc('v3_place_bid', {
          p_auction_id: auctionId,
          p_lot_id: lot1Id,
          p_team_id: hostTeamId,
          p_request_id: crypto.randomUUID(),
          p_is_bot: false,
        });
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    expect(s12LoopCount).toBeLessThan(MAX_S12_LOOP); // Prevent silent timeout success

    const settled = await supabase.from('auction_lots').select('status, winning_team_id').eq('id', lot1Id).single();
    
    expect(settled).not.toBeNull();
    expect(settled.data.status).toBe('SOLD');
    expect(settled.data.winning_team_id).toBe(hostTeamId);

    const { data: teamState } = await supabase
      .from('teams')
      .select('overseas_count')
      .eq('id', hostTeamId)
      .single();
    
    expect(teamState.overseas_count).toBe(1);

    const lot2Result = await pollUntil(
      supabase,
      () => supabase.from('auctions').select('current_lot_id').eq('id', auctionId).single(),
      (r) => r.data?.current_lot_id && r.data.current_lot_id !== lot1Id,
      20000
    );
    
    expect(lot2Result).not.toBeNull();
    const lot2Id = lot2Result.data.current_lot_id;

    // Prerequisite: Assert Lot 2 is overseas
    const { data: lot2Info } = await supabase
      .from('auction_lots')
      .select('players(is_overseas)')
      .eq('id', lot2Id)
      .single();
    expect(lot2Info.players.is_overseas).toBe(true);

    await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lot2Id).single(),
      (r) => r.data?.status === 'BIDDING',
      15000
    );

    // Attempt to bid on overseas Lot 2
    const { data: bidData } = await supabase.rpc('v3_place_bid', {
      p_auction_id: auctionId,
      p_lot_id: lot2Id,
      p_team_id: hostTeamId,
      p_request_id: crypto.randomUUID(),
      p_is_bot: false,
    });
    
    expect(bidData.success).toBe(false);
    expect(bidData.error).toBe('ERR_OVERSEAS_LIMIT');
  });
});

// ============================================================
// CONCURRENCY TEST SUITE
// ============================================================
test.describe.serial('Phase 13A — Concurrency', () => {
  let supabase: any;
  let runId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let playerSetId: string;

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    runId = setup.runId;

    const ps = await createBoundedTestPlayerSet(supabase);
    playerSetId = ps.playerSetId;

    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: { default_purse: 100, max_squad_size: 25, max_overseas: 8 },
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;
    hostTeamId = auction.hostTeamId;
  });

  test.afterAll(async () => {
    if (roomId && supabase) {
      try { await cleanupDisposableAuction(supabase, roomId); } catch (e) { }
    }
    if (playerSetId && supabase) {
      await cleanupBoundedTestPlayerSet(supabase, playerSetId);
    }
  });

  test('S19: Concurrency — Overlapping Bid Requests', async () => {
    const { data: startData } = await supabase.rpc('v3_start_auction', { p_room_id: roomId });
    const lot1Id = startData.lot_id;

    await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lot1Id).single(),
      (r: any) => r.data?.status === 'BIDDING',
      15000
    );

    // Fire two identical overlapping requests for the same team simultaneously
    const req1 = supabase.rpc('v3_place_bid', {
      p_auction_id: auctionId,
      p_lot_id: lot1Id,
      p_team_id: hostTeamId,
      p_request_id: crypto.randomUUID(),
      p_is_bot: false,
    });

    const req2 = supabase.rpc('v3_place_bid', {
      p_auction_id: auctionId,
      p_lot_id: lot1Id,
      p_team_id: hostTeamId,
      p_request_id: crypto.randomUUID(),
      p_is_bot: false,
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    
    // Assert no RPC transport errors
    expect(res1.error).toBeNull();
    expect(res2.error).toBeNull();

    // One must succeed, one must fail or be ignored (due to state change / identical bid amount)
    const successCount = (res1.data?.success === true ? 1 : 0) + (res2.data?.success === true ? 1 : 0);
    const failCount = (res1.data?.success === false ? 1 : 0) + (res2.data?.success === false ? 1 : 0);
    
    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    // Verify DB integrity (only 1 human bid should exist for this tick sequence)
    const { data: bids } = await supabase
      .from('bids')
      .select('*')
      .eq('lot_id', lot1Id)
      .eq('team_id', hostTeamId);
      
    expect(bids?.length).toBe(1);
  });
});

// ============================================================
// MULTI-BOT PARTICIPATION TEST SUITE
// ============================================================
test.describe.serial('Phase 13A — Multi-Bot', () => {
  let supabase: any;
  let runId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let playerSetId: string;

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    runId = setup.runId;

    const ps = await createBoundedTestPlayerSet(supabase);
    playerSetId = ps.playerSetId;

    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: { default_purse: 10000, max_squad_size: 25, max_overseas: 8 },
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;
    hostTeamId = auction.hostTeamId;
  });

  test.afterAll(async () => {
    if (roomId && supabase) {
      try { await cleanupDisposableAuction(supabase, roomId); } catch (e) { }
    }
    if (playerSetId && supabase) {
      await cleanupBoundedTestPlayerSet(supabase, playerSetId);
    }
  });

  test('S18: Multi-bot Participation (Isolated)', async () => {
    const { data: startData } = await supabase.rpc('v3_start_auction', { p_room_id: roomId });
    const lot1Id = startData.lot_id;

    await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status').eq('id', lot1Id).single(),
      (r: any) => r.data?.status === 'BIDDING',
      15000
    );

    // Wait for at least 2 distinct bots to participate naturally without human interference
    const result = await pollUntil(
      supabase,
      () => supabase.from('bids').select('team_id').eq('lot_id', lot1Id).eq('is_bot', true),
      (r: any) => {
        if (!r.data) return false;
        const unique = new Set(r.data.map((b: any) => b.team_id));
        return unique.size >= 2;
      },
      35000
    );
    
    expect(result).not.toBeNull();
    const uniqueBots = new Set((result.data || []).map((b: any) => b.team_id));
    expect(uniqueBots.size).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// PAUSE / RESUME TEST SUITE
// ============================================================
test.describe.serial('Phase 13A — Pause/Resume', () => {
  let supabase: any;
  let runId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let playerSetId: string;

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    runId = setup.runId;

    const ps = await createBoundedTestPlayerSet(supabase);
    playerSetId = ps.playerSetId;

    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: { default_purse: 10000, max_squad_size: 25, max_overseas: 8 },
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;
    hostTeamId = auction.hostTeamId;
  });

  test.afterAll(async () => {
    if (roomId && supabase) {
      try { await cleanupDisposableAuction(supabase, roomId); } catch (e) { }
    }
    if (playerSetId && supabase) {
      await cleanupBoundedTestPlayerSet(supabase, playerSetId);
    }
  });

  test('S16 & S17: Pause and Resume', async () => {
    const { error: startError } = await supabase.rpc('v3_start_auction', { p_room_id: roomId });
    expect(startError).toBeNull();

    // 1. Pause
    const { data: pauseData, error: pauseError } = await supabase.rpc('pause_auction', { 
      p_auction_id: auctionId, 
      p_reason: 'Admin break' 
    });
    expect(pauseError).toBeNull();
    expect(pauseData).toBeDefined();

    const { data: pauseState, error: pauseStateErr } = await supabase.from('auctions').select('status').eq('id', auctionId).single();
    expect(pauseStateErr).toBeNull();
    expect(pauseState.status).toBe('PAUSED');

    // 2. Resume
    const { data: resumeData, error: resumeError } = await supabase.rpc('resume_auction', { 
      p_auction_id: auctionId 
    });
    expect(resumeError).toBeNull();
    expect(resumeData).toBeDefined();

    const { data: resumeState, error: resumeStateErr } = await supabase.from('auctions').select('status').eq('id', auctionId).single();
    expect(resumeStateErr).toBeNull();
    expect(resumeState.status).toBe('IN_PROGRESS');
  });
});

// ============================================================
// NON-RUNTIME SCENARIOS — CODE TRACE ONLY / NOT EXECUTABLE
// ============================================================
test.describe('Phase 13A — Non-Runtime Scenarios', () => {
  test('S4: Bot Eligibility — CODE TRACE ONLY', async () => {
    test.skip();
  });

  test('S23: PendingAction — CODE TRACE ONLY', async () => {
    test.skip();
  });

  test('S24: Phase 6/7/13 Ordering — CODE TRACE ONLY', async () => {
    test.skip();
  });

  test('S25: Information Firewall — CODE TRACE ONLY', async () => {
    test.skip();
  });
});
