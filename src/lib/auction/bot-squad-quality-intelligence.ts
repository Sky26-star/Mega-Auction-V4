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

import { type BotSquadState } from './bot-squad-intelligence';
import { type RoleNeed } from './server-bot-engine';

// ============================================================
// TYPES
// ============================================================

export type QualityLevel = 'CRITICAL' | 'WEAK' | 'DEVELOPING' | 'BALANCED' | 'STRONG';
export type CoverageLevel = 'COVERED' | 'PARTIAL' | 'CRITICAL';

export interface RoleCoverage {
  readonly BATSMAN: CoverageLevel;
  readonly BOWLER: CoverageLevel;
  readonly ALL_ROUNDER: CoverageLevel;
  readonly WICKET_KEEPER: CoverageLevel;
}

export interface BotSquadQualityState {
  readonly teamId: string;
  readonly squadSize: number;

  readonly overallQuality: number;
  readonly qualityLevel: QualityLevel;

  readonly roleBalance: number;
  readonly overseasBalance: number;
  readonly squadCompleteness: number;

  readonly roleCoverage: RoleCoverage;
  
  readonly gapRoleCount: number;
  readonly criticalRoleCount: number;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function getCoverageLevel(need: RoleNeed): CoverageLevel {
  if (need === 'CRITICAL') return 'CRITICAL';
  if (need === 'HIGH') return 'PARTIAL';
  return 'COVERED'; // NORMAL, LOW, REDUNDANT
}

function determineQualityLevel(quality: number): QualityLevel {
  if (quality >= 80) return 'STRONG';
  if (quality >= 60) return 'BALANCED';
  if (quality >= 40) return 'DEVELOPING';
  if (quality >= 20) return 'WEAK';
  return 'CRITICAL';
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
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
export function buildBotSquadQualityState(squadState: BotSquadState): BotSquadQualityState {
  // 1. Coverage & Gaps
  let gapRoleCount = 0;
  let criticalRoleCount = 0;
  
  const roleCoverage: RoleCoverage = {
    BATSMAN: getCoverageLevel(squadState.roleNeeds.BATSMAN),
    BOWLER: getCoverageLevel(squadState.roleNeeds.BOWLER),
    ALL_ROUNDER: getCoverageLevel(squadState.roleNeeds.ALL_ROUNDER),
    WICKET_KEEPER: getCoverageLevel(squadState.roleNeeds.WICKET_KEEPER),
  };

  const roles = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'] as const;
  for (const role of roles) {
    const need = squadState.roleNeeds[role];
    if (need === 'CRITICAL' || need === 'HIGH') {
      gapRoleCount++;
    }
    if (need === 'CRITICAL') {
      criticalRoleCount++;
    }
  }

  // 2. Role Balance
  // Base 100. Deduct for gaps. Deduct for over-concentration.
  let roleBalance = 100;
  roleBalance -= criticalRoleCount * 25;
  roleBalance -= (gapRoleCount - criticalRoleCount) * 15;

  if (squadState.squadSize > 0) {
    let maxConcentration = 0;
    for (const role of roles) {
      const ratio = squadState.roleComposition[role] / squadState.squadSize;
      if (ratio > maxConcentration) maxConcentration = ratio;
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
  let overseasBalance = 100;
  const maxOverseas = squadState.overseasCount + squadState.overseasSlotsRemaining;
  
  if (squadState.overseasCount > maxOverseas && maxOverseas > 0) {
    overseasBalance = 0;
  } else if (squadState.overseasSlotsRemaining === 0 && squadState.remainingSlots > 10) {
    // Used all overseas slots but still have >10 players to buy. Flexibility constraint.
    overseasBalance -= 20;
  }
  overseasBalance = clamp(Math.round(overseasBalance), 0, 100);

  // 4. Squad Completeness
  // Not just size. It represents structural coverage.
  // Base 100. Deduct for gaps.
  let squadCompleteness = 100;
  squadCompleteness -= criticalRoleCount * 25;
  squadCompleteness -= (gapRoleCount - criticalRoleCount) * 10;
  squadCompleteness = clamp(Math.round(squadCompleteness), 0, 100);

  // 5. Overall Quality
  // Weighted combination of the structural factors.
  const overallQualityRaw = 
    (roleBalance * 0.50) + 
    (squadCompleteness * 0.35) + 
    (overseasBalance * 0.15);
    
  const overallQuality = clamp(Math.round(overallQualityRaw), 0, 100);
  const qualityLevel = determineQualityLevel(overallQuality);

  return {
    teamId: squadState.teamId,
    squadSize: squadState.squadSize,
    overallQuality,
    qualityLevel,
    roleBalance,
    overseasBalance,
    squadCompleteness,
    roleCoverage,
    gapRoleCount,
    criticalRoleCount,
  };
}
