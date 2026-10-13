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

import type {
  MaximumBidContext,
  MaximumBidResult,
  BindingConstraint,
  MaximumBidConstraints,
  Lakhs
} from './human-auction-manager-types';

/**
 * Normalizes a raw rational ceiling to the highest legal bid not exceeding that ceiling.
 * Temporary V1 approximation: rounds down to nearest 10L increment.
 */
export function normalizeLegalBidCeiling(rawCeiling: number): Lakhs {
  return Math.max(0, Math.floor(rawCeiling / 10) * 10);
}

export function evaluateMaximumBid(ctx: MaximumBidContext): MaximumBidResult {
  const reasons: string[] = [];
  const teamValue = ctx.teamValue.teamValue;
  const currentPurse = ctx.purse.currentPurse;
  const minimumRequiredFutureSpend = Math.max(0, ctx.purse.minimumRequiredFutureSpend ?? 0);
  const protectedFutureBudget = Math.max(0, ctx.futureBudget ?? 0);

  // 1. RAW FINANCIAL CEILINGS
  // Team Value: The strategic valuation from Phase 4
  const teamValueCeiling = teamValue;

  // Purse Limit: Absolute cash in hand
  const purseCeiling = currentPurse;

  // Solvency Limit: Spendable amount after protecting Phase 2 minimum future squad completion spend
  const solvencyCeiling = Math.max(0, currentPurse - minimumRequiredFutureSpend);

  // Future Budget Limit: Spendable amount after protecting planned future squad budget
  const futureBudgetCeiling = Math.max(0, currentPurse - protectedFutureBudget);

  const constraints: MaximumBidConstraints = {
    purseLimit: purseCeiling,
    futureBudgetLimit: futureBudgetCeiling,
    solvencyLimit: solvencyCeiling
  };

  // 2. EXPLAINABLE BASE REASONS
  reasons.push(`Team Value supports spending up to ${teamValue}L.`);
  if (minimumRequiredFutureSpend > 0) {
    reasons.push(`Solvency protects ${minimumRequiredFutureSpend}L of required future squad spend, leaving ${solvencyCeiling}L available.`);
  }
  if (protectedFutureBudget > 0) {
    reasons.push(`Future Budget protects ${protectedFutureBudget}L, leaving ${futureBudgetCeiling}L available.`);
  }

  // 3. APPLICABLE CONSTRAINTS & RAW MINIMUM DETERMINATION
  // Constraints are ordered by strict deterministic tie-break precedence:
  // FUTURE_BUDGET -> SOLVENCY -> PURSE -> TEAM_VALUE
  const candidateConstraints: { constraint: BindingConstraint; limit: number }[] = [];

  if (protectedFutureBudget > 0) {
    candidateConstraints.push({ constraint: 'FUTURE_BUDGET', limit: futureBudgetCeiling });
  }
  if (minimumRequiredFutureSpend > 0) {
    candidateConstraints.push({ constraint: 'SOLVENCY', limit: solvencyCeiling });
  }
  candidateConstraints.push({ constraint: 'PURSE', limit: purseCeiling });
  candidateConstraints.push({ constraint: 'TEAM_VALUE', limit: teamValueCeiling });

  const rawLimits = candidateConstraints.map(c => c.limit);
  const minRawCeiling = Math.min(...rawLimits);

  // 4. BINDING CONSTRAINT & TIE RESOLUTION (ON RAW CEILINGS)
  const tiedConstraints = candidateConstraints
    .filter(c => c.limit === minRawCeiling)
    .map(c => c.constraint);

  const bindingConstraint: BindingConstraint = tiedConstraints[0] ?? 'TEAM_VALUE';

  if (tiedConstraints.length > 1) {
    reasons.push(`Constraints tied at ${minRawCeiling}L: ${tiedConstraints.join(' and ')}.`);
    reasons.push(`Constraint: ${bindingConstraint} applied by precedence tie-break, capping bid at ${minRawCeiling}L.`);
  } else {
    if (bindingConstraint === 'TEAM_VALUE') {
      reasons.push(`Constraint: TEAM_VALUE caps bid at ${teamValueCeiling}L.`);
    } else if (bindingConstraint === 'PURSE') {
      reasons.push(`Constraint: PURSE limits maximum bid to ${purseCeiling}L.`);
    } else if (bindingConstraint === 'SOLVENCY') {
      reasons.push(`Constraint: SOLVENCY requires protecting ${minimumRequiredFutureSpend}L for remaining squad completion, capping bid at ${solvencyCeiling}L.`);
    } else if (bindingConstraint === 'FUTURE_BUDGET') {
      reasons.push(`Constraint: FUTURE_BUDGET requires protecting ${protectedFutureBudget}L, capping bid at ${futureBudgetCeiling}L.`);
    }
  }

  // 5. LEGAL BID NORMALIZATION (SEPARATE FROM RAW RATIONAL CEILING)
  const normalizedMaxBid = normalizeLegalBidCeiling(minRawCeiling);

  // 6. CURRENT BID CHECK
  // Current bid does NOT increase or change our maximum bid ceiling.
  if (ctx.currentBid > normalizedMaxBid) {
    reasons.push(`Current Bid (${ctx.currentBid}L) has exceeded our maximum rational ceiling.`);
  }

  return {
    teamValue,
    maximumBid: normalizedMaxBid,
    constraints,
    bindingConstraint,
    tiedConstraints,
    auctionStage: ctx.auctionStage,
    reasons
  };
}
