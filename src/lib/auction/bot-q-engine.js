"use strict";
// src/lib/auction/bot-q-engine.ts
//
// Authoritative Foundation Q & True Value (TV) Engine
//
// MATHEMATICAL CONTRACT (Locked Foundation):
// 1. Q() is the authoritative exact roster optimization mechanism.
// 2. Q_buy(B) is strictly monotonic non-increasing over legal bid ladder values.
// 3. TV is the maximum discrete legal bid B on the authoritative ladder satisfying:
//      Q_buy(B) >= Q_skip
// 4. Decision Rule:
//      Q_buy(B_req) > Q_skip  => BID
//      Q_buy(B_req) <= Q_skip => PASS / DROP (or bounded STRETCH)
// 5. Zero arbitrary rating-to-money continuous power curves.
// 6. Zero independent opportunity-cost multipliers (inherently captured in Q_skip).
// 7. Hard legality constraints (purse, squad slots, overseas) are strictly enforced.
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
exports.CAPITAL_UTILITY_RATE = void 0;
exports.generateDiscreteBidLadder = generateDiscreteBidLadder;
exports.getRoleTargetBounds = getRoleTargetBounds;
exports.computeMarginalUtility = computeMarginalUtility;
exports.evaluateQAndTV = evaluateQAndTV;
var bot_candidate_ordering_1 = require("./bot-candidate-ordering");
var server_bot_engine_1 = require("./server-bot-engine");
// ============================================================
// BID LADDER GENERATION
// ============================================================
/**
 * Generates the discrete legal bid ladder starting from startingBid up to maxPurse.
 * Uses the exact authoritative Mega Auction bid increment tiers.
 */
function generateDiscreteBidLadder(currentBid, basePrice, maxPurse) {
    var ladder = [];
    var runner = (0, server_bot_engine_1.getNextBidAmount)(currentBid, basePrice);
    while (runner <= maxPurse) {
        ladder.push(runner);
        var next = (0, server_bot_engine_1.getNextBidAmount)(runner, basePrice);
        if (next <= runner)
            break; // Safety against infinite loop
        runner = next;
    }
    return ladder;
}
// ============================================================
// MARGINAL ROSTER UTILITY FUNCTION (U_roster)
// ============================================================
/**
 * Target composition by role for an IPL squad of 25 players (scaled linearly for other sizes).
 */
function getRoleTargetBounds(maxSquadSize) {
    if (maxSquadSize === void 0) { maxSquadSize = 25; }
    var scale = Math.max(0.5, maxSquadSize / 25);
    return {
        WICKET_KEEPER: { min: Math.max(1, Math.round(2 * scale)), ideal: Math.max(2, Math.round(3 * scale)) },
        BATSMAN: { min: Math.max(2, Math.round(5 * scale)), ideal: Math.max(3, Math.round(7 * scale)) },
        ALL_ROUNDER: { min: Math.max(2, Math.round(3 * scale)), ideal: Math.max(3, Math.round(5 * scale)) },
        BOWLER: { min: Math.max(2, Math.round(6 * scale)), ideal: Math.max(3, Math.round(8 * scale)) },
    };
}
/**
 * Calculates the marginal utility of adding a candidate to the current roster state.
 *
 * U(candidate | state) = PlayerQuality * RoleNeedWeight
 * - If role count is 0 and min >= 1: Critical urgency (weight 1.50)
 * - If role count < min: High urgency (weight 1.25)
 * - If role count <= ideal: Normal utility (weight 1.00)
 * - If role count > ideal: Diminishing returns (weight 0.40)
 * - If squad is full: 0
 */
function computeMarginalUtility(candidateRole, candidateRating, roleCounts, remainingSlots, maxSquadSize) {
    if (maxSquadSize === void 0) { maxSquadSize = 25; }
    if (remainingSlots <= 0)
        return 0;
    var currentCount = roleCounts[candidateRole] || 0;
    var targets = getRoleTargetBounds(maxSquadSize);
    var target = targets[candidateRole] || { min: 2, ideal: 5 };
    var roleWeight = 1.0;
    if (currentCount === 0 && target.min >= 1) {
        roleWeight = candidateRole === 'WICKET_KEEPER' ? 1.55 : 1.40;
    }
    else if (currentCount < target.min) {
        roleWeight = 1.20;
    }
    else if (currentCount <= target.ideal) {
        roleWeight = 1.00;
    }
    else {
        // Redundant or excess depth
        roleWeight = Math.max(0.1, 0.40 - ((currentCount - target.ideal) * 0.15));
    }
    // Base utility normalized around quality range (74 - 98)
    var baseUtility = Math.max(10, candidateRating - 60);
    return baseUtility * roleWeight;
}
// ============================================================
// CORE Q RECURRENCE & TRUE VALUE EVALUATION
// ============================================================
/**
 * Recursive dynamic programming formulation for forward auction expectation Q.
 *
 * Evaluates the deterministic top future candidates to determine Q_skip
 * and Q_buy(B) over the legal bid ladder.
 */
function evaluateQAndTV(currentCandidate, futureCandidates, teamState, currentBid, isHighestBidder, bounds, isPreSorted) {
    if (bounds === void 0) { bounds = { maxSquadSize: 25, maxOverseas: 8 }; }
    if (isPreSorted === void 0) { isPreSorted = false; }
    var basePrice = currentCandidate.base_price || 20;
    var nextRequiredBid = (0, server_bot_engine_1.getNextBidAmount)(currentBid, basePrice);
    var remainingSlots = Math.max(0, bounds.maxSquadSize - teamState.playersBought);
    var remainingOS = Math.max(0, bounds.maxOverseas - teamState.overseasCount);
    // 1. HARD LEGALITY CHECKS
    if (isHighestBidder) {
        return {
            currentBid: currentBid,
            nextRequiredBid: nextRequiredBid,
            tv: 0,
            qSkip: 0,
            qBuyAtRequiredBid: 0,
            decision: 'PASS',
            isLegal: false,
            legalityReason: 'ERR_ALREADY_HIGHEST_BIDDER',
            ladderEvaluated: []
        };
    }
    if (remainingSlots <= 0) {
        return {
            currentBid: currentBid,
            nextRequiredBid: nextRequiredBid,
            tv: 0,
            qSkip: 0,
            qBuyAtRequiredBid: 0,
            decision: 'PASS',
            isLegal: false,
            legalityReason: 'ERR_SQUAD_LIMIT_REACHED',
            ladderEvaluated: []
        };
    }
    if (currentCandidate.is_overseas && remainingOS <= 0) {
        return {
            currentBid: currentBid,
            nextRequiredBid: nextRequiredBid,
            tv: 0,
            qSkip: 0,
            qBuyAtRequiredBid: 0,
            decision: 'PASS',
            isLegal: false,
            legalityReason: 'ERR_OVERSEAS_LIMIT',
            ladderEvaluated: []
        };
    }
    var remainingSlotsAfterBuy = Math.max(0, remainingSlots - 1);
    var minRequiredReserve = remainingSlotsAfterBuy * 20;
    var maxSolventPurse = teamState.purse - minRequiredReserve;
    // Hard engine legality check: does the team have enough purse for next required bid?
    if (teamState.purse < nextRequiredBid) {
        return {
            currentBid: currentBid,
            nextRequiredBid: nextRequiredBid,
            tv: 0,
            qSkip: 0,
            qBuyAtRequiredBid: 0,
            decision: 'PASS',
            isLegal: false,
            legalityReason: 'ERR_INSUFFICIENT_PURSE',
            ladderEvaluated: []
        };
    }
    // Strategic reserve defense: preserve 20L per remaining unfilled squad slot
    if (maxSolventPurse < nextRequiredBid) {
        return {
            currentBid: currentBid,
            nextRequiredBid: nextRequiredBid,
            tv: 0,
            qSkip: 0,
            qBuyAtRequiredBid: 0,
            decision: 'PASS',
            isLegal: true, // Legally valid in auction engine, strategically declined by bot
            legalityReason: 'STRATEGIC_PURSE_INSOLVENCY',
            ladderEvaluated: []
        };
    }
    // 2. SORT FUTURE CANDIDATES DETERMINISTICALLY (Reuses pre-sorted pool if available)
    var sortedPool = isPreSorted ? futureCandidates : (0, bot_candidate_ordering_1.sortCandidatesDeterministic)(futureCandidates);
    // Filter for top relevant candidates to bound DP state space (O(K) where K <= 8)
    var poolSubset = selectTopRelevantCandidates(sortedPool, remainingSlots);
    var memo = new Map();
    // 3. COMPUTE Q_SKIP (Utility of skipping current player and continuing optimally)
    var qSkip = computeForwardQ(0, poolSubset, teamState.purse, remainingSlots, remainingOS, __assign({}, teamState.roleCounts), bounds.maxSquadSize, memo);
    // 4. DISCRETE BID LADDER SEARCH FOR TV
    // Ladder contains all valid bids from basePrice up to max solvent purse to find absolute TV
    var fullLadder = generateDiscreteBidLadder(0, basePrice, maxSolventPurse);
    var candidateRating = currentCandidate.rating != null
        ? currentCandidate.rating
        : (0, bot_candidate_ordering_1.estimateCategoryRating)(currentCandidate.category);
    var immediateUtility = computeMarginalUtility(currentCandidate.role, candidateRating, teamState.roleCounts, remainingSlots, bounds.maxSquadSize);
    var tv = 0;
    var qBuyAtRequired = 0;
    var ladderEvaluated = [];
    for (var idx = 0; idx < fullLadder.length; idx++) {
        var bid = fullLadder[idx];
        ladderEvaluated.push(bid);
        // Q_buy(B) = MarginalUtility(Current) + Q_forward(Purse - B, Slots - 1)
        var newRoleCounts = __assign({}, teamState.roleCounts);
        newRoleCounts[currentCandidate.role] = (newRoleCounts[currentCandidate.role] || 0) + 1;
        var newOS = currentCandidate.is_overseas ? remainingOS - 1 : remainingOS;
        var futureValAfterBuy = computeForwardQ(0, poolSubset, teamState.purse - bid, remainingSlots - 1, newOS, newRoleCounts, bounds.maxSquadSize, memo);
        var qBuy = immediateUtility + futureValAfterBuy;
        if (bid === nextRequiredBid) {
            qBuyAtRequired = qBuy;
        }
        else if (idx === 0 && bid > nextRequiredBid) {
            // Should not happen since we start from 0, but just in case
            qBuyAtRequired = qBuy;
        }
        // Monotonic stopping rule:
        // As bid increases, remaining purse decreases, so futureValAfterBuy strictly decreases.
        // As soon as Q_buy(B) < Q_skip, stop.
        if (qBuy >= qSkip) {
            tv = bid;
        }
        else {
            // Monotonic early stop
            break;
        }
    }
    // 5. CANONICAL DECISION
    // Q_buy(nextRequiredBid) > Q_skip => BID
    // Q_buy(nextRequiredBid) <= Q_skip => PASS/DROP
    var decision = (nextRequiredBid <= tv && qBuyAtRequired > qSkip) ? 'BID' : 'PASS';
    return {
        currentBid: currentBid,
        nextRequiredBid: nextRequiredBid,
        tv: tv,
        qSkip: qSkip,
        qBuyAtRequiredBid: qBuyAtRequired,
        decision: decision,
        isLegal: true,
        ladderEvaluated: ladderEvaluated
    };
}
// ============================================================
// HELPER FORWARD Q FOR DP EVALUATION
// ============================================================
/**
 * Marginal utility of unspent purse capital (exchange rate: 0.025 util per Lakh = 1 util per 40 Lakhs).
 * Governs the terminal value of retained liquidity when future pools are exhausted.
 */
exports.CAPITAL_UTILITY_RATE = 0.025;
/**
 * Computes forward expected utility Q over the top future candidates.
 * Memoized per step with bounded pool using zero-allocation numeric keys.
 */
function computeForwardQ(index, pool, purse, slotsRemaining, osRemaining, roleCounts, maxSquadSize, memo) {
    if (purse <= 0) {
        return 0;
    }
    if (slotsRemaining <= 0 || index >= pool.length) {
        // Residual utility of unspent purse capital
        return purse * exports.CAPITAL_UTILITY_RATE;
    }
    // Fast numeric key (using exact purse since it can be large, string key is safer)
    // We need to include role counts for the subset of roles that matter, but since max depth is small,
    // we can just use a string key.
    var memoKey = memo
        ? "".concat(index, "-").concat(purse, "-").concat(slotsRemaining, "-").concat(osRemaining, "-").concat(roleCounts['BATSMAN'] || 0, "-").concat(roleCounts['BOWLER'] || 0, "-").concat(roleCounts['ALL_ROUNDER'] || 0, "-").concat(roleCounts['WICKET_KEEPER'] || 0)
        : null;
    if (memo && memoKey !== null) {
        var cached = memo.get(memoKey); // Using map with string keys now
        if (cached !== undefined)
            return cached;
    }
    var candidate = pool[index];
    var expectedPrice = candidate.base_price || 20;
    // Path 1: SKIP candidate
    var valSkip = computeForwardQ(index + 1, pool, purse, slotsRemaining, osRemaining, roleCounts, maxSquadSize, memo);
    // Path 2: BUY candidate (if legal)
    var isOS = candidate.is_overseas || false;
    if (purse >= expectedPrice && (!isOS || osRemaining > 0)) {
        var rating = candidate.rating != null ? candidate.rating : (0, bot_candidate_ordering_1.estimateCategoryRating)(candidate.category);
        var marginalU = computeMarginalUtility(candidate.role, rating, roleCounts, slotsRemaining, maxSquadSize);
        var nextRoleCounts = __assign({}, roleCounts);
        nextRoleCounts[candidate.role] = (nextRoleCounts[candidate.role] || 0) + 1;
        var valBuy = marginalU + computeForwardQ(index + 1, pool, purse - expectedPrice, slotsRemaining - 1, isOS ? osRemaining - 1 : osRemaining, nextRoleCounts, maxSquadSize, memo);
        var result = Math.max(valSkip, valBuy);
        if (memo && memoKey !== null)
            memo.set(memoKey, result);
        return result;
    }
    if (memo && memoKey !== null)
        memo.set(memoKey, valSkip);
    return valSkip;
}
/**
 * Selects the top relevant candidates from the deterministically sorted pool.
 * Takes the top candidates across each needed role up to bounded limit (top 2 per role, <= 8 total).
 */
function selectTopRelevantCandidates(sortedPool, slotsRemaining) {
    var selected = [];
    var perRoleCount = {};
    var maxPerRole = 2;
    for (var _i = 0, sortedPool_1 = sortedPool; _i < sortedPool_1.length; _i++) {
        var c = sortedPool_1[_i];
        var count = perRoleCount[c.role] || 0;
        if (count < maxPerRole) {
            selected.push(c);
            perRoleCount[c.role] = count + 1;
        }
        if (selected.length >= 8)
            break;
    }
    return selected;
}
