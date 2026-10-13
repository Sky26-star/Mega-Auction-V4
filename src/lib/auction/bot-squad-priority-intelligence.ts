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

import { type BotSquadState } from './bot-squad-intelligence';
import { type BotRoleGapState } from './bot-role-gap-intelligence';
import { type BotSquadQualityState } from './bot-squad-quality-intelligence';
import { type RoleNeed } from './server-bot-engine';

// ============================================================
// TYPES
// ============================================================

export type PriorityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export type RoleKey = 'BATSMAN' | 'BOWLER' | 'ALL_ROUNDER' | 'WICKET_KEEPER';

export interface BotRolePriority {
  readonly role: RoleKey;
  readonly priorityScore: number;
  readonly priorityLevel: PriorityLevel;
  readonly reason: string;
  readonly gapLevel: RoleNeed;
  readonly isGap: boolean;
  readonly isCritical: boolean;
  readonly currentCount: number;
  readonly need: RoleNeed;
}

export interface BotSquadPriorityState {
  readonly teamId: string;
  readonly overallPriorityLevel: PriorityLevel;
  readonly primaryPriorityRole: RoleKey | null;
  readonly secondaryPriorityRole: RoleKey | null;
  
  readonly roles: {
    readonly BATSMAN: BotRolePriority;
    readonly BOWLER: BotRolePriority;
    readonly ALL_ROUNDER: BotRolePriority;
    readonly WICKET_KEEPER: BotRolePriority;
  };
  
  readonly priorityOrder: readonly RoleKey[];
  
  readonly squadQualityContext: {
    readonly overallQuality: number;
    readonly qualityLevel: string;
    readonly squadCompleteness: number;
  };
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

const CANONICAL_ORDER: Record<RoleKey, number> = {
  BATSMAN: 4,
  BOWLER: 3,
  ALL_ROUNDER: 2,
  WICKET_KEEPER: 1,
};

function getBasePriorityScore(gapLevel: RoleNeed): number {
  switch (gapLevel) {
    case 'CRITICAL': return 95;
    case 'HIGH': return 80;
    case 'NORMAL': return 50;
    case 'LOW': return 30;
    case 'REDUNDANT': return 10;
  }
}

function determinePriorityLevel(score: number): PriorityLevel {
  if (score >= 90) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  if (score >= 20) return 'LOW';
  return 'NONE';
}

function generateReason(role: RoleKey, gapLevel: RoleNeed): string {
  switch (gapLevel) {
    case 'CRITICAL': return `Critical structural need for a ${role}.`;
    case 'HIGH': return `High structural need for a ${role}.`;
    case 'NORMAL': return `Moderate need for depth in ${role}.`;
    case 'LOW': return `Low priority; ${role} role is mostly satisfied.`;
    case 'REDUNDANT': return `No priority; ${role} role is fully saturated.`;
  }
}

function compareRolePriority(a: BotRolePriority, b: BotRolePriority): number {
  // 1. Higher priority score wins
  if (a.priorityScore !== b.priorityScore) {
    return b.priorityScore - a.priorityScore;
  }
  
  // 2. Higher gap severity wins
  const weightA = GAP_LEVEL_WEIGHT[a.gapLevel];
  const weightB = GAP_LEVEL_WEIGHT[b.gapLevel];
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

function clamp(val: number): number {
  if (Number.isNaN(val)) return 0;
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
export function buildBotSquadPriorityState(
  squadState: BotSquadState,
  gapState: BotRoleGapState,
  qualityState: BotSquadQualityState
): BotSquadPriorityState {

  const roleKeys: RoleKey[] = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
  
  const roles: Record<RoleKey, BotRolePriority> = {} as any;
  const roleList: BotRolePriority[] = [];

  for (const role of roleKeys) {
    const gap = gapState.roles[role];
    
    let priorityScore = getBasePriorityScore(gap.gapLevel);
    
    // Minor refinement based on overall squad quality (panic factor)
    // A weak squad slightly elevates the urgency of its significant gaps.
    if (qualityState.overallQuality < 40 && (gap.isCritical || gap.isGap)) {
      priorityScore += 5; 
    }
    
    priorityScore = clamp(priorityScore);
    const priorityLevel = determinePriorityLevel(priorityScore);

    const priorityObj: BotRolePriority = {
      role,
      priorityScore,
      priorityLevel,
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
  
  const priorityOrder = roleList.map(r => r.role) as unknown as readonly RoleKey[];
  
  const primaryRoleObj = roleList[0]!;
  const secondaryRoleObj = roleList[1]!;
  
  // Determine if primary/secondary are meaningful
  const primaryPriorityRole = primaryRoleObj.priorityLevel !== 'NONE' ? primaryRoleObj.role : null;
  const secondaryPriorityRole = 
    (secondaryRoleObj.priorityLevel === 'CRITICAL' || 
     secondaryRoleObj.priorityLevel === 'HIGH' || 
     secondaryRoleObj.priorityLevel === 'MEDIUM') 
    ? secondaryRoleObj.role : null;
    
  const overallPriorityLevel = primaryRoleObj.priorityLevel;

  return {
    teamId: squadState.teamId,
    overallPriorityLevel,
    primaryPriorityRole,
    secondaryPriorityRole,
    roles: roles as unknown as BotSquadPriorityState['roles'],
    priorityOrder,
    squadQualityContext: {
      overallQuality: qualityState.overallQuality,
      qualityLevel: qualityState.qualityLevel,
      squadCompleteness: qualityState.squadCompleteness,
    }
  };
}
