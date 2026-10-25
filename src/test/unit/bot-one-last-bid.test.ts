import { describe, it, expect, vi } from 'vitest';
import { evaluateTacticalDecision, type TacticalInputContext } from '@/lib/auction/bot-tactical-engine';
import { clearBotMemory, getBotMemory } from '@/lib/auction/bot-brain-memory';
import { submitBotBid } from '@/lib/auction/bot-bid-submission';
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

describe('Behavior B13: One-Last-Bid', () => {
  const currentLot: V3Player & { rating?: number } = {
    id: 'lot-b13-1',
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

  const aggressiveBot: V3Team & { personality?: string } = {
    id: 'bot-b13-aggressive',
    name: 'Aggressive Franchise',
    short_name: 'AGG',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 20,
    overseas_count: 5,
    personality: 'AGGRESSIVE',
  };

  const balancedBot: V3Team & { personality?: string } = {
    id: 'bot-b13-balanced',
    name: 'Balanced Franchise',
    short_name: 'BAL',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 20,
    overseas_count: 5,
    personality: 'BALANCED',
  };

  const opportunisticBot: V3Team & { personality?: string } = {
    id: 'bot-b13-opportunistic',
    name: 'Opportunistic Franchise',
    short_name: 'OPP',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 20,
    overseas_count: 5,
    personality: 'OPPORTUNISTIC',
  };

  const conservativeBot: V3Team & { personality?: string } = {
    id: 'bot-b13-conservative',
    name: 'Conservative Franchise',
    short_name: 'CON',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 20,
    overseas_count: 5,
    personality: 'CONSERVATIVE',
  };

  const baseTacticalContext: Omit<TacticalInputContext, 'personality' | 'qResult' | 'brainState'> = {
    teamId: aggressiveBot.id,
    auctionId: 'auction-b13',
    lotId: currentLot.id,
    roleNeed: 'CRITICAL',
    strategicPolicy: null,
    basePrice: 100,
    remainingSlots: 5,
    purse: 5000,
    remainingTimerMs: 15000,
    initialPurse: 10000,
    auctionProgress: 0.8,
    maxSquadSize: 25,
  };

  // Economic baseline at stopping point:
  // Q_buy (110) == Q_skip (110) -> economic indifference / stopping point where standard bidding stops
  // nextRequiredBid = 675 <= tv = 700 (within TV)
  const qResultStoppingPoint = {
    currentBid: 600,
    nextRequiredBid: 675,
    tv: 700,
    qSkip: 110,
    qBuyAtRequiredBid: 110,
    qBuyBase: 140,
    qDelta: 0,
    decision: 'PASS' as const,
    isLegal: true,
    ladderEvaluated: [675, 700],
  };

  // ============================================================
  // 1. TACTICAL ENGINE: CAUSAL DECISION CONTRAST & INVARIANTS
  // ============================================================
  it('1. Tactical engine: enforces One-Last-Bid (CRITICAL_GAP_STRETCH) on eligible stopping point, PASS when ineligible', () => {
    const highUrgencyBrainState = {
      beliefs: { rivalAggression: 0.3, marketInflation: 0.5, roleScarcityPanic: 1.0, estimatedSquadQuality: 0.5 },
      memory: {
        auctionId: 'auction-b13',
        teamId: aggressiveBot.id,
        observedBids: {},
        purchases: [],
        failedTargets: [],
        lotsSinceLastPurchase: 3,
        isInitialized: true,
        lastSeenLotId: currentLot.id,
        processedCompletedLots: new Set<string>()
      } as any,
      plan: {
        urgency: 1.0,
        strategicFocus: 'FILL_GAPS' as const,
        budgetAllocation: { totalRemaining: 5000, reserveForCriticalNeeds: 80, discretionaryBudget: 4920, spentRatio: 0.5 },
        willSacrificeOverseasForQuality: false
      },
    };

    // Case A: ELIGIBLE ONE-LAST-BID
    // Aggressive bot + Critical need + High urgency + Stopping point (Q_buy == Q_skip) + Bid <= TV
    const decEligible = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      qResult: qResultStoppingPoint as any,
      brainState: highUrgencyBrainState as any,
    });

    // Case B: NOT ELIGIBLE — Non-critical need (Balanced personality on normal role need)
    const decNotEligibleRole = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'BALANCED',
      roleNeed: 'NORMAL',
      qResult: qResultStoppingPoint as any,
      brainState: highUrgencyBrainState as any,
    });

    // Case C: NOT ELIGIBLE — Conservative personality (Conservative never stretches)
    const decNotEligiblePersonality = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'CONSERVATIVE',
      roleNeed: 'CRITICAL',
      qResult: qResultStoppingPoint as any,
      brainState: highUrgencyBrainState as any,
    });

    // Case D: REPEAT-PREVENTION — Memory shows final bid was already placed on this lot
    const repeatMemoryBrainState = {
      ...highUrgencyBrainState,
      memory: {
        ...highUrgencyBrainState.memory,
        observedBids: {
          [currentLot.id]: {
            highestBid: 675,
            observedAt: Date.now() - 1000,
            isFinalBid: true,
          }
        }
      }
    };

    const decRepeatPrevented = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      qResult: qResultStoppingPoint as any,
      brainState: repeatMemoryBrainState as any,
    });

    // Case E: TV INVARIANT — Exceeds TV strictly passes
    const qResultExceedsTv = {
      ...qResultStoppingPoint,
      nextRequiredBid: 750,
      tv: 700,
      ladderEvaluated: [750]
    };
    const decExceedsTv = evaluateTacticalDecision({
      ...baseTacticalContext,
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      qResult: qResultExceedsTv as any,
      brainState: highUrgencyBrainState as any,
    });

    // Case F: LEGALITY INVARIANT — Purse insolvency strictly overrides One-Last-Bid
    const decInsolvent = evaluateTacticalDecision({
      ...baseTacticalContext,
      purse: 700, // 700 - 675 = 25 < (5 - 1) * 20 = 80 min reserve
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      qResult: qResultStoppingPoint as any,
      brainState: highUrgencyBrainState as any,
    });

    console.log('\n--- B13 TACTICAL CAUSAL CONTRAST ---');
    console.log('B13_ELIGIBLE:', {
      action: decEligible.action,
      reason: decEligible.reason,
      bidAmount: decEligible.bidAmount,
      isStretched: decEligible.isStretched,
      tv: decEligible.tv,
    });
    console.log('B13_NOT_ELIGIBLE_NORMAL_ROLE:', {
      action: decNotEligibleRole.action,
      reason: decNotEligibleRole.reason,
    });
    console.log('B13_NOT_ELIGIBLE_CONSERVATIVE:', {
      action: decNotEligiblePersonality.action,
      reason: decNotEligiblePersonality.reason,
    });
    console.log('B13_REPEAT_PREVENTED:', {
      action: decRepeatPrevented.action,
      reason: decRepeatPrevented.reason,
    });
    console.log('B13_EXCEEDS_TV:', {
      action: decExceedsTv.action,
      reason: decExceedsTv.reason,
    });
    console.log('B13_INSOLVENT:', {
      action: decInsolvent.action,
      reason: decInsolvent.reason,
    });

    // Case A: Eligible -> Action: STRETCH, Reason: CRITICAL_GAP_STRETCH, isStretched: true, bid <= TV
    expect(decEligible.action).toBe('STRETCH');
    expect(decEligible.reason).toBe('CRITICAL_GAP_STRETCH');
    expect(decEligible.isStretched).toBe(true);
    expect(decEligible.bidAmount).toBe(675);
    expect(decEligible.bidAmount).toBeLessThanOrEqual(decEligible.tv);
    expect(decEligible.tv).toBe(700);

    // Case B: Not eligible (normal role) -> PASS
    expect(decNotEligibleRole.action).toBe('PASS');
    expect(decNotEligibleRole.reason).toBe('PRICE_EXCEEDS_TV');

    // Case C: Not eligible (conservative) -> PASS
    expect(decNotEligiblePersonality.action).toBe('PASS');
    expect(decNotEligiblePersonality.reason).toBe('PRICE_EXCEEDS_TV');

    // Case D: Repeat-prevention -> PASS (cannot stretch twice)
    expect(decRepeatPrevented.action).toBe('PASS');
    expect(decRepeatPrevented.reason).toBe('PRICE_EXCEEDS_TV');

    // Case E: TV Invariant -> cannot bid above TV
    expect(decExceedsTv.action).toBe('PASS');
    expect(decExceedsTv.reason).toBe('PRICE_EXCEEDS_TV');

    // Case F: Legality Invariant -> purse insolvency wins
    expect(decInsolvent.action).toBe('PASS');
    expect(decInsolvent.reason).toBe('PURSE_INSOLVENCY');
  });

  // ============================================================
  // 2. PRECEDENCE: B8, B10, B11, B12 WIN OVER ONE-LAST-BID
  // ============================================================
  it('2. Precedence: B8, B10, B11, and B12 higher-priority conditions retain their existing reason and action', () => {
    // Economic baseline within TV:
    // qBuyAtRequiredBid: 85 < qSkip: 80 * 1.10 = 88 (low marginal benefit)
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

    const brainStateWithHighRival = {
      beliefs: { rivalAggression: 0.9, marketInflation: 0.2, roleScarcityPanic: 1.0, estimatedSquadQuality: 0.5 },
      memory: { observedBids: {} } as any,
      plan: { urgency: 1.0, strategicFocus: 'FILL_GAPS' as const, budgetAllocation: {} as any },
    };

    const brainStateWithHighPricePressure = {
      beliefs: { rivalAggression: 0.2, marketInflation: 1.2, roleScarcityPanic: 0.2, estimatedSquadQuality: 0.5 },
      memory: { observedBids: {} } as any,
      plan: { urgency: 0.3, strategicFocus: 'BUILD_CORE' as const, budgetAllocation: {} as any },
    };

    // Precedence 1: B8 Rival Bait/Drop (Opportunistic + High rival aggression)
    const decB8 = evaluateTacticalDecision({
      ...baseTacticalContext,
      teamId: opportunisticBot.id,
      personality: 'OPPORTUNISTIC',
      roleNeed: 'NORMAL',
      qResult: qResultLowMarginal as any,
      brainState: brainStateWithHighRival as any,
    });
    expect(decB8.action).toBe('PASS');
    expect(decB8.reason).toBe('RIVAL_BAIT_DROP');

    // Precedence 2: B11 Rival Intimidation (Conservative + High rival aggression)
    const decB11 = evaluateTacticalDecision({
      ...baseTacticalContext,
      teamId: conservativeBot.id,
      personality: 'CONSERVATIVE',
      roleNeed: 'NORMAL',
      qResult: qResultLowMarginal as any,
      brainState: brainStateWithHighRival as any,
    });
    expect(decB11.action).toBe('PASS');
    expect(decB11.reason).toBe('RIVAL_INTIMIDATION');

    // Precedence 3: B12 Price Pressure / Purse Drain
    // Purse = 2000, 5 slots -> avg/slot = 400L. Next bid = 550L > 400L.
    const decB12 = evaluateTacticalDecision({
      ...baseTacticalContext,
      purse: 2000,
      personality: 'BALANCED',
      roleNeed: 'NORMAL',
      qResult: qResultLowMarginal as any,
      brainState: brainStateWithHighPricePressure as any,
    });
    expect(decB12.action).toBe('PASS');
    expect(decB12.reason).toBe('PRICE_PRESSURE_PURSE_DRAIN');

    // Precedence 4: B10 Purse Solvency failure
    const decB10 = evaluateTacticalDecision({
      ...baseTacticalContext,
      purse: 580, // 580 - 550 = 30 < (5 - 1) * 20 = 80 min reserve
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      qResult: qResultLowMarginal as any,
      brainState: brainStateWithHighRival as any,
    });
    expect(decB10.action).toBe('PASS');
    expect(decB10.reason).toBe('PURSE_INSOLVENCY');
  });

  // ============================================================
  // 3. SERVER BOT ENGINE END-TO-END INTEGRATION
  // ============================================================
  it('3. Server bot engine integration: only a confirmed RPC acceptance consumes the ONE_LAST_BID allowance', async () => {
    // Current bid 1075 -> next required bid is 1175 (the exact final discrete ladder point <= TV 1175)
    const currentBid = 1075;
    const basePrice = 100;
    const auctionId = 'auction-b13-confirmed-rpc';
    clearBotMemory(auctionId, aggressiveBot.id);
    const eligibleMemory = getBotMemory(auctionId, aggressiveBot.id);

    const currentLotWithStats: V3Player & { rating?: number } = {
      ...currentLot,
      rating: 85,
      matches: 120,
      runs: 2500,
      batting_average: 36,
      strike_rate: 142,
      boundaries: 350,
      catches: 60,
      stumpings: 18,
      highest_score: 102
    };

    const futureAlternative: V3Player = {
      id: 'future-wk-1',
      name: 'Future Wicket Keeper',
      role: 'WICKET_KEEPER',
      category: 'B',
      country: 'India',
      age: 26,
      batting_hand: 'Right Handed',
      base_price: 100,
      is_overseas: false,
      image_url: null,
    };

    const eligibleBrainState = {
      beliefs: { rivalAggression: 0.3, marketInflation: 0.4, roleScarcityPanic: 1.0, estimatedSquadQuality: 0.5 },
      memory: eligibleMemory,
      plan: {
        urgency: 1.0,
        strategicFocus: 'FILL_GAPS' as const,
        budgetAllocation: { totalRemaining: 5000, reserveForCriticalNeeds: 80, discretionaryBudget: 4920, spentRatio: 0.5 },
        willSacrificeOverseasForQuality: false
      },
    };

    const baseCtx: Omit<AuctionContext, 'futurePlayers'> = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      maxOverseas: 8,
      auctionProgress: 0.8,
    };

    // Roster where Batsmen (7), Bowlers (8), and All-Rounders (5) meet their ideal targets,
    // making Wicket Keeper (0) the single primary CRITICAL target.
    const criticalRoster = [
      ...Array(7).fill({ role: 'BATSMAN' }),
      ...Array(8).fill({ role: 'BOWLER' }),
      ...Array(5).fill({ role: 'ALL_ROUNDER' }),
    ];

    // Scenario 1: ELIGIBLE — Aggressive bot with zero wicket keepers emits ONE_LAST_BID
    const evidenceEligible: BotDecisionEvidence[] = [];
    const bidsEligible = evaluateBotsForLot(
      [aggressiveBot],
      currentLotWithStats,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [aggressiveBot],
      { [aggressiveBot.id]: criticalRoster },
      { ...baseCtx, brainState: eligibleBrainState, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceEligible,
      auctionId
    );

    const submitOptions = {
      auctionId,
      teamId: aggressiveBot.id,
      playerId: currentLot.id,
      isFinalBid: bidsEligible[0]?.isFinalBid,
    };
    expect(bidsEligible[0]?.isFinalBid).toBe(true);
    expect(eligibleMemory.observedBids[currentLot.id]?.isFinalBid).not.toBe(true);

    // A business rejection must leave the final-bid allowance available.
    const rejectedRpc = vi.fn().mockResolvedValue({
      data: { success: false, error: 'BID_REJECTED' },
      error: null,
    });
    const rejected = await submitBotBid(rejectedRpc, submitOptions);
    expect(rejectedRpc).toHaveBeenCalledOnce();
    expect(rejected.isApplied).toBe(false);
    expect(eligibleMemory.observedBids[currentLot.id]?.isFinalBid).not.toBe(true);

    // A rejected RPC promise likewise cannot consume the allowance.
    const transportError = new Error('simulated RPC transport failure');
    const failedRpc = vi.fn().mockRejectedValue(transportError);
    await expect(submitBotBid(failedRpc, submitOptions)).rejects.toBe(transportError);
    expect(eligibleMemory.observedBids[currentLot.id]?.isFinalBid).not.toBe(true);

    // A later evaluation can retry after either failure.
    const evidenceRetry: BotDecisionEvidence[] = [];
    const bidsRetry = evaluateBotsForLot(
      [aggressiveBot], currentLotWithStats, currentBid, basePrice, undefined, 'Normal',
      [aggressiveBot], { [aggressiveBot.id]: criticalRoster },
      { ...baseCtx, brainState: eligibleBrainState, futurePlayers: [futureAlternative] } as any,
      null, evidenceRetry, auctionId
    );
    expect(evidenceRetry[0]?.decision).toBe('ONE_LAST_BID');
    expect(bidsRetry[0]?.isFinalBid).toBe(true);

    // Only a confirmed, amount-bearing success records the final bid and prevents a duplicate.
    const acceptedRpc = vi.fn().mockResolvedValue({
      data: { success: true, amount: 1175, current_bid: 1175 },
      error: null,
    });
    const accepted = await submitBotBid(acceptedRpc, { ...submitOptions, isFinalBid: bidsRetry[0]?.isFinalBid });
    expect(acceptedRpc).toHaveBeenCalledOnce();
    expect(accepted.isApplied).toBe(true);
    expect(eligibleMemory.observedBids[currentLot.id]?.isFinalBid).toBe(true);

    const evidenceRepeat: BotDecisionEvidence[] = [];
    const bidsRepeat = evaluateBotsForLot(
      [aggressiveBot], currentLotWithStats, currentBid, basePrice, undefined, 'Normal',
      [aggressiveBot], { [aggressiveBot.id]: criticalRoster },
      { ...baseCtx, brainState: eligibleBrainState, futurePlayers: [futureAlternative] } as any,
      null, evidenceRepeat, auctionId
    );

    // Scenario 3: INELIGIBLE — Balanced bot with normal need drops out
    const evidenceIneligible: BotDecisionEvidence[] = [];
    const bidsIneligible = evaluateBotsForLot(
      [balancedBot],
      currentLot,
      currentBid,
      basePrice,
      undefined,
      'Normal',
      [balancedBot],
      { [balancedBot.id]: [
        ...Array(7).fill({ role: 'BATSMAN' }),
        ...Array(6).fill({ role: 'BOWLER' }),
        ...Array(5).fill({ role: 'ALL_ROUNDER' }),
        { role: 'WICKET_KEEPER' },
        { role: 'WICKET_KEEPER' }
      ] }, // Already 2 wicket keepers -> redundant / normal
      { ...baseCtx, futurePlayers: [futureAlternative] } as any,
      null,
      evidenceIneligible,
      auctionId
    );

    console.log('\n--- B13 SERVER BOT ENGINE END-TO-END EVIDENCE ---');
    console.log('B13_ELIGIBLE_ONE_LAST_BID:', {
      Decision: evidenceEligible[0]?.decision,
      Reason: evidenceEligible[0]?.actionReason,
      BidsCount: bidsEligible.length,
      NextBidAmount: bidsEligible[0]?.nextBidAmount,
      TV: evidenceEligible[0]?.tv,
    });
    console.log('B13_REPEAT_PREVENTED:', {
      Decision: evidenceRepeat[0]?.decision,
      Reason: evidenceRepeat[0]?.actionReason,
      BidsCount: bidsRepeat.length,
    });
    console.log('B13_INELIGIBLE_NORMAL_ROLE:', {
      Decision: evidenceIneligible[0]?.decision,
      Reason: evidenceIneligible[0]?.actionReason,
      BidsCount: bidsIneligible.length,
    });

    // Scenario 1: First-class ONE_LAST_BID decision and valid bid emitted
    expect(evidenceEligible[0]?.decision).toBe('ONE_LAST_BID');
    expect(evidenceEligible[0]?.actionReason).toBe('CRITICAL_GAP_STRETCH');
    expect(bidsEligible.length).toBe(1);
    expect(bidsEligible[0]?.nextBidAmount).toBe(1175);
    expect(bidsEligible[0]?.nextBidAmount).toBeLessThanOrEqual(evidenceEligible[0]!.tv);

    // Scenario 2: Repeat call drops after the accepted RPC result was recorded.
    expect(evidenceRepeat[0]?.decision).toBe('DROP');
    expect(bidsRepeat.length).toBe(0);

    // Scenario 3: Ineligible drops with 0 bids
    expect(evidenceIneligible[0]?.decision).toBe('DROP');
    expect(bidsIneligible.length).toBe(0);

    // TV remains identical across evaluations (TV invariant)
    expect(evidenceEligible[0]?.tv).toBe(evidenceRepeat[0]?.tv);
  });
});
