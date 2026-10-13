"use strict";
// src/lib/auction/bot-squad-tradeoff-intelligence.ts
//
// Phase 2G: Bot Squad Trade-off Intelligence
//
// "If I choose this acquisition path now, what do I gain, what do I sacrifice,
// what important squad problems remain unresolved, how much strategic flexibility do I lose,
// and how dangerous is this choice given my current squad constraints?"
//
// Standalone, pure, deterministic. Evaluates structural trade-offs of acquisition paths.
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
exports.buildBotSquadTradeoffState = buildBotSquadTradeoffState;
// ============================================================
// HELPERS
// ============================================================
function clamp(val) {
    if (Number.isNaN(val) || !Number.isFinite(val))
        return 0;
    return Math.max(0, Math.min(100, Math.round(val)));
}
var CANONICAL_ORDER = {
    BATSMAN: 4,
    BOWLER: 3,
    ALL_ROUNDER: 2,
    WICKET_KEEPER: 1,
};
function getConstraintLevel(pressure) {
    if (pressure < 20)
        return 'LOW';
    if (pressure < 40)
        return 'MODERATE';
    if (pressure < 60)
        return 'ELEVATED';
    if (pressure < 80)
        return 'HIGH';
    return 'CRITICAL';
}
function getGapResolutionBasis(need) {
    switch (need) {
        case 'CRITICAL': return 100;
        case 'HIGH': return 80;
        case 'NORMAL': return 50;
        case 'LOW': return 20;
        case 'REDUNDANT': return 0;
    }
}
function generateRationale(option) {
    var gapResolution = option.gapResolution, opportunityCost = option.opportunityCost, futureFlexibility = option.futureFlexibility, tradeoffScore = option.tradeoffScore;
    if (tradeoffScore < 30) {
        return "Limited structural benefit while consuming valuable slot capacity.";
    }
    if (gapResolution > 70 && opportunityCost < 50) {
        return "Strong gap resolution with manageable slot pressure and healthy flexibility.";
    }
    if (gapResolution > 70 && opportunityCost >= 50) {
        return "Resolves a major structural need but consumes critical remaining capacity.";
    }
    if (futureFlexibility > 60) {
        return "Moderate structural benefit that preserves future alternative paths.";
    }
    return "Balances moderate gap resolution against increasing structural constraints.";
}
function compareOptions(a, b) {
    if (a.tradeoffScore !== b.tradeoffScore)
        return b.tradeoffScore - a.tradeoffScore;
    if (a.benefitScore !== b.benefitScore)
        return b.benefitScore - a.benefitScore;
    if (a.sacrificeScore !== b.sacrificeScore)
        return a.sacrificeScore - b.sacrificeScore; // Ascending (lower sacrifice is better)
    if (a.futureFlexibility !== b.futureFlexibility)
        return b.futureFlexibility - a.futureFlexibility;
    return CANONICAL_ORDER[b.role] - CANONICAL_ORDER[a.role];
}
// ============================================================
// PUBLIC API
// ============================================================
function buildBotSquadTradeoffState(squadState, gapState, qualityState, priorityState, targetState, altState) {
    // 1. GLOBAL CONSTRAINT CONTEXT
    var totalCriticalGaps = gapState.criticalGapRoles;
    // Safe initial slot derivation: if squad is empty, slots = remaining. 
    var initialSlots = Math.max(1, squadState.squadSize + squadState.remainingSlots);
    var remainingSlots = Math.max(0, squadState.remainingSlots);
    var slotScarcity = clamp(100 * (1 - remainingSlots / initialSlots));
    var criticalNeedPressure = clamp((totalCriticalGaps / 4) * 100);
    var alternativeScarcity = 100;
    if (altState.alternativeAvailability === 'ALTERNATIVES_AVAILABLE')
        alternativeScarcity = 20;
    else if (altState.alternativeAvailability === 'LIMITED_ALTERNATIVES')
        alternativeScarcity = 60;
    var constraintPressure = clamp((0.45 * slotScarcity) +
        (0.35 * criticalNeedPressure) +
        (0.20 * alternativeScarcity));
    var constraintContext = {
        slotScarcity: slotScarcity,
        criticalNeedPressure: criticalNeedPressure,
        alternativeScarcity: alternativeScarcity,
        constraintPressure: constraintPressure
    };
    var overallConstraintLevel = getConstraintLevel(constraintPressure);
    // 2. CANDIDATE EVALUATION
    var allRoles = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
    var options = [];
    for (var _i = 0, allRoles_1 = allRoles; _i < allRoles_1.length; _i++) {
        var role = allRoles_1[_i];
        var roleGap = gapState.roles[role];
        var rolePrio = priorityState.roles[role];
        // Skip evaluating paths that are fundamentally redundant and unwanted
        if (roleGap.need === 'REDUNDANT' && rolePrio.priorityLevel === 'NONE') {
            continue;
        }
        var gapResolution = getGapResolutionBasis(roleGap.need);
        // SQUAD BALANCE & COMPLETION
        var squadBalanceImpact = gapResolution === 0 ? 0 : clamp((gapResolution * 0.7) + ((100 - qualityState.roleBalance) * 0.3));
        var completionImpact = gapResolution === 0 ? 0 : clamp((gapResolution * 0.6) + ((100 - qualityState.squadCompleteness) * 0.4));
        var benefitScore = clamp((0.45 * gapResolution) +
            (0.30 * squadBalanceImpact) +
            (0.25 * completionImpact));
        // SACRIFICE
        var opportunityCost = clamp((0.40 * slotScarcity) + (0.30 * criticalNeedPressure) + (0.30 * (100 - gapResolution)));
        var resolvedCriticals = roleGap.need === 'CRITICAL' ? 1 : 0;
        var unresolvedCriticals = Math.max(0, totalCriticalGaps - resolvedCriticals);
        var unresolvedNeedExposure = clamp((unresolvedCriticals / 4) * 100);
        var flexibilityLoss = clamp((0.40 * slotScarcity) + (0.40 * unresolvedNeedExposure) + (0.20 * alternativeScarcity));
        var sacrificeScore = clamp((0.45 * opportunityCost) +
            (0.35 * unresolvedNeedExposure) +
            (0.20 * flexibilityLoss));
        // FLEXIBILITY
        // If we acquire the primary target, we still have the squad's alternatives.
        // If we acquire an alternative, we deviate from the primary plan.
        var futureFlexibility = 0;
        var alternativePathValue = 0;
        if (role === altState.primaryRole) {
            futureFlexibility = clamp(altState.alternatives.length * 50); // 0, 50, or 100
            alternativePathValue = altState.alternatives.reduce(function (sum, a) { return sum + a.alternativeScore; }, 0) / Math.max(1, altState.alternatives.length);
        }
        else {
            // By choosing a fallback or unrelated role, we lock in a pivot path and lose general flexibility
            futureFlexibility = 20;
            alternativePathValue = 10;
        }
        var flexibilityScore = clamp((0.60 * futureFlexibility) + (0.40 * alternativePathValue));
        var targetLockRisk = clamp((100 - futureFlexibility) * 0.8 + (slotScarcity * 0.2));
        var sacrificeRisk = clamp((0.70 * sacrificeScore) + (0.30 * targetLockRisk));
        // CONSTRAINT SCALING
        var constraintMultiplier = 0.75 + (constraintPressure / 100) * 0.75;
        var adjustedSacrifice = clamp(sacrificeRisk * constraintMultiplier);
        // EFFICIENCY
        var structuralGain = clamp((0.50 * gapResolution) + (0.30 * squadBalanceImpact) + (0.20 * completionImpact));
        var constraintCost = clamp((0.40 * slotScarcity) + (0.35 * unresolvedNeedExposure) + (0.25 * flexibilityLoss));
        // Normalization: gain / cost. 
        // If gain = cost, ratio = 1.0 -> 50 rawEfficiency.
        var ratio = structuralGain / Math.max(1, constraintCost);
        var acquisitionEfficiency = clamp(ratio * 50);
        // FINAL SCORE
        var tradeoffScore = clamp((0.60 * benefitScore) +
            (0.20 * flexibilityScore) -
            (0.20 * adjustedSacrifice));
        options.push({
            role: role,
            gapResolution: gapResolution,
            squadBalanceImpact: squadBalanceImpact,
            completionImpact: completionImpact,
            opportunityCost: opportunityCost,
            unresolvedNeedExposure: unresolvedNeedExposure,
            flexibilityLoss: flexibilityLoss,
            futureFlexibility: futureFlexibility,
            alternativePathValue: alternativePathValue,
            targetLockRisk: targetLockRisk,
            benefitScore: benefitScore,
            sacrificeScore: sacrificeScore,
            sacrificeRisk: sacrificeRisk,
            flexibilityScore: flexibilityScore,
            constraintPressure: constraintPressure,
            adjustedSacrifice: adjustedSacrifice,
            acquisitionEfficiency: acquisitionEfficiency,
            tradeoffScore: tradeoffScore,
            rationale: '' // placeholder
        });
    }
    // Inject rationale after calculating all fields
    var populatedOptions = options.map(function (opt) { return (__assign(__assign({}, opt), { rationale: generateRationale(opt) })); });
    populatedOptions.sort(compareOptions);
    var primaryOption = populatedOptions.length > 0 ? (populatedOptions[0] || null) : null;
    var alternativeOptions = populatedOptions.length > 1 ? populatedOptions.slice(1) : [];
    var tradeoffOrder = populatedOptions.map(function (o) { return o.role; });
    return {
        teamId: squadState.teamId,
        remainingSlots: remainingSlots,
        constraintContext: constraintContext,
        primaryOption: primaryOption,
        alternativeOptions: alternativeOptions,
        tradeoffOrder: tradeoffOrder,
        overallConstraintLevel: overallConstraintLevel
    };
}
