// src/lib/auction/bot-squad-tradeoff-intelligence.ts
//
// Phase 2G: Bot Squad Trade-off Intelligence
//
// "If I choose this acquisition path now, what do I gain, what do I sacrifice,
// what important squad problems remain unresolved, how much strategic flexibility do I lose,
// and how dangerous is this choice given my current squad constraints?"
//
// Standalone, pure, deterministic. Evaluates structural trade-offs of acquisition paths.

import { type BotSquadState } from './bot-squad-intelligence';
import { type BotRoleGapState } from './bot-role-gap-intelligence';
import { type BotSquadQualityState } from './bot-squad-quality-intelligence';
import { type BotSquadPriorityState, type RoleKey } from './bot-squad-priority-intelligence';
import { type BotSquadTargetState } from './bot-squad-target-intelligence';
import { type BotSquadAlternativeState } from './bot-squad-alternative-intelligence';
import { type RoleNeed } from './server-bot-engine';

// ============================================================
// TYPES
// ============================================================

export type ConstraintLevel = 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' | 'CRITICAL';

export interface GlobalConstraintContext {
  readonly slotScarcity: number;
  readonly criticalNeedPressure: number;
  readonly alternativeScarcity: number;
  readonly constraintPressure: number;
}

export interface BotSquadTradeoffOption {
  readonly role: RoleKey;
  
  // Raw Components
  readonly gapResolution: number;
  readonly squadBalanceImpact: number;
  readonly completionImpact: number;
  
  readonly opportunityCost: number;
  readonly unresolvedNeedExposure: number;
  readonly flexibilityLoss: number;
  
  readonly futureFlexibility: number;
  readonly alternativePathValue: number;
  
  readonly targetLockRisk: number;
  
  // Synthesized Sub-Scores
  readonly benefitScore: number;
  readonly sacrificeScore: number;
  readonly sacrificeRisk: number;
  readonly flexibilityScore: number;
  
  // Global Adjustments
  readonly constraintPressure: number;
  readonly adjustedSacrifice: number;
  
  // Efficiency & Final Tradeoff
  readonly acquisitionEfficiency: number;
  readonly tradeoffScore: number;
  
  readonly rationale: string;
}

export interface BotSquadTradeoffState {
  readonly teamId: string;
  readonly remainingSlots: number;
  readonly constraintContext: GlobalConstraintContext;
  readonly primaryOption: BotSquadTradeoffOption | null;
  readonly alternativeOptions: readonly BotSquadTradeoffOption[];
  readonly tradeoffOrder: readonly RoleKey[];
  readonly overallConstraintLevel: ConstraintLevel;
}

// ============================================================
// HELPERS
// ============================================================

function clamp(val: number): number {
  if (Number.isNaN(val) || !Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(100, Math.round(val)));
}

const CANONICAL_ORDER: Record<RoleKey, number> = {
  BATSMAN: 4,
  BOWLER: 3,
  ALL_ROUNDER: 2,
  WICKET_KEEPER: 1,
};

function getConstraintLevel(pressure: number): ConstraintLevel {
  if (pressure < 20) return 'LOW';
  if (pressure < 40) return 'MODERATE';
  if (pressure < 60) return 'ELEVATED';
  if (pressure < 80) return 'HIGH';
  return 'CRITICAL';
}

function getGapResolutionBasis(need: RoleNeed): number {
  switch (need) {
    case 'CRITICAL': return 100;
    case 'HIGH': return 80;
    case 'NORMAL': return 50;
    case 'LOW': return 20;
    case 'REDUNDANT': return 0;
  }
}

function generateRationale(option: BotSquadTradeoffOption): string {
  const { gapResolution, opportunityCost, futureFlexibility, tradeoffScore } = option;
  
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

function compareOptions(a: BotSquadTradeoffOption, b: BotSquadTradeoffOption): number {
  if (a.tradeoffScore !== b.tradeoffScore) return b.tradeoffScore - a.tradeoffScore;
  if (a.benefitScore !== b.benefitScore) return b.benefitScore - a.benefitScore;
  if (a.sacrificeScore !== b.sacrificeScore) return a.sacrificeScore - b.sacrificeScore; // Ascending (lower sacrifice is better)
  if (a.futureFlexibility !== b.futureFlexibility) return b.futureFlexibility - a.futureFlexibility;
  return CANONICAL_ORDER[b.role] - CANONICAL_ORDER[a.role];
}

// ============================================================
// PUBLIC API
// ============================================================

export function buildBotSquadTradeoffState(
  squadState: BotSquadState,
  gapState: BotRoleGapState,
  qualityState: BotSquadQualityState,
  priorityState: BotSquadPriorityState,
  targetState: BotSquadTargetState,
  altState: BotSquadAlternativeState
): BotSquadTradeoffState {

  // 1. GLOBAL CONSTRAINT CONTEXT
  const totalCriticalGaps = gapState.criticalGapRoles;
  
  // Safe initial slot derivation: if squad is empty, slots = remaining. 
  const initialSlots = Math.max(1, squadState.squadSize + squadState.remainingSlots);
  const remainingSlots = Math.max(0, squadState.remainingSlots);
  
  const slotScarcity = clamp(100 * (1 - remainingSlots / initialSlots));
  const criticalNeedPressure = clamp((totalCriticalGaps / 4) * 100);
  
  let alternativeScarcity = 100;
  if (altState.alternativeAvailability === 'ALTERNATIVES_AVAILABLE') alternativeScarcity = 20;
  else if (altState.alternativeAvailability === 'LIMITED_ALTERNATIVES') alternativeScarcity = 60;
  
  const constraintPressure = clamp(
    (0.45 * slotScarcity) +
    (0.35 * criticalNeedPressure) +
    (0.20 * alternativeScarcity)
  );

  const constraintContext: GlobalConstraintContext = {
    slotScarcity,
    criticalNeedPressure,
    alternativeScarcity,
    constraintPressure
  };
  
  const overallConstraintLevel = getConstraintLevel(constraintPressure);

  // 2. CANDIDATE EVALUATION
  const allRoles: RoleKey[] = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
  const options: BotSquadTradeoffOption[] = [];

  for (const role of allRoles) {
    const roleGap = gapState.roles[role];
    const rolePrio = priorityState.roles[role];
    
    // Skip evaluating paths that are fundamentally redundant and unwanted
    if (roleGap.need === 'REDUNDANT' && rolePrio.priorityLevel === 'NONE') {
      continue;
    }

    const gapResolution = getGapResolutionBasis(roleGap.need);
    
    // SQUAD BALANCE & COMPLETION
    const squadBalanceImpact = gapResolution === 0 ? 0 : clamp((gapResolution * 0.7) + ((100 - qualityState.roleBalance) * 0.3));
    const completionImpact = gapResolution === 0 ? 0 : clamp((gapResolution * 0.6) + ((100 - qualityState.squadCompleteness) * 0.4));
    
    const benefitScore = clamp(
      (0.45 * gapResolution) +
      (0.30 * squadBalanceImpact) +
      (0.25 * completionImpact)
    );

    // SACRIFICE
    const opportunityCost = clamp((0.40 * slotScarcity) + (0.30 * criticalNeedPressure) + (0.30 * (100 - gapResolution)));
    
    const resolvedCriticals = roleGap.need === 'CRITICAL' ? 1 : 0;
    const unresolvedCriticals = Math.max(0, totalCriticalGaps - resolvedCriticals);
    const unresolvedNeedExposure = clamp((unresolvedCriticals / 4) * 100);
    
    const flexibilityLoss = clamp((0.40 * slotScarcity) + (0.40 * unresolvedNeedExposure) + (0.20 * alternativeScarcity));
    
    const sacrificeScore = clamp(
      (0.45 * opportunityCost) +
      (0.35 * unresolvedNeedExposure) +
      (0.20 * flexibilityLoss)
    );

    // FLEXIBILITY
    // If we acquire the primary target, we still have the squad's alternatives.
    // If we acquire an alternative, we deviate from the primary plan.
    let futureFlexibility = 0;
    let alternativePathValue = 0;
    
    if (role === altState.primaryRole) {
      futureFlexibility = clamp(altState.alternatives.length * 50); // 0, 50, or 100
      alternativePathValue = altState.alternatives.reduce((sum, a) => sum + a.alternativeScore, 0) / Math.max(1, altState.alternatives.length);
    } else {
      // By choosing a fallback or unrelated role, we lock in a pivot path and lose general flexibility
      futureFlexibility = 20; 
      alternativePathValue = 10;
    }
    
    const flexibilityScore = clamp((0.60 * futureFlexibility) + (0.40 * alternativePathValue));

    const targetLockRisk = clamp((100 - futureFlexibility) * 0.8 + (slotScarcity * 0.2));
    
    const sacrificeRisk = clamp((0.70 * sacrificeScore) + (0.30 * targetLockRisk));

    // CONSTRAINT SCALING
    const constraintMultiplier = 0.75 + (constraintPressure / 100) * 0.75;
    const adjustedSacrifice = clamp(sacrificeRisk * constraintMultiplier);

    // EFFICIENCY
    const structuralGain = clamp((0.50 * gapResolution) + (0.30 * squadBalanceImpact) + (0.20 * completionImpact));
    const constraintCost = clamp((0.40 * slotScarcity) + (0.35 * unresolvedNeedExposure) + (0.25 * flexibilityLoss));
    
    // Normalization: gain / cost. 
    // If gain = cost, ratio = 1.0 -> 50 rawEfficiency.
    const ratio = structuralGain / Math.max(1, constraintCost);
    const acquisitionEfficiency = clamp(ratio * 50);

    // FINAL SCORE
    const tradeoffScore = clamp(
      (0.60 * benefitScore) +
      (0.20 * flexibilityScore) -
      (0.20 * adjustedSacrifice)
    );

    options.push({
      role,
      gapResolution,
      squadBalanceImpact,
      completionImpact,
      opportunityCost,
      unresolvedNeedExposure,
      flexibilityLoss,
      futureFlexibility,
      alternativePathValue,
      targetLockRisk,
      benefitScore,
      sacrificeScore,
      sacrificeRisk,
      flexibilityScore,
      constraintPressure,
      adjustedSacrifice,
      acquisitionEfficiency,
      tradeoffScore,
      rationale: '' // placeholder
    });
  }

  // Inject rationale after calculating all fields
  const populatedOptions = options.map(opt => ({
    ...opt,
    rationale: generateRationale(opt)
  }));

  populatedOptions.sort(compareOptions);

  const primaryOption = populatedOptions.length > 0 ? (populatedOptions[0] || null) : null;
  const alternativeOptions = populatedOptions.length > 1 ? populatedOptions.slice(1) : [];
  const tradeoffOrder = populatedOptions.map(o => o.role);

  return {
    teamId: squadState.teamId,
    remainingSlots,
    constraintContext,
    primaryOption,
    alternativeOptions,
    tradeoffOrder,
    overallConstraintLevel
  };
}
