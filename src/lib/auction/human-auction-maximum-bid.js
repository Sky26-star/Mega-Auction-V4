"use strict";
// src/lib/auction/human-auction-maximum-bid.ts
//
// PHASE 5 — MAXIMUM BID ENGINE (HARDENED)
//
// PURPOSE:
//   Determines the maximum rational amount a team can spend on a candidate player.
//   Evaluates intrinsic Team Value (from Phase 4) against authoritative financial
//   and solvency constraints (from Phase 2).
//
// CORE PRINCIPLE:
//   Phase 5 answers exactly one question:
//   "Given this player's Team Value and the team's current financial/future constraints,
//   what is the highest rational amount this team can spend?"
//
//   TEAM VALUE is the strategic ceiling.
//   PURSE, FUTURE BUDGET, and SOLVENCY are financial ceilings.
//   The final rational ceiling is the minimum of the applicable raw ceilings.
//
// HARD RULES:
//   - Phase 4 Team Value is authoritative and MUST NOT be recalculated or modified by stage.
//   - Phase 2 `minimumRequiredFutureSpend` is authoritative for solvency.
//   - `futureBudget` is a PROTECTED future reserve, NOT an available budget to spend.
//   - Binding constraints are evaluated on RAW rational ceilings prior to legal bid normalization.
//   - Tied constraints are handled with deterministic precedence:
//     FUTURE_BUDGET -> SOLVENCY -> PURSE -> TEAM_VALUE.
//   - Current bid and next required bid NEVER inflate or change the calculated maximum bid ceiling.
//   - DOES NOT make BID/STRETCH/PASS decisions (Phase 7 boundary).
//   - DOES NOT evaluate opponent behavior (Phase 6 boundary).
//   - DOES NOT use random numbers or subjective behaviour.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLegalBidCeiling = normalizeLegalBidCeiling;
exports.evaluateMaximumBid = evaluateMaximumBid;
/**
 * Normalizes a raw rational ceiling to the highest legal bid not exceeding that ceiling.
 * Temporary V1 approximation: rounds down to nearest 10L increment.
 */
function normalizeLegalBidCeiling(rawCeiling) {
    return Math.max(0, Math.floor(rawCeiling / 10) * 10);
}
function evaluateMaximumBid(ctx) {
    var _a, _b, _c;
    var reasons = [];
    var teamValue = ctx.teamValue.teamValue;
    var currentPurse = ctx.purse.currentPurse;
    var minimumRequiredFutureSpend = Math.max(0, (_a = ctx.purse.minimumRequiredFutureSpend) !== null && _a !== void 0 ? _a : 0);
    var protectedFutureBudget = Math.max(0, (_b = ctx.futureBudget) !== null && _b !== void 0 ? _b : 0);
    // 1. RAW FINANCIAL CEILINGS
    // Team Value: The strategic valuation from Phase 4
    var teamValueCeiling = teamValue;
    // Purse Limit: Absolute cash in hand
    var purseCeiling = currentPurse;
    // Solvency Limit: Spendable amount after protecting Phase 2 minimum future squad completion spend
    var solvencyCeiling = Math.max(0, currentPurse - minimumRequiredFutureSpend);
    // Future Budget Limit: Spendable amount after protecting planned future squad budget
    var futureBudgetCeiling = Math.max(0, currentPurse - protectedFutureBudget);
    var constraints = {
        purseLimit: purseCeiling,
        futureBudgetLimit: futureBudgetCeiling,
        solvencyLimit: solvencyCeiling
    };
    // 2. EXPLAINABLE BASE REASONS
    reasons.push("Team Value supports spending up to ".concat(teamValue, "L."));
    if (minimumRequiredFutureSpend > 0) {
        reasons.push("Solvency protects ".concat(minimumRequiredFutureSpend, "L of required future squad spend, leaving ").concat(solvencyCeiling, "L available."));
    }
    if (protectedFutureBudget > 0) {
        reasons.push("Future Budget protects ".concat(protectedFutureBudget, "L, leaving ").concat(futureBudgetCeiling, "L available."));
    }
    // 3. APPLICABLE CONSTRAINTS & RAW MINIMUM DETERMINATION
    // Constraints are ordered by strict deterministic tie-break precedence:
    // FUTURE_BUDGET -> SOLVENCY -> PURSE -> TEAM_VALUE
    var candidateConstraints = [];
    if (protectedFutureBudget > 0) {
        candidateConstraints.push({ constraint: 'FUTURE_BUDGET', limit: futureBudgetCeiling });
    }
    if (minimumRequiredFutureSpend > 0) {
        candidateConstraints.push({ constraint: 'SOLVENCY', limit: solvencyCeiling });
    }
    candidateConstraints.push({ constraint: 'PURSE', limit: purseCeiling });
    candidateConstraints.push({ constraint: 'TEAM_VALUE', limit: teamValueCeiling });
    var rawLimits = candidateConstraints.map(function (c) { return c.limit; });
    var minRawCeiling = Math.min.apply(Math, rawLimits);
    // 4. BINDING CONSTRAINT & TIE RESOLUTION (ON RAW CEILINGS)
    var tiedConstraints = candidateConstraints
        .filter(function (c) { return c.limit === minRawCeiling; })
        .map(function (c) { return c.constraint; });
    var bindingConstraint = (_c = tiedConstraints[0]) !== null && _c !== void 0 ? _c : 'TEAM_VALUE';
    if (tiedConstraints.length > 1) {
        reasons.push("Constraints tied at ".concat(minRawCeiling, "L: ").concat(tiedConstraints.join(' and '), "."));
        reasons.push("Constraint: ".concat(bindingConstraint, " applied by precedence tie-break, capping bid at ").concat(minRawCeiling, "L."));
    }
    else {
        if (bindingConstraint === 'TEAM_VALUE') {
            reasons.push("Constraint: TEAM_VALUE caps bid at ".concat(teamValueCeiling, "L."));
        }
        else if (bindingConstraint === 'PURSE') {
            reasons.push("Constraint: PURSE limits maximum bid to ".concat(purseCeiling, "L."));
        }
        else if (bindingConstraint === 'SOLVENCY') {
            reasons.push("Constraint: SOLVENCY requires protecting ".concat(minimumRequiredFutureSpend, "L for remaining squad completion, capping bid at ").concat(solvencyCeiling, "L."));
        }
        else if (bindingConstraint === 'FUTURE_BUDGET') {
            reasons.push("Constraint: FUTURE_BUDGET requires protecting ".concat(protectedFutureBudget, "L, capping bid at ").concat(futureBudgetCeiling, "L."));
        }
    }
    // 5. LEGAL BID NORMALIZATION (SEPARATE FROM RAW RATIONAL CEILING)
    var normalizedMaxBid = normalizeLegalBidCeiling(minRawCeiling);
    // 6. CURRENT BID CHECK
    // Current bid does NOT increase or change our maximum bid ceiling.
    if (ctx.currentBid > normalizedMaxBid) {
        reasons.push("Current Bid (".concat(ctx.currentBid, "L) has exceeded our maximum rational ceiling."));
    }
    return {
        teamValue: teamValue,
        maximumBid: normalizedMaxBid,
        constraints: constraints,
        bindingConstraint: bindingConstraint,
        tiedConstraints: tiedConstraints,
        auctionStage: ctx.auctionStage,
        reasons: reasons
    };
}
