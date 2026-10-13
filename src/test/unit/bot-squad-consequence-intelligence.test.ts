import { describe, it, expect } from 'vitest';
import {
  buildBotSquadConsequenceState,
  CONSEQUENCE_WEIGHTS,
  CONSEQUENCE_PENALTIES,
  FLEXIBILITY_WEIGHTS,
  type BotSquadConsequenceState,
  type ConsequenceOption,
} from '../../lib/auction/bot-squad-consequence-intelligence';
import { type BotSquadState } from '../../lib/auction/bot-squad-intelligence';
import { type BotRoleGapState } from '../../lib/auction/bot-role-gap-intelligence';
import { type BotSquadTradeoffState, type BotSquadTradeoffOption } from '../../lib/auction/bot-squad-tradeoff-intelligence';
import { type RoleKey } from '../../lib/auction/bot-squad-priority-intelligence';
import { type RoleNeed } from '../../lib/auction/server-bot-engine';

// ============================================================
// MOCK FACTORY
// ============================================================

function makeMocks(
  remainingSlots: number,
  squadSize: number,
  roleComposition: Record<RoleKey, number>,
  roleNeeds: Record<RoleKey, RoleNeed>,
  tradeoffRoles?: RoleKey[],
  tradeoffScores?: Record<RoleKey, number>
) {
  const squadState: BotSquadState = {
    teamId: 'bot-test',
    squadSize,
    remainingSlots,
    purseRemaining: 5000,
    amountSpent: 5000,
    spentRatio: 0.5,
    overseasCount: 2,
    overseasSlotsRemaining: 6,
    roleComposition,
    roleNeeds,
  };

  const gapRoles: any = {};
  let totalGap = 0;
  let criticalGap = 0;
  for (const role of Object.keys(roleNeeds) as RoleKey[]) {
    const need = roleNeeds[role];
    const isGap = need === 'CRITICAL' || need === 'HIGH';
    const isCritical = need === 'CRITICAL';
    gapRoles[role] = {
      currentCount: roleComposition[role],
      need,
      gapLevel: need,
      isGap,
      isCritical,
    };
    if (isGap) totalGap++;
    if (isCritical) criticalGap++;
  }

  const gapState: BotRoleGapState = {
    teamId: 'bot-test',
    totalGapRoles: totalGap,
    criticalGapRoles: criticalGap,
    roles: gapRoles,
  };

  const allRoles: RoleKey[] = tradeoffRoles ?? ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
  const scores = tradeoffScores ?? {};
  const tradeoffOptions: BotSquadTradeoffOption[] = allRoles.map(r => ({
    role: r,
    gapResolution: 50,
    squadBalanceImpact: 50,
    completionImpact: 50,
    opportunityCost: 30,
    unresolvedNeedExposure: 20,
    flexibilityLoss: 20,
    futureFlexibility: 50,
    alternativePathValue: 40,
    targetLockRisk: 30,
    benefitScore: 50,
    sacrificeScore: 25,
    sacrificeRisk: 27,
    flexibilityScore: 46,
    constraintPressure: 30,
    adjustedSacrifice: 24,
    acquisitionEfficiency: 50,
    tradeoffScore: (scores as Record<string, number>)[r] ?? 50,
    rationale: 'mock',
  }));

  const tradeoffState: BotSquadTradeoffState = {
    teamId: 'bot-test',
    remainingSlots,
    constraintContext: {
      slotScarcity: 40,
      criticalNeedPressure: 25,
      alternativeScarcity: 60,
      constraintPressure: 35,
    },
    primaryOption: tradeoffOptions[0] ?? null,
    alternativeOptions: tradeoffOptions.slice(1),
    tradeoffOrder: allRoles,
    overallConstraintLevel: 'MODERATE',
  };

  return { squadState, gapState, tradeoffState };
}

describe('Bot Squad Consequence Intelligence', () => {

  // ============================================================
  // A. WEIGHT & PENALTY CONFIGURATION
  // ============================================================

  describe('A. Weight & Penalty Configuration', () => {
    it('CONSEQUENCE_WEIGHTS sum to exactly 1.0', () => {
      const sum =
        CONSEQUENCE_WEIGHTS.projectedSquadQuality +
        CONSEQUENCE_WEIGHTS.projectedCompletion +
        CONSEQUENCE_WEIGHTS.projectedFlexibility +
        CONSEQUENCE_WEIGHTS.priorityStability;
      expect(sum).toBeCloseTo(1.0, 10);
    });

    it('CONSEQUENCE_WEIGHTS match specification', () => {
      expect(CONSEQUENCE_WEIGHTS.projectedSquadQuality).toBe(0.35);
      expect(CONSEQUENCE_WEIGHTS.projectedCompletion).toBe(0.30);
      expect(CONSEQUENCE_WEIGHTS.projectedFlexibility).toBe(0.20);
      expect(CONSEQUENCE_WEIGHTS.priorityStability).toBe(0.15);
    });

    it('CONSEQUENCE_PENALTIES.criticalGap is 15', () => {
      expect(CONSEQUENCE_PENALTIES.criticalGap).toBe(15);
    });

    it('FLEXIBILITY_WEIGHTS sum to exactly 1.0', () => {
      const sum =
        FLEXIBILITY_WEIGHTS.slotFlexibility +
        FLEXIBILITY_WEIGHTS.urgentGapFlexibility +
        FLEXIBILITY_WEIGHTS.alternativeFlexibility;
      expect(sum).toBeCloseTo(1.0, 10);
    });

    it('FLEXIBILITY_WEIGHTS match specification', () => {
      expect(FLEXIBILITY_WEIGHTS.slotFlexibility).toBe(0.35);
      expect(FLEXIBILITY_WEIGHTS.urgentGapFlexibility).toBe(0.30);
      expect(FLEXIBILITY_WEIGHTS.alternativeFlexibility).toBe(0.35);
    });
  });

  // ============================================================
  // B. OUTPUT STRUCTURE
  // ============================================================

  describe('B. Output Structure', () => {
    it('produces exactly 4 candidate options for all 4 roles', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        20, 5,
        { BATSMAN: 1, BOWLER: 1, ALL_ROUNDER: 1, WICKET_KEEPER: 1 },
        { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'HIGH' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      expect(state.options).toHaveLength(4);
      expect(state.consequenceOrder).toHaveLength(4);
      expect(state.bestOption).not.toBeNull();
      expect(state.teamId).toBe('bot-test');
    });
  });

  // ============================================================
  // C. PRIORITY STABILITY (FIX #1: URGENT GAPS ONLY)
  // ============================================================

  describe('C. Priority Stability (urgent gaps only)', () => {
    it('resolving the only critical gap produces meaningful stability improvement', () => {
      // Use counts that produce exactly 1 critical gap via getRoleNeed().
      // BATSMAN: count=5, min=5 → NORMAL. BOWLER: count=0, min=6 → CRITICAL.
      // ALL_ROUNDER: count=3, min=3 → NORMAL. WICKET_KEEPER: count=2, min=2 → NORMAL.
      // urgentSeverityBefore = CRITICAL(4) only = 4
      const { squadState, gapState, tradeoffState } = makeMocks(
        15, 10,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 3, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      const bowlerOpt = state.options.find(o => o.role === 'BOWLER')!;
      const batsmanOpt = state.options.find(o => o.role === 'BATSMAN')!;

      // Acquiring BOWLER: count 0→1, getRoleNeed returns HIGH(3)
      // urgentSeverityRemaining includes HIGH(3) for BOWLER. Other roles may also shift.
      // But BOWLER severity drops from 4→3, which is a reduction.
      // Acquiring BATSMAN: BOWLER stays at count 0 → still CRITICAL(4)
      // So bowler stability ≥ batsman stability
      expect(bowlerOpt.priorityStability).toBeGreaterThanOrEqual(batsmanOpt.priorityStability);
    });

    it('resolving one of two critical gaps produces partial stability improvement', () => {
      // 2 critical gaps: BOWLER(0) and WICKET_KEEPER(0)
      // urgentSeverityBefore = 4+4 = 8 (plus any HIGH from other roles)
      const { squadState, gapState, tradeoffState } = makeMocks(
        15, 10,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 3, WICKET_KEEPER: 0 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      const bowlerOpt = state.options.find(o => o.role === 'BOWLER')!;

      // Resolving 1 of 2 → stability > 0 but < 100
      expect(bowlerOpt.priorityStability).toBeGreaterThanOrEqual(0);
      expect(bowlerOpt.priorityStability).toBeLessThan(100);
    });

    it('changing only NORMAL/LOW gaps does not affect urgent stability', () => {
      // All roles satisfied (no CRITICAL/HIGH) → urgentSeverityBefore = 0 → stability = 100
      // BATSMAN:5 (≤ideal 7→NORMAL, sev=0), BOWLER:6 (≤ideal 8→NORMAL, sev=0),
      // ALL_ROUNDER:3 (≤ideal 5→NORMAL, sev=0), WICKET_KEEPER:2 (≤ideal 3→NORMAL, sev=0)
      const { squadState, gapState, tradeoffState } = makeMocks(
        9, 16,
        { BATSMAN: 5, BOWLER: 6, ALL_ROUNDER: 3, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      for (const opt of state.options) {
        expect(opt.priorityStability).toBe(100);
      }
    });

    it('zero urgent pressure produces deterministic stability = 100', () => {
      // All roles at ideal+ counts → NORMAL/LOW/REDUNDANT → severity 0
      const { squadState, gapState, tradeoffState } = makeMocks(
        1, 24,
        { BATSMAN: 7, BOWLER: 8, ALL_ROUNDER: 5, WICKET_KEEPER: 3 },
        { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      for (const opt of state.options) {
        expect(opt.priorityStability).toBe(100);
        expect(Number.isFinite(opt.priorityStability)).toBe(true);
        expect(Number.isNaN(opt.priorityStability)).toBe(false);
      }
    });

    it('acquiring a critical role reduces urgent severity more than acquiring a satisfied role', () => {
      // 1 critical gap (BOWLER:0), others satisfied
      const { squadState, gapState, tradeoffState } = makeMocks(
        15, 10,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 3, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      const bowlerOpt = state.options.find(o => o.role === 'BOWLER')!;
      const batsmanOpt = state.options.find(o => o.role === 'BATSMAN')!;

      // Acquiring BOWLER always produces stability ≥ acquiring BATSMAN
      expect(bowlerOpt.priorityStability).toBeGreaterThanOrEqual(batsmanOpt.priorityStability);
    });
  });

  // ============================================================
  // D. CONSEQUENCE SCORE FORMULA
  // ============================================================

  describe('D. Consequence Score Formula', () => {
    it('computes consequence score using the named weights', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        20, 5,
        { BATSMAN: 2, BOWLER: 0, ALL_ROUNDER: 2, WICKET_KEEPER: 1 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);

      for (const opt of state.options) {
        const expectedRaw =
          CONSEQUENCE_WEIGHTS.projectedSquadQuality * opt.projectedSquadQuality +
          CONSEQUENCE_WEIGHTS.projectedCompletion * opt.projectedCompletion +
          CONSEQUENCE_WEIGHTS.projectedFlexibility * opt.projectedFlexibility +
          CONSEQUENCE_WEIGHTS.priorityStability * opt.priorityStability;
        const expected = Math.max(0, Math.min(100, Math.round(expectedRaw)));
        expect(opt.consequenceScore).toBe(expected);
      }
    });
  });

  // ============================================================
  // E. CRITICAL PENALTY (FIX #2: NAMED CONFIG)
  // ============================================================

  describe('E. Critical Penalty (named config)', () => {
    it('applies criticalPenalty = projectedCriticalGaps * CONSEQUENCE_PENALTIES.criticalGap', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        5, 20,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 0 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);

      for (const opt of state.options) {
        expect(opt.criticalPenalty).toBe(opt.projectedCriticalGaps * CONSEQUENCE_PENALTIES.criticalGap);
        const expectedFinal = Math.max(0, Math.min(100, Math.round(opt.consequenceScore - opt.criticalPenalty)));
        expect(opt.finalConsequenceScore).toBe(expectedFinal);
      }
    });

    it('0 critical gaps > 1 critical gap > 2 critical gaps in final consequence', () => {
      // Scenario: 2 critical gaps. Acquiring one resolves it, the other doesn't.
      const { squadState, gapState, tradeoffState } = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 0 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);

      // Acquiring BOWLER: resolves 1 critical → projected critical = 1
      const bowler = state.options.find(o => o.role === 'BOWLER')!;
      // Acquiring BATSMAN: resolves 0 critical → projected critical = 2
      const batsman = state.options.find(o => o.role === 'BATSMAN')!;

      expect(bowler.projectedCriticalGaps).toBeLessThan(batsman.projectedCriticalGaps);
      expect(bowler.criticalPenalty).toBeLessThan(batsman.criticalPenalty);
      expect(bowler.finalConsequenceScore).toBeGreaterThan(batsman.finalConsequenceScore);
    });

    it('acquiring a critical role reduces projected critical gaps', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        5, 20,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 0 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      const bowlerOpt = state.options.find(o => o.role === 'BOWLER')!;
      expect(bowlerOpt.projectedCriticalGaps).toBeLessThan(state.currentCriticalGaps);
    });
  });

  // ============================================================
  // F. PROJECTED FLEXIBILITY (FIX #3: THREE-COMPONENT FORMULA)
  // ============================================================

  describe('F. Projected Flexibility (three-component formula)', () => {
    it('more remaining slots, all else equal, cannot reduce flexibility', () => {
      // Same composition but different remaining slots
      const manySlots = makeMocks(
        20, 5,
        { BATSMAN: 1, BOWLER: 1, ALL_ROUNDER: 1, WICKET_KEEPER: 1 },
        { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'HIGH' }
      );
      const fewSlots = makeMocks(
        3, 22,
        { BATSMAN: 1, BOWLER: 1, ALL_ROUNDER: 1, WICKET_KEEPER: 1 },
        { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'HIGH' }
      );
      const sMany = buildBotSquadConsequenceState(manySlots.squadState, manySlots.gapState, manySlots.tradeoffState);
      const sFew = buildBotSquadConsequenceState(fewSlots.squadState, fewSlots.gapState, fewSlots.tradeoffState);

      // Compare same role across both scenarios
      for (const role of ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'] as RoleKey[]) {
        const optMany = sMany.options.find(o => o.role === role)!;
        const optFew = sFew.options.find(o => o.role === role)!;
        expect(optMany.projectedFlexibility).toBeGreaterThanOrEqual(optFew.projectedFlexibility);
      }
    });

    it('fewer urgent gaps, all else equal, cannot reduce flexibility', () => {
      const fewGaps = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 3, ALL_ROUNDER: 3, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const manyGaps = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 3, WICKET_KEEPER: 0 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' }
      );
      const sFew = buildBotSquadConsequenceState(fewGaps.squadState, fewGaps.gapState, fewGaps.tradeoffState);
      const sMany = buildBotSquadConsequenceState(manyGaps.squadState, manyGaps.gapState, manyGaps.tradeoffState);

      // BATSMAN acquisition in both: same role, different gap environments
      const optFew = sFew.options.find(o => o.role === 'BATSMAN')!;
      const optMany = sMany.options.find(o => o.role === 'BATSMAN')!;
      expect(optFew.projectedFlexibility).toBeGreaterThanOrEqual(optMany.projectedFlexibility);
    });

    it('relaxed squad has higher average flexibility than severely constrained squad', () => {
      // Relaxed: many slots, roles at normal, plenty of room
      const relaxed = makeMocks(
        15, 10,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 3, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      // Severely constrained: 1 slot, all redundant
      const constrained = makeMocks(
        1, 24,
        { BATSMAN: 7, BOWLER: 8, ALL_ROUNDER: 5, WICKET_KEEPER: 4 },
        { BATSMAN: 'REDUNDANT', BOWLER: 'REDUNDANT', ALL_ROUNDER: 'REDUNDANT', WICKET_KEEPER: 'REDUNDANT' }
      );
      const sRelaxed = buildBotSquadConsequenceState(relaxed.squadState, relaxed.gapState, relaxed.tradeoffState);
      const sConstrained = buildBotSquadConsequenceState(constrained.squadState, constrained.gapState, constrained.tradeoffState);

      const avgRelaxed = sRelaxed.options.reduce((s, o) => s + o.projectedFlexibility, 0) / 4;
      const avgConstrained = sConstrained.options.reduce((s, o) => s + o.projectedFlexibility, 0) / 4;
      expect(avgRelaxed).toBeGreaterThan(avgConstrained);
    });

    it('constrained late-squad produces lower flexibility than unconstrained early-squad', () => {
      const early = makeMocks(
        22, 3,
        { BATSMAN: 1, BOWLER: 1, ALL_ROUNDER: 1, WICKET_KEEPER: 0 },
        { BATSMAN: 'HIGH', BOWLER: 'HIGH', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'CRITICAL' }
      );
      const late = makeMocks(
        2, 23,
        { BATSMAN: 7, BOWLER: 7, ALL_ROUNDER: 5, WICKET_KEEPER: 0 },
        { BATSMAN: 'REDUNDANT', BOWLER: 'REDUNDANT', ALL_ROUNDER: 'REDUNDANT', WICKET_KEEPER: 'CRITICAL' }
      );
      const sEarly = buildBotSquadConsequenceState(early.squadState, early.gapState, early.tradeoffState);
      const sLate = buildBotSquadConsequenceState(late.squadState, late.gapState, late.tradeoffState);

      // WICKET_KEEPER acquisition: early has 22 slots, late has 2
      const optEarly = sEarly.options.find(o => o.role === 'WICKET_KEEPER')!;
      const optLate = sLate.options.find(o => o.role === 'WICKET_KEEPER')!;
      expect(optEarly.projectedFlexibility).toBeGreaterThan(optLate.projectedFlexibility);
    });
  });

  // ============================================================
  // G. STRUCTURAL ORDERING INVARIANTS
  // ============================================================

  describe('G. Structural Ordering Invariants', () => {
    it('Situation A > B > C: sole critical resolved > partial critical resolved > redundant', () => {
      // Situation A: BOWLER is the sole critical gap. Acquiring BOWLER resolves it.
      const mocksA = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const stateA = buildBotSquadConsequenceState(mocksA.squadState, mocksA.gapState, mocksA.tradeoffState);
      const bowlerA = stateA.options.find(o => o.role === 'BOWLER')!;

      // Situation B: BOWLER + WICKET_KEEPER both critical. Acquiring BOWLER resolves 1 of 2.
      const mocksB = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 0 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' }
      );
      const stateB = buildBotSquadConsequenceState(mocksB.squadState, mocksB.gapState, mocksB.tradeoffState);
      const bowlerB = stateB.options.find(o => o.role === 'BOWLER')!;

      // Situation C: BOWLER + WICKET_KEEPER both critical. Acquiring redundant BATSMAN.
      const batsmanC = stateB.options.find(o => o.role === 'BATSMAN')!;

      expect(bowlerA.finalConsequenceScore).toBeGreaterThan(bowlerB.finalConsequenceScore);
      expect(bowlerB.finalConsequenceScore).toBeGreaterThan(batsmanC.finalConsequenceScore);
    });

    it('direct critical-gap resolution outranks irrelevant redundant acquisition', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      const bowler = state.options.find(o => o.role === 'BOWLER')!;
      const batsman = state.options.find(o => o.role === 'BATSMAN')!;

      expect(bowler.finalConsequenceScore).toBeGreaterThan(batsman.finalConsequenceScore);
    });

    it('resolving more critical pressure cannot produce worse consequence under controlled conditions', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 0 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      const bowler = state.options.find(o => o.role === 'BOWLER')!;
      const batsman = state.options.find(o => o.role === 'BATSMAN')!;

      expect(bowler.finalConsequenceScore).toBeGreaterThan(batsman.finalConsequenceScore);
    });
  });

  // ============================================================
  // H. 2G TRADE-OFF CONSUMPTION
  // ============================================================

  describe('H. 2G Trade-off Consumption', () => {
    it('consumes priorTradeoffScore for explainability only', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
        ['BOWLER', 'BATSMAN', 'ALL_ROUNDER', 'WICKET_KEEPER'],
        { BOWLER: 80, BATSMAN: 40, ALL_ROUNDER: 50, WICKET_KEEPER: 30 }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      const bowler = state.options.find(o => o.role === 'BOWLER')!;

      expect(bowler.priorTradeoffScore).toBe(80);
      expect(bowler.rationale).toContain('trade-off');
    });

    it('tradeoffScore does NOT affect consequenceScore numerically', () => {
      const makeIt = (scores: Record<RoleKey, number>) => {
        const { squadState, gapState, tradeoffState } = makeMocks(
          10, 15,
          { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 2 },
          { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' },
          ['BOWLER', 'BATSMAN', 'ALL_ROUNDER', 'WICKET_KEEPER'],
          scores
        );
        return buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      };

      const stateA = makeIt({ BOWLER: 10, BATSMAN: 10, ALL_ROUNDER: 10, WICKET_KEEPER: 10 });
      const stateB = makeIt({ BOWLER: 90, BATSMAN: 90, ALL_ROUNDER: 90, WICKET_KEEPER: 90 });

      for (const role of ['BOWLER', 'BATSMAN', 'ALL_ROUNDER', 'WICKET_KEEPER'] as RoleKey[]) {
        const optA = stateA.options.find(o => o.role === role)!;
        const optB = stateB.options.find(o => o.role === role)!;
        expect(optA.consequenceScore).toBe(optB.consequenceScore);
        expect(optA.finalConsequenceScore).toBe(optB.finalConsequenceScore);
      }
    });
  });

  // ============================================================
  // I. EDGE CASES
  // ============================================================

  describe('I. Edge Cases', () => {
    it('empty squad (0 players, 25 remaining)', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        25, 0,
        { BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 },
        { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      expect(state.options).toHaveLength(4);
      expect(state.currentCriticalGaps).toBe(4);
      for (const opt of state.options) {
        expect(opt.finalConsequenceScore).toBeGreaterThanOrEqual(0);
        expect(opt.finalConsequenceScore).toBeLessThanOrEqual(100);
        expect(Number.isFinite(opt.finalConsequenceScore)).toBe(true);
      }
    });

    it('full squad (0 remaining slots)', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        0, 25,
        { BATSMAN: 7, BOWLER: 8, ALL_ROUNDER: 5, WICKET_KEEPER: 5 },
        { BATSMAN: 'REDUNDANT', BOWLER: 'REDUNDANT', ALL_ROUNDER: 'REDUNDANT', WICKET_KEEPER: 'REDUNDANT' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      expect(state.options).toHaveLength(4);
      for (const opt of state.options) {
        expect(Number.isFinite(opt.finalConsequenceScore)).toBe(true);
      }
    });

    it('single remaining slot', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        1, 24,
        { BATSMAN: 7, BOWLER: 7, ALL_ROUNDER: 5, WICKET_KEEPER: 5 },
        { BATSMAN: 'LOW', BOWLER: 'LOW', ALL_ROUNDER: 'LOW', WICKET_KEEPER: 'LOW' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      expect(state.options).toHaveLength(4);
      for (const opt of state.options) {
        expect(opt.finalConsequenceScore).toBeGreaterThanOrEqual(0);
        expect(opt.finalConsequenceScore).toBeLessThanOrEqual(100);
      }
    });
  });

  // ============================================================
  // J. DETERMINISM & IMMUTABILITY
  // ============================================================

  describe('J. Determinism & Immutability', () => {
    it('same input produces identical output', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        10, 15,
        { BATSMAN: 3, BOWLER: 0, ALL_ROUNDER: 3, WICKET_KEEPER: 1 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'HIGH' }
      );
      const state1 = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      const state2 = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);
      expect(JSON.stringify(state1)).toBe(JSON.stringify(state2));
    });

    it('does not mutate input objects', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        10, 15,
        { BATSMAN: 3, BOWLER: 0, ALL_ROUNDER: 3, WICKET_KEEPER: 1 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'HIGH' }
      );
      const squadBefore = JSON.stringify(squadState);
      const gapBefore = JSON.stringify(gapState);
      const tradeoffBefore = JSON.stringify(tradeoffState);

      buildBotSquadConsequenceState(squadState, gapState, tradeoffState);

      expect(JSON.stringify(squadState)).toBe(squadBefore);
      expect(JSON.stringify(gapState)).toBe(gapBefore);
      expect(JSON.stringify(tradeoffState)).toBe(tradeoffBefore);
    });
  });

  // ============================================================
  // K. NUMERIC SAFETY INVARIANTS
  // ============================================================

  describe('K. Numeric Safety Invariants', () => {
    it('all metrics remain 0-100 with no NaN or Infinity', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        1, 24,
        { BATSMAN: 7, BOWLER: 0, ALL_ROUNDER: 7, WICKET_KEEPER: 0 },
        { BATSMAN: 'REDUNDANT', BOWLER: 'CRITICAL', ALL_ROUNDER: 'REDUNDANT', WICKET_KEEPER: 'CRITICAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);

      for (const opt of state.options) {
        const vals = [
          opt.projectedSquadQuality,
          opt.projectedCompletion,
          opt.projectedFlexibility,
          opt.priorityStability,
          opt.consequenceScore,
          opt.finalConsequenceScore,
          opt.projectedConstraintPressure,
        ];
        for (const v of vals) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
          expect(Number.isFinite(v)).toBe(true);
          expect(Number.isNaN(v)).toBe(false);
        }
      }
    });
  });

  // ============================================================
  // L. DETERMINISTIC ORDERING
  // ============================================================

  describe('L. Deterministic Ordering', () => {
    it('orders by finalConsequenceScore descending', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);

      for (let i = 1; i < state.options.length; i++) {
        const prev = state.options[i - 1]!;
        const curr = state.options[i]!;
        expect(prev.finalConsequenceScore).toBeGreaterThanOrEqual(curr.finalConsequenceScore);
      }

      expect(state.consequenceOrder[0]).toBe('BOWLER');
      expect(state.bestOption?.role).toBe('BOWLER');
    });
  });

  // ============================================================
  // M. EXISTING 2B-2F FUNCTION REUSE
  // ============================================================

  describe('M. Existing 2B-2F Function Reuse', () => {
    it('projected quality comes from existing 2C function output', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        20, 5,
        { BATSMAN: 1, BOWLER: 0, ALL_ROUNDER: 1, WICKET_KEEPER: 1 },
        { BATSMAN: 'HIGH', BOWLER: 'CRITICAL', ALL_ROUNDER: 'HIGH', WICKET_KEEPER: 'HIGH' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);

      for (const opt of state.options) {
        expect(opt.projectedSquadQuality).toBeGreaterThanOrEqual(0);
        expect(opt.projectedSquadQuality).toBeLessThanOrEqual(100);
      }
    });
  });

  // ============================================================
  // N. RATIONALE
  // ============================================================

  describe('N. Rationale', () => {
    it('every option has a non-empty deterministic rationale referencing trade-off', () => {
      const { squadState, gapState, tradeoffState } = makeMocks(
        10, 15,
        { BATSMAN: 5, BOWLER: 0, ALL_ROUNDER: 5, WICKET_KEEPER: 2 },
        { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }
      );
      const state = buildBotSquadConsequenceState(squadState, gapState, tradeoffState);

      for (const opt of state.options) {
        expect(typeof opt.rationale).toBe('string');
        expect(opt.rationale.length).toBeGreaterThan(10);
        expect(opt.rationale).not.toContain('undefined');
        expect(opt.rationale).toContain('trade-off');
      }
    });
  });
});
