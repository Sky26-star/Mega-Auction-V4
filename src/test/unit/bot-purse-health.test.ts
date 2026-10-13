import { describe, it, expect } from 'vitest';
import { evaluateQAndTV } from '@/lib/auction/bot-q-engine';
import { evaluateTacticalDecision } from '@/lib/auction/bot-tactical-engine';
import {
  evaluateBotsForLot,
  DEFAULT_CONTEXT,
  type AuctionContext,
  type BotDecisionEvidence
} from '@/lib/auction/server-bot-engine';
import { type V3Player, type V3Team } from '@/lib/v3-auction-types';

describe('Behavior B10: Purse Health', () => {
  const currentLot: V3Player & { rating?: number } = {
    id: 'lot-b10-1',
    name: 'Top Order Batsman',
    role: 'BATSMAN',
    category: 'C',
    country: 'India',
    age: 25,
    batting_hand: 'Right Handed',
    base_price: 25,
    is_overseas: false,
    image_url: null,
    rating: 78,
  };

  const healthyBot: V3Team & { personality?: string } = {
    id: 'bot-b10-healthy',
    name: 'Healthy Purse Franchise',
    short_name: 'HLT',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 17,
    overseas_count: 2,
    personality: 'BALANCED',
  };

  const constrainedBot: V3Team & { personality?: string } = {
    id: 'bot-b10-constrained',
    name: 'Constrained Purse Franchise',
    short_name: 'CST',
    is_bot: true,
    purse: 250,
    initial_purse: 10000,
    players_bought: 17,
    overseas_count: 2,
    personality: 'BALANCED',
  };

  const feasibilityInsolventBot: V3Team & { personality?: string } = {
    id: 'bot-b10-feas-insolvent',
    name: 'Feasibility Insolvent Franchise',
    short_name: 'FIS',
    is_bot: true,
    purse: 180,
    initial_purse: 10000,
    players_bought: 17,
    overseas_count: 2,
    personality: 'BALANCED',
  };

  const walletInsolventBot: V3Team & { personality?: string } = {
    id: 'bot-b10-wallet-insolvent',
    name: 'Wallet Insolvent Franchise',
    short_name: 'WIS',
    is_bot: true,
    purse: 20,
    initial_purse: 10000,
    players_bought: 17,
    overseas_count: 2,
    personality: 'BALANCED',
  };

  // Remaining slots for all bots: 25 - 17 = 8 slots
  // Mandatory squad reserve for remaining slots after current purchase: (8 - 1) * 20L = 140L
  const remainingSlots = 8;
  const minSquadReserve = (remainingSlots - 1) * 20; // 140L

  // ============================================================
  // 1. ECONOMIC Q/TV ENGINE: PURSE BOUNDS ON DISCRETE LADDER
  // ============================================================
  it('1. Authoritative Q/TV engine: True Value ceiling naturally bounds to solvent purse', () => {
    const teamStateHealthy = {
      purse: 5000,
      playersBought: 17,
      overseasCount: 2,
      roleCounts: {},
    };

    const teamStateConstrained = {
      purse: 250,
      playersBought: 17,
      overseasCount: 2,
      roleCounts: {},
    };

    // Starting at bid 0 (opening bid 25L)
    const qHealthy = evaluateQAndTV(currentLot as any, [], teamStateHealthy, 0, false);
    const qConstrained = evaluateQAndTV(currentLot as any, [], teamStateConstrained, 0, false);

    console.log('\n--- B10 Q/TV ECONOMIC SOLVENCY CONTRAST ---');
    console.log('HEALTHY_BOT_TV:', {
      purse: teamStateHealthy.purse,
      maxSolventPurse: teamStateHealthy.purse - minSquadReserve,
      tv: qHealthy.tv,
      qBuy: qHealthy.qBuyAtRequiredBid,
      qSkip: qHealthy.qSkip,
    });
    console.log('CONSTRAINED_BOT_TV:', {
      purse: teamStateConstrained.purse,
      maxSolventPurse: teamStateConstrained.purse - minSquadReserve,
      tv: qConstrained.tv,
      qBuy: qConstrained.qBuyAtRequiredBid,
      qSkip: qConstrained.qSkip,
    });

    // Healthy bot has abundant solvent purse (5000 - 140 = 4860L), TV reflects player valuation
    expect(qHealthy.tv).toBeGreaterThan(qConstrained.tv);

    // Constrained bot's maximum solvent purse is 250 - 140 = 110L
    // True Value cannot exceed solvent purse boundary
    expect(qConstrained.tv).toBeLessThanOrEqual(110);
    expect(qConstrained.isLegal).toBe(true);
  });

  // ============================================================
  // 2. TACTICAL ENGINE: PURSE HEALTH PACING & SOLVENCY CONTRAST
  // ============================================================
  it('2. Tactical engine: differentiates Healthy bidding vs Constrained preservation vs Hard Insolvency', () => {
    const nextRequiredBid = 50; // Current bid 25 -> next required bid 50
    const tv = 75; // Player TV is 75L, so 50L is within True Value

    const qResult = {
      currentBid: 25,
      nextRequiredBid,
      tv,
      qSkip: 50,
      qBuyAtRequiredBid: 65,
      qBuyBase: 70,
      qDelta: 15,
      decision: 'BID' as const,
      isLegal: true,
      ladderEvaluated: [50, 75],
    };

    const baseTactical = {
      auctionId: 'auction-b10',
      lotId: currentLot.id,
      personality: 'BALANCED' as const,
      qResult: qResult as any,
      roleNeed: 'NORMAL' as const,
      strategicPolicy: null,
      brainState: null,
      basePrice: 25,
      remainingSlots,
      remainingTimerMs: 15000,
      initialPurse: 10000,
      auctionProgress: 0.65,
      maxSquadSize: 25,
    };

    // --- Branch A: HEALTHY PURSE STATE ---
    // Purse = 5000L >> 140L reserve, discretionary = 4860L, avg/slot = 625L
    const tacticalHealthy = evaluateTacticalDecision({
      ...baseTactical,
      teamId: healthyBot.id,
      purse: 5000,
    });

    // --- Branch B: MATERIALLY CONSTRAINED PURSE STATE ---
    // Purse = 250L, reserve = 140L, discretionary = 110L <= 140L, avg/slot = 31.25L
    // Bid 50L > avg/slot 31.25L for non-critical role -> must preserve resources
    const tacticalConstrained = evaluateTacticalDecision({
      ...baseTactical,
      teamId: constrainedBot.id,
      purse: 250,
    });

    // --- Branch C: CONSTRAINED BUT CRITICAL ROLE EXCEPTION ---
    // Same constrained purse (250L), but role gap is CRITICAL
    // Solvency is preserved (250 - 50 = 200 >= 140L), so critical gap is pursued
    const tacticalConstrainedCritical = evaluateTacticalDecision({
      ...baseTactical,
      teamId: constrainedBot.id,
      purse: 250,
      roleNeed: 'CRITICAL',
    });

    // --- Branch D: SQUAD FEASIBILITY INSOLVENCY ---
    // Purse = 180L, reserve = 140L.
    // Placing 50L bid leaves 180 - 50 = 130L < 140L (cannot fill remaining 7 slots at 20L base price)
    const tacticalFeasibilityInsolvent = evaluateTacticalDecision({
      ...baseTactical,
      teamId: feasibilityInsolventBot.id,
      purse: 180,
    });

    console.log('\n--- B10 TACTICAL DECISION CONTRAST ---');
    console.log('BRANCH_A_HEALTHY:', {
      action: tacticalHealthy.action,
      reason: tacticalHealthy.reason,
      pacingState: tacticalHealthy.pacingState,
      bidAmount: tacticalHealthy.bidAmount,
    });
    console.log('BRANCH_B_CONSTRAINED:', {
      action: tacticalConstrained.action,
      reason: tacticalConstrained.reason,
      pacingState: tacticalConstrained.pacingState,
    });
    console.log('BRANCH_C_CONSTRAINED_CRITICAL:', {
      action: tacticalConstrainedCritical.action,
      reason: tacticalConstrainedCritical.reason,
      pacingState: tacticalConstrainedCritical.pacingState,
      bidAmount: tacticalConstrainedCritical.bidAmount,
    });
    console.log('BRANCH_D_FEASIBILITY_INSOLVENT:', {
      action: tacticalFeasibilityInsolvent.action,
      reason: tacticalFeasibilityInsolvent.reason,
      pacingState: tacticalFeasibilityInsolvent.pacingState,
    });

    // Branch A: Healthy purse -> Bids normally
    expect(tacticalHealthy.action).toBe('BID');
    expect(tacticalHealthy.reason).toBe('TV_FAVORABLE');
    expect(tacticalHealthy.pacingState).toBe('RESOURCE_HEALTHY');
    expect(tacticalHealthy.bidAmount).toBe(50);

    // Branch B: Constrained purse -> Drops to preserve budget for slot feasibility
    expect(tacticalConstrained.action).toBe('PASS');
    expect(tacticalConstrained.reason).toBe('RESOURCE_CONSTRAINED_RESERVATION');
    expect(tacticalConstrained.pacingState).toBe('RESOURCE_CONSTRAINED');

    // Branch C: Constrained purse with CRITICAL need -> Bids because critical priority overrides non-critical conservation
    expect(tacticalConstrainedCritical.action).toBe('BID');
    expect(tacticalConstrainedCritical.reason).toBe('TV_FAVORABLE');
    expect(tacticalConstrainedCritical.bidAmount).toBe(50);

    // Branch D: Feasibility insolvent -> Hard drop due to squad reserve requirement
    expect(tacticalFeasibilityInsolvent.action).toBe('PASS');
    expect(tacticalFeasibilityInsolvent.reason).toBe('PURSE_INSOLVENCY');
    expect(tacticalFeasibilityInsolvent.pacingState).toBe('RESOURCE_CONSTRAINED');
  });

  // ============================================================
  // 3. SERVER BOT ENGINE END-TO-END INTEGRATION
  // ============================================================
  it('3. Server bot engine integration: evaluateBotsForLot emits ENTER vs DROP vs REJECTED_ELIGIBILITY', () => {
    const currentBid = 25;
    const basePrice = 25;

    const baseCtx: AuctionContext = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      maxOverseas: 8,
      auctionProgress: 0.65,
      futurePlayers: [],
    };

    // Scenario 1: Healthy Bot
    const evidenceHealthy: BotDecisionEvidence[] = [];
    const bidsHealthy = evaluateBotsForLot(
      [healthyBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [healthyBot],
      { [healthyBot.id]: [] },
      baseCtx,
      null,
      evidenceHealthy,
      'auction-b10'
    );

    // Scenario 2: Constrained Bot (has filled minimum batsmen, so roleNeed is NORMAL; declines above avg slot budget)
    const existingBatsmen: V3Player[] = Array.from({ length: 3 }, (_, i) => ({
      id: `existing-bat-${i}`,
      name: `Existing Bat ${i}`,
      role: 'BATSMAN',
      category: 'C',
      country: 'India',
      age: 26,
      batting_hand: 'Right Handed',
      base_price: 20,
      is_overseas: false,
      image_url: null,
    }));

    const evidenceConstrained: BotDecisionEvidence[] = [];
    const bidsConstrained = evaluateBotsForLot(
      [constrainedBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [constrainedBot],
      { [constrainedBot.id]: existingBatsmen },
      baseCtx,
      null,
      evidenceConstrained,
      'auction-b10'
    );

    // Scenario 3: Feasibility Insolvent Bot (cannot afford mandatory squad reserve)
    const evidenceFeasInsolvent: BotDecisionEvidence[] = [];
    const bidsFeasInsolvent = evaluateBotsForLot(
      [feasibilityInsolventBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [feasibilityInsolventBot],
      { [feasibilityInsolventBot.id]: [] },
      baseCtx,
      null,
      evidenceFeasInsolvent,
      'auction-b10'
    );

    // Scenario 4: Wallet Insolvent Bot (purse strictly less than next required bid)
    const evidenceWalletInsolvent: BotDecisionEvidence[] = [];
    const bidsWalletInsolvent = evaluateBotsForLot(
      [walletInsolventBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [walletInsolventBot],
      { [walletInsolventBot.id]: [] },
      baseCtx,
      null,
      evidenceWalletInsolvent,
      'auction-b10'
    );

    console.log('\n--- B10 SERVER BOT ENGINE END-TO-END EVIDENCE ---');
    console.log('SCENARIO_1_HEALTHY:', {
      Decision: evidenceHealthy[0]?.decision,
      Reason: evidenceHealthy[0]?.actionReason,
      PacingState: evidenceHealthy[0]?.pacingState,
      BidsCount: bidsHealthy.length,
      NextBid: bidsHealthy[0]?.nextBidAmount,
    });
    console.log('SCENARIO_2_CONSTRAINED:', {
      Decision: evidenceConstrained[0]?.decision,
      Reason: evidenceConstrained[0]?.actionReason,
      PacingState: evidenceConstrained[0]?.pacingState,
      BidsCount: bidsConstrained.length,
    });
    console.log('SCENARIO_3_FEASIBILITY_INSOLVENT:', {
      Decision: evidenceFeasInsolvent[0]?.decision,
      Reason: evidenceFeasInsolvent[0]?.actionReason,
      PacingState: evidenceFeasInsolvent[0]?.pacingState,
      BidsCount: bidsFeasInsolvent.length,
    });
    console.log('SCENARIO_4_WALLET_INSOLVENT:', {
      Decision: evidenceWalletInsolvent[0]?.decision,
      EligibilityReason: evidenceWalletInsolvent[0]?.eligibilityReason,
      BidsCount: bidsWalletInsolvent.length,
    });

    // 1. Healthy Bot: Bids actively within TV
    expect(evidenceHealthy[0]?.decision).toBe('ENTER');
    expect(evidenceHealthy[0]?.actionReason).toBe('TV_FAVORABLE');
    expect(evidenceHealthy[0]?.pacingState).toBe('RESOURCE_HEALTHY');
    expect(bidsHealthy.length).toBe(1);
    expect(bidsHealthy[0]?.nextBidAmount).toBe(50);

    // 2. Constrained Bot: Drops cleanly to preserve remaining budget
    expect(evidenceConstrained[0]?.decision).toBe('DROP');
    expect(evidenceConstrained[0]?.actionReason).toBe('RESOURCE_CONSTRAINED_RESERVATION');
    expect(evidenceConstrained[0]?.pacingState).toBe('RESOURCE_CONSTRAINED');
    expect(bidsConstrained.length).toBe(0);

    // 3. Feasibility Insolvent Bot: Drops due to squad solvency defense
    expect(evidenceFeasInsolvent[0]?.decision).toBe('DROP');
    expect(evidenceFeasInsolvent[0]?.actionReason).toBe('PURSE_INSOLVENCY');
    expect(evidenceFeasInsolvent[0]?.pacingState).toBe('RESOURCE_CONSTRAINED');
    expect(bidsFeasInsolvent.length).toBe(0);

    // 4. Wallet Insolvent Bot: Rejected before valuation via hard eligibility rule
    expect(evidenceWalletInsolvent[0]?.decision).toBe('REJECTED_ELIGIBILITY');
    expect(evidenceWalletInsolvent[0]?.eligibilityReason).toBe('PURSE_INSUFFICIENT');
    expect(bidsWalletInsolvent.length).toBe(0);
  });
});
