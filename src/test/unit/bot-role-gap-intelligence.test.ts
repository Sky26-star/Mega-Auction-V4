import { describe, it, expect } from 'vitest';
import { buildBotRoleGapState } from '../../lib/auction/bot-role-gap-intelligence';
import { type BotSquadState } from '../../lib/auction/bot-squad-intelligence';
import { type RoleNeed } from '../../lib/auction/server-bot-engine';

// ============================================================
// HELPERS
// ============================================================

function makeSquadState(
  overrides: Partial<BotSquadState> = {},
  roleNeedsOverrides: Partial<BotSquadState['roleNeeds']> = {},
  roleCompositionOverrides: Partial<BotSquadState['roleComposition']> = {}
): BotSquadState {
  return {
    teamId: 'bot-1',
    squadSize: 10,
    remainingSlots: 15,
    purseRemaining: 5000,
    amountSpent: 5000,
    spentRatio: 0.5,
    overseasCount: 2,
    overseasSlotsRemaining: 6,
    roleComposition: {
      BATSMAN: 3,
      BOWLER: 4,
      ALL_ROUNDER: 2,
      WICKET_KEEPER: 1,
      ...roleCompositionOverrides,
    },
    roleNeeds: {
      BATSMAN: 'NORMAL',
      BOWLER: 'NORMAL',
      ALL_ROUNDER: 'NORMAL',
      WICKET_KEEPER: 'NORMAL',
      ...roleNeedsOverrides,
    },
    ...overrides,
  };
}

// ============================================================
// TESTS
// ============================================================

describe('Bot Role Gap Intelligence - buildBotRoleGapState', () => {
  it('TEST 1 — EMPTY SQUAD', () => {
    const squadState = makeSquadState(
      { squadSize: 0, remainingSlots: 25 },
      { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' },
      { BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 }
    );

    const gapState = buildBotRoleGapState(squadState);

    expect(gapState.totalGapRoles).toBe(4);
    expect(gapState.criticalGapRoles).toBe(4);
    
    // All roles should be critical gaps
    const roles = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'] as const;
    for (const role of roles) {
      expect(gapState.roles[role].isGap).toBe(true);
      expect(gapState.roles[role].isCritical).toBe(true);
      expect(gapState.roles[role].gapLevel).toBe('CRITICAL');
      expect(gapState.roles[role].currentCount).toBe(0);
    }
  });

  it('TEST 2 — CRITICAL ROLE', () => {
    const squadState = makeSquadState({}, { BATSMAN: 'CRITICAL' }, { BATSMAN: 1 });
    const gapState = buildBotRoleGapState(squadState);

    expect(gapState.roles.BATSMAN.isGap).toBe(true);
    expect(gapState.roles.BATSMAN.isCritical).toBe(true);
    expect(gapState.roles.BATSMAN.gapLevel).toBe('CRITICAL');
  });

  it('TEST 3 — HIGH ROLE', () => {
    const squadState = makeSquadState({}, { BOWLER: 'HIGH' }, { BOWLER: 2 });
    const gapState = buildBotRoleGapState(squadState);

    expect(gapState.roles.BOWLER.isGap).toBe(true);
    expect(gapState.roles.BOWLER.isCritical).toBe(false);
    expect(gapState.roles.BOWLER.gapLevel).toBe('HIGH');
  });

  it('TEST 4 — NORMAL ROLE', () => {
    const squadState = makeSquadState({}, { ALL_ROUNDER: 'NORMAL' }, { ALL_ROUNDER: 3 });
    const gapState = buildBotRoleGapState(squadState);

    expect(gapState.roles.ALL_ROUNDER.isGap).toBe(false);
    expect(gapState.roles.ALL_ROUNDER.isCritical).toBe(false);
    expect(gapState.roles.ALL_ROUNDER.gapLevel).toBe('NORMAL');
  });

  it('TEST 5 — LOW ROLE', () => {
    const squadState = makeSquadState({}, { WICKET_KEEPER: 'LOW' }, { WICKET_KEEPER: 2 });
    const gapState = buildBotRoleGapState(squadState);

    expect(gapState.roles.WICKET_KEEPER.isGap).toBe(false);
    expect(gapState.roles.WICKET_KEEPER.isCritical).toBe(false);
    expect(gapState.roles.WICKET_KEEPER.gapLevel).toBe('LOW');
  });

  it('TEST 6 — REDUNDANT ROLE', () => {
    const squadState = makeSquadState({}, { BATSMAN: 'REDUNDANT' }, { BATSMAN: 8 });
    const gapState = buildBotRoleGapState(squadState);

    expect(gapState.roles.BATSMAN.isGap).toBe(false);
    expect(gapState.roles.BATSMAN.isCritical).toBe(false);
    expect(gapState.roles.BATSMAN.gapLevel).toBe('REDUNDANT');
  });

  it('TEST 7 — CURRENT COUNTS', () => {
    const squadState = makeSquadState(
      {},
      {},
      { BATSMAN: 4, BOWLER: 5, ALL_ROUNDER: 2, WICKET_KEEPER: 1 }
    );
    const gapState = buildBotRoleGapState(squadState);

    expect(gapState.roles.BATSMAN.currentCount).toBe(4);
    expect(gapState.roles.BOWLER.currentCount).toBe(5);
    expect(gapState.roles.ALL_ROUNDER.currentCount).toBe(2);
    expect(gapState.roles.WICKET_KEEPER.currentCount).toBe(1);
  });

  it('TEST 8 — ALL FOUR ROLES', () => {
    const gapState = buildBotRoleGapState(makeSquadState());
    
    expect(Object.keys(gapState.roles).sort()).toEqual(
      ['ALL_ROUNDER', 'BATSMAN', 'BOWLER', 'WICKET_KEEPER']
    );
  });

  it('TEST 9 — TOTAL GAP ROLES', () => {
    const squadState = makeSquadState(
      {},
      { BATSMAN: 'HIGH', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'LOW' }
    );
    const gapState = buildBotRoleGapState(squadState);

    // BATSMAN (HIGH) and BOWLER (CRITICAL) are gaps
    expect(gapState.totalGapRoles).toBe(2);
  });

  it('TEST 10 — CRITICAL GAP COUNT', () => {
    const squadState = makeSquadState(
      {},
      { BATSMAN: 'HIGH', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'NORMAL' }
    );
    const gapState = buildBotRoleGapState(squadState);

    // Only BOWLER and ALL_ROUNDER are critical
    expect(gapState.criticalGapRoles).toBe(2);
  });

  it('TEST 11 — DETERMINISM', () => {
    const squadState = makeSquadState();
    
    const state1 = buildBotRoleGapState(squadState);
    const state2 = buildBotRoleGapState(squadState);
    
    expect(state1).toEqual(state2);
  });

  it('TEST 12 — IMMUTABILITY', () => {
    const squadState = makeSquadState();
    const squadStateCopy = JSON.parse(JSON.stringify(squadState));
    
    buildBotRoleGapState(squadState);
    
    expect(squadState).toEqual(squadStateCopy);
  });

  it('TEST 13 — NO QUALITY LOGIC', () => {
    const gapState = buildBotRoleGapState(makeSquadState());
    
    // @ts-expect-error - testing for existence of unauthorized properties
    expect(gapState.squadQuality).toBeUndefined();
    // @ts-expect-error
    expect(gapState.roles.BATSMAN.quality).toBeUndefined();
  });

  it('TEST 14 — NO STRATEGIC SIDE EFFECTS', () => {
    // We can't strictly test that NO external work was done, but we can verify
    // the output strictly conforms to the interface and has no extra fields
    const gapState = buildBotRoleGapState(makeSquadState());
    
    expect(Object.keys(gapState).sort()).toEqual(
      ['criticalGapRoles', 'roles', 'teamId', 'totalGapRoles']
    );
    
    expect(Object.keys(gapState.roles.BATSMAN).sort()).toEqual(
      ['currentCount', 'gapLevel', 'isCritical', 'isGap', 'need']
    );
  });
});
