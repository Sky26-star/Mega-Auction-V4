import { describe, it, expect } from 'vitest';
import { buildBotSquadAlternativeState } from '../../lib/auction/bot-squad-alternative-intelligence';
import { type BotSquadState } from '../../lib/auction/bot-squad-intelligence';
import { type BotRoleGapState } from '../../lib/auction/bot-role-gap-intelligence';
import { type BotSquadQualityState } from '../../lib/auction/bot-squad-quality-intelligence';
import { type BotSquadPriorityState, type PriorityLevel, type RoleKey } from '../../lib/auction/bot-squad-priority-intelligence';
import { type BotSquadTargetState, type RoleTargetProfile } from '../../lib/auction/bot-squad-target-intelligence';
import { type RoleNeed } from '../../lib/auction/server-bot-engine';

// ============================================================
// HELPERS
// ============================================================

function makeMocks(
  primaryRole: RoleKey | null,
  roleNeeds: Record<RoleKey, RoleNeed>,
  roleCounts: Record<RoleKey, number>,
  priorityScores: Record<RoleKey, number>,
  targetScores: Record<RoleKey, number>,
  targetUrgency: number = 80
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
    gapRoles[role] = {
      currentCount: roleCounts[role],
      need: roleNeeds[role],
      gapLevel: roleNeeds[role],
      isGap: roleNeeds[role] === 'CRITICAL' || roleNeeds[role] === 'HIGH',
      isCritical: roleNeeds[role] === 'CRITICAL',
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
    overallQuality: 60,
    qualityLevel: 'BALANCED',
    roleBalance: 60,
    overseasBalance: 100,
    squadCompleteness: 60,
    roleCoverage: {} as any,
    gapRoleCount: gapState.totalGapRoles,
    criticalRoleCount: gapState.criticalGapRoles,
  };

  const priorityRoles: any = {};
  for (const role of Object.keys(priorityScores) as Array<RoleKey>) {
    priorityRoles[role] = {
      role,
      priorityScore: priorityScores[role],
      priorityLevel: 'MEDIUM',
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
    overallPriorityLevel: 'MEDIUM',
    primaryPriorityRole: primaryRole,
    secondaryPriorityRole: null,
    roles: priorityRoles,
    priorityOrder: ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'],
    squadQualityContext: { overallQuality: 60, qualityLevel: 'BALANCED', squadCompleteness: 60 }
  };

  const targetRoles: any = {};
  for (const role of Object.keys(targetScores) as Array<RoleKey>) {
    targetRoles[role] = {
      role,
      targetPriority: 'MEDIUM',
      targetScore: targetScores[role],
      targetUrgency: role === primaryRole ? targetUrgency : targetUrgency / 2,
      currentCount: roleCounts[role],
      roleNeed: roleNeeds[role],
      gapLevel: roleNeeds[role],
      isPrimaryTarget: role === primaryRole,
      isSecondaryTarget: false,
      rationale: 'mock target',
    };
  }
  const targetState: BotSquadTargetState = {
    teamId: 'bot-1',
    primaryTarget: primaryRole ? targetRoles[primaryRole] : null,
    secondaryTarget: null,
    roles: targetRoles,
    targetOrder: ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'],
  };

  return { squadState, gapState, qualityState, priorityState, targetState };
}

// ============================================================
// TESTS
// ============================================================

describe('Bot Squad Alternative Intelligence - buildBotSquadAlternativeState', () => {
  
  it('TEST 1 & 18 — BASIC PRIMARY TARGET FROM 2E', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'BOWLER',
      { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 3, BOWLER: 0, ALL_ROUNDER: 1, WICKET_KEEPER: 1 },
      { BATSMAN: 50, BOWLER: 95, ALL_ROUNDER: 80, WICKET_KEEPER: 50 },
      { BATSMAN: 50, BOWLER: 95, ALL_ROUNDER: 80, WICKET_KEEPER: 50 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    expect(altState.primaryRole).toBe('BOWLER');
  });

  it('TEST 2 — EMPTY SQUAD', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'BATSMAN', // canonical primary for empty squad
      { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 },
      { BATSMAN: 100, BOWLER: 100, ALL_ROUNDER: 100, WICKET_KEEPER: 100 },
      { BATSMAN: 100, BOWLER: 100, ALL_ROUNDER: 100, WICKET_KEEPER: 100 },
      100
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    expect(altState.primaryRole).toBe('BATSMAN');
    expect(altState.alternatives.length).toBeGreaterThan(0);
    expect(altState.fallbackOrder.includes('ALL_ROUNDER')).toBe(true);
  });

  it('TEST 3 & 8 — FULLY COVERED SQUAD / NO MEANINGFUL ALTERNATIVE', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      null,
      { BATSMAN: 'REDUNDANT', BOWLER: 'REDUNDANT', ALL_ROUNDER: 'REDUNDANT', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 6, BOWLER: 6, ALL_ROUNDER: 4, WICKET_KEEPER: 2 },
      { BATSMAN: 10, BOWLER: 10, ALL_ROUNDER: 10, WICKET_KEEPER: 10 },
      { BATSMAN: 10, BOWLER: 10, ALL_ROUNDER: 10, WICKET_KEEPER: 10 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    expect(altState.primaryRole).toBeNull();
    expect(altState.alternatives).toHaveLength(0);
    expect(altState.alternativeAvailability).toBe('NO_MEANINGFUL_ALTERNATIVE');
  });

  it('TEST 4 — CRITICAL BOWLER -> ALL_ROUNDER ALTERNATIVE', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'BOWLER',
      { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 3, BOWLER: 0, ALL_ROUNDER: 1, WICKET_KEEPER: 1 },
      { BATSMAN: 50, BOWLER: 95, ALL_ROUNDER: 80, WICKET_KEEPER: 50 },
      { BATSMAN: 50, BOWLER: 95, ALL_ROUNDER: 80, WICKET_KEEPER: 50 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    const arFallback = altState.alternatives.find(a => a.role === 'ALL_ROUNDER');
    expect(arFallback).toBeDefined();
    expect(arFallback?.alternativeType).toBe('PARTIAL');
  });

  it('TEST 5 — CRITICAL BATSMAN -> ALL_ROUNDER ALTERNATIVE', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'BATSMAN',
      { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 0, BOWLER: 3, ALL_ROUNDER: 2, WICKET_KEEPER: 1 },
      { BATSMAN: 95, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 50 },
      { BATSMAN: 95, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 50 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    expect(altState.fallbackOrder.includes('ALL_ROUNDER')).toBe(true);
    const alt = altState.alternatives.find(a => a.role === 'ALL_ROUNDER');
    expect(alt?.alternativeType).toBe('PARTIAL');
  });

  it('TEST 6 — WICKETKEEPER SUBSTITUTION BOUNDARIES', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'WICKET_KEEPER',
      { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 3, BOWLER: 3, ALL_ROUNDER: 2, WICKET_KEEPER: 0 },
      { BATSMAN: 50, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 95 },
      { BATSMAN: 50, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 95 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    // WicketKeeper only has a weak BATSMAN substitute
    expect(altState.alternatives).toHaveLength(1);
    expect(altState.alternatives[0]?.role).toBe('BATSMAN');
    expect(altState.alternatives[0]?.alternativeType).toBe('WEAK');
  });

  it('TEST 7 — ALL-ROUNDER PARTIAL ALTERNATIVES', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'ALL_ROUNDER',
      { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 3, BOWLER: 3, ALL_ROUNDER: 0, WICKET_KEEPER: 1 },
      { BATSMAN: 50, BOWLER: 50, ALL_ROUNDER: 95, WICKET_KEEPER: 50 },
      { BATSMAN: 50, BOWLER: 50, ALL_ROUNDER: 95, WICKET_KEEPER: 50 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    // All rounder fallback is BATSMAN/BOWLER (WEAK)
    expect(altState.alternatives.length).toBe(2);
    expect(altState.alternatives[0]?.alternativeType).toBe('WEAK');
  });

  it('TEST 10 — MAXIMUM TWO FALLBACK PATHS', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'ALL_ROUNDER',
      { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 1, BOWLER: 1, ALL_ROUNDER: 0, WICKET_KEEPER: 1 },
      { BATSMAN: 80, BOWLER: 80, ALL_ROUNDER: 95, WICKET_KEEPER: 50 },
      { BATSMAN: 80, BOWLER: 80, ALL_ROUNDER: 95, WICKET_KEEPER: 50 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    expect(altState.alternatives.length).toBeLessThanOrEqual(2);
  });

  it('TEST 11 & 12 — ALTERNATIVE ORDERING & DETERMINISTIC TIE BREAKING', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'ALL_ROUNDER',
      { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 1, BOWLER: 1, ALL_ROUNDER: 0, WICKET_KEEPER: 1 }, // identical counts
      { BATSMAN: 80, BOWLER: 80, ALL_ROUNDER: 95, WICKET_KEEPER: 50 }, // identical scores
      { BATSMAN: 80, BOWLER: 80, ALL_ROUNDER: 95, WICKET_KEEPER: 50 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    
    // Batsman and Bowler are both WEAK(40). Both have count 1. Both have score 80.
    // Canonical order breaks tie: BOWLER (3) > BATSMAN (4), wait BATSMAN is 4.
    // Let's check the test: CANONICAL BATSMAN: 4, BOWLER: 3 -> Batsman comes first.
    expect(altState.fallbackOrder).toEqual(['BATSMAN', 'BOWLER']);
  });

  it('TEST 13 & 14 & 15 & 20 — SCORE BOUNDS & INVALID INPUTS', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'BATSMAN',
      { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 0, BOWLER: 3, ALL_ROUNDER: 2, WICKET_KEEPER: 1 },
      { BATSMAN: 95, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 50 },
      { BATSMAN: 95, BOWLER: 50, ALL_ROUNDER: NaN, WICKET_KEEPER: Infinity } // NaN/Infinity injection
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    
    for (const alt of altState.alternatives) {
      expect(alt.alternativeScore).toBeGreaterThanOrEqual(0);
      expect(alt.alternativeScore).toBeLessThanOrEqual(100);
      expect(alt.alternativeUrgency).toBeGreaterThanOrEqual(0);
      expect(alt.alternativeUrgency).toBeLessThanOrEqual(100);
      expect(alt.compatibilityScore).toBeGreaterThanOrEqual(0);
      expect(alt.compatibilityScore).toBeLessThanOrEqual(100);
      expect(Number.isFinite(alt.alternativeScore)).toBe(true);
    }
  });

  it('TEST 16 & 17 — DEPENDENCY & AVAILABILITY CLASSIFICATION', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'WICKET_KEEPER',
      { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 3, BOWLER: 3, ALL_ROUNDER: 2, WICKET_KEEPER: 0 },
      { BATSMAN: 10, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 95 }, // BATSMAN redundant
      { BATSMAN: 10, BOWLER: 50, ALL_ROUNDER: 50, WICKET_KEEPER: 95 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    
    // Wicketkeeper -> Batsman is WEAK(30). Score = (30 * 0.5) + (10 * 0.5) = 20.
    // Max score is 20, which is < 40. Therefore HIGH_DEPENDENCY.
    expect(altState.targetDependency).toBe('HIGH_DEPENDENCY');
    expect(altState.alternativeAvailability).toBe('LIMITED_ALTERNATIVES'); // count = 1
  });

  it('TEST 21 — DETERMINISTIC RATIONALE', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'BOWLER',
      { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 3, BOWLER: 0, ALL_ROUNDER: 1, WICKET_KEEPER: 1 },
      { BATSMAN: 50, BOWLER: 95, ALL_ROUNDER: 80, WICKET_KEEPER: 50 },
      { BATSMAN: 50, BOWLER: 95, ALL_ROUNDER: 80, WICKET_KEEPER: 50 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    const ar = altState.alternatives.find(a => a.role === 'ALL_ROUNDER')!;
    expect(ar.rationale).toContain('partial structural coverage');
  });

  it('TEST 22 & 23 — IMMUTABILITY & DETERMINISM', () => {
    const mocks = makeMocks(
      'BATSMAN',
      { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 0, BOWLER: 3, ALL_ROUNDER: 1, WICKET_KEEPER: 1 },
      { BATSMAN: 95, BOWLER: 50, ALL_ROUNDER: 80, WICKET_KEEPER: 50 },
      { BATSMAN: 95, BOWLER: 50, ALL_ROUNDER: 80, WICKET_KEEPER: 50 }
    );
    const sCopy = JSON.parse(JSON.stringify(mocks.squadState));
    const pCopy = JSON.parse(JSON.stringify(mocks.priorityState));
    
    const run1 = buildBotSquadAlternativeState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState);
    const run2 = buildBotSquadAlternativeState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState);
    
    expect(run1).toEqual(run2);
    expect(mocks.squadState).toEqual(sCopy);
    expect(mocks.priorityState).toEqual(pCopy);
  });

  it('TEST 26 — EXACT FOUR ROLE SUPPORT', () => {
    const { squadState, gapState, qualityState, priorityState, targetState } = makeMocks(
      'BATSMAN',
      { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 },
      { BATSMAN: 100, BOWLER: 100, ALL_ROUNDER: 100, WICKET_KEEPER: 100 },
      { BATSMAN: 100, BOWLER: 100, ALL_ROUNDER: 100, WICKET_KEEPER: 100 }
    );
    const altState = buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState);
    // Since max 2 fallback paths allowed:
    expect(altState.alternatives.length).toBeLessThanOrEqual(2);
    
    // Check that we only ever see valid keys
    const validKeys = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
    for (const alt of altState.alternatives) {
      expect(validKeys.includes(alt.role)).toBe(true);
    }
  });
});
