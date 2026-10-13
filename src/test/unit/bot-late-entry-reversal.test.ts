import { describe, it, expect } from 'vitest';
import {
  evaluateTacticalDecision,
  evaluatePursePacing,
  type TacticalInputContext
} from '@/lib/auction/bot-tactical-engine';
import {
  evaluateBotsForLot,
  DEFAULT_CONTEXT,
  type AuctionContext,
  type BotDecisionEvidence
} from '@/lib/auction/server-bot-engine';
import { evaluateQAndTV } from '@/lib/auction/bot-q-engine';
import { type V3Player, type V3Team } from '@/lib/v3-auction-types';

describe('Behavior B14: Late Entry Reversal', () => {
  // Candidate player: solid Category B batsman (rating 85, base price 100L)
  const currentLot: V3Player & { rating?: number } = {
    id: 'lot-b14-1',
    name: 'Proven Middle-Order Batsman',
    role: 'BATSMAN',
    category: 'B',
    country: 'India',
    age: 27,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
    rating: 85,
  };

  // Bot franchise: 4000L remaining purse, 5 players bought (20 slots remaining)
  const botTeam: V3Team & { personality?: string } = {
    id: 'bot-b14-franchise',
    name: 'Strategic Franchise',
    short_name: 'STR',
    is_bot: true,
    purse: 4000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 2,
    personality: 'BALANCED',
  };

  // Aggressive bot for B13 regression verification
  const aggressiveBot: V3Team & { personality?: string } = {
    id: 'bot-b14-aggressive',
    name: 'Aggressive Franchise',
    short_name: 'AGG',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 20,
    overseas_count: 5,
    personality: 'AGGRESSIVE',
  };

  // Existing roster already satisfies baseline batsman target, so roleNeed is NORMAL (non-critical)
  const existingRoster: V3Player[] = [
    { id: 'bat-1', name: 'Bat 1', role: 'BATSMAN', category: 'B', country: 'India', age: 25, batting_hand: 'Right Handed', base_price: 100, is_overseas: false, image_url: null },
    { id: 'bat-2', name: 'Bat 2', role: 'BATSMAN', category: 'B', country: 'India', age: 26, batting_hand: 'Left Handed', base_price: 100, is_overseas: false, image_url: null },
    { id: 'bat-3', name: 'Bat 3', role: 'BATSMAN', category: 'B', country: 'India', age: 24, batting_hand: 'Right Handed', base_price: 100, is_overseas: false, image_url: null },
    { id: 'bat-4', name: 'Bat 4', role: 'BATSMAN', category: 'C', country: 'India', age: 23, batting_hand: 'Right Handed', base_price: 50, is_overseas: false, image_url: null },
    { id: 'bat-5', name: 'Bat 5', role: 'BATSMAN', category: 'C', country: 'India', age: 22, batting_hand: 'Left Handed', base_price: 50, is_overseas: false, image_url: null },
  ];

  // Plentiful future player pool for early auction (50 alternatives remain)
  const plentifulFuturePool: V3Player[] = Array.from({ length: 50 }, (_, i) => ({
    id: `future-player-${i}`,
    name: `Future Candidate ${i}`,
    role: i % 2 === 0 ? 'BATSMAN' : 'BOWLER',
    category: 'B',
    country: 'India',
    age: 25,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
  }));

  // Exhausted future player pool for late auction (only 2 alternatives remain <= remaining slots)
  const exhaustedFuturePool: V3Player[] = [
    {
      id: 'future-late-1',
      name: 'Remaining Candidate 1',
      role: 'BATSMAN',
      category: 'C',
      country: 'India',
      age: 24,
      batting_hand: 'Right Handed',
      base_price: 100,
      is_overseas: false,
      image_url: null,
    },
    {
      id: 'future-late-2',
      name: 'Remaining Candidate 2',
      role: 'BOWLER',
      category: 'C',
      country: 'India',
      age: 23,
      batting_hand: 'Right Handed',
      base_price: 50,
      is_overseas: false,
      image_url: null,
    },
  ];

  // Current market bid is elevated to 700 (nextRequiredBid = 775)
  // Avg slot budget: 4000L / 20 slots = 200L/slot
  // Price 775L drains purse for a non-critical role when 50 future alternatives exist
  const currentBid = 700;
  const basePrice = 100;

  // ============================================================
  // TEST 1 — BEFORE: EARLY-STAGE RESOURCE PRESERVATION (PASS)
  // ============================================================
  it('TEST 1 — BEFORE: Bot evaluates player early with ample alternatives and rationally PASSes to preserve purse', () => {
    // 1. Authoritative Q/TV calculation
    const qResultEarly = evaluateQAndTV(
      currentLot,
      plentifulFuturePool,
      {
        purse: botTeam.purse,
        playersBought: botTeam.players_bought,
        overseasCount: botTeam.overseas_count,
        roleCounts: { BATSMAN: 5 },
      },
      currentBid,
      false,
      { maxSquadSize: 25, maxOverseas: 8 }
    );

    // Q/TV invariant: price (775) is economically justifiable within TV (~1175)
    expect(qResultEarly.tv).toBeGreaterThanOrEqual(qResultEarly.nextRequiredBid);

    // 2. Early-stage purse pacing evaluation: 50 candidates, auctionProgress 0.0
    const pacingEarly = evaluatePursePacing({
      purse: botTeam.purse,
      remainingSlots: 20,
      auctionProgress: 0.0,
      futurePoolCount: plentifulFuturePool.length,
      nextRequiredBid: qResultEarly.nextRequiredBid,
      roleNeed: 'NORMAL',
    });

    expect(pacingEarly.pacingState).toBe('EARLY_PRESERVATION');
    expect(pacingEarly.shouldPass).toBe(true);
    expect(pacingEarly.reason).toBe('EARLY_RESOURCE_PRESERVATION');

    // 3. Tactical engine decision
    const tacticalEarly = evaluateTacticalDecision({
      teamId: botTeam.id,
      auctionId: 'auction-b14',
      lotId: currentLot.id,
      personality: 'BALANCED',
      roleNeed: 'NORMAL',
      strategicPolicy: null,
      brainState: null,
      basePrice,
      remainingSlots: 20,
      purse: botTeam.purse,
      remainingTimerMs: 15000,
      initialPurse: botTeam.initial_purse,
      auctionProgress: 0.0,
      futurePoolCount: plentifulFuturePool.length,
      maxSquadSize: 25,
      qResult: qResultEarly,
    });

    console.log('\n--- B14 STATE A (BEFORE) ---');
    console.log('B14_BEFORE_DECISION:', {
      action: tacticalEarly.action,
      reason: tacticalEarly.reason,
      pacingState: tacticalEarly.pacingState,
      bidAmount: tacticalEarly.bidAmount,
      nextRequiredBid: qResultEarly.nextRequiredBid,
      tv: qResultEarly.tv,
      futurePoolCount: plentifulFuturePool.length,
    });

    // Causal expectation: PASS due to early-stage resource preservation
    expect(tacticalEarly.action).toBe('PASS');
    expect(tacticalEarly.reason).toBe('EARLY_RESOURCE_PRESERVATION');
    expect(tacticalEarly.bidAmount).toBe(0);
    expect(tacticalEarly.pacingState).toBe('EARLY_PRESERVATION');
  });

  // ============================================================
  // TEST 2 — AFTER: LATE ENTRY REVERSAL (PASS -> BID)
  // ============================================================
  it('TEST 2 — AFTER: Re-evaluating SAME player after auction state becomes late reverses decision to BID', () => {
    // 1. Authoritative Q/TV calculation with exhausted pool
    const qResultLate = evaluateQAndTV(
      currentLot,
      exhaustedFuturePool,
      {
        purse: botTeam.purse,
        playersBought: botTeam.players_bought,
        overseasCount: botTeam.overseas_count,
        roleCounts: { BATSMAN: 5 },
      },
      currentBid,
      false,
      { maxSquadSize: 25, maxOverseas: 8 }
    );

    // Q/TV invariant: TV remains fully valid and unchanged or stronger due to dwindling alternatives
    expect(qResultLate.tv).toBeGreaterThanOrEqual(qResultLate.nextRequiredBid);

    // 2. Late-stage purse pacing evaluation: 2 candidates, auctionProgress 0.85
    const pacingLate = evaluatePursePacing({
      purse: botTeam.purse,
      remainingSlots: 20,
      auctionProgress: 0.85,
      futurePoolCount: exhaustedFuturePool.length,
      nextRequiredBid: qResultLate.nextRequiredBid,
      roleNeed: 'NORMAL',
    });

    expect(pacingLate.pacingState).toBe('LATE_RELEASE');
    expect(pacingLate.shouldPass).toBe(false);

    // 3. Tactical engine decision for SAME player at SAME bid
    const tacticalLate = evaluateTacticalDecision({
      teamId: botTeam.id,
      auctionId: 'auction-b14',
      lotId: currentLot.id,
      personality: 'BALANCED',
      roleNeed: 'NORMAL',
      strategicPolicy: null,
      brainState: null,
      basePrice,
      remainingSlots: 20,
      purse: botTeam.purse,
      remainingTimerMs: 15000,
      initialPurse: botTeam.initial_purse,
      auctionProgress: 0.85,
      futurePoolCount: exhaustedFuturePool.length,
      maxSquadSize: 25,
      qResult: qResultLate,
    });

    console.log('\n--- B14 STATE B (AFTER REVERSAL) ---');
    console.log('B14_AFTER_DECISION:', {
      action: tacticalLate.action,
      reason: tacticalLate.reason,
      pacingState: tacticalLate.pacingState,
      bidAmount: tacticalLate.bidAmount,
      nextRequiredBid: qResultLate.nextRequiredBid,
      tv: tacticalLate.tv,
      futurePoolCount: exhaustedFuturePool.length,
    });

    // Causal reversal proven: PASS -> BID
    expect(tacticalLate.action).toBe('BID');
    expect(tacticalLate.reason).toBe('TV_FAVORABLE');
    expect(tacticalLate.bidAmount).toBe(775);
    expect(tacticalLate.bidAmount).toBeLessThanOrEqual(tacticalLate.tv);
    expect(tacticalLate.pacingState).toBe('LATE_RELEASE');
  });

  // ============================================================
  // TEST 3 — NEGATIVE CONTROL: HARD CONSTRAINTS PREVENT ENTRY
  // ============================================================
  it('TEST 3 — NEGATIVE CONTROL: Late-entry condition cannot override hard economic or legal constraints', () => {
    // Sub-case A: Economic constraint (price exceeds TV)
    // Price elevated to 1600 (nextRequiredBid = 1750 > TV ~1175)
    const qResultExceedsTv = evaluateQAndTV(
      currentLot,
      exhaustedFuturePool,
      {
        purse: botTeam.purse,
        playersBought: botTeam.players_bought,
        overseasCount: botTeam.overseas_count,
        roleCounts: { BATSMAN: 5 },
      },
      1600,
      false,
      { maxSquadSize: 25, maxOverseas: 8 }
    );

    const tacticalExceedsTv = evaluateTacticalDecision({
      teamId: botTeam.id,
      auctionId: 'auction-b14',
      lotId: currentLot.id,
      personality: 'BALANCED',
      roleNeed: 'NORMAL',
      strategicPolicy: null,
      brainState: null,
      basePrice,
      remainingSlots: 20,
      purse: botTeam.purse,
      remainingTimerMs: 15000,
      initialPurse: botTeam.initial_purse,
      auctionProgress: 0.90,
      futurePoolCount: exhaustedFuturePool.length,
      maxSquadSize: 25,
      qResult: qResultExceedsTv,
    });

    // Must PASS because price exceeds TV, despite late auction
    expect(tacticalExceedsTv.action).toBe('PASS');
    expect(tacticalExceedsTv.reason).toBe('PRICE_EXCEEDS_TV');
    expect(tacticalExceedsTv.bidAmount).toBe(0);

    // Sub-case B: Financial solvency constraint
    // Purse is only 800L with 20 slots remaining:
    // Required reserve for 19 other slots = 19 * 20L = 380L.
    // 800L - 775L = 25L < 380L reserve -> Solvency failure!
    const qResultInsolvent = evaluateQAndTV(
      currentLot,
      exhaustedFuturePool,
      {
        purse: 800,
        playersBought: botTeam.players_bought,
        overseasCount: botTeam.overseas_count,
        roleCounts: { BATSMAN: 5 },
      },
      currentBid,
      false,
      { maxSquadSize: 25, maxOverseas: 8 }
    );

    const tacticalInsolvent = evaluateTacticalDecision({
      teamId: botTeam.id,
      auctionId: 'auction-b14',
      lotId: currentLot.id,
      personality: 'BALANCED',
      roleNeed: 'NORMAL',
      strategicPolicy: null,
      brainState: null,
      basePrice,
      remainingSlots: 20,
      purse: 800,
      remainingTimerMs: 15000,
      initialPurse: botTeam.initial_purse,
      auctionProgress: 0.90,
      futurePoolCount: exhaustedFuturePool.length,
      maxSquadSize: 25,
      qResult: qResultInsolvent,
    });

    // Must PASS with PURSE_INSOLVENCY
    expect(tacticalInsolvent.action).toBe('PASS');
    expect(tacticalInsolvent.reason).toBe('PURSE_INSOLVENCY');
    expect(tacticalInsolvent.bidAmount).toBe(0);
  });

  // ============================================================
  // TEST 4 — REGRESSION: B13 ONE_LAST_BID INTACT
  // ============================================================
  it('TEST 4 — REGRESSION: B13 One-Last-Bid remains strictly intact and unaffected at final-bid boundary', () => {
    // Candidate wicket keeper for aggressive bot needing wicket keeper
    const wkLot: V3Player & { rating?: number } = {
      id: 'lot-b13-wk',
      name: 'Star Wicket Keeper',
      role: 'WICKET_KEEPER',
      category: 'A',
      country: 'India',
      age: 28,
      batting_hand: 'Right Handed',
      base_price: 100,
      is_overseas: false,
      image_url: null,
      rating: 85,
    };

    // Stopping point at discrete ladder point 1075 -> nextRequiredBid = 1175 <= TV 1175
    const qStoppingPoint = {
      currentBid: 1075,
      nextRequiredBid: 1175,
      tv: 1175,
      qSkip: 156.6,
      qBuyAtRequiredBid: 158.2,
      qBuyBase: 180,
      qDelta: 1.6,
      decision: 'BID' as const,
      isLegal: true,
      ladderEvaluated: [1075, 1175],
    };

    const brainState = {
      beliefs: { rivalAggression: 0.3, marketInflation: 0.4, roleScarcityPanic: 1.0, estimatedSquadQuality: 0.5 },
      memory: {
        auctionId: 'auction-b14',
        teamId: aggressiveBot.id,
        observedBids: {},
        purchases: [],
        failedTargets: [],
        lotsSinceLastPurchase: 4,
        isInitialized: true,
        lastSeenLotId: wkLot.id,
        processedCompletedLots: new Set<string>(),
      } as any,
      plan: {
        urgency: 1.0,
        strategicFocus: 'FILL_GAPS' as const,
        budgetAllocation: { totalRemaining: 5000, reserveForCriticalNeeds: 80, discretionaryBudget: 4920, spentRatio: 0.5 },
        willSacrificeOverseasForQuality: false,
      },
    };

    // 1. First evaluation at stopping point emits STRETCH (One-Last-Bid)
    const decB13 = evaluateTacticalDecision({
      teamId: aggressiveBot.id,
      auctionId: 'auction-b14',
      lotId: wkLot.id,
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      strategicPolicy: null,
      brainState: brainState as any,
      basePrice: 100,
      remainingSlots: 5,
      purse: 5000,
      remainingTimerMs: 15000,
      initialPurse: 10000,
      auctionProgress: 0.85,
      futurePoolCount: 1,
      maxSquadSize: 25,
      qResult: qStoppingPoint as any,
    });

    expect(decB13.action).toBe('STRETCH');
    expect(decB13.reason).toBe('CRITICAL_GAP_STRETCH');
    expect(decB13.isStretched).toBe(true);
    expect(decB13.bidAmount).toBe(1175);
    expect(decB13.bidAmount).toBeLessThanOrEqual(decB13.tv);

    // 2. Mark memory as having placed final bid
    brainState.memory.observedBids[wkLot.id] = {
      highestBid: 1175,
      observedAt: Date.now(),
      isFinalBid: true,
    };

    // 3. Re-evaluation on same lot must prevent repeat One-Last-Bid
    const decB13Repeat = evaluateTacticalDecision({
      teamId: aggressiveBot.id,
      auctionId: 'auction-b14',
      lotId: wkLot.id,
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      strategicPolicy: null,
      brainState: brainState as any,
      basePrice: 100,
      remainingSlots: 5,
      purse: 5000,
      remainingTimerMs: 15000,
      initialPurse: 10000,
      auctionProgress: 0.85,
      futurePoolCount: 1,
      maxSquadSize: 25,
      qResult: qStoppingPoint as any,
    });

    expect(decB13Repeat.action).toBe('PASS');
    expect(decB13Repeat.reason).toBe('PRICE_EXCEEDS_TV');
  });

  // ============================================================
  // SERVER BOT ENGINE END-TO-END INTEGRATION
  // ============================================================
  it('5. Server bot engine integration: evaluateBotsForLot demonstrates BEFORE (DROP) -> STATE CHANGE -> AFTER (ENTER)', () => {
    const baseCtx: Omit<AuctionContext, 'futurePlayers'> = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      maxOverseas: 8,
    };

    // --- BEFORE: Early auction with plentiful future pool ---
    const evidenceEarly: BotDecisionEvidence[] = [];
    const bidsEarly = evaluateBotsForLot(
      [botTeam],
      currentLot,
      currentBid,
      basePrice,
      'other-team',
      'Normal',
      [botTeam, { id: 'other-team' } as V3Team],
      { [botTeam.id]: existingRoster },
      { ...baseCtx, auctionProgress: 0.0, futurePlayers: plentifulFuturePool } as any,
      null,
      evidenceEarly,
      'auction-b14'
    );

    // --- STATE CHANGE: Auction progresses to late stage with exhausted pool ---

    // --- AFTER: Late auction with exhausted future pool on SAME player and SAME bot ---
    const evidenceLate: BotDecisionEvidence[] = [];
    const bidsLate = evaluateBotsForLot(
      [botTeam],
      currentLot,
      currentBid,
      basePrice,
      'other-team',
      'Normal',
      [botTeam, { id: 'other-team' } as V3Team],
      { [botTeam.id]: existingRoster },
      { ...baseCtx, auctionProgress: 0.85, futurePlayers: exhaustedFuturePool } as any,
      null,
      evidenceLate,
      'auction-b14'
    );

    console.log('\n--- B14 SERVER BOT ENGINE END-TO-END EVIDENCE ---');
    console.log('B14_SERVER_BEFORE (EARLY):', {
      Decision: evidenceEarly[0]?.decision,
      Reason: evidenceEarly[0]?.actionReason,
      PacingState: evidenceEarly[0]?.pacingState,
      BidsCount: bidsEarly.length,
      TV: evidenceEarly[0]?.tv,
    });
    console.log('B14_SERVER_AFTER (LATE REVERSAL):', {
      Decision: evidenceLate[0]?.decision,
      Reason: evidenceLate[0]?.actionReason,
      PacingState: evidenceLate[0]?.pacingState,
      BidsCount: bidsLate.length,
      NextBidAmount: bidsLate[0]?.nextBidAmount,
      TV: evidenceLate[0]?.tv,
    });

    // 1. BEFORE: Bot rationally drops to preserve purse
    expect(evidenceEarly[0]?.decision).toBe('DROP');
    expect(evidenceEarly[0]?.actionReason).toBe('EARLY_RESOURCE_PRESERVATION');
    expect(evidenceEarly[0]?.pacingState).toBe('EARLY_PRESERVATION');
    expect(bidsEarly.length).toBe(0);

    // 2. AFTER: Decision successfully reverses to ENTER when auction state becomes late
    expect(evidenceLate[0]?.decision).toBe('ENTER');
    expect(evidenceLate[0]?.actionReason).toBe('TV_FAVORABLE');
    expect(evidenceLate[0]?.pacingState).toBe('LATE_RELEASE');
    expect(bidsLate.length).toBe(1);
    expect(bidsLate[0]?.nextBidAmount).toBe(775);
    expect(bidsLate[0]?.nextBidAmount).toBeLessThanOrEqual(evidenceLate[0]!.tv);

    // 3. Economic authority: TV is preserved and valid across both evaluations
    expect(evidenceEarly[0]!.tv).toBeGreaterThanOrEqual(775);
    expect(evidenceLate[0]!.tv).toBeGreaterThanOrEqual(775);
  });
});
