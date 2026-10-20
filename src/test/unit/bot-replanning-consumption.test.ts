import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBotMemory,
  recordBotBidObservation,
  recordRivalBidObservation,
  syncBotMemoryWithState,
  clearAuctionMemory,
  clearBotMemory
} from '@/lib/auction/bot-brain-memory';
import {
  updateBotBrainState,
  getBotBrainState,
  clearBrainStateCache
} from '@/lib/auction/bot-brain-state';
import {
  evaluateBotsForLot,
  DEFAULT_CONTEXT,
  type AuctionContext,
  type BotDecisionEvidence,
  getRoleNeed,
  computeFutureQualityMap
} from '@/lib/auction/server-bot-engine';
import { evaluateTacticalDecision } from '@/lib/auction/bot-tactical-engine';
import { evaluateQAndTV } from '@/lib/auction/bot-q-engine';
import { type V3Player, type V3Team } from '@/lib/v3-auction-types';

describe('Behavior B17-B: Replanning & Next-Action Consumption', () => {
  const auctionId = 'auction-b17b';
  const botTeamId = 'bot-team-alpha';
  const rival1Id = 'rival-team-1';
  const rival2Id = 'rival-team-2';
  const rival3Id = 'rival-team-3';

  beforeEach(() => {
    clearAuctionMemory(auctionId);
    clearBrainStateCache();
  });

  const makeBot = (overrides: Partial<V3Team> = {}): V3Team => ({
    id: botTeamId,
    name: 'Alpha Bot',
    short_name: 'ALPHA',
    is_bot: true,
    purse: 8000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 1,
    ...overrides
  });

  const makeRival = (id: string, overrides: Partial<V3Team> = {}): V3Team => ({
    id,
    name: `Rival ${id}`,
    short_name: id.toUpperCase().slice(0, 4),
    is_bot: true,
    purse: 8000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 1,
    ...overrides
  });

  const makePlayer = (id: string, overrides: Partial<V3Player> = {}): V3Player => ({
    id,
    name: `Player ${id}`,
    role: 'BATSMAN',
    category: 'B',
    country: 'India',
    age: 26,
    batting_hand: 'Right Handed',
    base_price: 200,
    is_overseas: false,
    image_url: null,
    rating: 82,
    created_at: new Date().toISOString(),
    ...overrides
  });

  // ============================================================
  // TEST 1 — RIVAL EVENT → REPLAN
  // ============================================================
  it('TEST 1 — RIVAL EVENT → REPLAN: Rival bid observation updates brain state and triggers tactical replan', () => {
    const candidatePlayer = makePlayer('p-rival-test', {
      base_price: 200,
      category: 'B',
      rating: 85,
      matches: 70,
      runs: 2200,
      batting_average: 34,
      strike_rate: 136,
      role: 'BATSMAN'
    });

    // Opportunistic bot evaluates candidate lot
    const bot = makeBot({ personality: 'OPPORTUNISTIC' } as any);
    const rival1 = makeRival(rival1Id);
    const rival2 = makeRival(rival2Id);
    const rival3 = makeRival(rival3Id);
    const allTeams = [bot, rival1, rival2, rival3];

    // Rivals with critical batsman need to create thirsty rival background
    const teamRosters: Record<string, V3Player[]> = {
      [bot.id]: [],
      [rival1.id]: [],
      [rival2.id]: [],
      [rival3.id]: []
    };

    const ctx: AuctionContext = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      maxOverseas: 8,
      totalLots: 50,
      lotsCompleted: 10,
      lotsRemaining: 40,
      auctionProgress: 0.20,
      futurePlayers: [
        { role: 'BATSMAN', category: 'B', base_price: 200, is_overseas: false }
      ]
    };

    // 1. BEFORE: Baseline evaluation at opening bid (200 on 200 base)
    // Low bid pressure at opening: rivalAggression = 3/3 * 0.6 + 0 = 0.60 (<= 0.75)
    const baselineBrainState = updateBotBrainState({
      auctionId,
      teamId: bot.id,
      bot,
      botRoster: [],
      currentBid: 200,
      basePrice: 200,
      playerRole: candidatePlayer.role,
      playerIsOverseas: candidatePlayer.is_overseas,
      allTeams,
      teamRosters,
      ctx
    });

    expect(baselineBrainState.beliefs.rivalAggression).toBeLessThanOrEqual(0.75);

    const baselineEvidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      candidatePlayer,
      200,
      200,
      undefined,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      null,
      baselineEvidence,
      auctionId
    );

    expect(baselineEvidence.length).toBe(1);
    expect(baselineEvidence[0]!.decision).toBe('ENTER');
    expect(baselineEvidence[0]!.actionReason).toBe('TV_FAVORABLE');

    // 2. EVENT: Rival places an aggressive bid of 600 on the lot
    recordRivalBidObservation(auctionId, bot.id, candidatePlayer.id, rival1.id, 600);

    // Verify B17-A capture
    const memory = getBotMemory(auctionId, bot.id);
    expect(memory.observedRivalBids[candidatePlayer.id]?.highestBid).toBe(600);
    expect(memory.observedRivalBids[candidatePlayer.id]?.bidderTeamId).toBe(rival1.id);

    // 3. REPLAN / STATE REFRESH: Brain state recalculates with updated bid and rival pressure
    const refreshedBrainState = updateBotBrainState({
      auctionId,
      teamId: bot.id,
      bot,
      botRoster: [],
      currentBid: 600,
      basePrice: 200,
      playerRole: candidatePlayer.role,
      playerIsOverseas: candidatePlayer.is_overseas,
      allTeams,
      teamRosters,
      ctx
    });

    // Elevated bid pressure pushes rivalAggression > 0.75 (0.60 + 0.20 = 0.80)
    expect(refreshedBrainState.beliefs.rivalAggression).toBeGreaterThan(0.75);

    // 4. AFTER: Re-evaluation of the bot consumes the refreshed rival aggression belief
    const replannedEvidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      candidatePlayer,
      600,
      200,
      rival1.id,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      null,
      replannedEvidence,
      auctionId
    );

    expect(replannedEvidence.length).toBe(1);
    // Opportunistic bot facing >0.75 rival pressure with marginal surplus tactically retreats (RIVAL_BAIT_DROP)
    expect(replannedEvidence[0]!.decision).toBe('DROP');
    expect(replannedEvidence[0]!.actionReason).toBe('RIVAL_BAIT_DROP');

    // Also verify Price Exceeds TV branch when rival bids exceed TV
    const exceedEvidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      candidatePlayer,
      1400, // Exceeds TV (TV is 1000)
      200,
      rival1.id,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      null,
      exceedEvidence,
      auctionId
    );
    expect(exceedEvidence[0]!.decision).toBe('DROP');
    expect(exceedEvidence[0]!.actionReason).toBe('PRICE_EXCEEDS_TV');
  });

  // ============================================================
  // TEST 2 — OWN PURCHASE → REPLAN
  // ============================================================
  it('TEST 2 — OWN PURCHASE → REPLAN: Own purchase updates roster and memory, recalculating role need and urgency', () => {
    const wkPlayer1 = makePlayer('wk-1', { role: 'WICKET_KEEPER', base_price: 100 });
    const wkPlayer2 = makePlayer('wk-2', { role: 'WICKET_KEEPER', base_price: 100 });

    const bot = makeBot({ players_bought: 0, purse: 9000 });
    const rival = makeRival(rival1Id);
    const allTeams = [bot, rival];
    const teamRosters: Record<string, V3Player[]> = {
      [bot.id]: [],
      [rival.id]: []
    };

    const ctx: AuctionContext = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      totalLots: 50,
      lotsCompleted: 5,
      lotsRemaining: 45,
      auctionProgress: 0.10
    };

    // 1. BEFORE: Bot has 0 WKs. Role need is CRITICAL.
    const initialNeed = getRoleNeed('WICKET_KEEPER', 0, 25, 25);
    expect(initialNeed.need).toBe('CRITICAL');

    const beforeState = updateBotBrainState({
      auctionId,
      teamId: bot.id,
      bot,
      botRoster: [],
      currentBid: 100,
      basePrice: 100,
      playerRole: 'WICKET_KEEPER',
      playerIsOverseas: false,
      allTeams,
      teamRosters,
      ctx
    });
    expect(beforeState.beliefs.roleScarcityPanic).toBe(1.0); // CRITICAL need -> 1.0 panic

    // 2. EVENT: Bot wins and purchases wk-1
    const soldLot = {
      id: 'lot-wk-1',
      status: 'SOLD',
      player_id: wkPlayer1.id,
      winning_team_id: bot.id,
      winning_bid: 300,
      base_price: 100,
      players: { role: 'WICKET_KEEPER' }
    };

    // Initialize baseline lot tracking then sync completed lot
    syncBotMemoryWithState(auctionId, bot.id, 'lot-wk-1', []);
    const updatedMemory = syncBotMemoryWithState(auctionId, bot.id, 'lot-wk-2', [soldLot]);

    expect(updatedMemory.purchases.length).toBe(1);
    expect(updatedMemory.purchases[0]!.playerId).toBe(wkPlayer1.id);
    expect(updatedMemory.lotsSinceLastPurchase).toBe(0); // Reset on purchase

    // Update authoritative bot roster
    const updatedRoster = [wkPlayer1];
    teamRosters[bot.id] = updatedRoster;
    bot.players_bought = 1;
    bot.purse -= 300;

    // 3. AFTER: Re-evaluate for the next WK player (wkPlayer2)
    const afterNeed = getRoleNeed('WICKET_KEEPER', 1, 24, 25);
    // Role need is no longer CRITICAL (downgrades to HIGH or lower)
    expect(afterNeed.need).not.toBe('CRITICAL');

    const afterState = updateBotBrainState({
      auctionId,
      teamId: bot.id,
      bot,
      botRoster: updatedRoster,
      currentBid: 100,
      basePrice: 100,
      playerRole: 'WICKET_KEEPER',
      playerIsOverseas: false,
      allTeams,
      teamRosters,
      ctx
    });

    // Panic drops from 1.0 down to 0.7 or lower
    expect(afterState.beliefs.roleScarcityPanic).toBeLessThan(beforeState.beliefs.roleScarcityPanic);

    // Verify server engine reflects recalculated need in evidence
    const evidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      wkPlayer2,
      100,
      100,
      undefined,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      null,
      evidence,
      auctionId
    );

    expect(evidence.length).toBe(1);
    expect(evidence[0]!.decision).toBe('ENTER');
  });

  // ============================================================
  // TEST 3 — RIVAL PURCHASE → FUTURE PLAN UPDATE
  // ============================================================
  it('TEST 3 — RIVAL PURCHASE → FUTURE PLAN UPDATE: Rival purchase of future replacement updates opportunity cost and future pool', () => {
    const candidateBatsman = makePlayer('bat-block', {
      role: 'BATSMAN',
      category: 'B',
      base_price: 200,
      rating: 82
    });

    const bot = makeBot();

    // Future pool contains 1 elite/marquee replacement batsman
    const futurePoolBefore = [
      { player_id: 'future-bat-1', role: 'BATSMAN', category: 'MARQUEE', base_price: 200, is_overseas: false },
      { player_id: 'future-bowler-1', role: 'BOWLER', category: 'B', base_price: 100, is_overseas: false }
    ];

    // 1. BEFORE: Evaluate Q and opportunity cost (qSkip) with marquee replacement available
    const qBefore = evaluateQAndTV(
      candidateBatsman,
      futurePoolBefore,
      { purse: bot.purse, playersBought: bot.players_bought, overseasCount: bot.overseas_count, roleCounts: { BATSMAN: 0 } },
      200,
      false,
      { maxSquadSize: 25, maxOverseas: 8 }
    );

    const qualityBefore = computeFutureQualityMap(futurePoolBefore);
    expect(qualityBefore['BATSMAN']?.avgEstRating).toBe(88); // MARQUEE category est ~88

    // 2. EVENT: Rival purchases the marquee replacement batsman in a prior lot
    const rivalPurchasedLot = {
      id: 'lot-future-bat-1',
      status: 'SOLD',
      player_id: 'future-bat-1',
      winning_team_id: rival1Id,
      winning_bid: 1200,
      base_price: 200,
      players: { role: 'BATSMAN' }
    };

    syncBotMemoryWithState(auctionId, bot.id, 'lot-future-bat-1', []);
    const memAfterRivalWin = syncBotMemoryWithState(auctionId, bot.id, candidateBatsman.id, [rivalPurchasedLot]);

    expect(memAfterRivalWin.rivalPurchases.length).toBe(1);
    expect(memAfterRivalWin.rivalPurchases[0]!.playerId).toBe('future-bat-1');
    expect(memAfterRivalWin.rivalPurchases[0]!.winnerId).toBe(rival1Id);

    // 3. AFTER: Future pool reflects loss of that player (it is completed and no longer pending)
    const futurePoolAfter = [
      { player_id: 'future-bowler-1', role: 'BOWLER', category: 'B', base_price: 100, is_overseas: false }
    ];

    const qAfter = evaluateQAndTV(
      candidateBatsman,
      futurePoolAfter,
      { purse: bot.purse, playersBought: bot.players_bought, overseasCount: bot.overseas_count, roleCounts: { BATSMAN: 0 } },
      200,
      false,
      { maxSquadSize: 25, maxOverseas: 8 }
    );

    const qualityAfter = computeFutureQualityMap(futurePoolAfter);
    expect(qualityAfter['BATSMAN']).toBeUndefined(); // No future batsmen remain

    // Loss of the marquee alternative in the future pool lowers qSkip (opportunity cost of waiting)
    expect(qAfter.qSkip).toBeLessThan(qBefore.qSkip);
    // Marginal surplus (qBuy - qSkip) of taking the current player increases
    expect(qAfter.qBuyAtRequiredBid - qAfter.qSkip).toBeGreaterThan(qBefore.qBuyAtRequiredBid - qBefore.qSkip);
  });

  // ============================================================
  // TEST 4 — STALE/IRRELEVANT MEMORY MUST NOT CAUSE RANDOM REACTION
  // ============================================================
  it('TEST 4 — STALE/IRRELEVANT MEMORY: Irrelevant memory events do not alter decision on unrelated player', () => {
    const bowler = makePlayer('bowler-target', {
      role: 'BOWLER',
      category: 'B',
      base_price: 200
    });

    const bot = makeBot({ personality: 'BALANCED' } as any);
    const rival = makeRival(rival1Id);
    const allTeams = [bot, rival];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [], [rival.id]: [] };

    const ctx: AuctionContext = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      totalLots: 50,
      lotsCompleted: 10,
      lotsRemaining: 40,
      auctionProgress: 0.20
    };

    // 1. Baseline evaluation without irrelevant memory
    const baselineEvidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      bowler,
      200,
      200,
      undefined,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      null,
      baselineEvidence,
      auctionId
    );

    const baseDecision = baselineEvidence[0]!.decision;
    const baseReason = baselineEvidence[0]!.actionReason;
    const baseValuation = baselineEvidence[0]!.valuation;

    // 2. Inject completely irrelevant memory (rival bids on an unrelated WK player in another lot)
    recordRivalBidObservation(auctionId, bot.id, 'unrelated-wk-lot', rival1Id, 950);
    recordBotBidObservation(auctionId, bot.id, 'unrelated-allrounder-lot', 400);

    const memory = getBotMemory(auctionId, bot.id);
    expect(memory.observedRivalBids['unrelated-wk-lot']).toBeDefined();
    expect(memory.observedBids['unrelated-allrounder-lot']).toBeDefined();

    // 3. Re-evaluate same bowler lot with identical context
    const afterEvidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      bowler,
      200,
      200,
      undefined,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      null,
      afterEvidence,
      auctionId
    );

    // Negative control: Decision, reason, and valuation must remain 100% deterministic and unaffected
    expect(afterEvidence[0]!.decision).toBe(baseDecision);
    expect(afterEvidence[0]!.actionReason).toBe(baseReason);
    expect(afterEvidence[0]!.valuation).toBe(baseValuation);
  });

  // ============================================================
  // TEST 5 — B13 REGRESSION
  // ============================================================
  it('TEST 5 — B13 REGRESSION: isFinalBid flag in memory preserves One-Last-Bid repeat prevention', () => {
    const lotId = 'lot-b13-stretch';
    const player = makePlayer(lotId, { base_price: 200 });

    // Mark that a final bid was already placed for this lot
    recordBotBidObservation(auctionId, botTeamId, lotId, 600, true);

    const memory = getBotMemory(auctionId, botTeamId);
    expect(memory.observedBids[lotId]?.isFinalBid).toBe(true);

    const brainState = {
      beliefs: { rivalAggression: 0.2, marketInflation: 0.1, roleScarcityPanic: 0.9, estimatedSquadQuality: 0.5 },
      memory,
      plan: { strategicFocus: 'BUILD_CORE', urgency: 0.8, budgetAllocation: {} as any, willSacrificeOverseasForQuality: false }
    };

    // Evaluate tactical decision when price is at TV limit
    const tactical = evaluateTacticalDecision({
      teamId: botTeamId,
      auctionId,
      lotId,
      personality: 'AGGRESSIVE',
      qResult: {
        tv: 600,
        nextRequiredBid: 600,
        currentBid: 550,
        qSkip: 100,
        qBuyAtRequiredBid: 120,
        decision: 'PASS',
        isLegal: true,
        ladderEvaluated: [600]
      },
      roleNeed: 'CRITICAL',
      brainState: brainState as any,
      remainingSlots: 5,
      purse: 5000,
      remainingTimerMs: 10000,
      initialPurse: 10000,
      auctionProgress: 0.50,
      futurePoolCount: 5,
      maxSquadSize: 25
    });

    // Since hasAlreadyPlacedFinalBid is true, STRETCH is forbidden and bot passes
    expect(tactical.action).toBe('PASS');
    expect(tactical.reason).toBe('PRICE_EXCEEDS_TV');
    expect(tactical.isStretched).toBe(false);
  });

  // ============================================================
  // TEST 6 — SERVER INTEGRATION
  // ============================================================
  it('TEST 6 — SERVER INTEGRATION: Real auction event → server bot processing → memory update → replan', () => {
    const candidatePlayer = makePlayer('lot-server-b17b', {
      base_price: 200,
      role: 'BATSMAN',
      category: 'B'
    });

    const bot = makeBot({ id: 'bot-integration', purse: 6000 });
    const rival = makeRival('rival-integration', { purse: 8000 });
    const allTeams = [bot, rival];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [], [rival.id]: [] };

    const ctx: AuctionContext = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      totalLots: 50,
      lotsCompleted: 10,
      lotsRemaining: 40,
      auctionProgress: 0.20,
      futurePlayers: []
    };

    // Step 1: Initial evaluation at opening bid: Bot enters
    const initialEvidence: BotDecisionEvidence[] = [];
    const bids1 = evaluateBotsForLot(
      [bot],
      candidatePlayer,
      200, // On discrete ladder
      200,
      undefined,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      null,
      initialEvidence,
      auctionId
    );

    expect(initialEvidence[0]!.decision).toBe('ENTER');
    expect(bids1.length).toBe(1);
    expect(bids1[0]!.nextBidAmount).toBe(225);

    // Memory captured own bid
    const mem1 = getBotMemory(auctionId, bot.id);
    expect(mem1.observedBids[candidatePlayer.id]?.highestBid).toBe(225);

    // Step 2: Real rival bid event escalates price past TV
    const replanEvidence: BotDecisionEvidence[] = [];
    const bids2 = evaluateBotsForLot(
      [bot],
      candidatePlayer,
      1400, // Escalated bid by rival, exceeds bot's TV (1375)
      200,
      rival.id, // Rival is highest bidder
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      null,
      replanEvidence,
      auctionId
    );

    // Verify rival observation was captured
    const mem2 = getBotMemory(auctionId, bot.id);
    expect(mem2.observedRivalBids[candidatePlayer.id]?.bidderTeamId).toBe(rival.id);
    expect(mem2.observedRivalBids[candidatePlayer.id]?.highestBid).toBe(1400);

    // Verify replanned decision in real engine flow: bot drops out
    expect(replanEvidence[0]!.decision).toBe('DROP');
    expect(replanEvidence[0]!.actionReason).toBe('PRICE_EXCEEDS_TV');
    expect(bids2.length).toBe(0);
  });
});
