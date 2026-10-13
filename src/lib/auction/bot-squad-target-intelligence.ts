// src/lib/auction/bot-squad-target-intelligence.ts
//
// Phase 2E: Bot Squad Target Intelligence
//
// "Given the bot's current squad condition and priorities, WHAT KIND OF PLAYER SHOULD THIS BOT ACTIVELY TARGET?"
//
// This layer is standalone, pure, deterministic, and side-effect free.
// It explicitly identifies TARGET PROFILES, not actual players.
// It does NOT value players, make bidding decisions, or integrate with the engine.

import { type BotSquadState } from './bot-squad-intelligence';
import { type BotRoleGapState } from './bot-role-gap-intelligence';
import { type BotSquadQualityState } from './bot-squad-quality-intelligence';
import { type BotSquadPriorityState, type PriorityLevel, type RoleKey } from './bot-squad-priority-intelligence';
import { type RoleNeed } from './server-bot-engine';

// ============================================================
// TYPES
// ============================================================

export interface RoleTargetProfile {
  readonly role: RoleKey;
  readonly targetPriority: PriorityLevel;
  readonly targetScore: number;
  readonly targetUrgency: number;
  readonly currentCount: number;
  readonly roleNeed: RoleNeed;
  readonly gapLevel: RoleNeed;
  readonly isPrimaryTarget: boolean;
  readonly isSecondaryTarget: boolean;
  readonly rationale: string;
}

export interface BotSquadTargetState {
  readonly teamId: string;
  readonly primaryTarget: RoleTargetProfile | null;
  readonly secondaryTarget: RoleTargetProfile | null;
  readonly roles: {
    readonly BATSMAN: RoleTargetProfile;
    readonly BOWLER: RoleTargetProfile;
    readonly ALL_ROUNDER: RoleTargetProfile;
    readonly WICKET_KEEPER: RoleTargetProfile;
  };
  readonly targetOrder: readonly RoleKey[];
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

const GAP_LEVEL_WEIGHT: Record<RoleNeed, number> = {
  CRITICAL: 5,
  HIGH: 4,
  NORMAL: 3,
  LOW: 2,
  REDUNDANT: 1,
};

const PRIORITY_LEVEL_WEIGHT: Record<PriorityLevel, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  NONE: 1,
};

const CANONICAL_ORDER: Record<RoleKey, number> = {
  BATSMAN: 4,
  BOWLER: 3,
  ALL_ROUNDER: 2,
  WICKET_KEEPER: 1,
};

function clamp(val: number): number {
  if (Number.isNaN(val)) return 0;
  return Math.max(0, Math.min(100, val));
}

function generateTargetRationale(targetPriority: PriorityLevel, isPrimary: boolean, isSecondary: boolean): string {
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

function compareTargetProfile(a: RoleTargetProfile, b: RoleTargetProfile): number {
  // 1. targetScore descending
  if (a.targetScore !== b.targetScore) {
    return b.targetScore - a.targetScore;
  }

  // 2. Phase 2D priority severity
  const prioA = PRIORITY_LEVEL_WEIGHT[a.targetPriority];
  const prioB = PRIORITY_LEVEL_WEIGHT[b.targetPriority];
  if (prioA !== prioB) {
    return prioB - prioA;
  }

  // 3. role gap severity
  const gapA = GAP_LEVEL_WEIGHT[a.gapLevel];
  const gapB = GAP_LEVEL_WEIGHT[b.gapLevel];
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
export function buildBotSquadTargetState(
  squadState: BotSquadState,
  gapState: BotRoleGapState,
  qualityState: BotSquadQualityState,
  priorityState: BotSquadPriorityState
): BotSquadTargetState {

  const roleKeys: RoleKey[] = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
  
  const roles: Record<RoleKey, RoleTargetProfile> = {} as any;
  const profileList: RoleTargetProfile[] = [];

  for (const role of roleKeys) {
    const gap = gapState.roles[role];
    const priority = priorityState.roles[role];
    
    const isPrimaryTarget = priorityState.primaryPriorityRole === role;
    const isSecondaryTarget = priorityState.secondaryPriorityRole === role;
    
    // Target Score natively derives from Phase 2D priority score
    const targetScore = clamp(priority.priorityScore);
    
    // Target Urgency incorporates the squad's broader quality context
    // Weak squads amplify urgency; strong squads safely diminish urgency
    let baseUrgency = targetScore;
    if (qualityState.overallQuality < 40) {
      baseUrgency += 15;
    } else if (qualityState.overallQuality > 80) {
      baseUrgency -= 15;
    }
    
    // A redundant role should always carry extremely low urgency, irrespective of squad quality padding
    if (gap.gapLevel === 'REDUNDANT') {
      baseUrgency = Math.min(baseUrgency, 10);
    }
    
    const targetUrgency = clamp(baseUrgency);

    const profile: RoleTargetProfile = {
      role,
      targetPriority: priority.priorityLevel,
      targetScore,
      targetUrgency,
      currentCount: gap.currentCount,
      roleNeed: gap.need,
      gapLevel: gap.gapLevel,
      isPrimaryTarget,
      isSecondaryTarget,
      rationale: generateTargetRationale(priority.priorityLevel, isPrimaryTarget, isSecondaryTarget),
    };
    
    roles[role] = profile;
    profileList.push(profile);
  }

  // Deterministically rank the profiles
  profileList.sort(compareTargetProfile);
  
  const targetOrder = profileList.map(p => p.role) as unknown as readonly RoleKey[];
  
  const primaryTarget = priorityState.primaryPriorityRole ? roles[priorityState.primaryPriorityRole] : null;
  const secondaryTarget = priorityState.secondaryPriorityRole ? roles[priorityState.secondaryPriorityRole] : null;

  return {
    teamId: squadState.teamId,
    primaryTarget,
    secondaryTarget,
    roles: roles as unknown as BotSquadTargetState['roles'],
    targetOrder,
  };
}
