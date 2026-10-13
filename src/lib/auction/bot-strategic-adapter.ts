// src/lib/auction/bot-strategic-adapter.ts
//
// Phase 2J-Gamma: Strategic Adapter
//
// PURPOSE:
//   Translates raw Phase 2 structural intelligence (BotIntelligenceContext, CandidateAlignmentResult)
//   into a semantic StrategicDecisionPolicy object.
//
// RESPONSIBILITY:
//   Acts as an anti-corruption layer. Converts structural categorizations into
//   decision policies (Pursuit Stance, Persistence, Budget Preservation).
//   It calculates NO money, NO multipliers, and makes NO final bidding decisions.

import type { CandidateAlignmentResult } from './bot-candidate-alignment';
import type { BotIntelligenceContext } from './bot-intelligence-orchestrator';

// ============================================================
// TYPES
// ============================================================

export type PursuitStance =
  | 'CRITICAL_PURSUIT'
  | 'STRONG_PURSUIT'
  | 'OPPORTUNISTIC_PURSUIT'
  | 'WEAK_PURSUIT'
  | 'CONTINGENCY_PURSUIT'
  | 'ABANDON_PREFERENCE'
  | 'UNKNOWN';

export type StrategicPersistence = 'MAXIMUM' | 'STANDARD' | 'EARLY_ABANDONMENT';

export interface StrategicDecisionPolicy {
  /** Governs the baseline intent to engage with the candidate */
  readonly pursuitStance: PursuitStance;
  
  /** Governs willingness to execute ONE_LAST_BID or tolerate price pressure */
  readonly strategicPersistence: StrategicPersistence;
  
  /** Governs willingness to drop early to save purse for future critical gaps */
  readonly budgetPreservationIntent: boolean;
  
  /** Provides confirmation context if missing this candidate creates severe structural damage */
  readonly consequenceAwareness: 'HIGH' | 'NORMAL';
  
  /** True if the intelligence pipeline errored, signaling fallback to legacy logic */
  readonly isFallback: boolean;
}

// ============================================================
// ADAPTER LOGIC
// ============================================================

export function buildStrategicDecisionPolicy(
  candidateRole: string,
  orchestratorCtx: BotIntelligenceContext | null,
  alignmentResult: CandidateAlignmentResult | null
): StrategicDecisionPolicy {
  
  // 1. SAFE FALLBACK (Intelligence Error or Unavailable)
  if (!orchestratorCtx || !alignmentResult || alignmentResult.status === 'ERROR') {
    return {
      pursuitStance: 'UNKNOWN',
      strategicPersistence: 'STANDARD',
      budgetPreservationIntent: false,
      consequenceAwareness: 'NORMAL',
      isFallback: true,
    };
  }

  // 2. PURSUIT STANCE (from Candidate Alignment)
  let pursuitStance: PursuitStance = 'UNKNOWN';
  switch (alignmentResult.structuralFit) {
    case 'EXACT_PRIMARY_TARGET':
      pursuitStance = 'CRITICAL_PURSUIT';
      break;
    case 'EXACT_SECONDARY_TARGET':
      pursuitStance = 'STRONG_PURSUIT';
      break;
    case 'NON_PRIORITY_TARGET':
      pursuitStance = 'OPPORTUNISTIC_PURSUIT';
      break;
    case 'LOW_PRIORITY_TARGET':
      pursuitStance = 'WEAK_PURSUIT';
      break;
    case 'FALLBACK_PARTIAL':
    case 'FALLBACK_WEAK':
      pursuitStance = 'CONTINGENCY_PURSUIT';
      break;
    case 'REDUNDANT_ROLE':
    case 'STRUCTURAL_MISMATCH':
      pursuitStance = 'ABANDON_PREFERENCE';
      break;
  }

  // 3. PERSISTENCE (from 2F Alternative State)
  // We only care about alternatives for the role we are currently prioritizing
  let persistence: StrategicPersistence = 'STANDARD';
  
  if (orchestratorCtx.squadAlternativeState.primaryRole === candidateRole) {
    if (orchestratorCtx.squadAlternativeState.alternativeAvailability === 'NO_MEANINGFUL_ALTERNATIVE') {
      persistence = 'MAXIMUM';
    } else if (orchestratorCtx.squadAlternativeState.alternativeAvailability === 'ALTERNATIVES_AVAILABLE') {
      persistence = 'EARLY_ABANDONMENT';
    }
  }

  // 4. BUDGET PRESERVATION (from 2G Tradeoff State)
  let budgetPreservation = false;
  const tradeoff = 
    orchestratorCtx.squadTradeoffState.primaryOption?.role === candidateRole 
      ? orchestratorCtx.squadTradeoffState.primaryOption
      : orchestratorCtx.squadTradeoffState.alternativeOptions.find(opt => opt.role === candidateRole);

  if (tradeoff && tradeoff.tradeoffScore > 75) {
    // A high tradeoff score means pursuing this role causes severe sacrifice to a critical gap
    budgetPreservation = true;
  }

  // 5. CONSEQUENCE AWARENESS (from 2H Consequence State)
  let consequence: 'HIGH' | 'NORMAL' = 'NORMAL';
  const roleConsequence = orchestratorCtx.squadConsequenceState.options.find(
    (opt) => opt.role === candidateRole
  );
  if (roleConsequence && roleConsequence.finalConsequenceScore >= 80) {
    consequence = 'HIGH';
  }

  return {
    pursuitStance,
    strategicPersistence: persistence,
    budgetPreservationIntent: budgetPreservation,
    consequenceAwareness: consequence,
    isFallback: false,
  };
}
