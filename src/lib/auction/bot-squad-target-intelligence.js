"use strict";
// src/lib/auction/bot-squad-target-intelligence.ts
//
// Phase 2E: Bot Squad Target Intelligence
//
// "Given the bot's current squad condition and priorities, WHAT KIND OF PLAYER SHOULD THIS BOT ACTIVELY TARGET?"
//
// This layer is standalone, pure, deterministic, and side-effect free.
// It explicitly identifies TARGET PROFILES, not actual players.
// It does NOT value players, make bidding decisions, or integrate with the engine.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotSquadTargetState = buildBotSquadTargetState;
// ============================================================
// INTERNAL HELPERS
// ============================================================
var GAP_LEVEL_WEIGHT = {
    CRITICAL: 5,
    HIGH: 4,
    NORMAL: 3,
    LOW: 2,
    REDUNDANT: 1,
};
var PRIORITY_LEVEL_WEIGHT = {
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    NONE: 1,
};
var CANONICAL_ORDER = {
    BATSMAN: 4,
    BOWLER: 3,
    ALL_ROUNDER: 2,
    WICKET_KEEPER: 1,
};
function clamp(val) {
    if (Number.isNaN(val))
        return 0;
    return Math.max(0, Math.min(100, val));
}
function generateTargetRationale(targetPriority, isPrimary, isSecondary) {
    if (isPrimary) {
        return "Primary target. Critical squad role requiring immediate reinforcement.";
    }
    if (isSecondary) {
        return "Secondary target. High-priority role with insufficient current coverage.";
    }
    switch (targetPriority) {
        case 'CRITICAL':
            return "Critical squad role requiring immediate reinforcement.";
        case 'HIGH':
            return "High-priority role with insufficient current coverage.";
        case 'MEDIUM':
            return "Role remains useful but is not currently urgent.";
        case 'LOW':
            return "Role is already sufficiently covered and should not be actively targeted.";
        case 'NONE':
            return "Role is redundant and should not be actively targeted.";
    }
}
function compareTargetProfile(a, b) {
    // 1. targetScore descending
    if (a.targetScore !== b.targetScore) {
        return b.targetScore - a.targetScore;
    }
    // 2. Phase 2D priority severity
    var prioA = PRIORITY_LEVEL_WEIGHT[a.targetPriority];
    var prioB = PRIORITY_LEVEL_WEIGHT[b.targetPriority];
    if (prioA !== prioB) {
        return prioB - prioA;
    }
    // 3. role gap severity
    var gapA = GAP_LEVEL_WEIGHT[a.gapLevel];
    var gapB = GAP_LEVEL_WEIGHT[b.gapLevel];
    if (gapA !== gapB) {
        return gapB - gapA;
    }
    // 4. currentCount ascending (fewer players = higher rank)
    if (a.currentCount !== b.currentCount) {
        return a.currentCount - b.currentCount;
    }
    // 5. canonical order
    return CANONICAL_ORDER[b.role] - CANONICAL_ORDER[a.role];
}
// ============================================================
// PUBLIC API
// ============================================================
/**
 * Build a BotSquadTargetState from existing Phase 2A-2D intelligence.
 *
 * - Synchronous
 * - Deterministic
 * - Pure
 * - Does NOT mutate inputs
 */
function buildBotSquadTargetState(squadState, gapState, qualityState, priorityState) {
    var roleKeys = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
    var roles = {};
    var profileList = [];
    for (var _i = 0, roleKeys_1 = roleKeys; _i < roleKeys_1.length; _i++) {
        var role = roleKeys_1[_i];
        var gap = gapState.roles[role];
        var priority = priorityState.roles[role];
        var isPrimaryTarget = priorityState.primaryPriorityRole === role;
        var isSecondaryTarget = priorityState.secondaryPriorityRole === role;
        // Target Score natively derives from Phase 2D priority score
        var targetScore = clamp(priority.priorityScore);
        // Target Urgency incorporates the squad's broader quality context
        // Weak squads amplify urgency; strong squads safely diminish urgency
        var baseUrgency = targetScore;
        if (qualityState.overallQuality < 40) {
            baseUrgency += 15;
        }
        else if (qualityState.overallQuality > 80) {
            baseUrgency -= 15;
        }
        // A redundant role should always carry extremely low urgency, irrespective of squad quality padding
        if (gap.gapLevel === 'REDUNDANT') {
            baseUrgency = Math.min(baseUrgency, 10);
        }
        var targetUrgency = clamp(baseUrgency);
        var profile = {
            role: role,
            targetPriority: priority.priorityLevel,
            targetScore: targetScore,
            targetUrgency: targetUrgency,
            currentCount: gap.currentCount,
            roleNeed: gap.need,
            gapLevel: gap.gapLevel,
            isPrimaryTarget: isPrimaryTarget,
            isSecondaryTarget: isSecondaryTarget,
            rationale: generateTargetRationale(priority.priorityLevel, isPrimaryTarget, isSecondaryTarget),
        };
        roles[role] = profile;
        profileList.push(profile);
    }
    // Deterministically rank the profiles
    profileList.sort(compareTargetProfile);
    var targetOrder = profileList.map(function (p) { return p.role; });
    var primaryTarget = priorityState.primaryPriorityRole ? roles[priorityState.primaryPriorityRole] : null;
    var secondaryTarget = priorityState.secondaryPriorityRole ? roles[priorityState.secondaryPriorityRole] : null;
    return {
        teamId: squadState.teamId,
        primaryTarget: primaryTarget,
        secondaryTarget: secondaryTarget,
        roles: roles,
        targetOrder: targetOrder,
    };
}
