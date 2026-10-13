import { describe, it, expect } from 'vitest';
import { buildBotSquadTargetState } from '../../lib/auction/bot-squad-target-intelligence';
import { type BotSquadState } from '../../lib/auction/bot-squad-intelligence';
import { type BotRoleGapState } from '../../lib/auction/bot-role-gap-intelligence';
import { type BotSquadQualityState } from '../../lib/auction/bot-squad-quality-intelligence';
import { type BotSquadPriorityState, type PriorityLevel, type RoleKey } from '../../lib/auction/bot-squad-priority-intelligence';
import { type RoleNeed } from '../../lib/auction/server-bot-engine';

// ============================================================
// HELPERS
// ============================================================

function makeMocks(
  roleNeeds: Record<RoleKey, RoleNeed>,
  roleCounts: Record<RoleKey, number>,
  priorityLevels: Record<RoleKey, PriorityLevel>,
  priorityScores: Record<RoleKey, number>,
  overallQuality: number = 60,
  primaryRole: RoleKey | null = null,
  secondaryRole: RoleKey | null = null
) {
  const squadState: BotSquadState = {
    teamId: 'bot-1',
    squadSize: Object.values(roleCounts).reduce((a, b) => a + b, 0),
    remainingSlots: 25 - Object.values(roleCounts).reduce((a, b) => a + b, 0),
    purseRemaining: 5000,
    amountSpent: 5000,
    spentRatio: 0.5,
    overseasCount: 2,
    overseasSlotsRemaining: 6,
    roleComposition: roleCounts,
    roleNeeds,
  };

  const gapRoles: any = {};
  for (const role of Object.keys(roleNeeds) as Array<RoleKey>) {
    const need = roleNeeds[role];
    gapRoles[role] = {
      currentCount: roleCounts[role],
      need,
      gapLevel: need,
      isGap: need === 'CRITICAL' || need === 'HIGH',
      isCritical: need === 'CRITICAL',
    };
  }

  const gapState: BotRoleGapState = {
    teamId: 'bot-1',
    totalGapRoles: Object.values(gapRoles).filter((g: any) => g.isGap).length,
    criticalGapRoles: Object.values(gapRoles).filter((g: any) => g.isCritical).length,
    roles: gapRoles,
  };

  const qualityState: BotSquadQualityState = {
    teamId: 'bot-1',
    squadSize: squadState.squadSize,
    overallQuality,
    qualityLevel: 'BALANCED',
    roleBalance: 60,
    overseasBalance: 100,
    squadCompleteness: 60,
    roleCoverage: {} as any,
    gapRoleCount: gapState.totalGapRoles,
    criticalRoleCount: gapState.criticalGapRoles,
  };

  const priorityRoles: any = {};
  for (const role of Object.keys(priorityLevels) as Array<RoleKey>) {
    priorityRoles[role] = {
      role,
      priorityScore: priorityScores[role],
      priorityLevel: priorityLevels[role],
      reason: 'mock',
      gapLevel: roleNeeds[role],
      isGap: gapRoles[role].isGap,
      isCritical: gapRoles[role].isCritical,
      currentCount: roleCounts[role],
      need: roleNeeds[role],
    };
  }

  const priorityState: BotSquadPriorityState = {
    teamId: 'bot-1',
    overallPriorityLevel: primaryRole ? priorityLevels[primaryRole] : 'NONE',
    primaryPriorityRole: primaryRole,
    secondaryPriorityRole: secondaryRole,
    roles: priorityRoles,
    priorityOrder: ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'], // simplified for mocking
    squadQualityContext: {
      overallQuality,
      qualityLevel: 'BALANCED',
      squadCompleteness: 60,
    }
  };

  return { squadState, gapState, qualityState, priorityState };
}

// ============================================================
// TESTS
// ============================================================

describe('Bot Squad Target Intelligence - buildBotSquadTargetState', () => {
  it('TEST 1 & 16 — BASIC BALANCED SQUAD / STRONG SQUAD MINOR GAP', () => {
    const { squadState, gapState, qualityState, priorityState } = makeMocks(
      { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 3, BOWLER: 3, ALL_ROUNDER: 2, WICKET_KEEPER: 1 },
      { BATSMAN: 'MEDIUM', BOWLER: 'MEDIUM', ALL_ROUNDER: 'MEDIUM', WICKET_KEEPER: 'MEDIUM' },
      { BATSMAN: 50, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 50 },
      85, // strong overall quality drops urgency
      'BATSMAN',
      'BOWLER'
    );

    const state = buildBotSquadTargetState(squadState, gapState, qualityState, priorityState);

    expect(state.primaryTarget?.role).toBe('BATSMAN');
    // Strong squad reduces urgency by 15. Base is 50 -> 35
    expect(state.roles.BATSMAN.targetUrgency).toBe(35);
  });

  it('TEST 2 & 5 & 15 — EMPTY SQUAD / MULTIPLE CRITICAL GAPS / WEAK SQUAD', () => {
    const { squadState, gapState, qualityState, priorityState } = makeMocks(
      { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 },
      { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 100, BOWLER: 100, ALL_ROUNDER: 100, WICKET_KEEPER: 100 },
      10, // weak overall quality increases urgency
      'BATSMAN',
      'BOWLER'
    );

    const state = buildBotSquadTargetState(squadState, gapState, qualityState, priorityState);

    // Score is 100, +15 for weak squad, but clamped to 100
    expect(state.roles.BATSMAN.targetUrgency).toBe(100);
    expect(state.roles.BATSMAN.targetScore).toBe(100);
  });

  it('TEST 3 & 9 & 10 & 17 — FULLY COVERED SQUAD / REDUNDANT ROLE SUPPRESSION', () => {
    const { squadState, gapState, qualityState, priorityState } = makeMocks(
      { BATSMAN: 'REDUNDANT', BOWLER: 'REDUNDANT', ALL_ROUNDER: 'REDUNDANT', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 6, BOWLER: 6, ALL_ROUNDER: 4, WICKET_KEEPER: 2 },
      { BATSMAN: 'NONE', BOWLER: 'NONE', ALL_ROUNDER: 'NONE', WICKET_KEEPER: 'NONE' },
      { BATSMAN: 10, BOWLER: 10, ALL_ROUNDER: 10, WICKET_KEEPER: 10 },
      60,
      null,
      null
    );

    const state = buildBotSquadTargetState(squadState, gapState, qualityState, priorityState);

    expect(state.primaryTarget).toBeNull();
    expect(state.secondaryTarget).toBeNull();
    // Redundant role suppression limits urgency to 10 max
    expect(state.roles.BATSMAN.targetUrgency).toBeLessThanOrEqual(10);
  });

  it('TEST 4 & 7 & 8 — SINGLE CRITICAL GAP / PRIMARY SECONDARY MAPPING', () => {
    const { squadState, gapState, qualityState, priorityState } = makeMocks(
      { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 3, BOWLER: 3, ALL_ROUNDER: 2, WICKET_KEEPER: 0 },
      { BATSMAN: 'MEDIUM', BOWLER: 'MEDIUM', ALL_ROUNDER: 'MEDIUM', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 50, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 95 },
      60,
      'WICKET_KEEPER',
      'BATSMAN'
    );

    const state = buildBotSquadTargetState(squadState, gapState, qualityState, priorityState);

    expect(state.primaryTarget?.role).toBe('WICKET_KEEPER');
    expect(state.primaryTarget?.isPrimaryTarget).toBe(true);
    expect(state.secondaryTarget?.role).toBe('BATSMAN');
    expect(state.secondaryTarget?.isSecondaryTarget).toBe(true);
  });

  it('TEST 6 & 11 & 12 — MULTIPLE HIGH GAPS / TARGET ORDERING / TIE-BREAKING', () => {
    const { squadState, gapState, qualityState, priorityState } = makeMocks(
      { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 2, BOWLER: 1, ALL_ROUNDER: 2, WICKET_KEEPER: 1 },
      { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'MEDIUM', WICKET_KEEPER: 'MEDIUM' },
      { BATSMAN: 80, BOWLER: 80, ALL_ROUNDER: 50, WICKET_KEEPER: 50 },
      60,
      'BOWLER',
      'BATSMAN'
    );

    const state = buildBotSquadTargetState(squadState, gapState, qualityState, priorityState);

    // Target ordering: targetScore(80) -> prioritySeverity(HIGH) -> gapSeverity(HIGH) -> currentCount(BOWLER: 1 < BATSMAN: 2) -> BOWLER wins over BATSMAN
    expect(state.targetOrder).toEqual(['BOWLER', 'BATSMAN', 'WICKET_KEEPER', 'ALL_ROUNDER']);
  });

  it('TEST 13 & 14 & 18 — TARGET SCORE BOUNDARIES / INVALID NUMERIC / CLAMPING', () => {
    const { squadState, gapState, qualityState, priorityState } = makeMocks(
      { BATSMAN: 'CRITICAL', BOWLER: 'REDUNDANT', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 0, BOWLER: 10, ALL_ROUNDER: 2, WICKET_KEEPER: 1 },
      { BATSMAN: 'CRITICAL', BOWLER: 'NONE', ALL_ROUNDER: 'MEDIUM', WICKET_KEEPER: 'MEDIUM' },
      { BATSMAN: 150, BOWLER: -20, ALL_ROUNDER: NaN, WICKET_KEEPER: Infinity }, // Malformed input
      60,
      'BATSMAN',
      null
    );

    const state = buildBotSquadTargetState(squadState, gapState, qualityState, priorityState);

    expect(state.roles.BATSMAN.targetScore).toBe(100);
    expect(state.roles.BOWLER.targetScore).toBe(0);
    expect(state.roles.ALL_ROUNDER.targetScore).toBe(0); // NaN clamped to 0
    expect(state.roles.WICKET_KEEPER.targetScore).toBe(100); // Infinity clamped to 100
  });

  it('TEST 19 — EXACT FOUR ROLE OUTPUT', () => {
    const { squadState, gapState, qualityState, priorityState } = makeMocks(
      { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 3, BOWLER: 3, ALL_ROUNDER: 2, WICKET_KEEPER: 1 },
      { BATSMAN: 'MEDIUM', BOWLER: 'MEDIUM', ALL_ROUNDER: 'MEDIUM', WICKET_KEEPER: 'MEDIUM' },
      { BATSMAN: 50, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 50 }
    );

    const state = buildBotSquadTargetState(squadState, gapState, qualityState, priorityState);

    expect(Object.keys(state.roles)).toEqual(['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER']);
    expect(state.targetOrder).toHaveLength(4);
  });

  it('TEST 20 — INPUT IMMUTABILITY', () => {
    const { squadState, gapState, qualityState, priorityState } = makeMocks(
      { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'LOW', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 2, BOWLER: 2, ALL_ROUNDER: 3, WICKET_KEEPER: 2 },
      { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'LOW', WICKET_KEEPER: 'NONE' },
      { BATSMAN: 80, BOWLER: 80, ALL_ROUNDER: 30, WICKET_KEEPER: 10 }
    );

    const sCopy = JSON.parse(JSON.stringify(squadState));
    const pCopy = JSON.parse(JSON.stringify(priorityState));

    buildBotSquadTargetState(squadState, gapState, qualityState, priorityState);

    expect(squadState).toEqual(sCopy);
    expect(priorityState).toEqual(pCopy);
  });

  it('TEST 21 — DETERMINISTIC RATIONALE', () => {
    const { squadState, gapState, qualityState, priorityState } = makeMocks(
      { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'REDUNDANT', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 0, BOWLER: 3, ALL_ROUNDER: 4, WICKET_KEEPER: 1 },
      { BATSMAN: 'CRITICAL', BOWLER: 'MEDIUM', ALL_ROUNDER: 'NONE', WICKET_KEEPER: 'MEDIUM' },
      { BATSMAN: 95, BOWLER: 50, ALL_ROUNDER: 10, WICKET_KEEPER: 50 },
      60,
      'BATSMAN',
      'BOWLER'
    );

    const state = buildBotSquadTargetState(squadState, gapState, qualityState, priorityState);

    expect(state.roles.BATSMAN.rationale).toContain('Primary target');
    expect(state.roles.BOWLER.rationale).toContain('Secondary target');
    expect(state.roles.ALL_ROUNDER.rationale).toContain('redundant');
  });
});
