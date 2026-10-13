import { describe, it, expect } from 'vitest';
import { buildStrategicDecisionPolicy } from '../../lib/auction/bot-strategic-adapter';
import type { CandidateAlignmentResult } from '../../lib/auction/bot-candidate-alignment';
import type { BotIntelligenceContext } from '../../lib/auction/bot-intelligence-orchestrator';

describe('Strategic Adapter', () => {
  const dummyCtx: Partial<BotIntelligenceContext> = {
    squadAlternativeState: { alternatives: [] } as any,
    squadTradeoffState: { alternativeOptions: [] } as any,
    squadConsequenceState: { options: [] } as any,
  };

  it('1. handles EXACT_PRIMARY_TARGET', () => {
    const result = buildStrategicDecisionPolicy('BATSMAN', dummyCtx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_PRIMARY_TARGET',
      matchedTargetPriority: 'CRITICAL',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.pursuitStance).toBe('CRITICAL_PURSUIT');
    expect(result.isFallback).toBe(false);
  });

  it('2. handles EXACT_SECONDARY_TARGET', () => {
    const result = buildStrategicDecisionPolicy('BOWLER', dummyCtx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_SECONDARY_TARGET',
      matchedTargetPriority: 'HIGH',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.pursuitStance).toBe('STRONG_PURSUIT');
  });

  it('3. handles NON_PRIORITY_TARGET', () => {
    const result = buildStrategicDecisionPolicy('ALL_ROUNDER', dummyCtx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'NON_PRIORITY_TARGET',
      matchedTargetPriority: 'MEDIUM',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.pursuitStance).toBe('OPPORTUNISTIC_PURSUIT');
  });

  it('4. handles LOW_PRIORITY_TARGET', () => {
    const result = buildStrategicDecisionPolicy('BATSMAN', dummyCtx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'LOW_PRIORITY_TARGET',
      matchedTargetPriority: 'LOW',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.pursuitStance).toBe('WEAK_PURSUIT');
  });

  it('5. handles REDUNDANT_ROLE', () => {
    const result = buildStrategicDecisionPolicy('BOWLER', dummyCtx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'REDUNDANT_ROLE',
      matchedTargetPriority: null,
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.pursuitStance).toBe('ABANDON_PREFERENCE');
  });

  it('6. handles FALLBACK_PARTIAL', () => {
    const result = buildStrategicDecisionPolicy('BOWLER', dummyCtx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'FALLBACK_PARTIAL',
      matchedTargetPriority: null,
      matchedFallbackType: 'PARTIAL',
      rationale: '',
    });
    expect(result.pursuitStance).toBe('CONTINGENCY_PURSUIT');
  });

  it('7. handles FALLBACK_WEAK', () => {
    const result = buildStrategicDecisionPolicy('BOWLER', dummyCtx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'FALLBACK_WEAK',
      matchedTargetPriority: null,
      matchedFallbackType: 'WEAK',
      rationale: '',
    });
    expect(result.pursuitStance).toBe('CONTINGENCY_PURSUIT');
  });

  it('8. handles STRUCTURAL_MISMATCH', () => {
    const result = buildStrategicDecisionPolicy('BOWLER', dummyCtx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'STRUCTURAL_MISMATCH',
      matchedTargetPriority: null,
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.pursuitStance).toBe('ABANDON_PREFERENCE');
  });

  it('9. handles ERROR (Alignment)', () => {
    const result = buildStrategicDecisionPolicy('BOWLER', dummyCtx as BotIntelligenceContext, {
      status: 'ERROR',
      structuralFit: 'STRUCTURAL_MISMATCH', // This shouldn't be parsed if ERROR
      matchedTargetPriority: null,
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.pursuitStance).toBe('UNKNOWN');
    expect(result.isFallback).toBe(true);
  });

  it('10. handles NO_MEANINGFUL_ALTERNATIVE', () => {
    const ctx: Partial<BotIntelligenceContext> = {
      squadAlternativeState: { primaryRole: 'BOWLER', alternativeAvailability: 'NO_MEANINGFUL_ALTERNATIVE', alternatives: [] } as any,
      squadTradeoffState: { alternativeOptions: [] } as any,
      squadConsequenceState: { options: [] } as any,
    };
    const result = buildStrategicDecisionPolicy('BOWLER', ctx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_PRIMARY_TARGET',
      matchedTargetPriority: 'CRITICAL',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.strategicPersistence).toBe('MAXIMUM');
  });

  it('11. handles LIMITED_ALTERNATIVES', () => {
    const ctx: Partial<BotIntelligenceContext> = {
      squadAlternativeState: { primaryRole: 'BOWLER', alternativeAvailability: 'LIMITED_ALTERNATIVES', alternatives: [] } as any,
      squadTradeoffState: { alternativeOptions: [] } as any,
      squadConsequenceState: { options: [] } as any,
    };
    const result = buildStrategicDecisionPolicy('BOWLER', ctx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_PRIMARY_TARGET',
      matchedTargetPriority: 'CRITICAL',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.strategicPersistence).toBe('STANDARD');
  });

  it('12. handles ALTERNATIVES_AVAILABLE', () => {
    const ctx: Partial<BotIntelligenceContext> = {
      squadAlternativeState: { primaryRole: 'BOWLER', alternativeAvailability: 'ALTERNATIVES_AVAILABLE', alternatives: [] } as any,
      squadTradeoffState: { alternativeOptions: [] } as any,
      squadConsequenceState: { options: [] } as any,
    };
    const result = buildStrategicDecisionPolicy('BOWLER', ctx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_PRIMARY_TARGET',
      matchedTargetPriority: 'CRITICAL',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.strategicPersistence).toBe('EARLY_ABANDONMENT');
  });

  it('13. handles low trade-off', () => {
    const ctx: Partial<BotIntelligenceContext> = {
      squadAlternativeState: { alternatives: [] } as any,
      squadTradeoffState: { alternativeOptions: [{ role: 'BOWLER', tradeoffScore: 40 }] } as any,
      squadConsequenceState: { options: [] } as any,
    };
    const result = buildStrategicDecisionPolicy('BOWLER', ctx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_PRIMARY_TARGET',
      matchedTargetPriority: 'CRITICAL',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.budgetPreservationIntent).toBe(false);
  });

  it('14. handles high trade-off', () => {
    const ctx: Partial<BotIntelligenceContext> = {
      squadAlternativeState: { alternatives: [] } as any,
      squadTradeoffState: { alternativeOptions: [{ role: 'BOWLER', tradeoffScore: 85 }] } as any,
      squadConsequenceState: { options: [] } as any,
    };
    const result = buildStrategicDecisionPolicy('BOWLER', ctx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_PRIMARY_TARGET',
      matchedTargetPriority: 'CRITICAL',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.budgetPreservationIntent).toBe(true);
  });

  it('15. handles low consequence', () => {
    const ctx: Partial<BotIntelligenceContext> = {
      squadAlternativeState: { alternatives: [] } as any,
      squadTradeoffState: { alternativeOptions: [] } as any,
      squadConsequenceState: { options: [{ role: 'BOWLER', finalConsequenceScore: 50 }] } as any,
    };
    const result = buildStrategicDecisionPolicy('BOWLER', ctx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_PRIMARY_TARGET',
      matchedTargetPriority: 'CRITICAL',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.consequenceAwareness).toBe('NORMAL');
  });

  it('16. handles high consequence', () => {
    const ctx: Partial<BotIntelligenceContext> = {
      squadAlternativeState: { alternatives: [] } as any,
      squadTradeoffState: { alternativeOptions: [] } as any,
      squadConsequenceState: { options: [{ role: 'BOWLER', finalConsequenceScore: 90 }] } as any,
    };
    const result = buildStrategicDecisionPolicy('BOWLER', ctx as BotIntelligenceContext, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_PRIMARY_TARGET',
      matchedTargetPriority: 'CRITICAL',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.consequenceAwareness).toBe('HIGH');
  });

  it('17. handles missing orchestrator ctx safely', () => {
    const result = buildStrategicDecisionPolicy('BOWLER', null, {
      status: 'SUCCESS',
      structuralFit: 'EXACT_PRIMARY_TARGET',
      matchedTargetPriority: 'CRITICAL',
      matchedFallbackType: null,
      rationale: '',
    });
    expect(result.isFallback).toBe(true);
  });
});
