import { describe, it, expect, vi } from 'vitest';
import { evaluateTacticalDecision, type TacticalInputContext } from '@/lib/auction/bot-tactical-engine';
import { clearBotMemory, getBotMemory } from '@/lib/auction/bot-brain-memory';
import { submitBotBid, type BotBidSubmissionOptions } from '@/lib/auction/bot-bid-submission';
import {
  evaluateBotsForLot,
  DEFAULT_CONTEXT,
  type AuctionContext,
  type BotDecisionEvidence,
  type BotBidCandidate
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
  // 3. SERVER BOT ENGINE / SUBMISSION INTEGRATION
  // ============================================================
  it('3. Server bot engine integration: only a confirmed RPC acceptance consumes the ONE_LAST_BID allowance', async () => {
    const auctionId = 'auction-b13-confirmed-rpc';
    clearBotMemory(auctionId, aggressiveBot.id);
    const eligibleMemory = getBotMemory(auctionId, aggressiveBot.id);

    const validCandidate: BotBidCandidate = {
      teamId: aggressiveBot.id,
      nextBidAmount: 1175,
      delayMs: 1500,
      isFinalBid: true,
    };

    const submitOptions: BotBidSubmissionOptions = {
      auctionId,
      teamId: aggressiveBot.id,
      playerId: currentLot.id,
      isFinalBid: validCandidate.isFinalBid,
    };
    expect(validCandidate.isFinalBid).toBe(true);
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
    await expect(submitBotBid(failedRpc, submitOptions)).rejects.toThrow('simulated RPC transport failure');
    expect(eligibleMemory.observedBids[currentLot.id]?.isFinalBid).not.toBe(true);

    // A later evaluation can retry after either failure.
    const retryCandidate: BotBidCandidate = {
      ...validCandidate,
    };
    expect(retryCandidate.isFinalBid).toBe(true);

    // Only a confirmed, amount-bearing success records the final bid and prevents a duplicate.
    const acceptedRpc = vi.fn().mockResolvedValue({
      data: { success: true, amount: 1175, current_bid: 1175 },
      error: null,
    });
    const accepted = await submitBotBid(acceptedRpc, { ...submitOptions, isFinalBid: retryCandidate.isFinalBid });
    expect(acceptedRpc).toHaveBeenCalledOnce();
    expect(accepted.isApplied).toBe(true);
    expect(accepted.acceptedAmount).toBe(1175);
    expect(eligibleMemory.observedBids[currentLot.id]?.isFinalBid).toBe(true);

    // Repeat prevention: confirmed memory records final bid so future candidate evaluation detects final bid placed.
    expect(getBotMemory(auctionId, aggressiveBot.id).observedBids[currentLot.id]?.isFinalBid).toBe(true);
  });
});
