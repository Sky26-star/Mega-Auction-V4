import { describe, it, expect } from 'vitest';
import type { MaximumBidContext, MaximumBidResult } from '../../lib/auction/human-auction-manager-types';
import { evaluateMaximumBid, normalizeLegalBidCeiling } from '../../lib/auction/human-auction-maximum-bid';

describe('Phase 5 — Maximum Bid Engine (Hardened)', () => {

  const createBaseContext = (overrides?: Partial<MaximumBidContext>): MaximumBidContext => ({
    teamValue: {
      teamId: 't1',
      playerId: 'p1',
      marketValue: 1000,
      teamValue: 1500,
      factors: {} as any,
      strategicCommitment: 'JUSTIFIED',
      reasons: []
    },
    purse: {
      currentPurse: 5000,
      remainingSquadSlots: 10,
      minimumRequiredFutureSpend: 200,
      health: 'SAFE',
    },
    auctionStage: 'MID',
    currentBid: 500,
    nextRequiredBid: 550,
    futureBudget: 0,
    ...overrides
  });

  // =========================================================================
  // MANDATORY HARDENING TESTS A THROUGH N
  // =========================================================================

  it('TEST A — PHASE 2 SOLVENCY HANDOFF', () => {
    // Proves the engine consumes minimumRequiredFutureSpend directly,
    // rather than calculating remainingSquadSlots * 20.
    const ctx = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, teamValue: 5000 },
      purse: {
        currentPurse: 1000,
        remainingSquadSlots: 20, // If slots * 20 was used, reserve would be 380 or 400
        minimumRequiredFutureSpend: 300, // Authoritative Phase 2 spend
        health: 'SAFE'
      },
      futureBudget: 0
    });

    const res = evaluateMaximumBid(ctx);

    // Expected spendable = 1000 - 300 = 700
    expect(res.constraints.solvencyLimit).toBe(700);
    expect(res.maximumBid).toBe(700);
    expect(res.bindingConstraint).toBe('SOLVENCY');
    expect(res.reasons.join(' ')).toContain('Solvency protects 300L of required future squad spend, leaving 700L available');
  });

  it('TEST B — EARLY DOES NOT DISCOUNT TEAM VALUE', () => {
    // Stage multipliers for V1 are 1.00 across all stages.
    const stages: Array<'EARLY' | 'MID' | 'LATE' | 'ENDGAME'> = ['EARLY', 'MID', 'LATE', 'ENDGAME'];
    
    const results = stages.map(auctionStage => {
      return evaluateMaximumBid(createBaseContext({
        teamValue: { ...createBaseContext().teamValue, teamValue: 2000 },
        purse: {
          currentPurse: 10000,
          remainingSquadSlots: 5,
          minimumRequiredFutureSpend: 0,
          health: 'SAFE'
        },
        futureBudget: 0,
        auctionStage
      }));
    });

    // All must produce 2000L without arbitrary stage discounts
    for (const res of results) {
      expect(res.maximumBid).toBe(2000);
      expect(res.bindingConstraint).toBe('TEAM_VALUE');
    }
  });

  it('TEST C — TEAM VALUE STILL CAPS EARLY', () => {
    const ctx = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, teamValue: 2000 },
      purse: {
        currentPurse: 50000,
        remainingSquadSlots: 10,
        minimumRequiredFutureSpend: 0,
        health: 'SAFE'
      },
      futureBudget: 0,
      auctionStage: 'EARLY'
    });

    const res = evaluateMaximumBid(ctx);

    // Must be 2000L, never 1800L (old 0.90 discount removed)
    expect(res.maximumBid).toBe(2000);
    expect(res.bindingConstraint).toBe('TEAM_VALUE');
  });

  it('TEST D — PROTECTED FUTURE BUDGET', () => {
    const ctx = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, teamValue: 4000 },
      purse: {
        currentPurse: 5000,
        remainingSquadSlots: 5,
        minimumRequiredFutureSpend: 0,
        health: 'SAFE'
      },
      futureBudget: 2000 // Protected future budget
    });

    const res = evaluateMaximumBid(ctx);

    // Ceiling = 5000 - 2000 = 3000
    expect(res.constraints.futureBudgetLimit).toBe(3000);
    expect(res.maximumBid).toBe(3000);
    expect(res.bindingConstraint).toBe('FUTURE_BUDGET');
  });

  it('TEST E — FUTURE BUDGET DOES NOT MEAN AVAILABLE BUDGET', () => {
    // If futureBudget (1000L) were misinterpreted as available budget, the bid would be 1000L.
    // As a protected budget, available headroom is 5000 - 1000 = 4000L.
    // Team Value is 3500L, so Team Value is the binding constraint.
    const ctx = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, teamValue: 3500 },
      purse: {
        currentPurse: 5000,
        remainingSquadSlots: 5,
        minimumRequiredFutureSpend: 0,
        health: 'SAFE'
      },
      futureBudget: 1000 // Protected budget
    });

    const res = evaluateMaximumBid(ctx);

    expect(res.constraints.futureBudgetLimit).toBe(4000);
    expect(res.maximumBid).toBe(3500);
    expect(res.bindingConstraint).toBe('TEAM_VALUE');
  });

  it('TEST F — RAW BINDING CONSTRAINT BEFORE ROUNDING', () => {
    // Team Value: 2037 (rounds to 2030)
    // Future Budget Limit: 2040 (rounds to 2040)
    // Solvency Limit: 5000
    // Purse Limit: 10000
    // Raw lowest ceiling is 2037 (TEAM_VALUE).
    const ctx = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, teamValue: 2037 },
      purse: {
        currentPurse: 10000,
        remainingSquadSlots: 10,
        minimumRequiredFutureSpend: 5000,
        health: 'SAFE'
      },
      futureBudget: 7960 // 10000 - 7960 = 2040
    });

    const res = evaluateMaximumBid(ctx);

    expect(res.bindingConstraint).toBe('TEAM_VALUE');
    expect(res.maximumBid).toBe(2030); // 2037 rounded down to legal 10L increment
  });

  it('TEST G — EXACT FUTURE-BUDGET / SOLVENCY TIE', () => {
    // Future Budget Limit = 1000 - 180 = 820
    // Solvency Limit = 1000 - 180 = 820
    // Purse = 1000 (> 820)
    // Team Value = 3000 (> 820)
    const ctx = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, teamValue: 3000 },
      purse: {
        currentPurse: 1000,
        remainingSquadSlots: 10,
        minimumRequiredFutureSpend: 180,
        health: 'SAFE'
      },
      futureBudget: 180
    });

    const res = evaluateMaximumBid(ctx);

    expect(res.maximumBid).toBe(820);
    // Tie-break precedence: FUTURE_BUDGET -> SOLVENCY -> PURSE -> TEAM_VALUE
    expect(res.bindingConstraint).toBe('FUTURE_BUDGET');
    expect(res.tiedConstraints).toEqual(['FUTURE_BUDGET', 'SOLVENCY']);
    
    // Reasoning must explicitly state the tie rather than claiming one was uniquely lower
    const reasonText = res.reasons.join(' ');
    expect(reasonText).toContain('Constraints tied at 820L: FUTURE_BUDGET and SOLVENCY');
  });

  it('TEST H — PURSE ONLY', () => {
    // When no future reserves exist (futureBudget = 0, minimumRequiredFutureSpend = 0),
    // Purse is the sole binding financial ceiling.
    const ctx = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, teamValue: 5000 },
      purse: {
        currentPurse: 400,
        remainingSquadSlots: 5,
        minimumRequiredFutureSpend: 0,
        health: 'DANGEROUS'
      },
      futureBudget: 0
    });

    const res = evaluateMaximumBid(ctx);

    expect(res.maximumBid).toBe(400);
    expect(res.bindingConstraint).toBe('PURSE');
    expect(res.reasons.join(' ')).toContain('Constraint: PURSE limits maximum bid to 400L');
  });

  it('TEST I — SOLVENCY ONLY', () => {
    const ctx = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, teamValue: 3000 },
      purse: {
        currentPurse: 1000,
        remainingSquadSlots: 10,
        minimumRequiredFutureSpend: 180,
        health: 'SAFE'
      },
      futureBudget: 0
    });

    const res = evaluateMaximumBid(ctx);

    expect(res.maximumBid).toBe(820);
    expect(res.bindingConstraint).toBe('SOLVENCY');
    expect(res.reasons.join(' ')).toContain('Constraint: SOLVENCY requires protecting 180L');
  });

  it('TEST J — CURRENT BID ISOLATION', () => {
    const ctxLow = createBaseContext({ currentBid: 500, nextRequiredBid: 550 });
    const ctxHigh = createBaseContext({ currentBid: 1500, nextRequiredBid: 1550 });

    const resLow = evaluateMaximumBid(ctxLow);
    const resHigh = evaluateMaximumBid(ctxHigh);

    expect(resLow.teamValue).toBe(resHigh.teamValue);
    expect(resLow.maximumBid).toBe(resHigh.maximumBid);
    expect(resLow.bindingConstraint).toBe(resHigh.bindingConstraint);
  });

  it('TEST K — NEXT REQUIRED BID ISOLATION', () => {
    const ctx1 = createBaseContext({ nextRequiredBid: 600 });
    const ctx2 = createBaseContext({ nextRequiredBid: 1900 });

    const res1 = evaluateMaximumBid(ctx1);
    const res2 = evaluateMaximumBid(ctx2);

    expect(res1.maximumBid).toBe(res2.maximumBid);
    expect(res1.bindingConstraint).toBe(res2.bindingConstraint);
  });

  it('TEST L — DETERMINISM', () => {
    const ctx = createBaseContext();
    const r1 = evaluateMaximumBid(ctx);
    const r2 = evaluateMaximumBid(ctx);

    expect(r1.maximumBid).toBe(r2.maximumBid);
    expect(r1.bindingConstraint).toBe(r2.bindingConstraint);
    expect(r1.constraints).toEqual(r2.constraints);
    expect(r1.reasons).toEqual(r2.reasons);
  });

  it('TEST M — MARKET VALUE ISOLATION', () => {
    const ctx1 = createBaseContext();
    const ctx2 = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, marketValue: 5000 } // Market value changed
    });

    const res1 = evaluateMaximumBid(ctx1);
    const res2 = evaluateMaximumBid(ctx2);

    expect(res1.maximumBid).toBe(res2.maximumBid);
    expect(res1.bindingConstraint).toBe(res2.bindingConstraint);
  });

  it('TEST N — PHASE BOUNDARY', () => {
    const res = evaluateMaximumBid(createBaseContext());

    // Phase 5 must not expose decision actions or opponent logic
    expect(res).not.toHaveProperty('action');
    expect(res).not.toHaveProperty('BID');
    expect(res).not.toHaveProperty('PASS');
    expect(res).not.toHaveProperty('STRETCH');
    expect(res).not.toHaveProperty('opponentDecision');
    expect(res).not.toHaveProperty('stretchAllowed');
  });

  // =========================================================================
  // ADDITIONAL REGRESSION & UTILITY TESTS
  // =========================================================================

  it('LEGAL BID NORMALIZATION HELPER', () => {
    expect(normalizeLegalBidCeiling(2037)).toBe(2030);
    expect(normalizeLegalBidCeiling(2030)).toBe(2030);
    expect(normalizeLegalBidCeiling(2039.9)).toBe(2030);
    expect(normalizeLegalBidCeiling(0)).toBe(0);
    expect(normalizeLegalBidCeiling(-50)).toBe(0);
  });

  it('EXCEEDED CEILING REASON WHEN CURRENT BID IS HIGHER', () => {
    const ctx = createBaseContext({ currentBid: 1600, nextRequiredBid: 1700 });
    const res = evaluateMaximumBid(ctx);

    expect(res.reasons.join(' ')).toContain('exceeded our maximum rational ceiling');
  });

  it('TIE BETWEEN PURSE AND TEAM VALUE', () => {
    const ctx = createBaseContext({
      teamValue: { ...createBaseContext().teamValue, teamValue: 1000 },
      purse: {
        currentPurse: 1000,
        remainingSquadSlots: 5,
        minimumRequiredFutureSpend: 0,
        health: 'SAFE'
      },
      futureBudget: 0
    });

    const res = evaluateMaximumBid(ctx);

    expect(res.maximumBid).toBe(1000);
    // Tie precedence: PURSE before TEAM_VALUE
    expect(res.bindingConstraint).toBe('PURSE');
    expect(res.tiedConstraints).toEqual(['PURSE', 'TEAM_VALUE']);
    expect(res.reasons.join(' ')).toContain('Constraints tied at 1000L: PURSE and TEAM_VALUE');
  });

});
