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

import type { TeamValueContext, TeamValueResult, XIImprovementLevel, StrategicCommitment } from './human-auction-manager-types';

// XI impact is a structural Version 1 approximation, not a full XI optimizer.
// It uses fixed role counts to estimate roster pressure until a deeper 
// formation intelligence system exists.
const BEST_XI_IDEAL_COUNTS: Record<string, number> = {
  BATSMAN: 4,
  BOWLER: 4,
  ALL_ROUNDER: 2,
  WICKET_KEEPER: 1
};

function calculateActualXIImprovement(ctx: TeamValueContext): { level: XIImprovementLevel; reason: string } {
  const role = ctx.player.role;
  const rating = ctx.player.rating || 74;
  
  // Find existing players in this role on the team
  const existingInRole = ctx.currentRoster
    .filter(p => p.role === role)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));

  const idealCount = BEST_XI_IDEAL_COUNTS[role] || 1;

  if (existingInRole.length === 0) {
    if (rating >= 90) return { level: 'TRANSFORMATIVE', reason: `Fills an empty ${role} role with an elite talent` };
    if (rating >= 80) return { level: 'MAJOR_UPGRADE', reason: `Fills an empty ${role} role with a solid starter` };
    return { level: 'USEFUL_STARTER', reason: `Fills an empty ${role} role with a baseline starter` };
  }

  const bestExisting = existingInRole[0]!.rating || 0;
  
  // Is this player the best in the role?
  if (rating > bestExisting) {
    if (rating - bestExisting >= 5) {
      return { level: 'TRANSFORMATIVE', reason: `Massive upgrade over best existing ${role} (${rating} vs ${bestExisting})` };
    }
    return { level: 'MAJOR_UPGRADE', reason: `Clear upgrade over best existing ${role} (${rating} vs ${bestExisting})` };
  }

  // Is there room in the starting XI for this player?
  if (existingInRole.length < idealCount) {
    if (rating >= 85) return { level: 'MAJOR_UPGRADE', reason: `Adds elite quality to incomplete ${role} rotation` };
    if (rating >= 78) return { level: 'USEFUL_STARTER', reason: `Provides a competent starter to incomplete ${role} rotation` };
    return { level: 'DEPTH', reason: `Adds baseline depth to incomplete ${role} rotation` };
  }

  // The starting XI is notionally full for this role. Where does the player fit?
  const worstStarter = existingInRole[idealCount - 1]!.rating || 0;
  
  if (rating > worstStarter) {
    return { level: 'USEFUL_STARTER', reason: `Upgrades the weakest starting ${role} (${rating} vs ${worstStarter})` };
  }

  if (rating >= 80) {
    return { level: 'DEPTH', reason: `Provides strong bench depth for ${role}` };
  }

  return { level: 'NONE', reason: `Role is fully covered by superior starters and depth` };
}

export function evaluateTeamValue(ctx: TeamValueContext): TeamValueResult {
  const reasons: string[] = [];
  const marketValue = ctx.marketValue.marketValue;
  let teamValue = marketValue;

  const xiResult = calculateActualXIImprovement(ctx);
  const xiLevel = xiResult.level;
  const need = ctx.need.level;
  const fit = ctx.teamFit.level;
  const scarcity = ctx.scarcity.level;
  const futurePlan = ctx.futurePlan;

  reasons.push(`XI Impact: ${xiResult.reason}`);

  // 1. CORE STRATEGIC CONSEQUENCE
  // We evaluate the primary strategic value derived from XI impact and Team Need, 
  // avoiding double-counting overlapping positive/negative indicators.

  let strategicMultiplier = 1.0;
  let strategicCommitment: StrategicCommitment = 'NOT_COMMITTED';

  const isRedundant = (xiLevel === 'NONE' || need === 'NOT_NEEDED');
  const isCriticalTarget = (need === 'CRITICAL');
  const isTransformative = (xiLevel === 'TRANSFORMATIVE');
  const hasAlternatives = (scarcity === 'ABUNDANT');
  const hasNoAlternatives = (scarcity === 'VERY_SCARCE');
  const isPoorFit = (fit === 'POOR');
  
  const hasFutureCriticalTargets = (futurePlan.remainingCriticalTargets >= 2);
  const createsFuturePressure = (hasFutureCriticalTargets && !isCriticalTarget && marketValue > 500);
  const solvesFuturePressure = (
    hasFutureCriticalTargets && 
    isCriticalTarget && 
    futurePlan.futureRequiredRoles.some(r => r.role === ctx.player.role)
  );

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
    } else if (solvesFuturePressure) {
      strategicMultiplier = 1.45;
      strategicCommitment = 'COMMITTED';
      reasons.push('Strategic Consequence: CRITICAL SOLUTION (RESOLVES FUTURE CONSTRAINT). Solves a critical weakness with a transformative talent, directly reducing dangerous future squad constraints.');
    } else if (hasAlternatives) {
      strategicMultiplier = 1.30;
      strategicCommitment = 'JUSTIFIED';
      reasons.push('Strategic Consequence: CRITICAL SOLUTION (ABUNDANT ALTERNATIVES). Solves a critical weakness with a transformative talent, though alternatives exist.');
    } else {
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
    } else if (isPoorFit) {
      strategicMultiplier = 1.10;
      strategicCommitment = 'JUSTIFIED';
      reasons.push('Strategic Consequence: MAJOR UPGRADE (POOR FIT). Strong upgrade, but poor structural fit limits utility.');
    } else if (hasNoAlternatives) {
      strategicMultiplier = 1.30;
      strategicCommitment = 'COMMITTED';
      reasons.push('Strategic Consequence: SCARCE MAJOR UPGRADE. Strong upgrade in a market with very few alternatives.');
    } else if (solvesFuturePressure) {
      strategicMultiplier = 1.25;
      strategicCommitment = 'COMMITTED';
      reasons.push('Strategic Consequence: MAJOR UPGRADE (RESOLVES FUTURE CONSTRAINT). Strong upgrade that directly addresses one of multiple critical remaining requirements.');
    } else {
      strategicMultiplier = 1.20;
      strategicCommitment = 'JUSTIFIED';
      reasons.push('Strategic Consequence: MAJOR UPGRADE. Provides a clear, major upgrade to the starting XI.');
    }
  }
  else if (xiLevel === 'MAJOR_UPGRADE' || (xiLevel === 'USEFUL_STARTER' && (need === 'IMPORTANT' || isCriticalTarget))) {
    if (createsFuturePressure) {
      strategicMultiplier = 0.95;
      strategicCommitment = 'JUSTIFIED';
      reasons.push('Strategic Consequence: SOLID ADDITION (HEAVILY CONSTRAINED). Competent starter, but buying creates unacceptable pressure on remaining critical targets.');
    } else if (hasAlternatives) {
      strategicMultiplier = 1.05;
      strategicCommitment = 'JUSTIFIED';
      reasons.push('Strategic Consequence: SOLID ADDITION (ABUNDANT ALTERNATIVES). Competent starter, but market abundance limits strategic urgency.');
    } else {
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
    } else if (isPoorFit) {
      strategicMultiplier = 0.75;
      strategicCommitment = 'NOT_COMMITTED';
      reasons.push('Strategic Consequence: POOR FIT DEPTH. Depth player with poor structural fit.');
    } else {
      strategicMultiplier = 0.85;
      strategicCommitment = (need === 'IMPORTANT' || isCriticalTarget) ? 'JUSTIFIED' : 'NOT_COMMITTED';
      reasons.push(
        (need === 'IMPORTANT' || isCriticalTarget)
          ? 'Strategic Consequence: DEPTH (NEEDED). Provides necessary squad depth for mandatory role requirements.'
          : 'Strategic Consequence: DEPTH. Primarily provides bench depth, reducing strategic value relative to market.'
      );
    }
  }

  // Ensure minimum floor to prevent absurd negative multipliers
  strategicMultiplier = Math.max(0.30, strategicMultiplier);

  // ============================================================
  // OVER-BIDDING PROTECTION (CATEGORY + QUALITY CAP)
  // Prevents weak/ordinary players in lower categories from receiving
  // unjustifiable multipliers simply because of extreme team need.
  // ============================================================
  if (strategicMultiplier > 1.0) {
    const category = ctx.player.category;
    const rating = ctx.player.rating || 0;
    let overbidProtection = 1.0;

    if (category === 'MARQUEE') {
      overbidProtection = rating >= 90 ? 1.0 : (rating >= 85 ? 0.95 : 0.90);
    } else if (category === 'A') {
      overbidProtection = rating >= 88 ? 1.0 : (rating >= 80 ? 0.95 : 0.85);
    } else if (category === 'B') {
      overbidProtection = rating >= 85 ? 0.95 : (rating >= 78 ? 0.85 : 0.75);
    } else if (category === 'C') {
      overbidProtection = rating >= 80 ? 0.85 : (rating >= 75 ? 0.70 : 0.55);
    } else if (category === 'D') {
      overbidProtection = rating >= 75 ? 0.70 : (rating >= 70 ? 0.50 : 0.35);
    } else {
      // E, F or other lower categories
      overbidProtection = rating >= 75 ? 0.65 : (rating >= 70 ? 0.40 : 0.25);
    }

    // Apply the protection only to the inflation portion (amount > 1.0)
    const inflation = strategicMultiplier - 1.0;
    strategicMultiplier = 1.0 + (inflation * overbidProtection);

    if (overbidProtection < 1.0) {
      reasons.push(`Over-bidding Protection: Category ${category} / Rating ${rating} capped strategic inflation by ${Math.round((1 - overbidProtection) * 100)}% to prevent unjustifiable premium.`);
    }
  }

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
    strategicCommitment,
    reasons
  };
}
