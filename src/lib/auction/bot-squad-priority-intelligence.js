"use strict";
// src/lib/auction/bot-squad-priority-intelligence.ts
//
// Phase 2D: Bot Squad Priority Intelligence
//
// Converts existing squad intelligence into actionable ROLE PRIORITIES.
// It answers: "What should my squad prioritize next?"
//
// This layer is standalone, pure, deterministic, and side-effect free.
// It evaluates the priority of structural needs, it does NOT select
// target players or determine bid amounts.
//
// THIS MODULE IS STANDALONE.
// It does NOT modify any existing auction behaviour.
// It does NOT integrate into the live auction tick.
// It does NOT make bidding decisions.
// It does NOT access the database or network.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotSquadPriorityState = buildBotSquadPriorityState;
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
var CANONICAL_ORDER = {
    BATSMAN: 4,
    BOWLER: 3,
    ALL_ROUNDER: 2,
    WICKET_KEEPER: 1,
};
function getBasePriorityScore(gapLevel) {
    switch (gapLevel) {
        case 'CRITICAL': return 95;
        case 'HIGH': return 80;
        case 'NORMAL': return 50;
        case 'LOW': return 30;
        case 'REDUNDANT': return 10;
    }
}
function determinePriorityLevel(score) {
    if (score >= 90)
        return 'CRITICAL';
    if (score >= 70)
        return 'HIGH';
    if (score >= 40)
        return 'MEDIUM';
    if (score >= 20)
        return 'LOW';
    return 'NONE';
}
function generateReason(role, gapLevel) {
    switch (gapLevel) {
        case 'CRITICAL': return "Critical structural need for a ".concat(role, ".");
        case 'HIGH': return "High structural need for a ".concat(role, ".");
        case 'NORMAL': return "Moderate need for depth in ".concat(role, ".");
        case 'LOW': return "Low priority; ".concat(role, " role is mostly satisfied.");
        case 'REDUNDANT': return "No priority; ".concat(role, " role is fully saturated.");
    }
}
function compareRolePriority(a, b) {
    // 1. Higher priority score wins
    if (a.priorityScore !== b.priorityScore) {
        return b.priorityScore - a.priorityScore;
    }
    // 2. Higher gap severity wins
    var weightA = GAP_LEVEL_WEIGHT[a.gapLevel];
    var weightB = GAP_LEVEL_WEIGHT[b.gapLevel];
    if (weightA !== weightB) {
        return weightB - weightA;
    }
    // 3. Lower current count wins (more severe absolute shortage)
    if (a.currentCount !== b.currentCount) {
        return a.currentCount - b.currentCount;
    }
    // 4. Canonical order (deterministic fallback)
    return CANONICAL_ORDER[b.role] - CANONICAL_ORDER[a.role];
}
function clamp(val) {
    if (Number.isNaN(val))
        return 0;
    return Math.max(0, Math.min(100, val));
}
// ============================================================
// PUBLIC API
// ============================================================
/**
 * Build a BotSquadPriorityState from Phase 2A, 2B, and 2C states.
 *
 * - Synchronous
 * - Deterministic
 * - Pure
 * - Does NOT mutate inputs
 */
function buildBotSquadPriorityState(squadState, gapState, qualityState) {
    var roleKeys = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
    var roles = {};
    var roleList = [];
    for (var _i = 0, roleKeys_1 = roleKeys; _i < roleKeys_1.length; _i++) {
        var role = roleKeys_1[_i];
        var gap = gapState.roles[role];
        var priorityScore = getBasePriorityScore(gap.gapLevel);
        // Minor refinement based on overall squad quality (panic factor)
        // A weak squad slightly elevates the urgency of its significant gaps.
        if (qualityState.overallQuality < 40 && (gap.isCritical || gap.isGap)) {
            priorityScore += 5;
        }
        priorityScore = clamp(priorityScore);
        var priorityLevel = determinePriorityLevel(priorityScore);
        var priorityObj = {
            role: role,
            priorityScore: priorityScore,
            priorityLevel: priorityLevel,
            reason: generateReason(role, gap.gapLevel),
            gapLevel: gap.gapLevel,
            isGap: gap.isGap,
            isCritical: gap.isCritical,
            currentCount: gap.currentCount,
            need: gap.need,
        };
        roles[role] = priorityObj;
        roleList.push(priorityObj);
    }
    // Sort deterministically
    roleList.sort(compareRolePriority);
    var priorityOrder = roleList.map(function (r) { return r.role; });
    var primaryRoleObj = roleList[0];
    var secondaryRoleObj = roleList[1];
    // Determine if primary/secondary are meaningful
    var primaryPriorityRole = primaryRoleObj.priorityLevel !== 'NONE' ? primaryRoleObj.role : null;
    var secondaryPriorityRole = (secondaryRoleObj.priorityLevel === 'CRITICAL' ||
        secondaryRoleObj.priorityLevel === 'HIGH' ||
        secondaryRoleObj.priorityLevel === 'MEDIUM')
        ? secondaryRoleObj.role : null;
    var overallPriorityLevel = primaryRoleObj.priorityLevel;
    return {
        teamId: squadState.teamId,
        overallPriorityLevel: overallPriorityLevel,
        primaryPriorityRole: primaryPriorityRole,
        secondaryPriorityRole: secondaryPriorityRole,
        roles: roles,
        priorityOrder: priorityOrder,
        squadQualityContext: {
            overallQuality: qualityState.overallQuality,
            qualityLevel: qualityState.qualityLevel,
            squadCompleteness: qualityState.squadCompleteness,
        }
    };
}
