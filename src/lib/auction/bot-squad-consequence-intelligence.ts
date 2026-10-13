// src/lib/auction/bot-squad-consequence-intelligence.ts
//
// Phase 2H: Squad Acquisition Consequence Intelligence
//
// "If I hypothetically acquire a player of role X, what does my squad
//  look like afterwards?"
//
// This layer constructs a SYNTHETIC PROJECTED BotSquadState by
// hypothetically adding one player of a given role, then feeds that
// projected state through the EXISTING 2B–2F pure functions to produce
// a full projected intelligence snapshot. It then synthesizes a
// consequence score representing the structural impact.
//
// THIS MODULE IS STANDALONE.
// It does NOT modify any existing auction behaviour.
// It does NOT integrate into the live auction tick.
// It does NOT make bidding decisions.
// It does NOT access the database or network.
// It does NOT duplicate any 2A–2F algorithm.

import { type BotSquadState, type RoleComposition, type RoleNeeds } from './bot-squad-intelligence';
import { buildBotRoleGapState, type BotRoleGapState } from './bot-role-gap-intelligence';
import { buildBotSquadQualityState, type BotSquadQualityState } from './bot-squad-quality-intelligence';
import { buildBotSquadPriorityState, type BotSquadPriorityState, type RoleKey } from './bot-squad-priority-intelligence';
import { buildBotSquadTargetState, type BotSquadTargetState } from './bot-squad-target-intelligence';
import { buildBotSquadAlternativeState, type BotSquadAlternativeState } from './bot-squad-alternative-intelligence';
import { type BotSquadTradeoffState } from './bot-squad-tradeoff-intelligence';
import { getRoleNeed, type RoleNeed } from './server-bot-engine';

// ============================================================
// TYPES
// ============================================================

export interface ProjectedSnapshot {
  readonly projectedSquadState: BotSquadState;
  readonly projectedGapState: BotRoleGapState;
  readonly projectedQualityState: BotSquadQualityState;
  readonly projectedPriorityState: BotSquadPriorityState;
  readonly projectedTargetState: BotSquadTargetState;
  readonly projectedAlternativeState: BotSquadAlternativeState;
}

export interface ConsequenceOption {
  readonly role: RoleKey;

  // Projected raw metrics (derived from existing 2B-2F functions)
  readonly projectedSquadQuality: number;
  readonly projectedCompletion: number;
  readonly projectedFlexibility: number;
  readonly priorityStability: number;
  readonly projectedCriticalGaps: number;
  readonly projectedConstraintPressure: number;

  // Synthesized scores
  readonly consequenceScore: number;
  readonly criticalPenalty: number;
  readonly finalConsequenceScore: number;

  // 2G trade-off context (consumed for explainability only)
  readonly priorTradeoffScore: number;

  readonly rationale: string;
}

export interface BotSquadConsequenceState {
  readonly teamId: string;
  readonly currentCriticalGaps: number;
  readonly options: readonly ConsequenceOption[];
  readonly consequenceOrder: readonly RoleKey[];
  readonly bestOption: ConsequenceOption | null;
}

// ============================================================
// NAMED IMMUTABLE WEIGHT CONFIGURATION
// ============================================================

/**
 * CONSEQUENCE_WEIGHTS: Named immutable synthesis weights for the
 * consequence score formula.
 *
 * Sum MUST equal 1.0. This is validated by tests.
 *
 * These weights are extracted as a named configuration to:
 * - make future tuning explicit and auditable
 * - enable deterministic A/B experimentation
 * - prevent magic numbers inside the formula
 */
export const CONSEQUENCE_WEIGHTS = {
  projectedSquadQuality: 0.35,
  projectedCompletion: 0.30,
  projectedFlexibility: 0.20,
  priorityStability: 0.15,
} as const;

// ============================================================
// SEVERITY WEIGHTS (URGENT GAPS ONLY)
// ============================================================

/**
 * URGENT_SEVERITY_WEIGHT: Local immutable mapping for urgent gap severity.
 *
 * Phase 2B classifies role gaps as CRITICAL > HIGH > NORMAL > LOW > REDUNDANT.
 * Priority stability measures reduction in URGENT structural pressure only.
 * Therefore only CRITICAL and HIGH gaps contribute to the severity sum.
 * NORMAL, LOW, and REDUNDANT gaps contribute 0.
 *
 * This does NOT duplicate 2B's gap detection algorithm. It only assigns
 * weights to the RoleNeed values that 2B already produces.
 */
const URGENT_SEVERITY_WEIGHT: Record<RoleNeed, number> = {
  CRITICAL: 4,
  HIGH: 3,
  NORMAL: 0,
  LOW: 0,
  REDUNDANT: 0,
};

// ============================================================
// CONSEQUENCE PENALTIES
// ============================================================

/**
 * CONSEQUENCE_PENALTIES: Named immutable penalty configuration.
 *
 * criticalGap: 15 — initial tunable structural penalty per projected
 * critical gap. This is intentionally separate from CONSEQUENCE_WEIGHTS.
 * It is NOT a player valuation, bid penalty, or market penalty.
 * It is a structural squad-health penalty applied after the
 * consequence score synthesis.
 */
export const CONSEQUENCE_PENALTIES = {
  criticalGap: 15,
} as const;

// ============================================================
// FLEXIBILITY WEIGHTS
// ============================================================

/**
 * FLEXIBILITY_WEIGHTS: Named immutable weights for the projected
 * flexibility formula.
 *
 * Projected flexibility accounts for three structural dimensions:
 * - slotFlexibility: how many squad slots remain for future acquisitions
 * - urgentGapFlexibility: how few urgent gaps remain (fewer = more flexible)
 * - alternativeFlexibility: how many meaningful alternative paths exist
 *
 * Sum MUST equal 1.0.
 */
export const FLEXIBILITY_WEIGHTS = {
  slotFlexibility: 0.35,
  urgentGapFlexibility: 0.30,
  alternativeFlexibility: 0.35,
} as const;

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

const ALL_ROLES: readonly RoleKey[] = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];

// ============================================================
// SYNTHETIC PROJECTED STATE CONSTRUCTION
// ============================================================

/**
 * Construct a synthetic projected BotSquadState by hypothetically
 * adding one player of the given role to the current squad.
 *
 * This does NOT call buildBotSquadState(). It constructs the state
 * directly from the current BotSquadState, modifying only the
 * role-relevant fields.
 *
 * Financial fields (purse, spent, overseas) are carried forward
 * unchanged because Phase 2H evaluates structural role-level
 * consequences, not player-level financial consequences.
 */
function buildProjectedSquadState(
  current: BotSquadState,
  acquiredRole: RoleKey
): BotSquadState {
  const projectedSquadSize = current.squadSize + 1;
  const maxSquadSize = current.squadSize + current.remainingSlots;
  const projectedRemainingSlots = Math.max(0, current.remainingSlots - 1);

  // Increment the acquired role count by 1
  const projectedComposition: RoleComposition = {
    BATSMAN: current.roleComposition.BATSMAN + (acquiredRole === 'BATSMAN' ? 1 : 0),
    BOWLER: current.roleComposition.BOWLER + (acquiredRole === 'BOWLER' ? 1 : 0),
    ALL_ROUNDER: current.roleComposition.ALL_ROUNDER + (acquiredRole === 'ALL_ROUNDER' ? 1 : 0),
    WICKET_KEEPER: current.roleComposition.WICKET_KEEPER + (acquiredRole === 'WICKET_KEEPER' ? 1 : 0),
  };

  // Recompute roleNeeds using the EXISTING exported getRoleNeed()
  const projectedNeeds: RoleNeeds = {
    BATSMAN: getRoleNeed('BATSMAN', projectedComposition.BATSMAN, projectedRemainingSlots, maxSquadSize).need,
    BOWLER: getRoleNeed('BOWLER', projectedComposition.BOWLER, projectedRemainingSlots, maxSquadSize).need,
    ALL_ROUNDER: getRoleNeed('ALL_ROUNDER', projectedComposition.ALL_ROUNDER, projectedRemainingSlots, maxSquadSize).need,
    WICKET_KEEPER: getRoleNeed('WICKET_KEEPER', projectedComposition.WICKET_KEEPER, projectedRemainingSlots, maxSquadSize).need,
  };

  return {
    teamId: current.teamId,
    squadSize: projectedSquadSize,
    remainingSlots: projectedRemainingSlots,
    purseRemaining: current.purseRemaining,
    amountSpent: current.amountSpent,
    spentRatio: current.spentRatio,
    overseasCount: current.overseasCount,
    overseasSlotsRemaining: current.overseasSlotsRemaining,
    roleComposition: projectedComposition,
    roleNeeds: projectedNeeds,
  };
}

/**
 * Run the projected BotSquadState through the EXISTING 2B–2F pipeline.
 * Zero algorithm duplication — calls the actual locked pure functions.
 */
function buildProjectedSnapshot(
  projectedSquadState: BotSquadState
): ProjectedSnapshot {
  const projectedGapState = buildBotRoleGapState(projectedSquadState);
  const projectedQualityState = buildBotSquadQualityState(projectedSquadState);
  const projectedPriorityState = buildBotSquadPriorityState(
    projectedSquadState, projectedGapState, projectedQualityState
  );
  const projectedTargetState = buildBotSquadTargetState(
    projectedSquadState, projectedGapState, projectedQualityState, projectedPriorityState
  );
  const projectedAlternativeState = buildBotSquadAlternativeState(
    projectedSquadState, projectedGapState, projectedQualityState, projectedPriorityState, projectedTargetState
  );

  return {
    projectedSquadState,
    projectedGapState,
    projectedQualityState,
    projectedPriorityState,
    projectedTargetState,
    projectedAlternativeState,
  };
}

// ============================================================
// PRIORITY STABILITY
// ============================================================

/**
 * Compute priority stability using the explicit urgent-severity-weight formula.
 *
 * Only CRITICAL and HIGH gaps contribute to the urgent severity sum.
 * NORMAL, LOW, and REDUNDANT gaps contribute 0.
 *
 * urgentSeverityBefore = sum of URGENT_SEVERITY_WEIGHT for current gaps
 *                        where need is CRITICAL or HIGH
 * urgentSeverityRemaining = sum of URGENT_SEVERITY_WEIGHT for projected gaps
 *                           where need is CRITICAL or HIGH
 *
 * priorityStability = 100 - (urgentSeverityRemaining / max(1, urgentSeverityBefore) * 100)
 *
 * Edge case: if urgentSeverityBefore = 0, there was no urgent pressure
 * to stabilize, so stability is maximal (100).
 */
function computePriorityStability(
  currentGapState: BotRoleGapState,
  projectedGapState: BotRoleGapState
): number {
  let urgentSeverityBefore = 0;
  let urgentSeverityRemaining = 0;

  for (const role of ALL_ROLES) {
    urgentSeverityBefore += URGENT_SEVERITY_WEIGHT[currentGapState.roles[role].need];
    urgentSeverityRemaining += URGENT_SEVERITY_WEIGHT[projectedGapState.roles[role].need];
  }

  // Edge case: no urgent severity to stabilize → maximal stability
  if (urgentSeverityBefore === 0) {
    return 100;
  }

  return clamp(100 - (urgentSeverityRemaining / Math.max(1, urgentSeverityBefore) * 100));
}

// ============================================================
// PROJECTED FLEXIBILITY
// ============================================================

/**
 * Projected flexibility measures the POST-ACQUISITION structural
 * freedom of the squad.
 *
 * It accounts for three dimensions:
 * - slotFlexibility: how many squad slots remain (more slots = more flexible)
 * - urgentGapFlexibility: how few urgent gaps remain (fewer = more flexible)
 * - alternativeFlexibility: how many meaningful alternative paths exist
 *
 * Uses the EXISTING 2F alternative state output.
 * Does NOT recreate compatibility logic.
 */
function computeProjectedFlexibility(
  projectedSquadState: BotSquadState,
  projectedGapState: BotRoleGapState,
  projectedAltState: BotSquadAlternativeState
): number {
  // 1. Slot flexibility: more remaining slots = more flexible
  const maxSquadSize = Math.max(1, projectedSquadState.squadSize + projectedSquadState.remainingSlots);
  const slotFlexibility = clamp((projectedSquadState.remainingSlots / maxSquadSize) * 100);

  // 2. Urgent gap flexibility: fewer urgent gaps = more flexible (max 4 roles)
  const urgentGaps = projectedGapState.criticalGapRoles + (projectedGapState.totalGapRoles - projectedGapState.criticalGapRoles);
  const urgentGapFlexibility = clamp(100 - (urgentGaps / 4) * 100);

  // 3. Alternative flexibility: from existing 2F output
  let alternativeFlexibility = 20;
  if (projectedAltState.alternativeAvailability === 'ALTERNATIVES_AVAILABLE') alternativeFlexibility = 80;
  else if (projectedAltState.alternativeAvailability === 'LIMITED_ALTERNATIVES') alternativeFlexibility = 50;

  return clamp(
    FLEXIBILITY_WEIGHTS.slotFlexibility * slotFlexibility +
    FLEXIBILITY_WEIGHTS.urgentGapFlexibility * urgentGapFlexibility +
    FLEXIBILITY_WEIGHTS.alternativeFlexibility * alternativeFlexibility
  );
}

// ============================================================
// PROJECTED CONSTRAINT PRESSURE
// ============================================================

/**
 * Projected constraint pressure measures how constrained the franchise
 * becomes after this hypothetical acquisition.
 *
 * Uses projected 2B critical gap count and projected 2F alternative state.
 * Slot scarcity uses the projected remaining slots.
 */
function computeProjectedConstraintPressure(
  projectedSquadState: BotSquadState,
  projectedGapState: BotRoleGapState,
  projectedAltState: BotSquadAlternativeState
): number {
  const maxSquadSize = projectedSquadState.squadSize + projectedSquadState.remainingSlots;
  const initialSlots = Math.max(1, maxSquadSize);
  const slotScarcity = clamp(100 * (1 - projectedSquadState.remainingSlots / initialSlots));
  const criticalPressure = clamp((projectedGapState.criticalGapRoles / 4) * 100);

  let altScarcity = 100;
  if (projectedAltState.alternativeAvailability === 'ALTERNATIVES_AVAILABLE') altScarcity = 20;
  else if (projectedAltState.alternativeAvailability === 'LIMITED_ALTERNATIVES') altScarcity = 60;

  return clamp((0.45 * slotScarcity) + (0.35 * criticalPressure) + (0.20 * altScarcity));
}

// ============================================================
// RATIONALE GENERATION
// ============================================================

/**
 * Generate a deterministic rationale string.
 *
 * The 2G tradeoffScore is consumed HERE for explainability:
 * it contextualizes the consequence relative to the prior trade-off
 * assessment. This is the ONLY place 2G data enters Phase 2H.
 */
function generateConsequenceRationale(
  role: RoleKey,
  finalScore: number,
  priorTradeoffScore: number,
  projectedCriticalGaps: number,
  priorityStability: number
): string {
  // Consequence vs prior trade-off comparison
  const tradeoffComparison =
    finalScore >= priorTradeoffScore + 10
      ? 'Projected consequence exceeds the prior trade-off expectation.'
      : finalScore <= priorTradeoffScore - 10
        ? 'Projected consequence falls below the prior trade-off expectation.'
        : 'Projected consequence is consistent with the prior trade-off assessment.';

  if (projectedCriticalGaps > 0 && priorityStability < 40) {
    return `Acquiring ${role} leaves ${projectedCriticalGaps} critical gap(s) unresolved with low priority stability. ${tradeoffComparison}`;
  }

  if (finalScore >= 70) {
    return `Acquiring ${role} produces a strong projected squad state. ${tradeoffComparison}`;
  }

  if (finalScore >= 40) {
    return `Acquiring ${role} produces a moderate projected improvement. ${tradeoffComparison}`;
  }

  return `Acquiring ${role} provides limited structural improvement. ${tradeoffComparison}`;
}

// ============================================================
// COMPARATOR
// ============================================================

function compareConsequenceOptions(a: ConsequenceOption, b: ConsequenceOption): number {
  if (a.finalConsequenceScore !== b.finalConsequenceScore) return b.finalConsequenceScore - a.finalConsequenceScore;
  if (a.consequenceScore !== b.consequenceScore) return b.consequenceScore - a.consequenceScore;
  if (a.projectedCriticalGaps !== b.projectedCriticalGaps) return a.projectedCriticalGaps - b.projectedCriticalGaps;
  if (a.priorityStability !== b.priorityStability) return b.priorityStability - a.priorityStability;
  return CANONICAL_ORDER[b.role] - CANONICAL_ORDER[a.role];
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Build a BotSquadConsequenceState by projecting each candidate role
 * acquisition through the existing 2B–2F pipeline.
 *
 * - Synchronous
 * - Deterministic (same input → same output)
 * - Pure (no side effects)
 * - Does NOT mutate any input
 * - Does NOT access the database or network
 * - Does NOT make bidding decisions
 * - Does NOT duplicate any 2A–2F algorithm
 * - Does NOT add 2G tradeoffScore to consequenceScore
 *
 * @param squadState    - Current 2A squad state
 * @param gapState      - Current 2B role gap state
 * @param tradeoffState - Current 2G trade-off state (consumed for rationale only)
 */
export function buildBotSquadConsequenceState(
  squadState: BotSquadState,
  gapState: BotRoleGapState,
  tradeoffState: BotSquadTradeoffState
): BotSquadConsequenceState {

  const currentCriticalGaps = gapState.criticalGapRoles;
  const options: ConsequenceOption[] = [];

  for (const role of ALL_ROLES) {
    // 1. Build synthetic projected BotSquadState
    const projectedSquadState = buildProjectedSquadState(squadState, role);

    // 2. Feed through existing 2B–2F pipeline (zero algorithm duplication)
    const snapshot = buildProjectedSnapshot(projectedSquadState);

    // 3. Extract projected metrics from existing function outputs
    const projectedSquadQuality = snapshot.projectedQualityState.overallQuality;
    const projectedCompletion = snapshot.projectedQualityState.squadCompleteness;
    const projectedFlexibility = computeProjectedFlexibility(
      snapshot.projectedSquadState, snapshot.projectedGapState, snapshot.projectedAlternativeState
    );
    const priorityStability = computePriorityStability(gapState, snapshot.projectedGapState);
    const projectedCriticalGaps = snapshot.projectedGapState.criticalGapRoles;
    const projectedConstraintPressure = computeProjectedConstraintPressure(
      snapshot.projectedSquadState, snapshot.projectedGapState, snapshot.projectedAlternativeState
    );

    // 4. Consequence score synthesis using named weights
    const consequenceScore = clamp(
      CONSEQUENCE_WEIGHTS.projectedSquadQuality * projectedSquadQuality +
      CONSEQUENCE_WEIGHTS.projectedCompletion * projectedCompletion +
      CONSEQUENCE_WEIGHTS.projectedFlexibility * projectedFlexibility +
      CONSEQUENCE_WEIGHTS.priorityStability * priorityStability
    );

    // 5. Critical penalty using named configuration
    const criticalPenalty = projectedCriticalGaps * CONSEQUENCE_PENALTIES.criticalGap;
    const finalConsequenceScore = clamp(consequenceScore - criticalPenalty);

    // 6. 2G trade-off context for explainability ONLY
    const tradeoffOption = tradeoffState.tradeoffOrder.includes(role)
      ? (tradeoffState.primaryOption?.role === role
          ? tradeoffState.primaryOption
          : tradeoffState.alternativeOptions.find(o => o.role === role))
      : null;
    const priorTradeoffScore = tradeoffOption?.tradeoffScore ?? 0;

    // 7. Rationale
    const rationale = generateConsequenceRationale(
      role, finalConsequenceScore, priorTradeoffScore, projectedCriticalGaps, priorityStability
    );

    options.push({
      role,
      projectedSquadQuality,
      projectedCompletion,
      projectedFlexibility,
      priorityStability,
      projectedCriticalGaps,
      projectedConstraintPressure,
      consequenceScore,
      criticalPenalty,
      finalConsequenceScore,
      priorTradeoffScore,
      rationale,
    });
  }

  // Deterministic sort
  options.sort(compareConsequenceOptions);

  const bestOption = options.length > 0 ? (options[0] || null) : null;
  const consequenceOrder = options.map(o => o.role);

  return {
    teamId: squadState.teamId,
    currentCriticalGaps,
    options,
    consequenceOrder,
    bestOption,
  };
}
