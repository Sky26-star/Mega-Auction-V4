import { describe, it, expect, vi } from 'vitest';
import { evaluateTacticalDecision, type TacticalInputContext } from '@/lib/auction/bot-tactical-engine';
import { updateBotBrainState } from '@/lib/auction/bot-brain-state';
import {
  evaluateBotsForLot,
  DEFAULT_CONTEXT,
  type AuctionContext,
  type BotDecisionEvidence
} from '@/lib/auction/server-bot-engine';
import { type V3Player, type V3Team } from '@/lib/v3-auction-types';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, appendFileSync: vi.fn() };
});

describe('Behavior B8: Rival Baiting / Drop', () => {
  const currentLot: V3Player & { rating?: number } = {
    id: 'lot-b8-1',
    name: 'Middle Order Batsman',
    role: 'BATSMAN',
    category: 'B',
    country: 'India',
    age: 27,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
    rating: 80,
  };

  const opportunisticBot: V3Team & { personality?: string } = {
    id: 'bot-b8-opportunistic',
    name: 'Opportunistic Franchise',
    short_name: 'OPP',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 2,
    personality: 'OPPORTUNISTIC',
  };

  const aggressiveBot: V3Team & { personality?: string } = {
    id: 'bot-b8-aggressive',
    name: 'Aggressive Franchise',
    short_name: 'AGG',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 2,
    personality: 'AGGRESSIVE',
  };

  const baseTacticalContext: Omit<TacticalInputContext, 'personality' | 'qResult' | 'brainState'> = {
    teamId: opportunisticBot.id,
    auctionId: 'auction-b8',
    lotId: currentLot.id,
    roleNeed: 'NORMAL',
    strategicPolicy: null,
    basePrice: 100,
    remainingSlots: 20,
    purse: 5000,
    remainingTimerMs: 15000,
    initialPurse: 10000,
    auctionProgress: 0.25,
    maxSquadSize: 25,
  };

  // ============================================================
  // 1. BELIEF FORMATION: RIVAL AGGRESSION BELIEF vs FACT
  // ============================================================
  it('1. Rival aggression belief forms credibly from competing thirsty rivals and bid pressure', () => {
    const thirstyRivals: V3Team[] = Array.from({ length: 3 }, (_, i) => ({
      id: `thirsty-rival-${i}`,
      name: `Rival ${i}`,
      short_name: `R${i}`,
      is_bot: true,
      purse: 8000,
      initial_purse: 10000,
      players_bought: 4,
      overseas_count: 1,
    }));

    // With 3 thirsty rivals with CRITICAL role need and escalated bid pressure (500L on 100L base)
    const highAggressionState = updateBotBrainState({
      auctionId: 'auction-b8-belief',
      teamId: opportunisticBot.id,
      bot: opportunisticBot,
      botRoster: [],
      currentBid: 500,
      basePrice: 100,
      playerRole: 'BATSMAN',
      playerIsOverseas: false,
      allTeams: [opportunisticBot, ...thirstyRivals],
      teamRosters: {
        [opportunisticBot.id]: [],
        'thirsty-rival-0': [],
        'thirsty-rival-1': [],
        'thirsty-rival-2': [],
      },
      ctx: DEFAULT_CONTEXT,
    });

    // Without thirsty rivals at opening bid
    const lowAggressionState = updateBotBrainState({
      auctionId: 'auction-b8-belief',
      teamId: opportunisticBot.id,
      bot: opportunisticBot,
      botRoster: [],
      currentBid: 100,
      basePrice: 100,
      playerRole: 'BATSMAN',
      playerIsOverseas: false,
      allTeams: [opportunisticBot],
      teamRosters: {
        [opportunisticBot.id]: [],
      },
      ctx: DEFAULT_CONTEXT,
    });

    console.log('\n--- B8 RIVAL AGGRESSION BELIEF FORMATION ---');
    console.log('HIGH_RIVAL_PRESSURE:', {
      rivalAggression: highAggressionState.beliefs.rivalAggression,
      marketInflation: highAggressionState.beliefs.marketInflation,
    });
    console.log('LOW_RIVAL_PRESSURE:', {
      rivalAggression: lowAggressionState.beliefs.rivalAggression,
      marketInflation: lowAggressionState.beliefs.marketInflation,
    });

    // Rival aggression belief distinction
    expect(highAggressionState.beliefs.rivalAggression).toBeGreaterThan(0.75);
    expect(lowAggressionState.beliefs.rivalAggression).toBeLessThanOrEqual(0.75);
  });

  // ============================================================
  // 2. TACTICAL ENGINE: CAUSAL DECISION CONTRAST
  // ============================================================
  it('2. Tactical engine: enforces RIVAL_BAIT_DROP only when all 4 conditions align, normal Q/TV otherwise', () => {
    // Economic baseline within TV:
    // nextRequiredBid = 550 <= tv = 600 (economically legal)
    // Low marginal benefit: qBuy (85) < qSkip (80) * 1.10 = 88
    const qResultLowMarginal = {
      currentBid: 500,
      nextRequiredBid: 550,
      tv: 600,
      qSkip: 80,
      qBuyAtRequiredBid: 85,
      qBuyBase: 120,
      qDelta: 5,
      decision: 'BID' as const,
      isLegal: true,
      ladderEvaluated: [550, 600],
    };

    // High marginal benefit: qBuy (100) >= qSkip (80) * 1.10 = 88 (high surplus)
    const qResultHighMarginal = {
      currentBid: 500,
      nextRequiredBid: 550,
      tv: 600,
      qSkip: 80,
      qBuyAtRequiredBid: 100,
      qBuyBase: 140,
      qDelta: 20,
      decision: 'BID' as const,
      isLegal: true,
      ladderEvaluated: [550, 600],
    };

    // Price exceeds TV: nextRequiredBid = 650 > tv = 600
    const qResultExceedsTv = {
      currentBid: 600,
      nextRequiredBid: 650,
      tv: 600,
      qSkip: 80,
      qBuyAtRequiredBid: 75,
      qBuyBase: 120,
      qDelta: -5,
      decision: 'PASS' as const,
      isLegal: true,
      ladderEvaluated: [650],
    };

    const highRivalBrainState = {
      beliefs: { rivalAggression: 0.9, marketInflation: 0.4, roleScarcityPanic: 0.2, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    const lowRivalBrainState = {
      beliefs: { rivalAggression: 0.2, marketInflation: 0.1, roleScarcityPanic: 0.1, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    // Case A: B8 TRIGGERED (Opportunistic + High Rival Aggression + Low Marginal Benefit + Legal Bid)
    const decB8Triggered = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'OPPORTUNISTIC',
      qResult: qResultLowMarginal as any,
      brainState: highRivalBrainState as any,
    });

    // Case B: B8 NOT TRIGGERED — Low Rival Aggression
    const decLowRival = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'OPPORTUNISTIC',
      qResult: qResultLowMarginal as any,
      brainState: lowRivalBrainState as any,
    });

    // Case C: B8 NOT TRIGGERED — Aggressive Personality (does not retreat)
    const decAggressive = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'AGGRESSIVE',
      qResult: qResultLowMarginal as any,
      brainState: highRivalBrainState as any,
    });

    // Case D: B8 NOT TRIGGERED — High Marginal Benefit (surplus justifies entering)
    const decHighMarginal = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'OPPORTUNISTIC',
      qResult: qResultHighMarginal as any,
      brainState: highRivalBrainState as any,
    });

    // Case E: B8 NOT TRIGGERED — Price Exceeds TV (Economic authority drops by PRICE_EXCEEDS_TV)
    const decExceedsTv = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'OPPORTUNISTIC',
      qResult: qResultExceedsTv as any,
      brainState: highRivalBrainState as any,
    });

    console.log('\n--- B8 TACTICAL CAUSAL CONTRAST ---');
    console.log('B8_TRIGGERED:', {
      action: decB8Triggered.action,
      reason: decB8Triggered.reason,
      tv: decB8Triggered.tv,
      nextBid: decB8Triggered.nextRequiredBid,
    });
    console.log('B8_NOT_TRIGGERED_LOW_RIVAL:', {
      action: decLowRival.action,
      reason: decLowRival.reason,
    });
    console.log('B8_NOT_TRIGGERED_AGGRESSIVE_PERSONALITY:', {
      action: decAggressive.action,
      reason: decAggressive.reason,
    });
    console.log('B8_NOT_TRIGGERED_HIGH_MARGINAL_BENEFIT:', {
      action: decHighMarginal.action,
      reason: decHighMarginal.reason,
    });
    console.log('B8_NOT_TRIGGERED_EXCEEDS_TV:', {
      action: decExceedsTv.action,
      reason: decExceedsTv.reason,
    });

    // B8 Triggered: Opportunistic bot tactically PASSES to let aggressive rivals exhaust funds
    expect(decB8Triggered.action).toBe('PASS');
    expect(decB8Triggered.reason).toBe('RIVAL_BAIT_DROP');

    // B8 Not Triggered: When conditions are absent, normal Q/TV bidding remains authoritative
    expect(decLowRival.action).toBe('BID');
    expect(decLowRival.reason).toBe('TV_FAVORABLE');

    expect(decAggressive.action).toBe('BID');
    expect(decAggressive.reason).toBe('TV_FAVORABLE');

    expect(decHighMarginal.action).toBe('BID');
    expect(decHighMarginal.reason).toBe('TV_FAVORABLE');

    expect(decExceedsTv.action).toBe('PASS');
    expect(decExceedsTv.reason).toBe('PRICE_EXCEEDS_TV');
  });

  // ============================================================
  // 3. SERVER BOT ENGINE END-TO-END INTEGRATION
  // ============================================================
  it('3. Server bot engine integration: evaluateBotsForLot emits DROP with RIVAL_BAIT_DROP vs ENTER with TV_FAVORABLE', () => {
    // Current bid 475 -> next required bid is 525 (both discrete ladder points)
    const currentBid = 475;
    const basePrice = 100;

    const currentLotWithStats: V3Player & { rating?: number } = {
      ...currentLot,
      rating: 84,
      matches: 60,
      runs: 2000,
      batting_average: 32,
      strike_rate: 135,
      boundaries: 250,
    };

    const futureAlternative: V3Player = {
      id: 'future-bat-1',
      name: 'Future Batsman',
      role: 'BATSMAN',
      category: 'B',
      country: 'India',
      age: 26,
      batting_hand: 'Right Handed',
      base_price: 100,
      is_overseas: false,
      image_url: null,
      rating: 85,
    };

    const highRivalBrainState = {
      beliefs: { rivalAggression: 0.9, marketInflation: 0.4, roleScarcityPanic: 0.2, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    const lowRivalBrainState = {
      beliefs: { rivalAggression: 0.2, marketInflation: 0.1, roleScarcityPanic: 0.1, estimatedSquadQuality: 0.5 },
      memory: {} as any,
      plan: {} as any,
    };

    const baseCtx: Omit<AuctionContext, 'futurePlayers'> = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      maxOverseas: 8,
      auctionProgress: 0.2,
    };

    // Scenario 1: B8 TRIGGERED (Opportunistic bot facing high rival aggression)
    const evidenceTriggered: BotDecisionEvidence[] = [];
    const bidsTriggered = evaluateBotsForLot(
      [opportunisticBot],
      currentLotWithStats,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [opportunisticBot],
      { [opportunisticBot.id]: [] },
      { ...baseCtx, brainState: highRivalBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceTriggered,
      'auction-b8'
    );

    // Scenario 2: B8 NOT TRIGGERED (Opportunistic bot in calm market with low rival aggression)
    const evidenceLowRival: BotDecisionEvidence[] = [];
    const bidsLowRival = evaluateBotsForLot(
      [opportunisticBot],
      currentLotWithStats,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [opportunisticBot],
      { [opportunisticBot.id]: [] },
      { ...baseCtx, brainState: lowRivalBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceLowRival,
      'auction-b8'
    );

    // Scenario 3: B8 NOT TRIGGERED (Aggressive bot facing the same high rival aggression)
    const evidenceAggressive: BotDecisionEvidence[] = [];
    const bidsAggressive = evaluateBotsForLot(
      [aggressiveBot],
      currentLotWithStats,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [aggressiveBot],
      { [aggressiveBot.id]: [] },
      { ...baseCtx, brainState: highRivalBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceAggressive,
      'auction-b8'
    );

    console.log('\n--- B8 SERVER BOT ENGINE END-TO-END EVIDENCE ---');
    console.log('B8_TRIGGERED_OPPORTUNISTIC:', {
      Decision: evidenceTriggered[0]?.decision,
      Reason: evidenceTriggered[0]?.actionReason,
      BidsCount: bidsTriggered.length,
    });
    console.log('B8_NOT_TRIGGERED_LOW_RIVAL:', {
      Decision: evidenceLowRival[0]?.decision,
      Reason: evidenceLowRival[0]?.actionReason,
      BidsCount: bidsLowRival.length,
      NextBid: bidsLowRival[0]?.nextBidAmount,
    });
    console.log('B8_NOT_TRIGGERED_AGGRESSIVE:', {
      Decision: evidenceAggressive[0]?.decision,
      Reason: evidenceAggressive[0]?.actionReason,
      BidsCount: bidsAggressive.length,
      NextBid: bidsAggressive[0]?.nextBidAmount,
    });

    // B8 Triggered: Opportunistic bot drops with RIVAL_BAIT_DROP and submits no bids
    expect(evidenceTriggered[0]?.decision).toBe('DROP');
    expect(evidenceTriggered[0]?.actionReason).toBe('RIVAL_BAIT_DROP');
    expect(bidsTriggered.length).toBe(0);

    // B8 Not Triggered: Low rival pressure -> Opportunistic bot enters auction and submits bid
    expect(evidenceLowRival[0]?.decision).toBe('ENTER');
    expect(evidenceLowRival[0]?.actionReason).toBe('TV_FAVORABLE');
    expect(bidsLowRival.length).toBe(1);
    expect(bidsLowRival[0]?.nextBidAmount).toBe(525);

    // B8 Not Triggered: Aggressive bot -> Enters auction and submits bid despite rival pressure
    expect(evidenceAggressive[0]?.decision).toBe('ENTER');
    expect(evidenceAggressive[0]?.actionReason).toBe('TV_FAVORABLE');
    expect(bidsAggressive.length).toBe(1);
    expect(bidsAggressive[0]?.nextBidAmount).toBe(525);
  });
});
