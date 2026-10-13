"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStrategicDecisionPolicy = buildStrategicDecisionPolicy;
// ============================================================
// ADAPTER LOGIC
// ============================================================
function buildStrategicDecisionPolicy(candidateRole, orchestratorCtx, alignmentResult) {
    var _a;
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
    var pursuitStance = 'UNKNOWN';
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
    var persistence = 'STANDARD';
    if (orchestratorCtx.squadAlternativeState.primaryRole === candidateRole) {
        if (orchestratorCtx.squadAlternativeState.alternativeAvailability === 'NO_MEANINGFUL_ALTERNATIVE') {
            persistence = 'MAXIMUM';
        }
        else if (orchestratorCtx.squadAlternativeState.alternativeAvailability === 'ALTERNATIVES_AVAILABLE') {
            persistence = 'EARLY_ABANDONMENT';
        }
    }
    // 4. BUDGET PRESERVATION (from 2G Tradeoff State)
    var budgetPreservation = false;
    var tradeoff = ((_a = orchestratorCtx.squadTradeoffState.primaryOption) === null || _a === void 0 ? void 0 : _a.role) === candidateRole
        ? orchestratorCtx.squadTradeoffState.primaryOption
        : orchestratorCtx.squadTradeoffState.alternativeOptions.find(function (opt) { return opt.role === candidateRole; });
    if (tradeoff && tradeoff.tradeoffScore > 75) {
        // A high tradeoff score means pursuing this role causes severe sacrifice to a critical gap
        budgetPreservation = true;
    }
    // 5. CONSEQUENCE AWARENESS (from 2H Consequence State)
    var consequence = 'NORMAL';
    var roleConsequence = orchestratorCtx.squadConsequenceState.options.find(function (opt) { return opt.role === candidateRole; });
    if (roleConsequence && roleConsequence.finalConsequenceScore >= 80) {
        consequence = 'HIGH';
    }
    return {
        pursuitStance: pursuitStance,
        strategicPersistence: persistence,
        budgetPreservationIntent: budgetPreservation,
        consequenceAwareness: consequence,
        isFallback: false,
    };
}
