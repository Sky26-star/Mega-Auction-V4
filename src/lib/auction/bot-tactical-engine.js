"use strict";
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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeterministicPseudoRandom = getDeterministicPseudoRandom;
exports.evaluatePursePacing = evaluatePursePacing;
exports.evaluateTacticalDecision = evaluateTacticalDecision;
exports.computeReactionDelay = computeReactionDelay;
var server_bot_engine_1 = require("./server-bot-engine");
// ============================================================
// DETERMINISTIC SEEDED PSEUDO-RANDOM GENERATOR
// ============================================================
/**
 * Deterministic pseudo-random number in [0, 1) derived from state string hash.
 * Guaranteed 100% reproducible for the same auction/bot/bid state.
 */
function getDeterministicPseudoRandom(seedStr) {
    var hash = 0;
    for (var i = 0; i < seedStr.length; i++) {
        hash = (hash << 5) - hash + seedStr.charCodeAt(i);
        hash |= 0;
    }
    // Mulberry32-inspired PRNG step
    var t = hash + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
function evaluatePursePacing(params) {
    var _a, _b, _c;
    var purse = params.purse, remainingSlots = params.remainingSlots, _d = params.auctionProgress, auctionProgress = _d === void 0 ? 0 : _d, _e = params.futurePoolCount, futurePoolCount = _e === void 0 ? 0 : _e, nextRequiredBid = params.nextRequiredBid, roleNeed = params.roleNeed, strategicPolicy = params.strategicPolicy, brainState = params.brainState;
    var minBasePrice = 20; // Official IPL base price floor in Lakhs
    var remainingSlotsAfterCurrent = Math.max(0, remainingSlots - 1);
    var minSquadReserve = remainingSlotsAfterCurrent * minBasePrice;
    var discretionaryPurse = Math.max(0, purse - minSquadReserve);
    var avgPursePerSlot = remainingSlots > 0 ? purse / remainingSlots : purse;
    var isCriticalNeed = roleNeed === 'CRITICAL' ||
        (strategicPolicy === null || strategicPolicy === void 0 ? void 0 : strategicPolicy.pursuitStance) === 'CRITICAL_PURSUIT' ||
        (strategicPolicy === null || strategicPolicy === void 0 ? void 0 : strategicPolicy.consequenceAwareness) === 'HIGH';
    // 1. HARD FINANCIAL FEASIBILITY: Can bot fill remaining slots at base price?
    if (purse - nextRequiredBid < minSquadReserve) {
        return {
            pacingState: 'RESOURCE_CONSTRAINED',
            shouldPass: true,
            reason: 'PURSE_INSOLVENCY',
            notes: "Squad feasibility failure: placing bid ".concat(nextRequiredBid, " leaves less than ").concat(minSquadReserve, "L needed for ").concat(remainingSlotsAfterCurrent, " remaining slots."),
        };
    }
    // 2. RESOURCE-CONSTRAINED STATE
    // Discretionary purse is depleted relative to mandatory squad reserve, or brain plan is PROTECT_PURSE
    var isBudgetConstrained = discretionaryPurse <= minSquadReserve ||
        ((_a = brainState === null || brainState === void 0 ? void 0 : brainState.plan) === null || _a === void 0 ? void 0 : _a.strategicFocus) === 'PROTECT_PURSE';
    if (isBudgetConstrained) {
        if (!isCriticalNeed && nextRequiredBid > avgPursePerSlot) {
            return {
                pacingState: 'RESOURCE_CONSTRAINED',
                shouldPass: true,
                reason: 'RESOURCE_CONSTRAINED_RESERVATION',
                notes: "Resource-constrained preservation: discretionary purse is tight (".concat(discretionaryPurse, "L); declining non-critical bid ").concat(nextRequiredBid, "L above average slot budget (").concat(avgPursePerSlot.toFixed(1), "L)."),
            };
        }
        return {
            pacingState: 'RESOURCE_CONSTRAINED',
            shouldPass: false,
        };
    }
    // 3. LATE / RESOURCE-RELEASE CONTEXT
    // Final squad slot, structural market pool exhaustion, or architectural LATE_AUCTION focus
    var isLate = remainingSlots <= 1 ||
        (futurePoolCount > 0 && futurePoolCount <= remainingSlotsAfterCurrent) ||
        ((_b = brainState === null || brainState === void 0 ? void 0 : brainState.plan) === null || _b === void 0 ? void 0 : _b.strategicFocus) === 'LATE_AUCTION';
    if (isLate) {
        return {
            pacingState: 'LATE_RELEASE',
            shouldPass: false,
            reason: 'LATE_RESOURCE_RELEASE',
            notes: "Late-stage resource release: pool exhausted or final slots remaining. Releasing capital.",
        };
    }
    // 4. EARLY / RESOURCE-PRESERVATION CONTEXT
    // Meaningful future squad obligations with available future pool or architectural BUILD_CORE focus
    var isEarly = !isLate &&
        remainingSlots > 1 &&
        (((_c = brainState === null || brainState === void 0 ? void 0 : brainState.plan) === null || _c === void 0 ? void 0 : _c.strategicFocus) === 'BUILD_CORE' ||
            (auctionProgress === 0 && futurePoolCount > remainingSlots));
    if (isEarly) {
        if (!isCriticalNeed && nextRequiredBid > avgPursePerSlot) {
            return {
                pacingState: 'EARLY_PRESERVATION',
                shouldPass: true,
                reason: 'EARLY_RESOURCE_PRESERVATION',
                notes: "Early-stage resource preservation: price ".concat(nextRequiredBid, "L exceeds average slot budget ").concat(avgPursePerSlot.toFixed(1), "L for non-critical role when ").concat(remainingSlots, " slots and ").concat(futurePoolCount, " pool candidates remain."),
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
function evaluateTacticalDecision(ctx) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    var _r = __assign(__assign({}, ctx), { currentBid: ctx.qResult.currentBid, basePrice: (_a = ctx.basePrice) !== null && _a !== void 0 ? _a : 20 }), qResult = _r.qResult, personality = _r.personality, strategicPolicy = _r.strategicPolicy, roleNeed = _r.roleNeed, purse = _r.purse, remainingSlots = _r.remainingSlots, teamId = _r.teamId, lotId = _r.lotId, currentBid = _r.currentBid, _s = _r.basePrice, basePrice = _s === void 0 ? 20 : _s;
    var seed = "".concat(ctx.auctionId, "_").concat(lotId, "_").concat(teamId, "_").concat(qResult.nextRequiredBid, "_").concat(currentBid);
    var prng = getDeterministicPseudoRandom(seed);
    // 1. HARD LEGALITY REJECTIONS
    if (!qResult.isLegal) {
        var reason = 'PRICE_EXCEEDS_TV';
        if (qResult.legalityReason === 'ERR_ALREADY_HIGHEST_BIDDER')
            reason = 'ALREADY_HIGHEST_BIDDER';
        else if (qResult.legalityReason === 'ERR_SQUAD_LIMIT_REACHED')
            reason = 'SQUAD_CAPACITY_REACHED';
        else if (qResult.legalityReason === 'ERR_OVERSEAS_LIMIT')
            reason = 'OVERSEAS_CAPACITY_REACHED';
        else if (qResult.legalityReason === 'ERR_INSUFFICIENT_PURSE')
            reason = 'PURSE_INSOLVENCY';
        return {
            action: 'PASS',
            reason: reason,
            bidAmount: 0,
            delayMs: 0,
            tv: qResult.tv,
            nextRequiredBid: qResult.nextRequiredBid,
            isStretched: false,
            pacingState: 'RESOURCE_CONSTRAINED',
            notes: "Rejected by hard legality: ".concat(qResult.legalityReason)
        };
    }
    // Pre-calculate Strategic Purse Pacing state
    var pacing = evaluatePursePacing({
        purse: purse,
        initialPurse: ctx.initialPurse,
        remainingSlots: remainingSlots,
        maxSquadSize: ctx.maxSquadSize,
        auctionProgress: ctx.auctionProgress,
        futurePoolCount: ctx.futurePoolCount,
        nextRequiredBid: qResult.nextRequiredBid,
        roleNeed: roleNeed,
        strategicPolicy: strategicPolicy,
        brainState: ctx.brainState
    });
    // 2. SQUAD FEASIBILITY & FINANCIAL SOLVENCY CHECK
    var minBasePrice = 20;
    var remainingSlotsAfterBuy = Math.max(0, remainingSlots - 1);
    var minSquadReserve = remainingSlotsAfterBuy * minBasePrice;
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
            notes: "Squad feasibility failure: placing bid ".concat(qResult.nextRequiredBid, " leaves less than ").concat(minSquadReserve, "L needed for ").concat(remainingSlotsAfterBuy, " remaining slots.")
        };
    }
    // 3. RIVAL THIRST BAIT / DROP
    // If rival aggression is extremely high and the marginal benefit of buying is small,
    // an OPPORTUNISTIC bot tactically PASSES to let opponents exhaust their purses.
    var rivalAggression = (_d = (_c = (_b = ctx.brainState) === null || _b === void 0 ? void 0 : _b.beliefs) === null || _c === void 0 ? void 0 : _c.rivalAggression) !== null && _d !== void 0 ? _d : 0;
    var isHighRivalPressure = rivalAggression > 0.75;
    var isLowMarginalBenefit = qResult.qBuyAtRequiredBid < qResult.qSkip * 1.10;
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
    var marketInflation = (_g = (_f = (_e = ctx.brainState) === null || _e === void 0 ? void 0 : _e.beliefs) === null || _f === void 0 ? void 0 : _f.marketInflation) !== null && _g !== void 0 ? _g : 0;
    var isHighPricePressure = marketInflation >= 1.0;
    var avgPursePerSlot = remainingSlots > 0 ? purse / remainingSlots : purse;
    var isMaterialPurseDrain = qResult.nextRequiredBid > avgPursePerSlot;
    var isPressureTolerant = roleNeed === 'CRITICAL' ||
        (strategicPolicy === null || strategicPolicy === void 0 ? void 0 : strategicPolicy.strategicPersistence) === 'MAXIMUM' ||
        (personality === 'AGGRESSIVE' && !(strategicPolicy === null || strategicPolicy === void 0 ? void 0 : strategicPolicy.budgetPreservationIntent));
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
            notes: "Tactical concession: lot price inflation (".concat(marketInflation.toFixed(2), ") drains purse above average slot budget (").concat(avgPursePerSlot.toFixed(1), "L) for non-critical need.")
        };
    }
    // 6. STRATEGIC PURSE PACING (Within TV)
    // Standard bidding happens when Q_buy is strictly greater than Q_skip and not at the final stopping point.
    // The final legal bid step within TV for strategic contenders is reserved for the One-Last-Bid (STRETCH) contract.
    var nextNextBid = (0, server_bot_engine_1.getNextBidAmount)(qResult.nextRequiredBid, basePrice);
    var isFinalBidStepWithinTv = qResult.nextRequiredBid <= qResult.tv && nextNextBid > qResult.tv;
    var isStrategicContender = (roleNeed === 'CRITICAL' || (strategicPolicy === null || strategicPolicy === void 0 ? void 0 : strategicPolicy.strategicPersistence) === 'MAXIMUM') &&
        (personality === 'AGGRESSIVE' || personality === 'STRATEGIC');
    var isComfortableBid = qResult.qBuyAtRequiredBid > qResult.qSkip && !(isFinalBidStepWithinTv && isStrategicContender);
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
        var remainingTimerMs = Math.max(0, ctx.remainingTimerMs);
        var canWait = remainingTimerMs > 7000;
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
        var delay = computeReactionDelay(personality, roleNeed, remainingTimerMs, prng);
        return {
            action: 'BID',
            reason: 'TV_FAVORABLE',
            bidAmount: qResult.nextRequiredBid,
            delayMs: delay,
            tv: qResult.tv,
            nextRequiredBid: qResult.nextRequiredBid,
            isStretched: false,
            pacingState: pacing.pacingState,
            notes: "Bid within TV (".concat(qResult.nextRequiredBid, " <= ").concat(qResult.tv, "). Pacing: ").concat(pacing.pacingState, ".")
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
    var priorBidObs = (_k = (_j = (_h = ctx.brainState) === null || _h === void 0 ? void 0 : _h.memory) === null || _j === void 0 ? void 0 : _j.observedBids) === null || _k === void 0 ? void 0 : _k[lotId];
    var hasAlreadyPlacedFinalBid = (priorBidObs === null || priorBidObs === void 0 ? void 0 : priorBidObs.isFinalBid) === true;
    var focus = (_m = (_l = ctx.brainState) === null || _l === void 0 ? void 0 : _l.plan) === null || _m === void 0 ? void 0 : _m.strategicFocus;
    var isEligibleToStretch = !hasAlreadyPlacedFinalBid &&
        focus !== 'PROTECT_PURSE' &&
        pacing.pacingState !== 'EARLY_PRESERVATION' &&
        pacing.pacingState !== 'RESOURCE_CONSTRAINED' &&
        (roleNeed === 'CRITICAL' || (strategicPolicy === null || strategicPolicy === void 0 ? void 0 : strategicPolicy.strategicPersistence) === 'MAXIMUM') &&
        (personality === 'AGGRESSIVE' || personality === 'STRATEGIC') &&
        remainingSlots > 0;
    var isPurseSafeForStretch = (purse - qResult.nextRequiredBid) >= minSquadReserve;
    // Stretched bid must NEVER exceed TV. FINAL BID <= TV always.
    var isWithinStretchBounds = qResult.tv > 0 && qResult.nextRequiredBid <= qResult.tv;
    // Base stretch chance is tied to urgency
    var memoryUrgency = (_q = (_p = (_o = ctx.brainState) === null || _o === void 0 ? void 0 : _o.plan) === null || _p === void 0 ? void 0 : _p.urgency) !== null && _q !== void 0 ? _q : 0.3;
    var shouldStretch = memoryUrgency > 0.5 || prng < memoryUrgency;
    if (isEligibleToStretch && isPurseSafeForStretch && isWithinStretchBounds && shouldStretch) {
        var remainingTimerMs = Math.max(0, ctx.remainingTimerMs);
        // Stretch bids have deliberation tied directly to urgency
        var stretchDelay = Math.min(Math.max(1500, Math.floor(3000 * (1 - memoryUrgency))), Math.max(500, remainingTimerMs - 400));
        return {
            action: 'STRETCH',
            reason: 'CRITICAL_GAP_STRETCH',
            bidAmount: qResult.nextRequiredBid,
            delayMs: stretchDelay,
            tv: qResult.tv,
            nextRequiredBid: qResult.nextRequiredBid,
            isStretched: true,
            pacingState: pacing.pacingState,
            notes: "Bounded STRETCH on critical role gap (pushing to absolute TV limit: ".concat(qResult.nextRequiredBid, " <= ").concat(qResult.tv, ").")
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
        notes: "Price ".concat(qResult.nextRequiredBid, " exceeds TV ").concat(qResult.tv, ". Passing.")
    };
}
// ============================================================
// DYNAMIC HUMAN REACTION DELAY
// ============================================================
/**
 * Computes realistic human reaction delays bounded by timer expiration and personality.
 */
function computeReactionDelay(personality, roleNeed, remainingTimerMs, prng, urgency) {
    if (urgency === void 0) { urgency = 0; }
    var minDelay = 1000;
    var maxDelay = 2500;
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
    var delay = Math.floor(prng * (maxDelay - minDelay + 1)) + minDelay;
    return Math.max(minDelay, Math.min(delay, maxDelay));
}
