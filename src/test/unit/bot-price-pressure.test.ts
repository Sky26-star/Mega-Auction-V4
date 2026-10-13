import { describe, it, expect } from 'vitest';
import { evaluateTacticalDecision, type TacticalInputContext } from '@/lib/auction/bot-tactical-engine';
import { updateBotBrainState } from '@/lib/auction/bot-brain-state';
import {
  evaluateBotsForLot,
  DEFAULT_CONTEXT,
  type AuctionContext,
  type BotDecisionEvidence
} from '@/lib/auction/server-bot-engine';
import { type V3Player, type V3Team } from '@/lib/v3-auction-types';

describe('Behavior B12: Price Pressure / Purse Drain', () => {
  const currentLot: V3Player & { rating?: number } = {
    id: 'lot-b12-1',
    name: 'Premier All Rounder',
    role: 'ALL_ROUNDER',
    category: 'A',
    country: 'India',
    age: 26,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
    rating: 84,
  };

  const balancedBot: V3Team & { personality?: string } = {
    id: 'bot-b12-balanced',
    name: 'Balanced Franchise',
    short_name: 'BAL',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 15,
    overseas_count: 4,
    personality: 'BALANCED',
  };

  const opportunisticBot: V3Team & { personality?: string } = {
    id: 'bot-b12-opportunistic',
    name: 'Opportunistic Franchise',
    short_name: 'OPP',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 15,
    overseas_count: 4,
    personality: 'OPPORTUNISTIC',
  };

  const conservativeBot: V3Team & { personality?: string } = {
    id: 'bot-b12-conservative',
    name: 'Conservative Franchise',
    short_name: 'CON',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 15,
    overseas_count: 4,
    personality: 'CONSERVATIVE',
  };

  const baseTacticalContext: Omit<TacticalInputContext, 'personality' | 'qResult' | 'brainState'> = {
    teamId: balancedBot.id,
    auctionId: 'auction-b12',
    lotId: currentLot.id,
    roleNeed: 'NORMAL',
    strategicPolicy: null,
    basePrice: 100,
    remainingSlots: 10,
    purse: 5000,
    remainingTimerMs: 15000,
    initialPurse: 10000,
    auctionProgress: 0.5,
    maxSquadSize: 25,
  };

  // ============================================================
  // 1. BELIEF FORMATION: PRICE PRESSURE SIGNAL (marketInflation)
  // ============================================================
  it('1. Price pressure belief forms credibly from lot bid escalation relative to base price', () => {
    // Current bid 600L on 100L base price (ratio = 6.0) -> high market inflation / price pressure
    const highPressureState = updateBotBrainState({
      auctionId: 'auction-b12-belief',
      teamId: balancedBot.id,
      bot: balancedBot,
      botRoster: [],
      currentBid: 600,
      basePrice: 100,
      playerRole: 'ALL_ROUNDER',
      playerIsOverseas: false,
      allTeams: [balancedBot],
      teamRosters: { [balancedBot.id]: [] },
      ctx: DEFAULT_CONTEXT,
    });

    // Opening bid 100L on 100L base price (ratio = 1.0) -> zero market inflation / unpressured
    const unpressuredState = updateBotBrainState({
      auctionId: 'auction-b12-belief',
      teamId: balancedBot.id,
      bot: balancedBot,
      botRoster: [],
      currentBid: 100,
      basePrice: 100,
      playerRole: 'ALL_ROUNDER',
      playerIsOverseas: false,
      allTeams: [balancedBot],
      teamRosters: { [balancedBot.id]: [] },
      ctx: DEFAULT_CONTEXT,
    });

    console.log('\n--- B12 PRICE PRESSURE BELIEF FORMATION ---');
    console.log('HIGH_PRICE_PRESSURE:', {
      marketInflation: highPressureState.beliefs.marketInflation,
      ratio: 600 / 100,
    });
    console.log('UNPRESSURED:', {
      marketInflation: unpressuredState.beliefs.marketInflation,
      ratio: 100 / 100,
    });

    // Ratio = 6.0: (6 - 1) / 5 = 1.0 (high price premium)
    expect(highPressureState.beliefs.marketInflation).toBeGreaterThanOrEqual(1.0);
    // Ratio = 1.0: (1 - 1) / 5 = 0.0 (unpressured baseline)
    expect(unpressuredState.beliefs.marketInflation).toBe(0.0);
  });

  // ============================================================
  // 2. TACTICAL ENGINE: CAUSAL DECISION CONTRAST & INVARIANTS
  // ============================================================
  it('2. Tactical engine: enforces PRICE_PRESSURE_PURSE_DRAIN on material purse drain under high price pressure', () => {
    // Economic baseline within TV:
    // nextRequiredBid = 550 <= tv = 700 (economically favorable)
    // Avg purse per slot = 5000 / 10 = 500L
    // Next bid 550L > 500L -> drains purse above average slot budget
    const qResultWithinTv = {
      currentBid: 500,
      nextRequiredBid: 550,
      tv: 700,
      qSkip: 80,
      qBuyAtRequiredBid: 95,
      qBuyBase: 130,
      qDelta: 15,
      decision: 'BID' as const,
      isLegal: true,
      ladderEvaluated: [550, 600, 650, 700],
    };

    // Price exceeds TV: nextRequiredBid = 750 > tv = 700
    const qResultExceedsTv = {
      currentBid: 700,
      nextRequiredBid: 750,
      tv: 700,
      qSkip: 80,
      qBuyAtRequiredBid: 70,
      qBuyBase: 130,
      qDelta: -10,
      decision: 'PASS' as const,
      isLegal: true,
      ladderEvaluated: [750],
    };

    // Low marginal benefit qResult for B8/B11 tests: qBuy (85) < qSkip (80) * 1.10 = 88
    const qResultLowMarginal = {
      currentBid: 500,
      nextRequiredBid: 550,
      tv: 700,
      qSkip: 80,
      qBuyAtRequiredBid: 85,
      qBuyBase: 120,
      qDelta: 5,
      decision: 'BID' as const,
      isLegal: true,
      ladderEvaluated: [550, 600],
    };

    const highPressureBrainState = {
      beliefs: { rivalAggression: 0.2, marketInflation: 1.0, roleScarcityPanic: 0.2, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    const unpressuredBrainState = {
      beliefs: { rivalAggression: 0.2, marketInflation: 0.0, roleScarcityPanic: 0.2, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    const highRivalBrainState = {
      beliefs: { rivalAggression: 0.9, marketInflation: 1.0, roleScarcityPanic: 0.2, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    // Case A: B12 ACTIVE — High Price Pressure (1.0) + Material Purse Drain (550L > 500L) on non-critical role
    const decPressured = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'BALANCED',
      qResult: qResultWithinTv as any,
      brainState: highPressureBrainState as any,
    });

    // Case B: B12 UNPRESSURED — Same bot & economic values, but marketInflation is 0.0 (unpressured)
    const decUnpressured = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'BALANCED',
      qResult: qResultWithinTv as any,
      brainState: unpressuredBrainState as any,
    });

    // Case C: B12 UNPRESSURED — High price pressure (1.0), but bot has abundant purse (8000L / 10 = 800L > 550L)
    const decAbundantPurse = evaluateTacticalDecision({
      ...baseTacticalContext,
      purse: 8000,
      personality: 'BALANCED',
      qResult: qResultWithinTv as any,
      brainState: highPressureBrainState as any,
    });

    // Case D: CRITICAL NEED TOLERANCE — High price pressure + drain, but roleNeed is CRITICAL
    const decCriticalNeed = evaluateTacticalDecision({
      ...baseTacticalContext,
      roleNeed: 'CRITICAL',
      personality: 'BALANCED',
      qResult: qResultWithinTv as any,
      brainState: highPressureBrainState as any,
    });

    // Case E: MAXIMUM PERSISTENCE TOLERANCE — High price pressure + drain, but strategicPersistence is MAXIMUM
    const decMaxPersistence = evaluateTacticalDecision({
      ...baseTacticalContext,
      strategicPolicy: {
        pursuitStance: 'STRONG_PURSUIT',
        strategicPersistence: 'MAXIMUM',
        budgetPreservationIntent: false,
        consequenceAwareness: 'NORMAL',
        isFallback: false,
      },
      personality: 'BALANCED',
      qResult: qResultWithinTv as any,
      brainState: highPressureBrainState as any,
    });

    // Case F: PRECEDENCE PROOF B8 — Opportunistic bot facing high rival aggression drops with RIVAL_BAIT_DROP
    const decPrecedenceB8 = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'OPPORTUNISTIC',
      qResult: qResultLowMarginal as any,
      brainState: highRivalBrainState as any,
    });

    // Case G: PRECEDENCE PROOF B11 — Conservative bot facing high rival aggression drops with RIVAL_INTIMIDATION
    const decPrecedenceB11 = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'CONSERVATIVE',
      qResult: qResultLowMarginal as any,
      brainState: highRivalBrainState as any,
    });

    // Case H: ECONOMIC INVARIANT — Price Exceeds TV wins over Price Pressure
    const decExceedsTv = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'BALANCED',
      qResult: qResultExceedsTv as any,
      brainState: highPressureBrainState as any,
    });

    // Case I: LEGAL INVARIANT — Hard Purse Insolvency wins over Price Pressure
    const decInsolvent = evaluateTacticalDecision({
      ...baseTacticalContext,
      purse: 600, // 600 - 550 = 50L < (10 - 1) * 20 = 180L minimum squad reserve
      personality: 'BALANCED',
      qResult: qResultWithinTv as any,
      brainState: highPressureBrainState as any,
    });

    console.log('\n--- B12 TACTICAL CAUSAL CONTRAST ---');
    console.log('B12_PRESSURED:', {
      action: decPressured.action,
      reason: decPressured.reason,
      tv: decPressured.tv,
      nextBid: decPressured.nextRequiredBid,
    });
    console.log('B12_UNPRESSURED_LOW_INFLATION:', {
      action: decUnpressured.action,
      reason: decUnpressured.reason,
    });
    console.log('B12_UNPRESSURED_ABUNDANT_PURSE:', {
      action: decAbundantPurse.action,
      reason: decAbundantPurse.reason,
    });
    console.log('CRITICAL_NEED_TOLERANCE:', {
      action: decCriticalNeed.action,
      reason: decCriticalNeed.reason,
    });
    console.log('MAX_PERSISTENCE_TOLERANCE:', {
      action: decMaxPersistence.action,
      reason: decMaxPersistence.reason,
    });
    console.log('PRECEDENCE_B8:', {
      action: decPrecedenceB8.action,
      reason: decPrecedenceB8.reason,
    });
    console.log('PRECEDENCE_B11:', {
      action: decPrecedenceB11.action,
      reason: decPrecedenceB11.reason,
    });
    console.log('ECONOMIC_AUTHORITY_EXCEEDS_TV:', {
      action: decExceedsTv.action,
      reason: decExceedsTv.reason,
    });
    console.log('LEGAL_INVARIANT_INSOLVENT:', {
      action: decInsolvent.action,
      reason: decInsolvent.reason,
    });

    // Case A: B12 Pressured -> PASS with PRICE_PRESSURE_PURSE_DRAIN
    expect(decPressured.action).toBe('PASS');
    expect(decPressured.reason).toBe('PRICE_PRESSURE_PURSE_DRAIN');
    expect(decPressured.tv).toBe(700); // TV unchanged

    // Case B: Unpressured market -> BID with TV_FAVORABLE
    expect(decUnpressured.action).toBe('BID');
    expect(decUnpressured.reason).toBe('TV_FAVORABLE');
    expect(decUnpressured.tv).toBe(700); // TV unchanged

    // Case C: Abundant purse -> BID with TV_FAVORABLE
    expect(decAbundantPurse.action).toBe('BID');
    expect(decAbundantPurse.reason).toBe('TV_FAVORABLE');

    // Case D: Critical role -> BID with TV_FAVORABLE
    expect(decCriticalNeed.action).toBe('BID');
    expect(decCriticalNeed.reason).toBe('TV_FAVORABLE');

    // Case E: Maximum persistence -> BID with TV_FAVORABLE
    expect(decMaxPersistence.action).toBe('BID');
    expect(decMaxPersistence.reason).toBe('TV_FAVORABLE');

    // Case F: Precedence B8 wins
    expect(decPrecedenceB8.action).toBe('PASS');
    expect(decPrecedenceB8.reason).toBe('RIVAL_BAIT_DROP');

    // Case G: Precedence B11 wins
    expect(decPrecedenceB11.action).toBe('PASS');
    expect(decPrecedenceB11.reason).toBe('RIVAL_INTIMIDATION');

    // Case H: Economic boundary wins
    expect(decExceedsTv.action).toBe('PASS');
    expect(decExceedsTv.reason).toBe('PRICE_EXCEEDS_TV');

    // Case I: Hard solvency wins
    expect(decInsolvent.action).toBe('PASS');
    expect(decInsolvent.reason).toBe('PURSE_INSOLVENCY');
  });

  // ============================================================
  // 3. SERVER BOT ENGINE END-TO-END INTEGRATION
  it('3. Server bot engine integration: evaluateBotsForLot defers to Phase 7 Human Decision Engine (Tactical engine has zero override authority)', () => {
    // Current bid 625 -> next required bid is 700.
    // TV = 610. Both bots drop because 700 > 610.
    // The legacy PRICE_PRESSURE_PURSE_DRAIN from tactical engine is correctly ignored by Phase 7.
    const currentBid = 625;
    const basePrice = 100;

    const futureAlternative: V3Player = {
      id: 'future-ar-1',
      name: 'Future All Rounder',
      role: 'ALL_ROUNDER',
      category: 'B',
      country: 'India',
      age: 25,
      batting_hand: 'Right Handed',
      base_price: 100,
      is_overseas: false,
      image_url: null,
    };

    const highPressureBrainState = {
      beliefs: { rivalAggression: 0.2, marketInflation: 1.0, roleScarcityPanic: 0.2, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    const unpressuredBrainState = {
      beliefs: { rivalAggression: 0.2, marketInflation: 0.0, roleScarcityPanic: 0.2, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    const highRivalBrainState = {
      beliefs: { rivalAggression: 0.9, marketInflation: 1.0, roleScarcityPanic: 0.2, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    const baseCtx: Omit<AuctionContext, 'futurePlayers'> = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      maxOverseas: 8,
      auctionProgress: 0.5,
    };

    const testSquad = [
      ...Array(13).fill({ role: 'BATSMAN' }),
      ...Array(2).fill({ role: 'ALL_ROUNDER' })
    ];

    // Scenario 1: B12 TRIGGERED (Balanced bot facing high lot price pressure and purse drain)
    const evidencePressured: BotDecisionEvidence[] = [];
    const bidsPressured = evaluateBotsForLot(
      [balancedBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [balancedBot],
      { [balancedBot.id]: testSquad },
      { ...baseCtx, brainState: highPressureBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidencePressured,
      'auction-b12'
    );

    // Scenario 2: B12 NOT TRIGGERED (Balanced bot in unpressured market)
    const evidenceUnpressured: BotDecisionEvidence[] = [];
    const bidsUnpressured = evaluateBotsForLot(
      [balancedBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [balancedBot],
      { [balancedBot.id]: testSquad },
      { ...baseCtx, brainState: unpressuredBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceUnpressured,
      'auction-b12'
    );

    // Scenario 3: B8 PRECEDENCE
    const evidenceB8: BotDecisionEvidence[] = [];
    const bidsB8 = evaluateBotsForLot(
      [opportunisticBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [opportunisticBot],
      { [opportunisticBot.id]: testSquad },
      { ...baseCtx, brainState: highRivalBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceB8,
      'auction-b12'
    );

    // Scenario 4: B11 PRECEDENCE
    const evidenceB11: BotDecisionEvidence[] = [];
    const bidsB11 = evaluateBotsForLot(
      [conservativeBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [conservativeBot],
      { [conservativeBot.id]: testSquad },
      { ...baseCtx, brainState: highRivalBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceB11,
      'auction-b12'
    );

    // Phase 7 Authority with legacy reason shim:
    // Pressured bot drops (Human=PASS, Tactical=PASS). Shim uses Tactical reason: 'PRICE_PRESSURE_PURSE_DRAIN'
    expect(evidencePressured[0]?.decision).toBe('DROP');
    expect(evidencePressured[0]?.actionReason).toBe('PRICE_PRESSURE_PURSE_DRAIN');
    
    // Unpressured bot drops (Human=PASS, Tactical=BID). Shim uses Human reason.
    expect(evidenceUnpressured[0]?.decision).toBe('DROP');
    expect(evidenceUnpressured[0]?.actionReason).toContain('exceeds maximum rational bid');

    // Precedence proofs
    expect(evidenceB8[0]?.decision).toBe('DROP');
    expect(evidenceB11[0]?.decision).toBe('DROP');
  });
});
