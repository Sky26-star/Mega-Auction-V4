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

describe('Behavior B11: Rival Intimidation', () => {
  const currentLot: V3Player & { rating?: number } = {
    id: 'lot-b11-1',
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
    matches: 80,
    runs: 2500,
    batting_average: 35,
    strike_rate: 140,
    boundaries: 300,
    hundreds: 1,
    fifties: 15,
    highest_score: 102,
  };

  const conservativeBot: V3Team & { personality?: string } = {
    id: 'bot-b11-conservative',
    name: 'Conservative Franchise',
    short_name: 'CON',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 2,
    personality: 'CONSERVATIVE',
  };

  const opportunisticBot: V3Team & { personality?: string } = {
    id: 'bot-b11-opportunistic',
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
    id: 'bot-b11-aggressive',
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
    teamId: conservativeBot.id,
    auctionId: 'auction-b11',
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
      auctionId: 'auction-b11-belief',
      teamId: conservativeBot.id,
      bot: conservativeBot,
      botRoster: [],
      currentBid: 500,
      basePrice: 100,
      playerRole: 'BATSMAN',
      playerIsOverseas: false,
      allTeams: [conservativeBot, ...thirstyRivals],
      teamRosters: {
        [conservativeBot.id]: [],
        'thirsty-rival-0': [],
        'thirsty-rival-1': [],
        'thirsty-rival-2': [],
      },
      ctx: DEFAULT_CONTEXT,
    });

    // Without thirsty rivals at opening bid
    const lowAggressionState = updateBotBrainState({
      auctionId: 'auction-b11-belief',
      teamId: conservativeBot.id,
      bot: conservativeBot,
      botRoster: [],
      currentBid: 100,
      basePrice: 100,
      playerRole: 'BATSMAN',
      playerIsOverseas: false,
      allTeams: [conservativeBot],
      teamRosters: {
        [conservativeBot.id]: [],
      },
      ctx: DEFAULT_CONTEXT,
    });

    console.log('\n--- B11 RIVAL AGGRESSION BELIEF FORMATION ---');
    console.log('HIGH_RIVAL_PRESSURE:', {
      rivalAggression: highAggressionState.beliefs.rivalAggression,
      marketInflation: highAggressionState.beliefs.marketInflation,
    });
    console.log('LOW_RIVAL_PRESSURE:', {
      rivalAggression: lowAggressionState.beliefs.rivalAggression,
      marketInflation: lowAggressionState.beliefs.marketInflation,
    });

    // Credible rival aggression belief distinction (>0.75 indicates high aggressive pressure)
    expect(highAggressionState.beliefs.rivalAggression).toBeGreaterThan(0.75);
    expect(lowAggressionState.beliefs.rivalAggression).toBeLessThanOrEqual(0.75);
  });

  // ============================================================
  // 2. TACTICAL ENGINE: CAUSAL INTIMIDATION CONTRAST
  // ============================================================
  it('2. Tactical engine: enforces RIVAL_INTIMIDATION on conservative bot with high rival aggression and marginal surplus', () => {
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

    // Case A: B11 INTIMIDATED (Conservative bot + High Rival Aggression + Low Marginal Benefit + Bid <= TV)
    const decB11Intimidated = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'CONSERVATIVE',
      qResult: qResultLowMarginal as any,
      brainState: highRivalBrainState as any,
    });

    // Case B: B11 NOT INTIMIDATED — Low Rival Aggression (Calm market)
    const decLowRival = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'CONSERVATIVE',
      qResult: qResultLowMarginal as any,
      brainState: lowRivalBrainState as any,
    });

    // Case C: B11 NOT INTIMIDATED — Aggressive Personality (Unintimidated by aggressive bidding)
    const decAggressive = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'AGGRESSIVE',
      qResult: qResultLowMarginal as any,
      brainState: highRivalBrainState as any,
    });

    // Case D: B11 NOT INTIMIDATED — High Marginal Benefit (Surplus justifies participating)
    const decHighMarginal = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'CONSERVATIVE',
      qResult: qResultHighMarginal as any,
      brainState: highRivalBrainState as any,
    });

    // Case E: B8 Separation Proof — Opportunistic Personality executes RIVAL_BAIT_DROP
    const decB8Opportunistic = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'OPPORTUNISTIC',
      qResult: qResultLowMarginal as any,
      brainState: highRivalBrainState as any,
    });

    // Case F: Q/TV Economic Authority — Price Exceeds TV (Drops by PRICE_EXCEEDS_TV)
    const decExceedsTv = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'CONSERVATIVE',
      qResult: qResultExceedsTv as any,
      brainState: highRivalBrainState as any,
    });

    // Case G: Legal Constraints Always Win — Insolvent purse (Drops by PURSE_INSOLVENCY)
    const decInsolvent = evaluateTacticalDecision({
      ...baseTacticalContext,
      purse: 600, // Remaining slots = 20 -> minSquadReserve = 19 * 20 = 380. 600 - 550 = 50 < 380
      personality: 'CONSERVATIVE',
      qResult: qResultLowMarginal as any,
      brainState: highRivalBrainState as any,
    });

    console.log('\n--- B11 TACTICAL CAUSAL CONTRAST ---');
    console.log('B11_INTIMIDATED (CONSERVATIVE):', {
      action: decB11Intimidated.action,
      reason: decB11Intimidated.reason,
      tv: decB11Intimidated.tv,
      nextBid: decB11Intimidated.nextRequiredBid,
    });
    console.log('B11_NOT_INTIMIDATED_LOW_RIVAL:', {
      action: decLowRival.action,
      reason: decLowRival.reason,
    });
    console.log('B11_NOT_INTIMIDATED_AGGRESSIVE:', {
      action: decAggressive.action,
      reason: decAggressive.reason,
    });
    console.log('B11_NOT_INTIMIDATED_HIGH_MARGINAL:', {
      action: decHighMarginal.action,
      reason: decHighMarginal.reason,
    });
    console.log('B8_SEPARATION_OPPORTUNISTIC:', {
      action: decB8Opportunistic.action,
      reason: decB8Opportunistic.reason,
    });
    console.log('ECONOMIC_AUTHORITY_EXCEEDS_TV:', {
      action: decExceedsTv.action,
      reason: decExceedsTv.reason,
    });
    console.log('LEGAL_INVARIANT_INSOLVENT:', {
      action: decInsolvent.action,
      reason: decInsolvent.reason,
    });

    // B11 Intimidated: Conservative bot tactically concedes to avoid destructive bidding war on marginal lot
    expect(decB11Intimidated.action).toBe('PASS');
    expect(decB11Intimidated.reason).toBe('RIVAL_INTIMIDATION');

    // B11 Not Intimidated: Low rival pressure -> enters and bids TV_FAVORABLE
    expect(decLowRival.action).toBe('BID');
    expect(decLowRival.reason).toBe('TV_FAVORABLE');

    // B11 Not Intimidated: Aggressive bot refuses intimidation -> bids TV_FAVORABLE
    expect(decAggressive.action).toBe('BID');
    expect(decAggressive.reason).toBe('TV_FAVORABLE');

    // B11 Not Intimidated: High marginal surplus -> bids TV_FAVORABLE
    expect(decHighMarginal.action).toBe('BID');
    expect(decHighMarginal.reason).toBe('TV_FAVORABLE');

    // B8 Separation: Opportunistic bot executes bait/drop, NOT intimidation
    expect(decB8Opportunistic.action).toBe('PASS');
    expect(decB8Opportunistic.reason).toBe('RIVAL_BAIT_DROP');

    // Economic Authority: Price exceeds TV wins over intimidation
    expect(decExceedsTv.action).toBe('PASS');
    expect(decExceedsTv.reason).toBe('PRICE_EXCEEDS_TV');

    // Legal Authority: Hard purse insolvency wins over intimidation
    expect(decInsolvent.action).toBe('PASS');
    expect(decInsolvent.reason).toBe('PURSE_INSOLVENCY');
  });

  // ============================================================
  // 3. SERVER BOT ENGINE END-TO-END INTEGRATION
  // ============================================================
  it('3. Server bot engine integration: evaluateBotsForLot emits DROP with RIVAL_INTIMIDATION vs ENTER with TV_FAVORABLE', () => {
    // Current bid 475 -> next required bid is 525 (both discrete ladder points)
    const currentBid = 475;
    const basePrice = 100;

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

    // Scenario 1: B11 TRIGGERED (Conservative bot facing high rival aggression)
    const evidenceIntimidated: BotDecisionEvidence[] = [];
    const bidsIntimidated = evaluateBotsForLot(
      [conservativeBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [conservativeBot],
      { [conservativeBot.id]: [] },
      { ...baseCtx, brainState: highRivalBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceIntimidated,
      'auction-b11'
    );

    // Scenario 2: B11 NOT TRIGGERED (Conservative bot in calm market with low rival aggression)
    const evidenceLowRival: BotDecisionEvidence[] = [];
    const bidsLowRival = evaluateBotsForLot(
      [conservativeBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [conservativeBot],
      { [conservativeBot.id]: [] },
      { ...baseCtx, brainState: lowRivalBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceLowRival,
      'auction-b11'
    );

    // Scenario 3: B11 NOT TRIGGERED (Aggressive bot facing the same high rival aggression)
    const evidenceAggressive: BotDecisionEvidence[] = [];
    const bidsAggressive = evaluateBotsForLot(
      [aggressiveBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [aggressiveBot],
      { [aggressiveBot.id]: [] },
      { ...baseCtx, brainState: highRivalBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceAggressive,
      'auction-b11'
    );

    // Scenario 4: B8 SEPARATION (Opportunistic bot facing the same high rival aggression)
    const evidenceOpportunistic: BotDecisionEvidence[] = [];
    const bidsOpportunistic = evaluateBotsForLot(
      [opportunisticBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [opportunisticBot],
      { [opportunisticBot.id]: [] },
      { ...baseCtx, brainState: highRivalBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceOpportunistic,
      'auction-b11'
    );

    console.log('\n--- B11 SERVER BOT ENGINE END-TO-END EVIDENCE ---');
    console.log('B11_INTIMIDATED_CONSERVATIVE:', {
      Decision: evidenceIntimidated[0]?.decision,
      Reason: evidenceIntimidated[0]?.actionReason,
      BidsCount: bidsIntimidated.length,
    });
    console.log('B11_NOT_INTIMIDATED_LOW_RIVAL:', {
      Decision: evidenceLowRival[0]?.decision,
      Reason: evidenceLowRival[0]?.actionReason,
      BidsCount: bidsLowRival.length,
      NextBid: bidsLowRival[0]?.nextBidAmount,
    });
    console.log('B11_NOT_INTIMIDATED_AGGRESSIVE:', {
      Decision: evidenceAggressive[0]?.decision,
      Reason: evidenceAggressive[0]?.actionReason,
      BidsCount: bidsAggressive.length,
      NextBid: bidsAggressive[0]?.nextBidAmount,
    });
    console.log('B8_SEPARATION_OPPORTUNISTIC:', {
      Decision: evidenceOpportunistic[0]?.decision,
      Reason: evidenceOpportunistic[0]?.actionReason,
      BidsCount: bidsOpportunistic.length,
    });

    // B11 Intimidated: Conservative bot drops with RIVAL_INTIMIDATION and submits no bids
    expect(evidenceIntimidated[0]?.decision).toBe('DROP');
    expect(evidenceIntimidated[0]?.actionReason).toBe('RIVAL_INTIMIDATION');
    expect(bidsIntimidated.length).toBe(0);

    // B11 Not Intimidated: Low rival pressure -> Conservative bot enters auction and submits bid
    expect(evidenceLowRival[0]?.decision).toBe('ENTER');
    expect(evidenceLowRival[0]?.actionReason).toBe('TV_FAVORABLE');
    expect(bidsLowRival.length).toBe(1);
    expect(bidsLowRival[0]?.nextBidAmount).toBe(525);

    // B11 Not Intimidated: Aggressive bot enters auction and submits bid
    expect(evidenceAggressive[0]?.decision).toBe('ENTER');
    expect(evidenceAggressive[0]?.actionReason).toBe('TV_FAVORABLE');
    expect(bidsAggressive.length).toBe(1);
    expect(bidsAggressive[0]?.nextBidAmount).toBe(525);

    // B8 Separation: Opportunistic bot drops with RIVAL_BAIT_DROP
    expect(evidenceOpportunistic[0]?.decision).toBe('DROP');
    expect(evidenceOpportunistic[0]?.actionReason).toBe('RIVAL_BAIT_DROP');
    expect(bidsOpportunistic.length).toBe(0);
  });
});
