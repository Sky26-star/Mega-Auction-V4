"use strict";
// src/lib/auction/bot-squad-quality-intelligence.ts
//
// Phase 2C: Squad Quality & Balance Intelligence
//
// Evaluates the STRUCTURAL QUALITY and BALANCE of a bot's current squad.
// This relies on Phase 2A (BotSquadState) and conceptually on Phase 2B.
//
// It evaluates:
// - Role balance and coverage
// - Structural completeness
// - Overseas structure
//
// It does NOT calculate player quality, player ratings, or bidding decisions.
//
// THIS MODULE IS STANDALONE.
// It does NOT modify any existing auction behaviour.
// It does NOT integrate into the live auction tick.
// It does NOT make bidding decisions.
// It does NOT access the database or network.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotSquadQualityState = buildBotSquadQualityState;
// ============================================================
// INTERNAL HELPERS
// ============================================================
function getCoverageLevel(need) {
    if (need === 'CRITICAL')
        return 'CRITICAL';
    if (need === 'HIGH')
        return 'PARTIAL';
    return 'COVERED'; // NORMAL, LOW, REDUNDANT
}
function determineQualityLevel(quality) {
    if (quality >= 80)
        return 'STRONG';
    if (quality >= 60)
        return 'BALANCED';
    if (quality >= 40)
        return 'DEVELOPING';
    if (quality >= 20)
        return 'WEAK';
    return 'CRITICAL';
}
function clamp(value, min, max) {
    if (Number.isNaN(value))
        return min;
    return Math.min(max, Math.max(min, value));
}
// ============================================================
// PUBLIC API
// ============================================================
/**
 * Build a BotSquadQualityState from an existing BotSquadState.
 *
 * - Synchronous
 * - Deterministic (same input → same output)
 * - Pure (no side effects)
 * - Does NOT mutate squadState
 * - Does NOT access the database or network
 * - Does NOT make bidding decisions
 *
 * @param squadState - The structural squad state generated in Phase 2A
 */
function buildBotSquadQualityState(squadState) {
    // 1. Coverage & Gaps
    var gapRoleCount = 0;
    var criticalRoleCount = 0;
    var roleCoverage = {
        BATSMAN: getCoverageLevel(squadState.roleNeeds.BATSMAN),
        BOWLER: getCoverageLevel(squadState.roleNeeds.BOWLER),
        ALL_ROUNDER: getCoverageLevel(squadState.roleNeeds.ALL_ROUNDER),
        WICKET_KEEPER: getCoverageLevel(squadState.roleNeeds.WICKET_KEEPER),
    };
    var roles = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
    for (var _i = 0, roles_1 = roles; _i < roles_1.length; _i++) {
        var role = roles_1[_i];
        var need = squadState.roleNeeds[role];
        if (need === 'CRITICAL' || need === 'HIGH') {
            gapRoleCount++;
        }
        if (need === 'CRITICAL') {
            criticalRoleCount++;
        }
    }
    // 2. Role Balance
    // Base 100. Deduct for gaps. Deduct for over-concentration.
    var roleBalance = 100;
    roleBalance -= criticalRoleCount * 25;
    roleBalance -= (gapRoleCount - criticalRoleCount) * 15;
    if (squadState.squadSize > 0) {
        var maxConcentration = 0;
        for (var _a = 0, roles_2 = roles; _a < roles_2.length; _a++) {
            var role = roles_2[_a];
            var ratio = squadState.roleComposition[role] / squadState.squadSize;
            if (ratio > maxConcentration)
                maxConcentration = ratio;
        }
        // If one role makes up >50% of a reasonably sized squad, penalize balance
        if (squadState.squadSize >= 5 && maxConcentration > 0.5) {
            roleBalance -= (maxConcentration - 0.5) * 40; // up to -20 penalty
        }
    }
    roleBalance = clamp(Math.round(roleBalance), 0, 100);
    // 3. Overseas Balance
    // Base 100. Penalize if overseas count exceeds max (invalid state).
    // Penalize slightly if overseas slots are exhausted but squad is still very small,
    // as this limits future flexibility.
    var overseasBalance = 100;
    var maxOverseas = squadState.overseasCount + squadState.overseasSlotsRemaining;
    if (squadState.overseasCount > maxOverseas && maxOverseas > 0) {
        overseasBalance = 0;
    }
    else if (squadState.overseasSlotsRemaining === 0 && squadState.remainingSlots > 10) {
        // Used all overseas slots but still have >10 players to buy. Flexibility constraint.
        overseasBalance -= 20;
    }
    overseasBalance = clamp(Math.round(overseasBalance), 0, 100);
    // 4. Squad Completeness
    // Not just size. It represents structural coverage.
    // Base 100. Deduct for gaps.
    var squadCompleteness = 100;
    squadCompleteness -= criticalRoleCount * 25;
    squadCompleteness -= (gapRoleCount - criticalRoleCount) * 10;
    squadCompleteness = clamp(Math.round(squadCompleteness), 0, 100);
    // 5. Overall Quality
    // Weighted combination of the structural factors.
    var overallQualityRaw = (roleBalance * 0.50) +
        (squadCompleteness * 0.35) +
        (overseasBalance * 0.15);
    var overallQuality = clamp(Math.round(overallQualityRaw), 0, 100);
    var qualityLevel = determineQualityLevel(overallQuality);
    return {
        teamId: squadState.teamId,
        squadSize: squadState.squadSize,
        overallQuality: overallQuality,
        qualityLevel: qualityLevel,
        roleBalance: roleBalance,
        overseasBalance: overseasBalance,
        squadCompleteness: squadCompleteness,
        roleCoverage: roleCoverage,
        gapRoleCount: gapRoleCount,
        criticalRoleCount: criticalRoleCount,
    };
}
