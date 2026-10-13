"use strict";
// src/lib/auction/bot-candidate-alignment.ts
//
// Phase 2J-Alpha: Candidate Alignment Intelligence
//
// PURPOSE:
//   Evaluate the exact structural relationship between a candidate's role
//   and the bot's static target/fallback intelligence.
//
// RESPONSIBILITY:
//   Return a pure StructuralFitCategory.
//
// ARCHITECTURAL BOUNDARIES:
//   - Structural fit only. No intrinsic player valuation.
//   - No financial modifiers or bid limits.
//   - No live market dependencies.
//   - Never crashes the auction (defensive error handling).
//   - Consumes actual 2F fallback output, does not duplicate compatibility algorithms.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeCandidateAlignment = computeCandidateAlignment;
// ============================================================
// PURE EVALUATION LOGIC
// ============================================================
/**
 * Determine how the candidate's role satisfies the bot's strategic targets or fallbacks.
 *
 * This function is pure and deterministic. It does not look at player quality
 * or live market pressure.
 */
function computeCandidateAlignment(input) {
    try {
        var candidateRole_1 = input.candidateRole, targetState = input.targetState, alternativeState = input.alternativeState;
        // 1. Defensive Validation
        if (!candidateRole_1 || !targetState || !targetState.roles || !alternativeState || !alternativeState.alternatives) {
            return {
                status: 'ERROR',
                structuralFit: 'STRUCTURAL_MISMATCH',
                matchedTargetPriority: null,
                matchedFallbackType: null,
                rationale: 'INTELLIGENCE_ERROR: Input state is malformed or missing.',
            };
        }
        var targetProfile = targetState.roles[candidateRole_1];
        if (!targetProfile) {
            return {
                status: 'ERROR',
                structuralFit: 'STRUCTURAL_MISMATCH',
                matchedTargetPriority: null,
                matchedFallbackType: null,
                rationale: "INTELLIGENCE_ERROR: Target state missing profile for role ".concat(candidateRole_1, "."),
            };
        }
        // 2. Exact Target Matching (Primary/Secondary precedence)
        var priority = targetProfile.targetPriority;
        if (targetProfile.isPrimaryTarget) {
            return {
                status: 'SUCCESS',
                structuralFit: 'EXACT_PRIMARY_TARGET',
                matchedTargetPriority: priority,
                matchedFallbackType: null,
                rationale: "Candidate directly matches the PRIMARY strategic target (".concat(candidateRole_1, ")."),
            };
        }
        if (targetProfile.isSecondaryTarget) {
            return {
                status: 'SUCCESS',
                structuralFit: 'EXACT_SECONDARY_TARGET',
                matchedTargetPriority: priority,
                matchedFallbackType: null,
                rationale: "Candidate directly matches the SECONDARY strategic target (".concat(candidateRole_1, ")."),
            };
        }
        // 3. Fallback Path Matching (via Phase 2F)
        var fallbackProfile = alternativeState.alternatives.find(function (a) { return a.role === candidateRole_1; });
        if (fallbackProfile) {
            var altType = fallbackProfile.alternativeType;
            if (altType === 'PARTIAL') {
                return {
                    status: 'SUCCESS',
                    structuralFit: 'FALLBACK_PARTIAL',
                    matchedTargetPriority: null,
                    matchedFallbackType: 'PARTIAL',
                    rationale: "Candidate provides PARTIAL structural fallback for the primary target via ".concat(candidateRole_1, "."),
                };
            }
            if (altType === 'WEAK') {
                return {
                    status: 'SUCCESS',
                    structuralFit: 'FALLBACK_WEAK',
                    matchedTargetPriority: null,
                    matchedFallbackType: 'WEAK',
                    rationale: "Candidate provides WEAK structural fallback for the primary target via ".concat(candidateRole_1, "."),
                };
            }
        }
        // 4. Exact Target Matching (Non-1st/2nd Priority Classification)
        if (priority === 'NONE' || targetProfile.gapLevel === 'REDUNDANT') {
            return {
                status: 'SUCCESS',
                structuralFit: 'REDUNDANT_ROLE',
                matchedTargetPriority: priority,
                matchedFallbackType: null,
                rationale: "Candidate matches a role that is structurally REDUNDANT or has no priority (".concat(candidateRole_1, ")."),
            };
        }
        if (priority === 'LOW') {
            return {
                status: 'SUCCESS',
                structuralFit: 'LOW_PRIORITY_TARGET',
                matchedTargetPriority: priority,
                matchedFallbackType: null,
                rationale: "Candidate matches a role target with LOW priority (".concat(candidateRole_1, ")."),
            };
        }
        // It's a valid target (CRITICAL/HIGH/MEDIUM/NORMAL) but neither 1st nor 2nd
        if (priority === 'CRITICAL' || priority === 'HIGH' || priority === 'MEDIUM') {
            return {
                status: 'SUCCESS',
                structuralFit: 'NON_PRIORITY_TARGET',
                matchedTargetPriority: priority,
                matchedFallbackType: null,
                rationale: "Candidate matches a target role (".concat(candidateRole_1, ") with ").concat(priority, " priority, but it is not the primary/secondary focus."),
            };
        }
        // 5. No Match
        return {
            status: 'SUCCESS',
            structuralFit: 'STRUCTURAL_MISMATCH',
            matchedTargetPriority: null,
            matchedFallbackType: null,
            rationale: "Candidate role (".concat(candidateRole_1, ") does not solve target needs or provide a recognized fallback."),
        };
    }
    catch (err) {
        // Failsafe for unexpected exceptions
        return {
            status: 'ERROR',
            structuralFit: 'STRUCTURAL_MISMATCH',
            matchedTargetPriority: null,
            matchedFallbackType: null,
            rationale: "INTELLIGENCE_ERROR: Unexpected exception during alignment evaluation.",
        };
    }
}
