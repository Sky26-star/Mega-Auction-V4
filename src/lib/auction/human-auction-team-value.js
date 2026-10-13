"use strict";
// src/lib/auction/human-auction-team-value.ts
//
// PHASE 4 — TEAM VALUE ENGINE
//
// PURPOSE:
//   A standalone, deterministic engine evaluating team-specific player value.
//   Answers "How valuable is this player to THIS team?" by transforming
//   objective Market Value based on squad construction, XI impact, 
//   alternatives, and strategic position.
//
// ARCHITECTURE:
//   Inputs: TeamValueContext (MarketValue + Team Factors + Roster)
//   Outputs: TeamValueResult
//
// RULES:
//   - DOES NOT calculate maximum bid.
//   - DOES NOT mutate intrinsic Player Market Value.
//   - DOES NOT use random numbers.
//   - XI Improvement is re-calculated based on actual roster comparison,
//     not just trusted from Phase 2 heuristics.
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateTeamValue = evaluateTeamValue;
// XI impact is a structural Version 1 approximation, not a full XI optimizer.
// It uses fixed role counts to estimate roster pressure until a deeper 
// formation intelligence system exists.
var BEST_XI_IDEAL_COUNTS = {
    BATSMAN: 4,
    BOWLER: 4,
    ALL_ROUNDER: 2,
    WICKET_KEEPER: 1
};
function calculateActualXIImprovement(ctx) {
    var role = ctx.player.role;
    var rating = ctx.player.rating || 74;
    // Find existing players in this role on the team
    var existingInRole = ctx.currentRoster
        .filter(function (p) { return p.role === role; })
        .sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    var idealCount = BEST_XI_IDEAL_COUNTS[role] || 1;
    if (existingInRole.length === 0) {
        if (rating >= 90)
            return { level: 'TRANSFORMATIVE', reason: "Fills an empty ".concat(role, " role with an elite talent") };
        if (rating >= 80)
            return { level: 'MAJOR_UPGRADE', reason: "Fills an empty ".concat(role, " role with a solid starter") };
        return { level: 'USEFUL_STARTER', reason: "Fills an empty ".concat(role, " role with a baseline starter") };
    }
    var bestExisting = existingInRole[0].rating || 0;
    // Is this player the best in the role?
    if (rating > bestExisting) {
        if (rating - bestExisting >= 5) {
            return { level: 'TRANSFORMATIVE', reason: "Massive upgrade over best existing ".concat(role, " (").concat(rating, " vs ").concat(bestExisting, ")") };
        }
        return { level: 'MAJOR_UPGRADE', reason: "Clear upgrade over best existing ".concat(role, " (").concat(rating, " vs ").concat(bestExisting, ")") };
    }
    // Is there room in the starting XI for this player?
    if (existingInRole.length < idealCount) {
        if (rating >= 85)
            return { level: 'MAJOR_UPGRADE', reason: "Adds elite quality to incomplete ".concat(role, " rotation") };
        if (rating >= 78)
            return { level: 'USEFUL_STARTER', reason: "Provides a competent starter to incomplete ".concat(role, " rotation") };
        return { level: 'DEPTH', reason: "Adds baseline depth to incomplete ".concat(role, " rotation") };
    }
    // The starting XI is notionally full for this role. Where does the player fit?
    var worstStarter = existingInRole[idealCount - 1].rating || 0;
    if (rating > worstStarter) {
        return { level: 'USEFUL_STARTER', reason: "Upgrades the weakest starting ".concat(role, " (").concat(rating, " vs ").concat(worstStarter, ")") };
    }
    if (rating >= 80) {
        return { level: 'DEPTH', reason: "Provides strong bench depth for ".concat(role) };
    }
    return { level: 'NONE', reason: "Role is fully covered by superior starters and depth" };
}
function evaluateTeamValue(ctx) {
    var reasons = [];
    var marketValue = ctx.marketValue.marketValue;
    var teamValue = marketValue;
    var xiResult = calculateActualXIImprovement(ctx);
    var xiLevel = xiResult.level;
    var need = ctx.need.level;
    var fit = ctx.teamFit.level;
    var scarcity = ctx.scarcity.level;
    var futurePlan = ctx.futurePlan;
    reasons.push("XI Impact: ".concat(xiResult.reason));
    // 1. CORE STRATEGIC CONSEQUENCE
    // We evaluate the primary strategic value derived from XI impact and Team Need, 
    // avoiding double-counting overlapping positive/negative indicators.
    var strategicMultiplier = 1.0;
    var strategicCommitment = 'NOT_COMMITTED';
    var isRedundant = (xiLevel === 'NONE' || need === 'NOT_NEEDED');
    var isCriticalTarget = (need === 'CRITICAL');
    var isTransformative = (xiLevel === 'TRANSFORMATIVE');
    var hasAlternatives = (scarcity === 'ABUNDANT');
    var hasNoAlternatives = (scarcity === 'VERY_SCARCE');
    var isPoorFit = (fit === 'POOR');
    var hasFutureCriticalTargets = (futurePlan.remainingCriticalTargets >= 2);
    var createsFuturePressure = (hasFutureCriticalTargets && !isCriticalTarget && marketValue > 500);
    var solvesFuturePressure = (hasFutureCriticalTargets &&
        isCriticalTarget &&
        futurePlan.futureRequiredRoles.some(function (r) { return r.role === ctx.player.role; }));
    if (isRedundant) {
        strategicMultiplier = 0.50;
        strategicCommitment = 'NOT_COMMITTED';
        reasons.push('Strategic Consequence: REDUNDANT. Severe value discount due to role redundancy or lack of structural need.');
    }
    else if (isTransformative && isCriticalTarget) {
        // Top tier consequence
        if (hasNoAlternatives && !isPoorFit) {
            strategicMultiplier = 1.50;
            strategicCommitment = 'COMMITTED';
            reasons.push('Strategic Consequence: IRREPLACEABLE CRITICAL SOLUTION. Solves a critical weakness with a transformative talent and virtually no alternatives remaining.');
        }
        else if (solvesFuturePressure) {
            strategicMultiplier = 1.45;
            strategicCommitment = 'COMMITTED';
            reasons.push('Strategic Consequence: CRITICAL SOLUTION (RESOLVES FUTURE CONSTRAINT). Solves a critical weakness with a transformative talent, directly reducing dangerous future squad constraints.');
        }
        else if (hasAlternatives) {
            strategicMultiplier = 1.30;
            strategicCommitment = 'JUSTIFIED';
            reasons.push('Strategic Consequence: CRITICAL SOLUTION (ABUNDANT ALTERNATIVES). Solves a critical weakness with a transformative talent, though alternatives exist.');
        }
        else {
            strategicMultiplier = 1.40;
            strategicCommitment = 'COMMITTED';
            reasons.push('Strategic Consequence: CRITICAL SOLUTION. Solves a critical squad weakness with a transformative talent.');
        }
    }
    else if (isTransformative || (xiLevel === 'MAJOR_UPGRADE' && isCriticalTarget)) {
        if (createsFuturePressure) {
            strategicMultiplier = 1.10;
            strategicCommitment = 'JUSTIFIED';
            reasons.push('Strategic Consequence: MAJOR UPGRADE (CONSTRAINED). Strong upgrade, but high price creates dangerous pressure on remaining critical targets.');
        }
        else if (isPoorFit) {
            strategicMultiplier = 1.10;
            strategicCommitment = 'JUSTIFIED';
            reasons.push('Strategic Consequence: MAJOR UPGRADE (POOR FIT). Strong upgrade, but poor structural fit limits utility.');
        }
        else if (hasNoAlternatives) {
            strategicMultiplier = 1.30;
            strategicCommitment = 'COMMITTED';
            reasons.push('Strategic Consequence: SCARCE MAJOR UPGRADE. Strong upgrade in a market with very few alternatives.');
        }
        else if (solvesFuturePressure) {
            strategicMultiplier = 1.25;
            strategicCommitment = 'COMMITTED';
            reasons.push('Strategic Consequence: MAJOR UPGRADE (RESOLVES FUTURE CONSTRAINT). Strong upgrade that directly addresses one of multiple critical remaining requirements.');
        }
        else {
            strategicMultiplier = 1.20;
            strategicCommitment = 'JUSTIFIED';
            reasons.push('Strategic Consequence: MAJOR UPGRADE. Provides a clear, major upgrade to the starting XI.');
        }
    }
    else if (xiLevel === 'MAJOR_UPGRADE' || (xiLevel === 'USEFUL_STARTER' && need === 'IMPORTANT')) {
        if (createsFuturePressure) {
            strategicMultiplier = 0.95;
            strategicCommitment = 'JUSTIFIED';
            reasons.push('Strategic Consequence: SOLID ADDITION (HEAVILY CONSTRAINED). Competent starter, but buying creates unacceptable pressure on remaining critical targets.');
        }
        else if (hasAlternatives) {
            strategicMultiplier = 1.05;
            strategicCommitment = 'JUSTIFIED';
            reasons.push('Strategic Consequence: SOLID ADDITION (ABUNDANT ALTERNATIVES). Competent starter, but market abundance limits strategic urgency.');
        }
        else {
            strategicMultiplier = 1.10;
            strategicCommitment = 'JUSTIFIED';
            reasons.push('Strategic Consequence: SOLID ADDITION. Provides a competent starter that improves the squad structure.');
        }
    }
    else if (xiLevel === 'USEFUL_STARTER' || xiLevel === 'DEPTH') {
        if (createsFuturePressure) {
            strategicMultiplier = 0.70;
            strategicCommitment = 'NOT_COMMITTED';
            reasons.push('Strategic Consequence: DEPTH (CONSTRAINED). Primarily bench depth, heavily discounted due to future critical constraints.');
        }
        else if (isPoorFit) {
            strategicMultiplier = 0.75;
            strategicCommitment = 'NOT_COMMITTED';
            reasons.push('Strategic Consequence: POOR FIT DEPTH. Depth player with poor structural fit.');
        }
        else {
            strategicMultiplier = 0.85;
            strategicCommitment = 'NOT_COMMITTED';
            reasons.push('Strategic Consequence: DEPTH. Primarily provides bench depth, reducing strategic value relative to market.');
        }
    }
    // Ensure minimum floor to prevent absurd negative multipliers
    strategicMultiplier = Math.max(0.30, strategicMultiplier);
    teamValue = marketValue * strategicMultiplier;
    // Round team value to nearest 10L
    teamValue = Math.max(ctx.player.base_price, Math.round(teamValue / 10) * 10);
    return {
        teamId: ctx.teamId,
        playerId: ctx.player.id,
        marketValue: marketValue,
        teamValue: teamValue,
        factors: {
            need: ctx.need,
            xiImprovement: { level: xiLevel, reasons: [xiResult.reason] },
            scarcity: ctx.scarcity,
            teamFit: ctx.teamFit,
            futurePlan: ctx.futurePlan
        },
        strategicCommitment: strategicCommitment,
        reasons: reasons
    };
}
