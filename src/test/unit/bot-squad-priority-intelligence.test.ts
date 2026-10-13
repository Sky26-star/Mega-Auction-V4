import { describe, it, expect } from 'vitest';
import { buildBotSquadPriorityState, type PriorityLevel } from '../../lib/auction/bot-squad-priority-intelligence';
import { type BotSquadState } from '../../lib/auction/bot-squad-intelligence';
import { type BotRoleGapState } from '../../lib/auction/bot-role-gap-intelligence';
import { type BotSquadQualityState } from '../../lib/auction/bot-squad-quality-intelligence';
import { type RoleNeed } from '../../lib/auction/server-bot-engine';

// ============================================================
// HELPERS
// ============================================================

function makeMocks(
  roleNeeds: Record<'BATSMAN'|'BOWLER'|'ALL_ROUNDER'|'WICKET_KEEPER', RoleNeed>,
  roleCounts: Record<'BATSMAN'|'BOWLER'|'ALL_ROUNDER'|'WICKET_KEEPER', number>,
  overallQuality: number = 60
) {
  const squadState: BotSquadState = {
    teamId: 'bot-1',
    squadSize: 10,
    remainingSlots: 15,
    purseRemaining: 5000,
    amountSpent: 5000,
    spentRatio: 0.5,
    overseasCount: 2,
    overseasSlotsRemaining: 6,
    roleComposition: roleCounts,
    roleNeeds,
  };

  const gapRoles: any = {};
  for (const role of Object.keys(roleNeeds) as Array<keyof typeof roleNeeds>) {
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
    squadSize: 10,
    overallQuality,
    qualityLevel: 'BALANCED',
    roleBalance: 60,
    overseasBalance: 100,
    squadCompleteness: 60,
    roleCoverage: {} as any,
    gapRoleCount: gapState.totalGapRoles,
    criticalRoleCount: gapState.criticalGapRoles,
  };

  return { squadState, gapState, qualityState };
}

// ============================================================
// TESTS
// ============================================================

describe('Bot Squad Priority Intelligence - buildBotSquadPriorityState', () => {
  it('TEST 1 & 10 & 23 — EMPTY SQUAD / MULTIPLE CRITICAL', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 },
      15 // CRITICAL quality
    );

    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    expect(priorityState.overallPriorityLevel).toBe('CRITICAL');
    
    // All should be CRITICAL, and a CRITICAL gap must never be LOW/NONE
    const roles = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'] as const;
    for (const r of roles) {
      expect(priorityState.roles[r].priorityLevel).toBe('CRITICAL');
      expect(priorityState.roles[r].priorityScore).toBeGreaterThanOrEqual(90);
      expect(priorityState.roles[r].priorityScore).toBeLessThanOrEqual(100);
      expect(priorityState.roles[r].gapLevel).toBe('CRITICAL');
    }

    expect(priorityState.primaryPriorityRole).not.toBeNull();
  });

  it('TEST 2 & 19 & 20 — FOUR ROLE OUTPUT & NO DUPLICATES', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'NORMAL', BOWLER: 'HIGH', ALL_ROUNDER: 'LOW', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 3, BOWLER: 2, ALL_ROUNDER: 3, WICKET_KEEPER: 2 }
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    expect(priorityState.priorityOrder).toHaveLength(4);
    expect(new Set(priorityState.priorityOrder).size).toBe(4);
    
    // Check specific roles are present
    expect(priorityState.priorityOrder.includes('BATSMAN')).toBe(true);
    expect(priorityState.priorityOrder.includes('BOWLER')).toBe(true);
    expect(priorityState.priorityOrder.includes('ALL_ROUNDER')).toBe(true);
    expect(priorityState.priorityOrder.includes('WICKET_KEEPER')).toBe(true);
  });

  it('TEST 3, 4, 5, 6 — HIERARCHY', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'NORMAL', BOWLER: 'HIGH', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 3, BOWLER: 2, ALL_ROUNDER: 1, WICKET_KEEPER: 3 }
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    // ALL_ROUNDER(CRITICAL) > BOWLER(HIGH) > BATSMAN(NORMAL) > WICKET_KEEPER(REDUNDANT)
    expect(priorityState.priorityOrder).toEqual([
      'ALL_ROUNDER', 'BOWLER', 'BATSMAN', 'WICKET_KEEPER'
    ]);
  });

  it('TEST 7 & 8 — PRIMARY AND SECONDARY PRIORITY SELECTION', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 3, BOWLER: 0, ALL_ROUNDER: 1, WICKET_KEEPER: 3 }
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    expect(priorityState.primaryPriorityRole).toBe('BOWLER');
    expect(priorityState.secondaryPriorityRole).toBe('ALL_ROUNDER');
    expect(priorityState.overallPriorityLevel).toBe('CRITICAL');
  });

  it('TEST 9 & 12 — NO MEANINGFUL SECONDARY PRIORITY / NO GAPS', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'LOW', BOWLER: 'REDUNDANT', ALL_ROUNDER: 'REDUNDANT', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 5, BOWLER: 5, ALL_ROUNDER: 3, WICKET_KEEPER: 2 },
      90 // STRONG quality
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    expect(priorityState.primaryPriorityRole).toBe('BATSMAN'); // It's LOW, which is not NONE
    expect(priorityState.secondaryPriorityRole).toBeNull(); // Redundant is NONE -> null
    expect(priorityState.overallPriorityLevel).toBe('LOW');
  });

  it('TEST 11 — MULTIPLE HIGH ROLES', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 2, BOWLER: 2, ALL_ROUNDER: 3, WICKET_KEEPER: 2 }
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    expect(priorityState.primaryPriorityRole).not.toBeNull();
    // One of them is primary, the other secondary
    const [first, second] = priorityState.priorityOrder;
    expect([first, second].includes('BATSMAN')).toBe(true);
    expect([first, second].includes('BOWLER')).toBe(true);
  });

  it('TEST 13 & 14 — BALANCED / PARTIAL SQUAD', () => {
    // Normal squad with no critical/high gaps
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
      { BATSMAN: 3, BOWLER: 3, ALL_ROUNDER: 3, WICKET_KEEPER: 1 },
      70
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    // All NORMAL -> MEDIUM priority
    expect(priorityState.overallPriorityLevel).toBe('MEDIUM');
    expect(priorityState.secondaryPriorityRole).not.toBeNull();
  });

  it('TEST 15 & 25 — SCORE BOUNDED 0-100 / NO NaN', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'CRITICAL', BOWLER: 'HIGH', ALL_ROUNDER: 'LOW', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 },
      10 // Low quality boosts critical/high scores slightly
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    for (const role of ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'] as const) {
      const score = priorityState.roles[role].priorityScore;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isNaN(score)).toBe(false);
      expect(Number.isFinite(score)).toBe(true);
    }
    
    // BATSMAN is CRITICAL, base 95. Quality < 40 boosts by 5 -> 100.
    expect(priorityState.roles.BATSMAN.priorityScore).toBe(100);
  });

  it('TEST 16 — QUALITY CONTEXT PRESERVED', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 },
      25
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    expect(priorityState.squadQualityContext.overallQuality).toBe(25);
    expect(priorityState.squadQualityContext.qualityLevel).toBe('BALANCED');
    expect(priorityState.squadQualityContext.squadCompleteness).toBe(60);
  });

  it('TEST 17 — DETERMINISTIC TIE-BREAKING', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'HIGH' },
      { BATSMAN: 2, BOWLER: 2, ALL_ROUNDER: 2, WICKET_KEEPER: 2 } // identical gaps, identical counts
    );
    const state1 = buildBotSquadPriorityState(squadState, gapState, qualityState);
    const state2 = buildBotSquadPriorityState(squadState, gapState, qualityState);

    // Canonical order: BATSMAN > BOWLER > ALL_ROUNDER > WICKET_KEEPER
    expect(state1.priorityOrder).toEqual(['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER']);
    expect(state1.priorityOrder).toEqual(state2.priorityOrder);
  });

  it('TEST 18 & 24 — INPUT IMMUTABILITY & DETERMINISM', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'NORMAL', BOWLER: 'HIGH', ALL_ROUNDER: 'LOW', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 3, BOWLER: 2, ALL_ROUNDER: 3, WICKET_KEEPER: 2 }
    );
    
    const sCopy = JSON.parse(JSON.stringify(squadState));
    const gCopy = JSON.parse(JSON.stringify(gapState));
    const qCopy = JSON.parse(JSON.stringify(qualityState));
    
    buildBotSquadPriorityState(squadState, gapState, qualityState);
    
    expect(squadState).toEqual(sCopy);
    expect(gapState).toEqual(gCopy);
    expect(qualityState).toEqual(qCopy);
  });

  it('TEST 21 — OVERALL PRIORITY LEVEL', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'REDUNDANT', BOWLER: 'REDUNDANT', ALL_ROUNDER: 'REDUNDANT', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 5, BOWLER: 5, ALL_ROUNDER: 3, WICKET_KEEPER: 2 }
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    expect(priorityState.overallPriorityLevel).toBe('NONE');
    expect(priorityState.primaryPriorityRole).toBeNull();
  });

  it('TEST 22 — EXPLAINABLE REASONS', () => {
    const { squadState, gapState, qualityState } = makeMocks(
      { BATSMAN: 'CRITICAL', BOWLER: 'HIGH', ALL_ROUNDER: 'LOW', WICKET_KEEPER: 'REDUNDANT' },
      { BATSMAN: 0, BOWLER: 1, ALL_ROUNDER: 3, WICKET_KEEPER: 2 }
    );
    const priorityState = buildBotSquadPriorityState(squadState, gapState, qualityState);

    expect(typeof priorityState.roles.BATSMAN.reason).toBe('string');
    expect(priorityState.roles.BATSMAN.reason.length).toBeGreaterThan(10);
    expect((priorityState.roles as any).REDUNDANT?.reason).toBeUndefined(); // Key is the role
    expect(priorityState.roles.WICKET_KEEPER.reason).toContain('No priority');
  });
});
