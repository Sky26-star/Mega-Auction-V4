// src/lib/auction/bot-tactical-engine.ts
//
// Strategic & Tactical Execution Engine
//
// Translates Foundation Q & TV into authoritative Strategy (BID / PASS / WAIT / STRETCH)
// and Tactical Execution (reaction delays, bounded stretch, opponent awareness).
//
// INVARIANTS:
// 1. STRATEGY INFORMS. ENGINE DECIDES.
// 2. Tactical execution CANNOT bypass legal feasibility or hard purse/squad/overseas bounds.
// 3. STRETCH is strictly bounded (at most 1 increment step above TV, only on critical needs).
// 4. Deterministic pseudo-randomness: No raw Math.random() in core logic; seeded by state hash.
// 5. Explicit first-class WAIT, PASS, STRETCH, and BID.

import { type BotPersonality, getNextBidAmount } from './server-bot-engine';
import { type QEvaluationResult } from './bot-q-engine';
import { type StrategicDecisionPolicy } from './bot-strategic-adapter';
import { type BotBrainState } from './bot-brain-state';

// ============================================================
// TYPES
// ============================================================

export type StrategicAction = 'BID' | 'PASS' | 'WAIT' | 'STRETCH';

export type StrategicReason =
  | 'TV_FAVORABLE'
  | 'PRICE_EXCEEDS_TV'
  | 'Q_INFERIOR'
  | 'ALREADY_HIGHEST_BIDDER'
  | 'SQUAD_CAPACITY_REACHED'
  | 'OVERSEAS_CAPACITY_REACHED'
  | 'PURSE_INSOLVENCY'
  | 'TACTICAL_WAIT_OPTIONALITY'
  | 'RIVAL_BAIT_DROP'
  | 'RIVAL_INTIMIDATION'
  | 'PRICE_PRESSURE_PURSE_DRAIN'
  | 'CRITICAL_GAP_STRETCH'
  | 'EARLY_RESOURCE_PRESERVATION'
  | 'RESOURCE_CONSTRAINED_RESERVATION'
  | 'LATE_RESOURCE_RELEASE';

export type PacingState =
  | 'EARLY_PRESERVATION'
  | 'LATE_RELEASE'
  | 'RESOURCE_CONSTRAINED'
  | 'RESOURCE_HEALTHY';

export interface TacticalDecision {
  action: StrategicAction;
  reason: StrategicReason;
  bidAmount: number;
  delayMs: number;
  tv: number;
  nextRequiredBid: number;
  isStretched: boolean;
  notes: string;
  pacingState?: PacingState;
}

export interface TacticalInputContext {
  teamId: string;
  auctionId: string;
  lotId: string;
  personality: BotPersonality;
  qResult: QEvaluationResult;
  roleNeed: string;
  strategicPolicy?: StrategicDecisionPolicy | null;
  brainState?: Readonly<BotBrainState> | null;
  basePrice?: number;
  remainingSlots: number;
  purse: number;
  remainingTimerMs: number;
  initialPurse?: number;
  auctionProgress?: number;
  futurePoolCount?: number;
  maxSquadSize?: number;
}

// ============================================================
// DETERMINISTIC SEEDED PSEUDO-RANDOM GENERATOR
// ============================================================

/**
 * Deterministic pseudo-random number in [0, 1) derived from state string hash.
 * Guaranteed 100% reproducible for the same auction/bot/bid state.
 */
export function getDeterministicPseudoRandom(seedStr: string): number {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  // Mulberry32-inspired PRNG step
  let t = hash + 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ============================================================
// STRATEGIC PURSE PACING (Behavior B3)
// ============================================================

export interface PursePacingEvaluation {
  pacingState: PacingState;
  shouldPass: boolean;
  reason?: StrategicReason;
  notes?: string;
}

/**
 * Evaluates the bot's strategic purse-pacing state and determines whether
 * resources should be preserved, released, or constrained based on real
 * auction progression, remaining squad obligations, and opportunity justification.
 *
 * Invariants:
 * 1. Q/TV is the sole economic authority (TV is NEVER modified).
 * 2. No arbitrary monetary multipliers (no 0.8x, no 1.2x).
 * 3. Priority: Legal > Q/TV > Squad Feasibility > Strategic Purse Pacing > Tactical/Personality.
 */
export function evaluatePursePacing(params: {
  purse: number;
  initialPurse?: number;
  remainingSlots: number;
  maxSquadSize?: number;
  auctionProgress?: number;
  futurePoolCount?: number;
  nextRequiredBid: number;
  roleNeed: string;
  strategicPolicy?: StrategicDecisionPolicy | null;
  brainState?: Readonly<BotBrainState> | null;
}): PursePacingEvaluation {
  const {
    purse,
    remainingSlots,
    auctionProgress = 0,
    futurePoolCount = 0,
    nextRequiredBid,
    roleNeed,
    strategicPolicy,
    brainState,
  } = params;

  const minBasePrice = 20; // Official IPL base price floor in Lakhs
  const remainingSlotsAfterCurrent = Math.max(0, remainingSlots - 1);
  const minSquadReserve = remainingSlotsAfterCurrent * minBasePrice;
  const discretionaryPurse = Math.max(0, purse - minSquadReserve);
  const avgPursePerSlot = remainingSlots > 0 ? purse / remainingSlots : purse;

  const isCriticalNeed =
    roleNeed === 'CRITICAL' ||
    strategicPolicy?.pursuitStance === 'CRITICAL_PURSUIT' ||
    strategicPolicy?.consequenceAwareness === 'HIGH';

  // 1. HARD FINANCIAL FEASIBILITY: Can bot fill remaining slots at base price?
  if (purse - nextRequiredBid < minSquadReserve) {
    return {
      pacingState: 'RESOURCE_CONSTRAINED',
      shouldPass: true,
      reason: 'PURSE_INSOLVENCY',
      notes: `Squad feasibility failure: placing bid ${nextRequiredBid} leaves less than ${minSquadReserve}L needed for ${remainingSlotsAfterCurrent} remaining slots.`,
    };
  }

  // 2. RESOURCE-CONSTRAINED STATE
  // Discretionary purse is depleted relative to mandatory squad reserve, or brain plan is PROTECT_PURSE
  const isBudgetConstrained =
    discretionaryPurse <= minSquadReserve ||
    brainState?.plan?.strategicFocus === 'PROTECT_PURSE';

  if (isBudgetConstrained) {
    if (!isCriticalNeed && nextRequiredBid > avgPursePerSlot) {
      return {
        pacingState: 'RESOURCE_CONSTRAINED',
        shouldPass: true,
        reason: 'RESOURCE_CONSTRAINED_RESERVATION',
        notes: `Resource-constrained preservation: discretionary purse is tight (${discretionaryPurse}L); declining non-critical bid ${nextRequiredBid}L above average slot budget (${avgPursePerSlot.toFixed(1)}L).`,
      };
    }
    return {
      pacingState: 'RESOURCE_CONSTRAINED',
      shouldPass: false,
    };
  }

  // 3. LATE / RESOURCE-RELEASE CONTEXT
  // Final squad slot, structural market pool exhaustion, or architectural LATE_AUCTION focus
  const isLate =
    remainingSlots <= 1 ||
    (futurePoolCount > 0 && futurePoolCount <= remainingSlotsAfterCurrent) ||
    brainState?.plan?.strategicFocus === 'LATE_AUCTION';

  if (isLate) {
    return {
      pacingState: 'LATE_RELEASE',
      shouldPass: false,
      reason: 'LATE_RESOURCE_RELEASE',
      notes: `Late-stage resource release: pool exhausted or final slots remaining. Releasing capital.`,
    };
  }

  // 4. EARLY / RESOURCE-PRESERVATION CONTEXT
  // Meaningful future squad obligations with available future pool or architectural BUILD_CORE focus
  const isEarly =
    !isLate &&
    remainingSlots > 1 &&
    (brainState?.plan?.strategicFocus === 'BUILD_CORE' ||
      (auctionProgress === 0 && futurePoolCount > remainingSlots));

  if (isEarly) {
    if (!isCriticalNeed && nextRequiredBid > avgPursePerSlot) {
      return {
        pacingState: 'EARLY_PRESERVATION',
        shouldPass: true,
        reason: 'EARLY_RESOURCE_PRESERVATION',
        notes: `Early-stage resource preservation: price ${nextRequiredBid}L exceeds average slot budget ${avgPursePerSlot.toFixed(1)}L for non-critical role when ${remainingSlots} slots and ${futurePoolCount} pool candidates remain.`,
      };
    }

    return {
      pacingState: 'EARLY_PRESERVATION',
      shouldPass: false,
    };
  }

  // 5. RESOURCE-HEALTHY STATE (default)
  return {
    pacingState: 'RESOURCE_HEALTHY',
    shouldPass: false,
  };
}

// ============================================================
// STRATEGY & TACTICAL DECISION LOGIC
// ============================================================

/**
 * Evaluates the final strategic decision and tactical execution for a bot.
 */
export function evaluateTacticalDecision(ctx: TacticalInputContext): TacticalDecision {
  const { qResult, personality, strategicPolicy, roleNeed, purse, remainingSlots, teamId, lotId, currentBid, basePrice = 20 } = {
    ...ctx,
    currentBid: ctx.qResult.currentBid,
    basePrice: ctx.basePrice ?? 20
  };

  const seed = `${ctx.auctionId}_${lotId}_${teamId}_${qResult.nextRequiredBid}_${currentBid}`;
  const prng = getDeterministicPseudoRandom(seed);

  // 1. HARD LEGALITY REJECTIONS
  if (!qResult.isLegal) {
    let reason: StrategicReason = 'PRICE_EXCEEDS_TV';
    if (qResult.legalityReason === 'ERR_ALREADY_HIGHEST_BIDDER') reason = 'ALREADY_HIGHEST_BIDDER';
    else if (qResult.legalityReason === 'ERR_SQUAD_LIMIT_REACHED') reason = 'SQUAD_CAPACITY_REACHED';
    else if (qResult.legalityReason === 'ERR_OVERSEAS_LIMIT') reason = 'OVERSEAS_CAPACITY_REACHED';
    else if (qResult.legalityReason === 'ERR_INSUFFICIENT_PURSE') reason = 'PURSE_INSOLVENCY';

    return {
      action: 'PASS',
      reason,
      bidAmount: 0,
      delayMs: 0,
      tv: qResult.tv,
      nextRequiredBid: qResult.nextRequiredBid,
      isStretched: false,
      pacingState: 'RESOURCE_CONSTRAINED',
      notes: `Rejected by hard legality: ${qResult.legalityReason}`
    };
  }

  // Pre-calculate Strategic Purse Pacing state
  const pacing = evaluatePursePacing({
    purse,
    initialPurse: ctx.initialPurse,
    remainingSlots,
    maxSquadSize: ctx.maxSquadSize,
    auctionProgress: ctx.auctionProgress,
    futurePoolCount: ctx.futurePoolCount,
    nextRequiredBid: qResult.nextRequiredBid,
    roleNeed,
    strategicPolicy,
    brainState: ctx.brainState
  });

  // 2. SQUAD FEASIBILITY & FINANCIAL SOLVENCY CHECK
  const minBasePrice = 20;
  const remainingSlotsAfterBuy = Math.max(0, remainingSlots - 1);
  const minSquadReserve = remainingSlotsAfterBuy * minBasePrice;
  if (purse - qResult.nextRequiredBid < minSquadReserve) {
    return {
      action: 'PASS',
      reason: 'PURSE_INSOLVENCY',
      bidAmount: 0,
      delayMs: 0,
      tv: qResult.tv,
      nextRequiredBid: qResult.nextRequiredBid,
      isStretched: false,
      pacingState: 'RESOURCE_CONSTRAINED',
      notes: `Squad feasibility failure: placing bid ${qResult.nextRequiredBid} leaves less than ${minSquadReserve}L needed for ${remainingSlotsAfterBuy} remaining slots.`
    };
  }

  // 3. RIVAL THIRST BAIT / DROP
  // If rival aggression is extremely high and the marginal benefit of buying is small,
  // an OPPORTUNISTIC bot tactically PASSES to let opponents exhaust their purses.
  const rivalAggression = ctx.brainState?.beliefs?.rivalAggression ?? 0;
  const isHighRivalPressure = rivalAggression > 0.75;
  const isLowMarginalBenefit = qResult.qBuyAtRequiredBid < qResult.qSkip * 1.10;

  if (isHighRivalPressure && personality === 'OPPORTUNISTIC' && isLowMarginalBenefit && qResult.nextRequiredBid <= qResult.tv) {
    return {
      action: 'PASS',
      reason: 'RIVAL_BAIT_DROP',
      bidAmount: 0,
      delayMs: 0,
      tv: qResult.tv,
      nextRequiredBid: qResult.nextRequiredBid,
      isStretched: false,
      pacingState: pacing.pacingState,
      notes: 'Tactical retreat: baiting aggressive rivals when marginal value is low.'
    };
  }

  // 4. RIVAL INTIMIDATION CONCESSION (Behavior B11)
  // When facing credible, strong rival aggression, a risk-averse CONSERVATIVE bot
  // is intimidated by intense bidding pressure on marginal-benefit lots and tactically concedes.
  if (isHighRivalPressure && personality === 'CONSERVATIVE' && isLowMarginalBenefit && qResult.nextRequiredBid <= qResult.tv) {
    return {
      action: 'PASS',
      reason: 'RIVAL_INTIMIDATION',
      bidAmount: 0,
      delayMs: 0,
      tv: qResult.tv,
      nextRequiredBid: qResult.nextRequiredBid,
      isStretched: false,
      pacingState: pacing.pacingState,
      notes: 'Tactical concession: conservative bot intimidated by strong rival pressure on marginal surplus.'
    };
  }

  // 5. PRICE PRESSURE / PURSE DRAIN (Behavior B12)
  // When auction price has escalated to high premium (marketInflation >= 1.0)
  // and the next required bid exceeds average slot budget, materially draining discretionary purse
  // on a non-critical target, the bot tactically concedes rather than succumbing to price pressure.
  const marketInflation = ctx.brainState?.beliefs?.marketInflation ?? 0;
  const isHighPricePressure = marketInflation >= 1.0;
  const avgPursePerSlot = remainingSlots > 0 ? purse / remainingSlots : purse;
  const isMaterialPurseDrain = qResult.nextRequiredBid > avgPursePerSlot;
  const isPressureTolerant =
    roleNeed === 'CRITICAL' ||
    strategicPolicy?.strategicPersistence === 'MAXIMUM' ||
    (personality === 'AGGRESSIVE' && !strategicPolicy?.budgetPreservationIntent);

  if (isHighPricePressure && isMaterialPurseDrain && !isPressureTolerant && qResult.nextRequiredBid <= qResult.tv) {
    return {
      action: 'PASS',
      reason: 'PRICE_PRESSURE_PURSE_DRAIN',
      bidAmount: 0,
      delayMs: 0,
      tv: qResult.tv,
      nextRequiredBid: qResult.nextRequiredBid,
      isStretched: false,
      pacingState: pacing.pacingState,
      notes: `Tactical concession: lot price inflation (${marketInflation.toFixed(2)}) drains purse above average slot budget (${avgPursePerSlot.toFixed(1)}L) for non-critical need.`
    };
  }

  // 6. STRATEGIC PURSE PACING (Within TV)
  // Standard bidding happens when Q_buy is strictly greater than Q_skip and not at the final stopping point.
  // The final legal bid step within TV for strategic contenders is reserved for the One-Last-Bid (STRETCH) contract.
  const nextNextBid = getNextBidAmount(qResult.nextRequiredBid, basePrice);
  const isFinalBidStepWithinTv = qResult.nextRequiredBid <= qResult.tv && nextNextBid > qResult.tv;
  const isStrategicContender =
    (roleNeed === 'CRITICAL' || strategicPolicy?.strategicPersistence === 'MAXIMUM') &&
    (personality === 'AGGRESSIVE' || personality === 'STRATEGIC');
  const isComfortableBid = qResult.qBuyAtRequiredBid > qResult.qSkip && !(isFinalBidStepWithinTv && isStrategicContender);
  if (qResult.nextRequiredBid <= qResult.tv && isComfortableBid) {
    // If strategic purse-pacing dictates preservation, PASS
    if (pacing.shouldPass) {
      return {
        action: 'PASS',
        reason: pacing.reason || 'EARLY_RESOURCE_PRESERVATION',
        bidAmount: 0,
        delayMs: 0,
        tv: qResult.tv,
        nextRequiredBid: qResult.nextRequiredBid,
        isStretched: false,
        pacingState: pacing.pacingState,
        notes: pacing.notes || 'Pacing preservation'
      };
    }

    // Check tactical WAIT:
    // If timer has > 7 seconds remaining, and personality is CONSERVATIVE or BALANCED,
    // and price is still near opening base price, bot may WAIT one tick to observe opponent action.
    const remainingTimerMs = Math.max(0, ctx.remainingTimerMs);
    const canWait = remainingTimerMs > 7000;

    if (canWait && personality === 'CONSERVATIVE' && prng < 0.20 && currentBid > 0) {
      return {
        action: 'WAIT',
        reason: 'TACTICAL_WAIT_OPTIONALITY',
        bidAmount: 0,
        delayMs: 0,
        tv: qResult.tv,
        nextRequiredBid: qResult.nextRequiredBid,
        isStretched: false,
        pacingState: pacing.pacingState,
        notes: 'Patience: observing market while ample timer remains.'
      };
    }

    // Standard BID action
    const delay = computeReactionDelay(personality, roleNeed, remainingTimerMs, prng);
    return {
      action: 'BID',
      reason: 'TV_FAVORABLE',
      bidAmount: qResult.nextRequiredBid,
      delayMs: delay,
      tv: qResult.tv,
      nextRequiredBid: qResult.nextRequiredBid,
      isStretched: false,
      pacingState: pacing.pacingState,
      notes: `Bid within TV (${qResult.nextRequiredBid} <= ${qResult.tv}). Pacing: ${pacing.pacingState}.`
    };
  }

  // 5. PRICE EXCEEDS BASELINE TV: EVALUATE BOUNDED STRETCH VS PASS
  // STRETCH CONTRACT:
  // A. Can only stretch if roleNeed is CRITICAL or strategicPolicy is MAXIMUM persistence.
  // B. Next required bid must be at most 1 discrete legal increment step above TV:
  //    nextRequiredBid <= getNextBidAmount(qResult.tv, basePrice)
  // C. Strategic squad solvency preserved: (purse - nextRequiredBid) >= minSquadReserve
  // D. Allowed only for AGGRESSIVE or STRATEGIC personalities (CONSERVATIVE never stretches).
  // E. Forbidden if bot plan focus is PRESERVE_PURSE or in preservation/constrained states.
  // F. Urgency from brain state/memory modulates willingness to stretch.
  // G. Repeat-prevention: A bot can only execute One-Last-Bid ONCE per lot.
  const priorBidObs = ctx.brainState?.memory?.observedBids?.[lotId];
  const hasAlreadyPlacedFinalBid = priorBidObs?.isFinalBid === true;

  const focus = ctx.brainState?.plan?.strategicFocus;
  const isEligibleToStretch =
    !hasAlreadyPlacedFinalBid &&
    focus !== 'PROTECT_PURSE' &&
    pacing.pacingState !== 'EARLY_PRESERVATION' &&
    pacing.pacingState !== 'RESOURCE_CONSTRAINED' &&
    (roleNeed === 'CRITICAL' || strategicPolicy?.strategicPersistence === 'MAXIMUM') &&
    (personality === 'AGGRESSIVE' || personality === 'STRATEGIC') &&
    remainingSlots > 0;

  const isPurseSafeForStretch = (purse - qResult.nextRequiredBid) >= minSquadReserve;

  // Stretched bid must NEVER exceed TV. FINAL BID <= TV always.
  const isWithinStretchBounds = qResult.tv > 0 && qResult.nextRequiredBid <= qResult.tv;

  // Base stretch chance is tied to urgency
  const memoryUrgency = ctx.brainState?.plan?.urgency ?? 0.3;
  const shouldStretch = memoryUrgency > 0.5 || prng < memoryUrgency;

  if (isEligibleToStretch && isPurseSafeForStretch && isWithinStretchBounds && shouldStretch) {
    const remainingTimerMs = Math.max(0, ctx.remainingTimerMs);
    // Stretch bids have deliberation tied directly to urgency
    const stretchDelay = Math.min(
      Math.max(1500, Math.floor(3000 * (1 - memoryUrgency))),
      Math.max(500, remainingTimerMs - 400)
    );

    return {
      action: 'STRETCH',
      reason: 'CRITICAL_GAP_STRETCH',
      bidAmount: qResult.nextRequiredBid,
      delayMs: stretchDelay,
      tv: qResult.tv,
      nextRequiredBid: qResult.nextRequiredBid,
      isStretched: true,
      pacingState: pacing.pacingState,
      notes: `Bounded STRETCH on critical role gap (pushing to absolute TV limit: ${qResult.nextRequiredBid} <= ${qResult.tv}).`
    };
  }

  // 6. DEFAULT: PASS / DROP
  return {
    action: 'PASS',
    reason: qResult.tv > 0 ? 'PRICE_EXCEEDS_TV' : 'Q_INFERIOR',
    bidAmount: 0,
    delayMs: 0,
    tv: qResult.tv,
    nextRequiredBid: qResult.nextRequiredBid,
    isStretched: false,
    pacingState: pacing.pacingState,
    notes: `Price ${qResult.nextRequiredBid} exceeds TV ${qResult.tv}. Passing.`
  };
}

// ============================================================
// DYNAMIC HUMAN REACTION DELAY
// ============================================================

/**
 * Computes realistic human reaction delays bounded by timer expiration and personality.
 */
export function computeReactionDelay(
  personality: BotPersonality,
  roleNeed: string,
  remainingTimerMs: number,
  prng: number,
  urgency: number = 0
): number {
  let minDelay = 1000;
  let maxDelay = 2500;

  switch (personality) {
    case 'AGGRESSIVE':
      minDelay = 600;
      maxDelay = 1400;
      break;
    case 'CONSERVATIVE':
      minDelay = 1600;
      maxDelay = 3200;
      break;
    case 'OPPORTUNISTIC':
      minDelay = 900;
      maxDelay = 2200;
      break;
    case 'STRATEGIC':
      minDelay = 1100;
      maxDelay = 2600;
      break;
    default:
      minDelay = 1000;
      maxDelay = 2400;
  }

  // Snap reaction for critical gaps or elevated memory urgency
  if (roleNeed === 'CRITICAL' || urgency > 0.60) {
    minDelay = Math.floor(minDelay * 0.65);
    maxDelay = Math.floor(maxDelay * 0.75);
  }

  // Clamp to timer expiration so bot does not time out before bidding
  if (remainingTimerMs > 0 && remainingTimerMs < maxDelay + 400) {
    maxDelay = Math.max(minDelay, remainingTimerMs - 400);
  }

  const delay = Math.floor(prng * (maxDelay - minDelay + 1)) + minDelay;
  return Math.max(minDelay, Math.min(delay, maxDelay));
}
