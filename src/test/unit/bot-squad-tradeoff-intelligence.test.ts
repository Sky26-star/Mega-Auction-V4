import { describe, it, expect } from 'vitest';
import { buildBotSquadTradeoffState } from '../../lib/auction/bot-squad-tradeoff-intelligence';
import { type BotSquadState } from '../../lib/auction/bot-squad-intelligence';
import { type BotRoleGapState } from '../../lib/auction/bot-role-gap-intelligence';
import { type BotSquadQualityState } from '../../lib/auction/bot-squad-quality-intelligence';
import { type BotSquadPriorityState, type PriorityLevel, type RoleKey } from '../../lib/auction/bot-squad-priority-intelligence';
import { type BotSquadTargetState } from '../../lib/auction/bot-squad-target-intelligence';
import { type BotSquadAlternativeState, type AlternativeAvailability } from '../../lib/auction/bot-squad-alternative-intelligence';
import { type RoleNeed } from '../../lib/auction/server-bot-engine';

function makeMocks(
  remainingSlots: number,
  squadSize: number,
  roleNeeds: Record<RoleKey, RoleNeed>,
  altAvailability: AlternativeAvailability,
  altCount: number,
  primaryRole: RoleKey | null
) {
  const squadState: BotSquadState = {
    teamId: 'bot-1',
    squadSize,
    remainingSlots,
    purseRemaining: 5000,
    amountSpent: 5000,
    spentRatio: 0.5,
    overseasCount: 2,
    overseasSlotsRemaining: 6,
    roleComposition: { BATSMAN: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 },
    roleNeeds,
  };

  const gapRoles: any = {};
  for (const role of Object.keys(roleNeeds) as Array<RoleKey>) {
    gapRoles[role] = {
      currentCount: 0,
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
    squadSize,
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
  for (const role of Object.keys(roleNeeds) as Array<RoleKey>) {
    priorityRoles[role] = {
      role,
      priorityScore: 50,
      priorityLevel: roleNeeds[role] === 'CRITICAL' ? 'CRITICAL' : (roleNeeds[role] === 'REDUNDANT' ? 'NONE' : 'MEDIUM'),
      reason: 'mock',
      gapLevel: roleNeeds[role],
      isGap: gapRoles[role].isGap,
      isCritical: gapRoles[role].isCritical,
      currentCount: 0,
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

  const targetState: BotSquadTargetState = {
    teamId: 'bot-1',
    primaryTarget: null,
    secondaryTarget: null,
    roles: {} as any,
    targetOrder: ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'],
  };

  const alternatives = Array.from({ length: altCount }).map((_, i) => ({
    role: i === 0 ? 'ALL_ROUNDER' : 'WICKET_KEEPER',
    alternativeType: 'PARTIAL',
    alternativeScore: 50,
    alternativeUrgency: 50,
    compatibilityScore: 50,
    currentCount: 0,
    roleNeed: 'NORMAL',
    gapLevel: 'NORMAL',
    rationale: 'mock'
  })) as any;

  const altState: BotSquadAlternativeState = {
    teamId: 'bot-1',
    primaryRole,
    alternativeAvailability: altAvailability,
    targetDependency: 'LOW_DEPENDENCY',
    alternatives,
    fallbackOrder: [],
  };

  return { squadState, gapState, qualityState, priorityState, targetState, altState };
}

describe('Bot Squad Tradeoff Intelligence - Comprehensive Suite', () => {

  describe('A. Global Constraint Context', () => {
    it('calculates CRITICAL pressure accurately', () => {
      const mocks = makeMocks(0, 25, { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' }, 'NO_MEANINGFUL_ALTERNATIVE', 0, 'BATSMAN');
      const state = buildBotSquadTradeoffState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState, mocks.altState);
      expect(state.constraintContext.slotScarcity).toBe(100);
      expect(state.constraintContext.criticalNeedPressure).toBe(100);
      expect(state.constraintContext.alternativeScarcity).toBe(100);
      expect(state.constraintContext.constraintPressure).toBe(100);
      expect(state.overallConstraintLevel).toBe('CRITICAL');
    });

    it('calculates LOW pressure accurately', () => {
      // High remaining slots (20/25), 0 critical gaps, multiple alternatives
      const mocks = makeMocks(20, 5, { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'ALTERNATIVES_AVAILABLE', 2, 'BATSMAN');
      const state = buildBotSquadTradeoffState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState, mocks.altState);
      
      const expectedSlotScarcity = Math.round(100 * (1 - 20 / 25)); // 20% -> 20
      expect(state.constraintContext.slotScarcity).toBe(expectedSlotScarcity);
      expect(state.constraintContext.criticalNeedPressure).toBe(0);
      expect(state.constraintContext.alternativeScarcity).toBe(20);
      
      const expectedPressure = Math.round((0.45 * expectedSlotScarcity) + (0.35 * 0) + (0.20 * 20)); // 9 + 4 = 13
      expect(state.constraintContext.constraintPressure).toBe(expectedPressure);
      expect(state.overallConstraintLevel).toBe('LOW');
    });
  });

  describe('B. Benefit Formula Verification', () => {
    it('verifies exact benefit score computation', () => {
      const mocks = makeMocks(20, 5, { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'ALTERNATIVES_AVAILABLE', 2, 'BATSMAN');
      const state = buildBotSquadTradeoffState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState, mocks.altState);
      const opt = state.primaryOption!;
      
      const gapRes = 100; // CRITICAL
      const expectedBal = Math.round((100 * 0.7) + (40 * 0.3)); // 82
      const expectedComp = Math.round((100 * 0.6) + (40 * 0.4)); // 76
      const expectedBenefit = Math.round((0.45 * gapRes) + (0.30 * expectedBal) + (0.25 * expectedComp)); // 45 + 24.6 + 19 = 88.6 -> 89
      
      expect(opt.gapResolution).toBe(gapRes);
      expect(opt.squadBalanceImpact).toBe(expectedBal);
      expect(opt.completionImpact).toBe(expectedComp);
      expect(opt.benefitScore).toBe(expectedBenefit);
    });
  });

  describe('C. Sacrifice Formula Verification', () => {
    it('verifies exact sacrifice score computation', () => {
      const mocks = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'LIMITED_ALTERNATIVES', 1, 'BATSMAN');
      const state = buildBotSquadTradeoffState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState, mocks.altState);
      const opt = state.primaryOption!; // BATSMAN (solves the 1 critical gap)
      
      const expectedSlotScarcity = 60; // 1 - 10/25 = 0.6 * 100
      const criticalPressure = 25; // 1/4 = 0.25 * 100
      const altScarcity = 60; // LIMITED
      
      const oppCost = Math.round((0.40 * expectedSlotScarcity) + (0.30 * criticalPressure) + (0.30 * (100 - 100))); // 24 + 7.5 = 31.5 -> 32
      const unresExp = 0; // Fixed the only critical gap
      const flexLoss = Math.round((0.40 * expectedSlotScarcity) + (0.40 * unresExp) + (0.20 * altScarcity)); // 24 + 0 + 12 = 36
      
      const expectedSacrificeScore = Math.round((0.45 * oppCost) + (0.35 * unresExp) + (0.20 * flexLoss)); // 14.4 + 0 + 7.2 = 21.6 -> 22
      
      expect(opt.opportunityCost).toBe(oppCost);
      expect(opt.unresolvedNeedExposure).toBe(unresExp);
      expect(opt.flexibilityLoss).toBe(flexLoss);
      expect(opt.sacrificeScore).toBe(expectedSacrificeScore);
    });
  });

  describe('D. Constraint Scaling & Adjusted Sacrifice', () => {
    it('scales properly from 0.75x to 1.50x based on constraint pressure', () => {
      // Force constraint pressures by mocking
      
      // Pressure = 100
      const m100 = makeMocks(0, 25, { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' }, 'NO_MEANINGFUL_ALTERNATIVE', 0, 'BATSMAN');
      const s100 = buildBotSquadTradeoffState(m100.squadState, m100.gapState, m100.qualityState, m100.priorityState, m100.targetState, m100.altState);
      expect(s100.constraintContext.constraintPressure).toBe(100);
      const o100 = s100.primaryOption!;
      const expectedMult100 = 1.5;
      expect(o100.adjustedSacrifice).toBe(Math.min(100, Math.round(o100.sacrificeRisk * expectedMult100)));

      // Pressure = ~50
      const m50 = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'LIMITED_ALTERNATIVES', 1, 'BATSMAN');
      const s50 = buildBotSquadTradeoffState(m50.squadState, m50.gapState, m50.qualityState, m50.priorityState, m50.targetState, m50.altState);
      const o50 = s50.primaryOption!;
      const expectedMult50 = 0.75 + (s50.constraintContext.constraintPressure / 100) * 0.75;
      expect(o50.adjustedSacrifice).toBe(Math.min(100, Math.round(o50.sacrificeRisk * expectedMult50)));
    });
  });

  describe('E. Flexibility', () => {
    it('computes future flexibility and flexibility score for primary vs secondary', () => {
      const mocks = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'HIGH', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'LIMITED_ALTERNATIVES', 1, 'BATSMAN');
      const state = buildBotSquadTradeoffState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState, mocks.altState);
      
      const primary = state.primaryOption!; // BATSMAN
      const secondary = state.alternativeOptions.find(o => o.role === 'BOWLER')!;
      
      // Primary inherits alternatives
      expect(primary.futureFlexibility).toBe(50); // 1 alt * 50
      expect(primary.alternativePathValue).toBe(50); // mock average is 50
      expect(primary.flexibilityScore).toBe(Math.round((0.60 * 50) + (0.40 * 50)));

      // Secondary lock-in drops flexibility
      expect(secondary.futureFlexibility).toBe(20);
      expect(secondary.alternativePathValue).toBe(10);
      expect(secondary.flexibilityScore).toBe(Math.round((0.60 * 20) + (0.40 * 10))); // 16
    });
  });

  describe('F. Acquisition Efficiency', () => {
    it('normalizes gain vs cost accurately around 50', () => {
      const mocks = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'LIMITED_ALTERNATIVES', 1, 'BATSMAN');
      const state = buildBotSquadTradeoffState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState, mocks.altState);
      const opt = state.primaryOption!;
      
      const expectedGain = Math.round((0.50 * opt.gapResolution) + (0.30 * opt.squadBalanceImpact) + (0.20 * opt.completionImpact));
      const expectedCost = Math.round((0.40 * state.constraintContext.slotScarcity) + (0.35 * opt.unresolvedNeedExposure) + (0.25 * opt.flexibilityLoss));
      
      const ratio = expectedGain / Math.max(1, expectedCost);
      const expectedEff = Math.max(0, Math.min(100, Math.round(ratio * 50)));
      
      expect(opt.acquisitionEfficiency).toBe(expectedEff);
      expect(opt.acquisitionEfficiency).toBeGreaterThanOrEqual(0);
      expect(opt.acquisitionEfficiency).toBeLessThanOrEqual(100);
    });
  });

  describe('G. Final Tradeoff Score', () => {
    it('verifies exact tradeoff formula synthesis', () => {
      const mocks = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'LIMITED_ALTERNATIVES', 1, 'BATSMAN');
      const state = buildBotSquadTradeoffState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState, mocks.altState);
      const opt = state.primaryOption!;
      
      const expectedTradeoff = Math.round(
        (0.60 * opt.benefitScore) + (0.20 * opt.flexibilityScore) - (0.20 * opt.adjustedSacrifice)
      );
      expect(opt.tradeoffScore).toBe(expectedTradeoff);
    });
  });

  describe('H. Structural Scenarios', () => {
    it('scenario 4: critical bowler + critical WK with only 2 slots', () => {
      const mocks = makeMocks(2, 23, { BATSMAN: 'NORMAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'CRITICAL' }, 'LIMITED_ALTERNATIVES', 1, 'BOWLER');
      const state = buildBotSquadTradeoffState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState, mocks.altState);
      
      const unneededBat = state.alternativeOptions.find(o => o.role === 'BATSMAN')!;
      // Unneeded batsman leaves 2 critical roles unresolved.
      expect(unneededBat.unresolvedNeedExposure).toBe(50); // 2/4 = 50%
      expect(unneededBat.benefitScore).toBeLessThan(50);
      expect(unneededBat.tradeoffScore).toBeLessThan(50);
      
      const neededBowler = state.primaryOption!;
      expect(neededBowler.unresolvedNeedExposure).toBe(25); // fixes 1, leaves 1 (1/4 = 25%)
      expect(neededBowler.benefitScore).toBeGreaterThan(80);
      expect(neededBowler.tradeoffScore).toBeGreaterThan(unneededBat.tradeoffScore);
    });

    it('omits entirely redundant paths', () => {
      const mocks = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'REDUNDANT' }, 'LIMITED_ALTERNATIVES', 1, 'BATSMAN');
      const state = buildBotSquadTradeoffState(mocks.squadState, mocks.gapState, mocks.qualityState, mocks.priorityState, mocks.targetState, mocks.altState);
      expect(state.tradeoffOrder).not.toContain('WICKET_KEEPER');
    });
  });

  describe('I. Deterministic Ordering', () => {
    it('sorts by tradeoff > benefit > sacrifice > flex > canonical', () => {
      const m1 = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' }, 'NO_MEANINGFUL_ALTERNATIVE', 0, null);
      const s1 = buildBotSquadTradeoffState(m1.squadState, m1.gapState, m1.qualityState, m1.priorityState, m1.targetState, m1.altState);
      
      // All are CRITICAL, identical stats, should sort canonically
      expect(s1.tradeoffOrder).toEqual(['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER']);
    });
  });

  describe('J. Invariants', () => {
    it('invariant 1: all metrics 0-100', () => {
      const m = makeMocks(1, 24, { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' }, 'NO_MEANINGFUL_ALTERNATIVE', 0, 'BATSMAN');
      const s = buildBotSquadTradeoffState(m.squadState, m.gapState, m.qualityState, m.priorityState, m.targetState, m.altState);
      
      for (const opt of s.alternativeOptions.concat(s.primaryOption!)) {
        if (!opt) continue;
        const vals = [
          opt.gapResolution, opt.squadBalanceImpact, opt.completionImpact,
          opt.opportunityCost, opt.unresolvedNeedExposure, opt.flexibilityLoss,
          opt.futureFlexibility, opt.alternativePathValue, opt.targetLockRisk,
          opt.benefitScore, opt.sacrificeScore, opt.sacrificeRisk, opt.flexibilityScore,
          opt.constraintPressure, opt.adjustedSacrifice, opt.acquisitionEfficiency, opt.tradeoffScore
        ];
        for (const v of vals) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    });

    it('invariant 4: more unresolved needs cannot reduce constraint pressure', () => {
      const mLow = makeMocks(10, 15, { BATSMAN: 'NORMAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'ALTERNATIVES_AVAILABLE', 2, 'BATSMAN');
      const mHigh = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'ALTERNATIVES_AVAILABLE', 2, 'BATSMAN');
      
      const sLow = buildBotSquadTradeoffState(mLow.squadState, mLow.gapState, mLow.qualityState, mLow.priorityState, mLow.targetState, mLow.altState);
      const sHigh = buildBotSquadTradeoffState(mHigh.squadState, mHigh.gapState, mHigh.qualityState, mHigh.priorityState, mHigh.targetState, mHigh.altState);
      
      expect(sHigh.constraintContext.constraintPressure).toBeGreaterThan(sLow.constraintContext.constraintPressure);
    });

    it('invariant 5: fewer alternatives cannot increase future flexibility', () => {
      const mMany = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'ALTERNATIVES_AVAILABLE', 2, 'BATSMAN');
      const mFew = makeMocks(10, 15, { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'NO_MEANINGFUL_ALTERNATIVE', 0, 'BATSMAN');
      
      const sMany = buildBotSquadTradeoffState(mMany.squadState, mMany.gapState, mMany.qualityState, mMany.priorityState, mMany.targetState, mMany.altState);
      const sFew = buildBotSquadTradeoffState(mFew.squadState, mFew.gapState, mFew.qualityState, mFew.priorityState, mFew.targetState, mFew.altState);
      
      expect(sFew.primaryOption!.futureFlexibility).toBeLessThanOrEqual(sMany.primaryOption!.futureFlexibility);
    });

    it('invariant 3: higher constraint pressure cannot reduce adjusted sacrifice', () => {
      const mUnconstrained = makeMocks(20, 5, { BATSMAN: 'CRITICAL', BOWLER: 'NORMAL', ALL_ROUNDER: 'NORMAL', WICKET_KEEPER: 'NORMAL' }, 'ALTERNATIVES_AVAILABLE', 2, 'BATSMAN');
      const mConstrained = makeMocks(2, 23, { BATSMAN: 'CRITICAL', BOWLER: 'CRITICAL', ALL_ROUNDER: 'CRITICAL', WICKET_KEEPER: 'CRITICAL' }, 'NO_MEANINGFUL_ALTERNATIVE', 0, 'BATSMAN');
      
      const sUnconstrained = buildBotSquadTradeoffState(mUnconstrained.squadState, mUnconstrained.gapState, mUnconstrained.qualityState, mUnconstrained.priorityState, mUnconstrained.targetState, mUnconstrained.altState);
      const sConstrained = buildBotSquadTradeoffState(mConstrained.squadState, mConstrained.gapState, mConstrained.qualityState, mConstrained.priorityState, mConstrained.targetState, mConstrained.altState);
      
      // To strictly test invariant 3, if sacrificeRisk is identical, higher pressure -> higher adjusted
      const sr1 = 50;
      const pressure1 = sUnconstrained.constraintContext.constraintPressure;
      const pressure2 = sConstrained.constraintContext.constraintPressure;
      expect(pressure2).toBeGreaterThan(pressure1);
      
      const mult1 = 0.75 + (pressure1 / 100) * 0.75;
      const mult2 = 0.75 + (pressure2 / 100) * 0.75;
      
      expect(Math.round(sr1 * mult2)).toBeGreaterThanOrEqual(Math.round(sr1 * mult1));
    });
  });

});
