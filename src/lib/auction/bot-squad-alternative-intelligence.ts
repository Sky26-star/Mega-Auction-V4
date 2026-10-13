// src/lib/auction/bot-squad-alternative-intelligence.ts
//
// Phase 2F: Bot Squad Alternative Intelligence
//
// "If my preferred target does not work out, what are my next viable alternatives?"
//
// This layer is standalone, pure, deterministic, and side-effect free.
// It explicitly identifies ALTERNATIVE TARGET PATHS, not actual players.
// It does NOT value players, make bidding decisions, or integrate with the engine.

import { type BotSquadState } from './bot-squad-intelligence';
import { type BotRoleGapState } from './bot-role-gap-intelligence';
import { type BotSquadQualityState } from './bot-squad-quality-intelligence';
import { type BotSquadPriorityState, type PriorityLevel, type RoleKey } from './bot-squad-priority-intelligence';
import { type BotSquadTargetState, type RoleTargetProfile } from './bot-squad-target-intelligence';
import { type RoleNeed } from './server-bot-engine';

// ============================================================
// TYPES
// ============================================================

export type AlternativeType = 'DIRECT' | 'PARTIAL' | 'WEAK' | 'NONE';

export type AlternativeAvailability = 'ALTERNATIVES_AVAILABLE' | 'LIMITED_ALTERNATIVES' | 'NO_MEANINGFUL_ALTERNATIVE';

export type TargetDependency = 'HIGH_DEPENDENCY' | 'LOW_DEPENDENCY';

export interface RoleAlternativeProfile {
  readonly role: RoleKey;
  readonly alternativeType: AlternativeType;
  readonly alternativeScore: number;
  readonly alternativeUrgency: number;
  readonly compatibilityScore: number;
  readonly currentCount: number;
  readonly roleNeed: RoleNeed;
  readonly gapLevel: RoleNeed;
  readonly rationale: string;
}

export interface BotSquadAlternativeState {
  readonly teamId: string;
  readonly primaryRole: RoleKey | null;
  readonly alternativeAvailability: AlternativeAvailability;
  readonly targetDependency: TargetDependency;
  readonly alternatives: readonly RoleAlternativeProfile[];
  readonly fallbackOrder: readonly RoleKey[];
}

// ============================================================
// COMPATIBILITY MODEL
// ============================================================

interface Compatibility {
  readonly type: AlternativeType;
  readonly score: number;
}

function getCompatibility(primary: RoleKey, fallback: RoleKey): Compatibility {
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

const CANONICAL_ORDER: Record<RoleKey, number> = {
  BATSMAN: 4,
  BOWLER: 3,
  ALL_ROUNDER: 2,
  WICKET_KEEPER: 1,
};

function clamp(val: number): number {
  if (Number.isNaN(val) || !Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(100, Math.round(val)));
}

function generateRationale(fallbackRole: RoleKey, type: AlternativeType, primaryRole: RoleKey): string {
  switch (type) {
    case 'DIRECT':
      return `Direct substitute available for ${primaryRole}.`;
    case 'PARTIAL':
      return `All-rounder provides partial structural coverage for the ${primaryRole} gap.`;
    case 'WEAK':
      return `Batting/Bowling alternative exists but does not fully replace the ${primaryRole} requirement.`;
    case 'NONE':
      return `No meaningful structural alternative exists for this requirement.`;
  }
}

function compareAlternatives(a: RoleAlternativeProfile, b: RoleAlternativeProfile, primaryPriorityState: BotSquadPriorityState): number {
  // 1. alternativeScore DESC
  if (a.alternativeScore !== b.alternativeScore) {
    return b.alternativeScore - a.alternativeScore;
  }
  // 2. compatibility strength DESC
  if (a.compatibilityScore !== b.compatibilityScore) {
    return b.compatibilityScore - a.compatibilityScore;
  }
  // 3. role priority score DESC
  const prioA = primaryPriorityState.roles[a.role].priorityScore;
  const prioB = primaryPriorityState.roles[b.role].priorityScore;
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

export function buildBotSquadAlternativeState(
  squadState: BotSquadState,
  gapState: BotRoleGapState,
  qualityState: BotSquadQualityState,
  priorityState: BotSquadPriorityState,
  targetState: BotSquadTargetState
): BotSquadAlternativeState {

  const primaryTarget = targetState.primaryTarget;
  
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

  const primaryRole = primaryTarget.role;
  const roleKeys: RoleKey[] = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
  const possibleAlternatives: RoleAlternativeProfile[] = [];

  for (const fallback of roleKeys) {
    if (fallback === primaryRole) continue;

    const compat = getCompatibility(primaryRole, fallback);
    if (compat.type === 'NONE') continue;

    const fallbackTargetProfile = targetState.roles[fallback];
    const fallbackGap = gapState.roles[fallback];

    // Alternative Score = 50% structural compatibility + 50% structural value of the fallback role itself.
    // If the squad also needs an ALL_ROUNDER, using one to cover a BATSMAN gap is highly efficient.
    // If ALL_ROUNDER is REDUNDANT, score drops significantly.
    const alternativeScore = clamp((compat.score * 0.5) + (fallbackTargetProfile.targetScore * 0.5));

    // Urgency is derived primarily from how urgent the PRIMARY target is, 
    // bounded by how compatible the fallback is.
    // A weak alternative cannot carry 100 urgency even if the primary is frantic.
    const urgencyCeiling = compat.score;
    const computedUrgency = primaryTarget.targetUrgency * (compat.score / 100);
    const alternativeUrgency = clamp(Math.min(computedUrgency, urgencyCeiling));

    possibleAlternatives.push({
      role: fallback,
      alternativeType: compat.type,
      alternativeScore,
      alternativeUrgency,
      compatibilityScore: compat.score,
      currentCount: fallbackGap.currentCount,
      roleNeed: fallbackGap.need,
      gapLevel: fallbackGap.gapLevel,
      rationale: generateRationale(fallback, compat.type, primaryRole),
    });
  }

  // Sort deterministically
  possibleAlternatives.sort((a, b) => compareAlternatives(a, b, priorityState));
  
  // Enforce fallback depth limit (max 2)
  const finalAlternatives = possibleAlternatives.slice(0, 2);
  const fallbackOrder = finalAlternatives.map(a => a.role);

  // Dependency logic:
  // If no alternatives scored > 40, the squad is highly dependent on securing the primary target.
  const hasStrongAlternative = finalAlternatives.some(a => a.alternativeScore >= 40);
  const targetDependency: TargetDependency = hasStrongAlternative ? 'LOW_DEPENDENCY' : 'HIGH_DEPENDENCY';

  let availability: AlternativeAvailability = 'NO_MEANINGFUL_ALTERNATIVE';
  if (finalAlternatives.length >= 2) availability = 'ALTERNATIVES_AVAILABLE';
  else if (finalAlternatives.length === 1) availability = 'LIMITED_ALTERNATIVES';

  return {
    teamId: squadState.teamId,
    primaryRole,
    alternativeAvailability: availability,
    targetDependency,
    alternatives: finalAlternatives,
    fallbackOrder,
  };
}
