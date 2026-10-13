"use strict";
// src/lib/auction/bot-squad-alternative-intelligence.ts
//
// Phase 2F: Bot Squad Alternative Intelligence
//
// "If my preferred target does not work out, what are my next viable alternatives?"
//
// This layer is standalone, pure, deterministic, and side-effect free.
// It explicitly identifies ALTERNATIVE TARGET PATHS, not actual players.
// It does NOT value players, make bidding decisions, or integrate with the engine.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotSquadAlternativeState = buildBotSquadAlternativeState;
function getCompatibility(primary, fallback) {
    if (primary === 'BATSMAN' && fallback === 'ALL_ROUNDER') {
        return { type: 'PARTIAL', score: 75 };
    }
    if (primary === 'BOWLER' && fallback === 'ALL_ROUNDER') {
        return { type: 'PARTIAL', score: 75 };
    }
    if (primary === 'ALL_ROUNDER' && fallback === 'BATSMAN') {
        return { type: 'WEAK', score: 40 };
    }
    if (primary === 'ALL_ROUNDER' && fallback === 'BOWLER') {
        return { type: 'WEAK', score: 40 };
    }
    if (primary === 'WICKET_KEEPER' && fallback === 'BATSMAN') {
        return { type: 'WEAK', score: 30 };
    }
    return { type: 'NONE', score: 0 };
}
var CANONICAL_ORDER = {
    BATSMAN: 4,
    BOWLER: 3,
    ALL_ROUNDER: 2,
    WICKET_KEEPER: 1,
};
function clamp(val) {
    if (Number.isNaN(val) || !Number.isFinite(val))
        return 0;
    return Math.max(0, Math.min(100, Math.round(val)));
}
function generateRationale(fallbackRole, type, primaryRole) {
    switch (type) {
        case 'DIRECT':
            return "Direct substitute available for ".concat(primaryRole, ".");
        case 'PARTIAL':
            return "All-rounder provides partial structural coverage for the ".concat(primaryRole, " gap.");
        case 'WEAK':
            return "Batting/Bowling alternative exists but does not fully replace the ".concat(primaryRole, " requirement.");
        case 'NONE':
            return "No meaningful structural alternative exists for this requirement.";
    }
}
function compareAlternatives(a, b, primaryPriorityState) {
    // 1. alternativeScore DESC
    if (a.alternativeScore !== b.alternativeScore) {
        return b.alternativeScore - a.alternativeScore;
    }
    // 2. compatibility strength DESC
    if (a.compatibilityScore !== b.compatibilityScore) {
        return b.compatibilityScore - a.compatibilityScore;
    }
    // 3. role priority score DESC
    var prioA = primaryPriorityState.roles[a.role].priorityScore;
    var prioB = primaryPriorityState.roles[b.role].priorityScore;
    if (prioA !== prioB) {
        return prioB - prioA;
    }
    // 4. currentCount ASC
    if (a.currentCount !== b.currentCount) {
        return a.currentCount - b.currentCount;
    }
    // 5. Canonical
    return CANONICAL_ORDER[b.role] - CANONICAL_ORDER[a.role];
}
// ============================================================
// PUBLIC API
// ============================================================
function buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState) {
    var primaryTarget = targetState.primaryTarget;
    if (!primaryTarget) {
        // Fully covered squad or no meaningful priority
        return {
            teamId: squadState.teamId,
            primaryRole: null,
            alternativeAvailability: 'NO_MEANINGFUL_ALTERNATIVE',
            targetDependency: 'LOW_DEPENDENCY',
            alternatives: [],
            fallbackOrder: [],
        };
    }
    var primaryRole = primaryTarget.role;
    var roleKeys = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
    var possibleAlternatives = [];
    for (var _i = 0, roleKeys_1 = roleKeys; _i < roleKeys_1.length; _i++) {
        var fallback = roleKeys_1[_i];
        if (fallback === primaryRole)
            continue;
        var compat = getCompatibility(primaryRole, fallback);
        if (compat.type === 'NONE')
            continue;
        var fallbackTargetProfile = targetState.roles[fallback];
        var fallbackGap = gapState.roles[fallback];
        // Alternative Score = 50% structural compatibility + 50% structural value of the fallback role itself.
        // If the squad also needs an ALL_ROUNDER, using one to cover a BATSMAN gap is highly efficient.
        // If ALL_ROUNDER is REDUNDANT, score drops significantly.
        var alternativeScore = clamp((compat.score * 0.5) + (fallbackTargetProfile.targetScore * 0.5));
        // Urgency is derived primarily from how urgent the PRIMARY target is, 
        // bounded by how compatible the fallback is.
        // A weak alternative cannot carry 100 urgency even if the primary is frantic.
        var urgencyCeiling = compat.score;
        var computedUrgency = primaryTarget.targetUrgency * (compat.score / 100);
        var alternativeUrgency = clamp(Math.min(computedUrgency, urgencyCeiling));
        possibleAlternatives.push({
            role: fallback,
            alternativeType: compat.type,
            alternativeScore: alternativeScore,
            alternativeUrgency: alternativeUrgency,
            compatibilityScore: compat.score,
            currentCount: fallbackGap.currentCount,
            roleNeed: fallbackGap.need,
            gapLevel: fallbackGap.gapLevel,
            rationale: generateRationale(fallback, compat.type, primaryRole),
        });
    }
    // Sort deterministically
    possibleAlternatives.sort(function (a, b) { return compareAlternatives(a, b, priorityState); });
    // Enforce fallback depth limit (max 2)
    var finalAlternatives = possibleAlternatives.slice(0, 2);
    var fallbackOrder = finalAlternatives.map(function (a) { return a.role; });
    // Dependency logic:
    // If no alternatives scored > 40, the squad is highly dependent on securing the primary target.
    var hasStrongAlternative = finalAlternatives.some(function (a) { return a.alternativeScore >= 40; });
    var targetDependency = hasStrongAlternative ? 'LOW_DEPENDENCY' : 'HIGH_DEPENDENCY';
    var availability = 'NO_MEANINGFUL_ALTERNATIVE';
    if (finalAlternatives.length >= 2)
        availability = 'ALTERNATIVES_AVAILABLE';
    else if (finalAlternatives.length === 1)
        availability = 'LIMITED_ALTERNATIVES';
    return {
        teamId: squadState.teamId,
        primaryRole: primaryRole,
        alternativeAvailability: availability,
        targetDependency: targetDependency,
        alternatives: finalAlternatives,
        fallbackOrder: fallbackOrder,
    };
}
