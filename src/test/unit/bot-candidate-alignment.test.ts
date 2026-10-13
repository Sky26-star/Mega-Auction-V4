// src/test/unit/bot-candidate-alignment.test.ts
//
// Phase 2J-Alpha: Candidate Alignment Intelligence — Tests
//
// Tests cover the entire structural mapping matrix:
//   - Exact primary / secondary targets
//   - Non-priority and low-priority targets
//   - Redundant roles
//   - Phase 2F fallback paths (Partial / Weak)
//   - Structural Mismatch
//   - Intelligence Error (Malformed state)

import { describe, it, expect } from 'vitest';
import { 
  computeCandidateAlignment,
  type CandidateAlignmentInput,
  type StructuralFitCategory
} from '../../lib/auction/bot-candidate-alignment';
import { type BotSquadTargetState, type RoleTargetProfile } from '../../lib/auction/bot-squad-target-intelligence';
import { type BotSquadAlternativeState, type RoleAlternativeProfile } from '../../lib/auction/bot-squad-alternative-intelligence';
import { type RoleKey, type PriorityLevel } from '../../lib/auction/bot-squad-priority-intelligence';

// ============================================================
// TEST HELPERS
// ============================================================

function makeTargetProfile(overrides: Partial<RoleTargetProfile> = {}): RoleTargetProfile {
  return {
    role: 'BATSMAN',
    targetPriority: 'CRITICAL',
    targetScore: 100,
    targetUrgency: 100,
    currentCount: 0,
    roleNeed: 'CRITICAL',
    gapLevel: 'CRITICAL',
    isPrimaryTarget: false,
    isSecondaryTarget: false,
    rationale: 'Test rationale',
    ...overrides,
  };
}

function makeTargetState(overrides: Partial<BotSquadTargetState> = {}): BotSquadTargetState {
  const roles = {
    BATSMAN: makeTargetProfile({ role: 'BATSMAN' }),
    BOWLER: makeTargetProfile({ role: 'BOWLER' }),
    ALL_ROUNDER: makeTargetProfile({ role: 'ALL_ROUNDER' }),
    WICKET_KEEPER: makeTargetProfile({ role: 'WICKET_KEEPER' }),
  };
  return {
    teamId: 'team-alpha',
    primaryTarget: null,
    secondaryTarget: null,
    targetOrder: [],
    roles,
    ...overrides,
  };
}

function makeAlternativeProfile(overrides: Partial<RoleAlternativeProfile> = {}): RoleAlternativeProfile {
  return {
    role: 'ALL_ROUNDER',
    alternativeType: 'PARTIAL',
    alternativeScore: 75,
    alternativeUrgency: 75,
    compatibilityScore: 75,
    currentCount: 0,
    roleNeed: 'CRITICAL',
    gapLevel: 'CRITICAL',
    rationale: 'Test rationale',
    ...overrides,
  };
}

function makeAlternativeState(overrides: Partial<BotSquadAlternativeState> = {}): BotSquadAlternativeState {
  return {
    teamId: 'team-alpha',
    primaryRole: 'BOWLER',
    alternativeAvailability: 'LIMITED_ALTERNATIVES',
    targetDependency: 'HIGH_DEPENDENCY',
    alternatives: [],
    fallbackOrder: [],
    ...overrides,
  };
}

function makeInput(candidateRole: RoleKey, targetOverrides: Partial<BotSquadTargetState> = {}, altOverrides: Partial<BotSquadAlternativeState> = {}): CandidateAlignmentInput {
  return {
    candidateRole,
    targetState: makeTargetState(targetOverrides),
    alternativeState: makeAlternativeState(altOverrides),
  };
}

// ============================================================
// TESTS
// ============================================================

describe('Bot Candidate Alignment (Phase 2J-Alpha)', () => {

  // ============================
  // A. Target Matching
  // ============================
  describe('A. Target Matching', () => {

    it('1. identifies EXACT_PRIMARY_TARGET', () => {
      const targetState = makeTargetState({

        roles: {
          ...makeTargetState().roles,
          BOWLER: makeTargetProfile({ role: 'BOWLER', isPrimaryTarget: true, targetPriority: 'CRITICAL' }),
        }
      });
      const input = makeInput('BOWLER', targetState);
      const result = computeCandidateAlignment(input);

      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('EXACT_PRIMARY_TARGET');
      expect(result.matchedTargetPriority).toBe('CRITICAL');
      expect(result.matchedFallbackType).toBeNull();
    });

    it('2. identifies EXACT_SECONDARY_TARGET', () => {
      const targetState = makeTargetState({
        roles: {
          ...makeTargetState().roles,
          ALL_ROUNDER: makeTargetProfile({ role: 'ALL_ROUNDER', isSecondaryTarget: true, targetPriority: 'HIGH' }),
        }
      });
      const input = makeInput('ALL_ROUNDER', targetState);
      const result = computeCandidateAlignment(input);

      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('EXACT_SECONDARY_TARGET');
      expect(result.matchedTargetPriority).toBe('HIGH');
    });

    it('3. identifies NON_PRIORITY_TARGET for valid non-primary targets', () => {
      const targetState = makeTargetState({
        roles: {
          ...makeTargetState().roles,
          BATSMAN: makeTargetProfile({ role: 'BATSMAN', targetPriority: 'MEDIUM' }), // Not primary or secondary
        }
      });
      const input = makeInput('BATSMAN', targetState);
      const result = computeCandidateAlignment(input);

      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('NON_PRIORITY_TARGET');
      expect(result.matchedTargetPriority).toBe('MEDIUM');
    });

    it('4. identifies LOW_PRIORITY_TARGET', () => {
      const targetState = makeTargetState({
        roles: {
          ...makeTargetState().roles,
          WICKET_KEEPER: makeTargetProfile({ role: 'WICKET_KEEPER', targetPriority: 'LOW' }),
        }
      });
      const input = makeInput('WICKET_KEEPER', targetState);
      const result = computeCandidateAlignment(input);

      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('LOW_PRIORITY_TARGET');
      expect(result.matchedTargetPriority).toBe('LOW');
    });

    it('5. identifies REDUNDANT_ROLE from NONE priority', () => {
      const targetState = makeTargetState({
        roles: {
          ...makeTargetState().roles,
          BATSMAN: makeTargetProfile({ role: 'BATSMAN', targetPriority: 'NONE' }),
        }
      });
      const input = makeInput('BATSMAN', targetState);
      const result = computeCandidateAlignment(input);

      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('REDUNDANT_ROLE');
    });

    it('6. identifies REDUNDANT_ROLE from REDUNDANT gap level despite priority', () => {
      const targetState = makeTargetState({
        roles: {
          ...makeTargetState().roles,
          BATSMAN: makeTargetProfile({ role: 'BATSMAN', gapLevel: 'REDUNDANT' }),
        }
      });
      const input = makeInput('BATSMAN', targetState);
      const result = computeCandidateAlignment(input);

      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('REDUNDANT_ROLE');
    });
  });

  // ============================
  // B. Fallback Matching
  // ============================
  describe('B. Fallback Matching', () => {

    it('7. identifies FALLBACK_PARTIAL from 2F Alternative State and overrides low priority', () => {
      const targetState = makeTargetState({

        roles: {
          ...makeTargetState().roles,
          BOWLER: makeTargetProfile({ role: 'BOWLER', isPrimaryTarget: true, targetPriority: 'CRITICAL' }),
          // ALL_ROUNDER is a fallback. Without 2F, it would be LOW priority or NONE.
          ALL_ROUNDER: makeTargetProfile({ role: 'ALL_ROUNDER', targetPriority: 'NONE' }), 
        }
      });
      
      const alternativeState = makeAlternativeState({
        primaryRole: 'BOWLER',
        alternatives: [
          makeAlternativeProfile({ role: 'ALL_ROUNDER', alternativeType: 'PARTIAL' })
        ]
      });

      const input = makeInput('ALL_ROUNDER', targetState, alternativeState);
      const result = computeCandidateAlignment(input);

      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('FALLBACK_PARTIAL');
      expect(result.matchedFallbackType).toBe('PARTIAL');
      expect(result.matchedTargetPriority).toBeNull();
    });

    it('8. identifies FALLBACK_WEAK from 2F Alternative State', () => {
      const targetState = makeTargetState({
        roles: {
          ...makeTargetState().roles,
          WICKET_KEEPER: makeTargetProfile({ role: 'WICKET_KEEPER', isPrimaryTarget: true }),
          BATSMAN: makeTargetProfile({ role: 'BATSMAN', targetPriority: 'LOW' }), 
        }
      });
      
      const alternativeState = makeAlternativeState({
        primaryRole: 'WICKET_KEEPER',
        alternatives: [
          makeAlternativeProfile({ role: 'BATSMAN', alternativeType: 'WEAK' })
        ]
      });

      const input = makeInput('BATSMAN', targetState, alternativeState);
      const result = computeCandidateAlignment(input);

      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('FALLBACK_WEAK');
      expect(result.matchedFallbackType).toBe('WEAK');
    });

    it('9. exact targets override fallback paths', () => {
      // If a candidate is somehow BOTH the primary target AND listed in fallbacks
      const targetState = makeTargetState({

        roles: {
          ...makeTargetState().roles,
          BOWLER: makeTargetProfile({ role: 'BOWLER', isPrimaryTarget: true, targetPriority: 'CRITICAL' }),
        }
      });
      
      const alternativeState = makeAlternativeState({
        primaryRole: 'BOWLER',
        alternatives: [
          makeAlternativeProfile({ role: 'BOWLER', alternativeType: 'DIRECT' }) // Edge case: 2F says direct substitute
        ]
      });

      const input = makeInput('BOWLER', targetState, alternativeState);
      const result = computeCandidateAlignment(input);

      // Should match exactly, fallback logic is bypassed
      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('EXACT_PRIMARY_TARGET');
    });
  });

  // ============================
  // C. Structural Mismatch
  // ============================
  describe('C. Structural Mismatch', () => {
    
    it('10. identifies STRUCTURAL_MISMATCH when no target or fallback exists', () => {
       // Target logic falls through to mismatch (not explicitly caught by priority levels)
       // Let's test a case where we pass an unknown role or a role with no profile.
       const input = makeInput('BATSMAN');
       // Remove BATSMAN profile
       delete (input.targetState.roles as any).BATSMAN;

       const result = computeCandidateAlignment(input);
       
       expect(result.status).toBe('ERROR');
       expect(result.structuralFit).toBe('STRUCTURAL_MISMATCH');
    });

    it('11. identifies STRUCTURAL_MISMATCH when alternativeType is NONE and priority is NORMAL but not 1st/2nd', () => {
      // Wait, if priority is NORMAL, it catches NON_PRIORITY_TARGET.
      // What if we don't match ANY priority checks? The function catches them all right now.
      // The only way to get a pure 'SUCCESS' 'STRUCTURAL_MISMATCH' is if targetState has a role, but priority is missing or unexpected.
      const targetState = makeTargetState({
        roles: {
          ...makeTargetState().roles,
          BATSMAN: makeTargetProfile({ role: 'BATSMAN', targetPriority: 'UNKNOWN' as any, gapLevel: 'NORMAL' }),
        }
      });
      const input = makeInput('BATSMAN', targetState);
      const result = computeCandidateAlignment(input);

      expect(result.status).toBe('SUCCESS');
      expect(result.structuralFit).toBe('STRUCTURAL_MISMATCH');
    });
  });

  // ============================
  // D. Error Handling
  // ============================
  describe('D. Error Handling', () => {
    
    it('12. handles completely missing input safely', () => {
      const result = computeCandidateAlignment({} as CandidateAlignmentInput);
      expect(result.status).toBe('ERROR');
      expect(result.structuralFit).toBe('STRUCTURAL_MISMATCH');
      expect(result.rationale).toContain('INTELLIGENCE_ERROR');
    });

    it('13. handles missing target state safely', () => {
      const result = computeCandidateAlignment({
        candidateRole: 'BOWLER',
        targetState: null as any,
        alternativeState: makeAlternativeState()
      });
      expect(result.status).toBe('ERROR');
      expect(result.structuralFit).toBe('STRUCTURAL_MISMATCH');
    });

    it('14. handles missing alternative state safely', () => {
      const result = computeCandidateAlignment({
        candidateRole: 'BOWLER',
        targetState: makeTargetState(),
        alternativeState: null as any
      });
      expect(result.status).toBe('ERROR');
      expect(result.structuralFit).toBe('STRUCTURAL_MISMATCH');
    });

    it('15. gracefully handles missing role profile in targetState', () => {
      const targetState = makeTargetState();
      delete (targetState.roles as any).BOWLER;
      
      const result = computeCandidateAlignment({
        candidateRole: 'BOWLER',
        targetState,
        alternativeState: makeAlternativeState()
      });
      
      expect(result.status).toBe('ERROR');
      expect(result.structuralFit).toBe('STRUCTURAL_MISMATCH');
      expect(result.rationale).toContain('missing profile');
    });
  });
});
