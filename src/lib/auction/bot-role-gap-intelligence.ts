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

import { type BotSquadState } from './bot-squad-intelligence';
import { type RoleNeed } from './server-bot-engine';

// ============================================================
// TYPES
// ============================================================

/**
 * BotRoleGap: Represents the structural gap for a single role.
 */
export interface BotRoleGap {
  /** The current number of players filling this role, sourced directly from BotSquadState */
  readonly currentCount: number;
  /** The existing, authoritative role need from the BotSquadState */
  readonly need: RoleNeed;
  /** The gap level exactly matches the existing RoleNeed. No new scoring system is invented. */
  readonly gapLevel: RoleNeed;
  /** true if need is CRITICAL or HIGH. false if NORMAL, LOW, or REDUNDANT. */
  readonly isGap: boolean;
  /** true ONLY if need is CRITICAL. */
  readonly isCritical: boolean;
}

/**
 * BotRoleGapState: Represents the strategic gap for all four supported roles.
 */
export interface BotRoleGapState {
  readonly teamId: string;

  /** Number of roles where isGap === true */
  readonly totalGapRoles: number;
  /** Number of roles where isCritical === true */
  readonly criticalGapRoles: number;

  readonly roles: {
    readonly BATSMAN: BotRoleGap;
    readonly BOWLER: BotRoleGap;
    readonly ALL_ROUNDER: BotRoleGap;
    readonly WICKET_KEEPER: BotRoleGap;
  };
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function interpretGap(need: RoleNeed, currentCount: number): BotRoleGap {
  const isGap = need === 'CRITICAL' || need === 'HIGH';
  const isCritical = need === 'CRITICAL';

  return {
    currentCount,
    need,
    gapLevel: need,
    isGap,
    isCritical,
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
export function buildBotRoleGapState(squadState: BotSquadState): BotRoleGapState {
  const roles = {
    BATSMAN: interpretGap(squadState.roleNeeds.BATSMAN, squadState.roleComposition.BATSMAN),
    BOWLER: interpretGap(squadState.roleNeeds.BOWLER, squadState.roleComposition.BOWLER),
    ALL_ROUNDER: interpretGap(squadState.roleNeeds.ALL_ROUNDER, squadState.roleComposition.ALL_ROUNDER),
    WICKET_KEEPER: interpretGap(squadState.roleNeeds.WICKET_KEEPER, squadState.roleComposition.WICKET_KEEPER),
  };

  let totalGapRoles = 0;
  let criticalGapRoles = 0;

  for (const roleKey of Object.keys(roles) as Array<keyof typeof roles>) {
    const gap = roles[roleKey];
    if (gap.isGap) {
      totalGapRoles++;
    }
    if (gap.isCritical) {
      criticalGapRoles++;
    }
  }

  return {
    teamId: squadState.teamId,
    totalGapRoles,
    criticalGapRoles,
    roles,
  };
}
