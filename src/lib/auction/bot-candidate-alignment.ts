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

import { type RoleKey, type PriorityLevel } from './bot-squad-priority-intelligence';
import { type BotSquadTargetState } from './bot-squad-target-intelligence';
import { type BotSquadAlternativeState, type AlternativeType } from './bot-squad-alternative-intelligence';

// ============================================================
// TYPES
// ============================================================

export interface CandidateAlignmentInput {
  readonly candidateRole: RoleKey;
  readonly targetState: BotSquadTargetState;
  readonly alternativeState: BotSquadAlternativeState;
}

export type StructuralFitCategory = 
  | 'EXACT_PRIMARY_TARGET'
  | 'EXACT_SECONDARY_TARGET'
  | 'NON_PRIORITY_TARGET'   // Matched target with CRITICAL/HIGH/MEDIUM priority, but not 1st/2nd
  | 'LOW_PRIORITY_TARGET'   // Matched target with LOW priority
  | 'REDUNDANT_ROLE'        // Matched target with NONE priority or REDUNDANT gapLevel
  | 'FALLBACK_PARTIAL'      // Matches an alternative path with PARTIAL type
  | 'FALLBACK_WEAK'         // Matches an alternative path with WEAK type
  | 'STRUCTURAL_MISMATCH';  // No target match and no fallback path match

export type AlignmentStatus = 'SUCCESS' | 'ERROR';

export interface CandidateAlignmentResult {
  readonly status: AlignmentStatus;
  readonly structuralFit: StructuralFitCategory;
  
  // Context mapping (null if mismatch or error)
  readonly matchedTargetPriority: PriorityLevel | null;
  readonly matchedFallbackType: AlternativeType | null;
  
  // Explanation strictly for debugging/logs
  readonly rationale: string;
}

// ============================================================
// PURE EVALUATION LOGIC
// ============================================================

/**
 * Determine how the candidate's role satisfies the bot's strategic targets or fallbacks.
 *
 * This function is pure and deterministic. It does not look at player quality
 * or live market pressure.
 */
export function computeCandidateAlignment(input: CandidateAlignmentInput): CandidateAlignmentResult {
  try {
    const { candidateRole, targetState, alternativeState } = input;

    // 1. Defensive Validation
    if (!candidateRole || !targetState || !targetState.roles || !alternativeState || !alternativeState.alternatives) {
      return {
        status: 'ERROR',
        structuralFit: 'STRUCTURAL_MISMATCH',
        matchedTargetPriority: null,
        matchedFallbackType: null,
        rationale: 'INTELLIGENCE_ERROR: Input state is malformed or missing.',
      };
    }

    const targetProfile = targetState.roles[candidateRole];
    if (!targetProfile) {
      return {
        status: 'ERROR',
        structuralFit: 'STRUCTURAL_MISMATCH',
        matchedTargetPriority: null,
        matchedFallbackType: null,
        rationale: `INTELLIGENCE_ERROR: Target state missing profile for role ${candidateRole}.`,
      };
    }

    // 2. Exact Target Matching (Primary/Secondary precedence)
    const priority = targetProfile.targetPriority;
    
    if (targetProfile.isPrimaryTarget) {
      return {
        status: 'SUCCESS',
        structuralFit: 'EXACT_PRIMARY_TARGET',
        matchedTargetPriority: priority,
        matchedFallbackType: null,
        rationale: `Candidate directly matches the PRIMARY strategic target (${candidateRole}).`,
      };
    }

    if (targetProfile.isSecondaryTarget) {
      return {
        status: 'SUCCESS',
        structuralFit: 'EXACT_SECONDARY_TARGET',
        matchedTargetPriority: priority,
        matchedFallbackType: null,
        rationale: `Candidate directly matches the SECONDARY strategic target (${candidateRole}).`,
      };
    }

    // 3. Fallback Path Matching (via Phase 2F)
    const fallbackProfile = alternativeState.alternatives.find(a => a.role === candidateRole);
    if (fallbackProfile) {
      const altType = fallbackProfile.alternativeType;
      if (altType === 'PARTIAL') {
        return {
          status: 'SUCCESS',
          structuralFit: 'FALLBACK_PARTIAL',
          matchedTargetPriority: null,
          matchedFallbackType: 'PARTIAL',
          rationale: `Candidate provides PARTIAL structural fallback for the primary target via ${candidateRole}.`,
        };
      }
      
      if (altType === 'WEAK') {
        return {
          status: 'SUCCESS',
          structuralFit: 'FALLBACK_WEAK',
          matchedTargetPriority: null,
          matchedFallbackType: 'WEAK',
          rationale: `Candidate provides WEAK structural fallback for the primary target via ${candidateRole}.`,
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
        rationale: `Candidate matches a role that is structurally REDUNDANT or has no priority (${candidateRole}).`,
      };
    }

    if (priority === 'LOW') {
      return {
        status: 'SUCCESS',
        structuralFit: 'LOW_PRIORITY_TARGET',
        matchedTargetPriority: priority,
        matchedFallbackType: null,
        rationale: `Candidate matches a role target with LOW priority (${candidateRole}).`,
      };
    }

    // It's a valid target (CRITICAL/HIGH/MEDIUM/NORMAL) but neither 1st nor 2nd
    if (priority === 'CRITICAL' || priority === 'HIGH' || priority === 'MEDIUM') {
      return {
        status: 'SUCCESS',
        structuralFit: 'NON_PRIORITY_TARGET',
        matchedTargetPriority: priority,
        matchedFallbackType: null,
        rationale: `Candidate matches a target role (${candidateRole}) with ${priority} priority, but it is not the primary/secondary focus.`,
      };
    }

    // 5. No Match
    return {
      status: 'SUCCESS',
      structuralFit: 'STRUCTURAL_MISMATCH',
      matchedTargetPriority: null,
      matchedFallbackType: null,
      rationale: `Candidate role (${candidateRole}) does not solve target needs or provide a recognized fallback.`,
    };

  } catch (err) {
    // Failsafe for unexpected exceptions
    return {
      status: 'ERROR',
      structuralFit: 'STRUCTURAL_MISMATCH',
      matchedTargetPriority: null,
      matchedFallbackType: null,
      rationale: `INTELLIGENCE_ERROR: Unexpected exception during alignment evaluation.`,
    };
  }
}
