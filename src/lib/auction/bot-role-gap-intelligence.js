"use strict";
// src/lib/auction/bot-role-gap-intelligence.ts
//
// Phase 2B: Role Gap Intelligence
//
// Consumes the BotSquadState (Phase 2A) and interprets the existing
// authoritative RoleNeeds into a semantic gap model.
//
// This answers "What is missing from my current squad?" without
// calculating squad quality, player priority, or making bidding decisions.
//
// THIS MODULE IS STANDALONE.
// It does NOT modify any existing auction behaviour.
// It does NOT integrate into the live auction tick.
// It does NOT make bidding decisions.
// It does NOT access the database or network.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotRoleGapState = buildBotRoleGapState;
// ============================================================
// INTERNAL HELPERS
// ============================================================
function interpretGap(need, currentCount) {
    var isGap = need === 'CRITICAL' || need === 'HIGH';
    var isCritical = need === 'CRITICAL';
    return {
        currentCount: currentCount,
        need: need,
        gapLevel: need,
        isGap: isGap,
        isCritical: isCritical,
    };
}
// ============================================================
// PUBLIC API
// ============================================================
/**
 * Build a BotRoleGapState from an existing BotSquadState.
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
function buildBotRoleGapState(squadState) {
    var roles = {
        BATSMAN: interpretGap(squadState.roleNeeds.BATSMAN, squadState.roleComposition.BATSMAN),
        BOWLER: interpretGap(squadState.roleNeeds.BOWLER, squadState.roleComposition.BOWLER),
        ALL_ROUNDER: interpretGap(squadState.roleNeeds.ALL_ROUNDER, squadState.roleComposition.ALL_ROUNDER),
        WICKET_KEEPER: interpretGap(squadState.roleNeeds.WICKET_KEEPER, squadState.roleComposition.WICKET_KEEPER),
    };
    var totalGapRoles = 0;
    var criticalGapRoles = 0;
    for (var _i = 0, _a = Object.keys(roles); _i < _a.length; _i++) {
        var roleKey = _a[_i];
        var gap = roles[roleKey];
        if (gap.isGap) {
            totalGapRoles++;
        }
        if (gap.isCritical) {
            criticalGapRoles++;
        }
    }
    return {
        teamId: squadState.teamId,
        totalGapRoles: totalGapRoles,
        criticalGapRoles: criticalGapRoles,
        roles: roles,
    };
}
