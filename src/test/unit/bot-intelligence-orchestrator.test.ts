// src/test/unit/bot-intelligence-orchestrator.test.ts
//
// Phase 2I: Bot Intelligence Orchestrator & Cache — Tests
//
// Tests cover:
//   A. Pipeline Execution & Completeness
//   B. Determinism
//   C. Cache Hit/Miss Behaviour
//   D. Cache Invalidation & Lifecycle
//   E. Structural vs Market Separation
//   F. Immutability
//   G. Squad Edge Cases
//   H. Fingerprint Correctness

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBotIntelligenceContext,
  invalidateBotIntelligence,
  clearAllBotIntelligence,
  getCacheSize,
  hasCachedIntelligence,
  computeStructuralFingerprint,
  type BotIntelligenceInput,
  type BotIntelligenceContext,
} from '../../lib/auction/bot-intelligence-orchestrator';
import { type V3Team, type V3Player } from '../../lib/v3-auction-types';

// ============================================================
// TEST HELPERS
// ============================================================

function makeTeam(overrides: Partial<V3Team> = {}): V3Team {
  return {
    id: 'team-alpha',
    name: 'Alpha FC',
    short_name: 'ALP',
    purse: 8000,
    initial_purse: 12000,
    players_bought: 5,
    overseas_count: 2,
    is_bot: true,
    ...overrides,
  };
}

function makePlayer(role: string, is_overseas = false): V3Player {
  return {
    id: `player-${role}-${Math.random().toString(36).slice(2, 6)}`,
    name: `Test ${role}`,
    role: role as V3Player['role'],
    base_price: 100,
    is_overseas,
    category: 'B' as V3Player['category'],
    country: is_overseas ? 'AUS' : 'IND',
    age: 28,
    batting_hand: 'Right',
    image_url: null,
    matches: 50,
    runs: 1000,
    batting_average: 30,
    strike_rate: 130,
    wickets: 20,
    bowling_average: 28,
    economy_rate: 7.5,
    fifties: 5,
    hundreds: 2,
    best_bowling: '3/25',
    catches: 10,
    stumpings: 0,
  };
}

function makeRoster(counts: { BATSMAN?: number; BOWLER?: number; ALL_ROUNDER?: number; WICKET_KEEPER?: number } = {}): V3Player[] {
  const roster: V3Player[] = [];
  for (let i = 0; i < (counts.BATSMAN ?? 0); i++) roster.push(makePlayer('BATSMAN'));
  for (let i = 0; i < (counts.BOWLER ?? 0); i++) roster.push(makePlayer('BOWLER'));
  for (let i = 0; i < (counts.ALL_ROUNDER ?? 0); i++) roster.push(makePlayer('ALL_ROUNDER'));
  for (let i = 0; i < (counts.WICKET_KEEPER ?? 0); i++) roster.push(makePlayer('WICKET_KEEPER'));
  return roster;
}

function makeInput(overrides: Partial<BotIntelligenceInput> = {}): BotIntelligenceInput {
  const team = overrides.team ?? makeTeam();
  const roster = overrides.roster ?? makeRoster({ BATSMAN: 2, BOWLER: 1, ALL_ROUNDER: 1, WICKET_KEEPER: 1 });
  return {
    team,
    roster,
    maxSquadSize: overrides.maxSquadSize ?? 25,
    maxOverseas: overrides.maxOverseas ?? 8,
  };
}

// ============================================================
// TESTS
// ============================================================

describe('Bot Intelligence Orchestrator (Phase 2I)', () => {

  beforeEach(() => {
    clearAllBotIntelligence();
  });

  // ============================
  // A. Pipeline Execution & Completeness
  // ============================
  describe('A. Pipeline Execution & Completeness', () => {

    it('1. complete 2A→2H pipeline executes and returns all expected outputs', () => {
      const input = makeInput();
      const ctx = getBotIntelligenceContext(input);

      // All 8 phases present
      expect(ctx.squadState).toBeDefined();
      expect(ctx.roleGapState).toBeDefined();
      expect(ctx.squadQualityState).toBeDefined();
      expect(ctx.squadPriorityState).toBeDefined();
      expect(ctx.squadTargetState).toBeDefined();
      expect(ctx.squadAlternativeState).toBeDefined();
      expect(ctx.squadTradeoffState).toBeDefined();
      expect(ctx.squadConsequenceState).toBeDefined();

      // Metadata
      expect(ctx.teamId).toBe('team-alpha');
      expect(ctx.fingerprint).toBeDefined();
      expect(typeof ctx.fingerprint).toBe('string');
      expect(ctx.fingerprint.length).toBeGreaterThan(0);
    });

    it('2. squadState (2A) reflects actual roster composition', () => {
      const roster = makeRoster({ BATSMAN: 3, BOWLER: 2, ALL_ROUNDER: 1, WICKET_KEEPER: 1 });
      const team = makeTeam({ players_bought: 7 });
      const ctx = getBotIntelligenceContext({ team, roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(ctx.squadState.squadSize).toBe(7);
      expect(ctx.squadState.roleComposition.BATSMAN).toBe(3);
      expect(ctx.squadState.roleComposition.BOWLER).toBe(2);
      expect(ctx.squadState.roleComposition.ALL_ROUNDER).toBe(1);
      expect(ctx.squadState.roleComposition.WICKET_KEEPER).toBe(1);
      expect(ctx.squadState.remainingSlots).toBe(18);
    });

    it('3. existing 2A–2H functions are reused (teamId propagates through chain)', () => {
      const team = makeTeam({ id: 'unique-team-xyz' });
      const ctx = getBotIntelligenceContext({ team, roster: makeRoster({ BATSMAN: 1 }), maxSquadSize: 25, maxOverseas: 8 });

      // teamId propagates through every phase
      expect(ctx.squadState.teamId).toBe('unique-team-xyz');
      expect(ctx.roleGapState.teamId).toBe('unique-team-xyz');
      expect(ctx.squadQualityState.teamId).toBe('unique-team-xyz');
      expect(ctx.squadPriorityState.teamId).toBe('unique-team-xyz');
      expect(ctx.squadTargetState.teamId).toBe('unique-team-xyz');
      expect(ctx.squadAlternativeState.teamId).toBe('unique-team-xyz');
      expect(ctx.squadTradeoffState.teamId).toBe('unique-team-xyz');
      expect(ctx.squadConsequenceState.teamId).toBe('unique-team-xyz');
    });
  });

  // ============================
  // B. Determinism
  // ============================
  describe('B. Determinism', () => {

    it('4. identical input produces identical context', () => {
      // Use fixed roster (no randomness in player IDs for structural comparison)
      const team = makeTeam();
      const roster = makeRoster({ BATSMAN: 2, BOWLER: 2, ALL_ROUNDER: 1, WICKET_KEEPER: 0 });
      const input: BotIntelligenceInput = { team, roster, maxSquadSize: 25, maxOverseas: 8 };

      clearAllBotIntelligence();
      const ctx1 = getBotIntelligenceContext(input);

      clearAllBotIntelligence();
      const ctx2 = getBotIntelligenceContext(input);

      // Deep structural equality (both are independent pipeline runs)
      expect(ctx1.squadState).toEqual(ctx2.squadState);
      expect(ctx1.roleGapState).toEqual(ctx2.roleGapState);
      expect(ctx1.squadQualityState).toEqual(ctx2.squadQualityState);
      expect(ctx1.squadPriorityState).toEqual(ctx2.squadPriorityState);
      expect(ctx1.squadTargetState).toEqual(ctx2.squadTargetState);
      expect(ctx1.squadAlternativeState).toEqual(ctx2.squadAlternativeState);
      expect(ctx1.squadTradeoffState).toEqual(ctx2.squadTradeoffState);
      expect(ctx1.squadConsequenceState).toEqual(ctx2.squadConsequenceState);
    });

    it('5. structural fingerprint is deterministic', () => {
      const input = makeInput();
      const fp1 = computeStructuralFingerprint(input);
      const fp2 = computeStructuralFingerprint(input);
      expect(fp1).toBe(fp2);
    });

    it('6. same structural input returns equivalent cached intelligence', () => {
      const input = makeInput();
      const ctx1 = getBotIntelligenceContext(input);
      const ctx2 = getBotIntelligenceContext(input); // should be cache hit

      expect(ctx1.fingerprint).toBe(ctx2.fingerprint);
      expect(ctx1.squadState).toEqual(ctx2.squadState);
      expect(ctx1.squadConsequenceState).toEqual(ctx2.squadConsequenceState);
    });
  });

  // ============================
  // C. Cache Hit/Miss Behaviour
  // ============================
  describe('C. Cache Hit/Miss Behaviour', () => {

    it('7. same structural input reuses cache', () => {
      const input = makeInput();

      getBotIntelligenceContext(input); // miss
      expect(getCacheSize()).toBe(1);

      getBotIntelligenceContext(input); // hit
      expect(getCacheSize()).toBe(1); // still 1 entry
    });

    it('8. changed roster invalidates cache (different composition)', () => {
      const team = makeTeam();
      const input1: BotIntelligenceInput = {
        team,
        roster: makeRoster({ BATSMAN: 2, BOWLER: 1 }),
        maxSquadSize: 25,
        maxOverseas: 8,
      };
      const input2: BotIntelligenceInput = {
        team,
        roster: makeRoster({ BATSMAN: 3, BOWLER: 1 }), // added 1 BATSMAN
        maxSquadSize: 25,
        maxOverseas: 8,
      };

      const ctx1 = getBotIntelligenceContext(input1);
      const ctx2 = getBotIntelligenceContext(input2);

      expect(ctx1.fingerprint).not.toBe(ctx2.fingerprint);
      expect(ctx1.squadState.roleComposition.BATSMAN).toBe(2);
      expect(ctx2.squadState.roleComposition.BATSMAN).toBe(3);
    });

    it('9. changed purse invalidates cache', () => {
      const roster = makeRoster({ BATSMAN: 2 });
      const team1 = makeTeam({ purse: 8000 });
      const team2 = makeTeam({ purse: 7500 });

      const ctx1 = getBotIntelligenceContext({ team: team1, roster, maxSquadSize: 25, maxOverseas: 8 });
      const ctx2 = getBotIntelligenceContext({ team: team2, roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(ctx1.fingerprint).not.toBe(ctx2.fingerprint);
    });

    it('10. changed overseas count invalidates cache', () => {
      const roster = makeRoster({ BATSMAN: 2 });
      const team1 = makeTeam({ overseas_count: 2 });
      const team2 = makeTeam({ overseas_count: 3 });

      const fp1 = computeStructuralFingerprint({ team: team1, roster, maxSquadSize: 25, maxOverseas: 8 });
      const fp2 = computeStructuralFingerprint({ team: team2, roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(fp1).not.toBe(fp2);
    });

    it('11. changed maxSquadSize invalidates cache', () => {
      const input1 = makeInput({ maxSquadSize: 25 });
      const input2 = makeInput({ maxSquadSize: 20 });

      const ctx1 = getBotIntelligenceContext(input1);
      clearAllBotIntelligence();
      const ctx2 = getBotIntelligenceContext(input2);

      expect(ctx1.fingerprint).not.toBe(ctx2.fingerprint);
    });

    it('12. changed maxOverseas invalidates cache', () => {
      const input1 = makeInput({ maxOverseas: 8 });
      const input2 = makeInput({ maxOverseas: 6 });

      const fp1 = computeStructuralFingerprint(input1);
      const fp2 = computeStructuralFingerprint(input2);

      expect(fp1).not.toBe(fp2);
    });

    it('13. different team IDs never share cache entries', () => {
      const roster = makeRoster({ BATSMAN: 2 });
      const teamA = makeTeam({ id: 'team-A' });
      const teamB = makeTeam({ id: 'team-B' });

      getBotIntelligenceContext({ team: teamA, roster, maxSquadSize: 25, maxOverseas: 8 });
      getBotIntelligenceContext({ team: teamB, roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(getCacheSize()).toBe(2);
      expect(hasCachedIntelligence('team-A')).toBe(true);
      expect(hasCachedIntelligence('team-B')).toBe(true);
    });
  });

  // ============================
  // D. Cache Invalidation & Lifecycle
  // ============================
  describe('D. Cache Invalidation & Lifecycle', () => {

    it('14. invalidate(teamId) removes specific cache entry', () => {
      const input = makeInput();
      getBotIntelligenceContext(input);
      expect(hasCachedIntelligence('team-alpha')).toBe(true);

      const removed = invalidateBotIntelligence('team-alpha');
      expect(removed).toBe(true);
      expect(hasCachedIntelligence('team-alpha')).toBe(false);
      expect(getCacheSize()).toBe(0);
    });

    it('14b. invalidate(teamId) returns false for non-existent entry', () => {
      const removed = invalidateBotIntelligence('non-existent-team');
      expect(removed).toBe(false);
    });

    it('15. clear() removes all cache entries', () => {
      const roster = makeRoster({ BATSMAN: 2 });
      getBotIntelligenceContext({ team: makeTeam({ id: 'team-1' }), roster, maxSquadSize: 25, maxOverseas: 8 });
      getBotIntelligenceContext({ team: makeTeam({ id: 'team-2' }), roster, maxSquadSize: 25, maxOverseas: 8 });
      getBotIntelligenceContext({ team: makeTeam({ id: 'team-3' }), roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(getCacheSize()).toBe(3);
      clearAllBotIntelligence();
      expect(getCacheSize()).toBe(0);
    });

    it('15b. after invalidation, next call recomputes fresh pipeline', () => {
      const roster = makeRoster({ BATSMAN: 2, BOWLER: 1 });
      const team = makeTeam({ purse: 8000 });

      const ctx1 = getBotIntelligenceContext({ team, roster, maxSquadSize: 25, maxOverseas: 8 });
      invalidateBotIntelligence(team.id);

      // Change purse and recompute
      const team2 = makeTeam({ purse: 7000 });
      const ctx2 = getBotIntelligenceContext({ team: team2, roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(ctx2.squadState.purseRemaining).toBe(7000);
      expect(ctx1.squadState.purseRemaining).toBe(8000);
    });
  });

  // ============================
  // E. Structural vs Market Separation
  // ============================
  describe('E. Structural vs Market Separation', () => {

    it('16. live-market-like values are not part of structural cache identity', () => {
      // Two inputs differing ONLY in "market-like" data that is NOT in BotIntelligenceInput
      // should produce the same fingerprint because BotIntelligenceInput doesn't carry market data
      const input1 = makeInput();
      const input2 = makeInput();

      const fp1 = computeStructuralFingerprint(input1);
      const fp2 = computeStructuralFingerprint(input2);

      // Same structural inputs → same fingerprint
      expect(fp1).toBe(fp2);
    });

    it('17. current bid cannot affect cached structural intelligence', () => {
      // BotIntelligenceInput has NO current bid field.
      // The fingerprint is derived only from team/roster/squad config.
      const input = makeInput();
      const ctx = getBotIntelligenceContext(input);

      // Verify the context doesn't contain any bid-related data
      expect((ctx as any).currentBid).toBeUndefined();
      expect((ctx as any).nextBidAmount).toBeUndefined();
    });

    it('18. opponent pressure cannot affect cached structural intelligence', () => {
      // BotIntelligenceInput has NO opponent/rival fields
      const input = makeInput();
      const fp = computeStructuralFingerprint(input);

      // Fingerprint contains only structural fields
      expect(fp).toContain('t:');
      expect(fp).toContain('p:');
      expect(fp).toContain('r:[');
      expect(fp).not.toContain('rival');
      expect(fp).not.toContain('opponent');
      expect(fp).not.toContain('bid');
    });

    it('19. auction stage cannot affect cached structural intelligence', () => {
      // BotIntelligenceInput has NO auctionProgress field
      const input = makeInput();
      const fp = computeStructuralFingerprint(input);

      expect(fp).not.toContain('progress');
      expect(fp).not.toContain('stage');
      expect(fp).not.toContain('lot');
    });
  });

  // ============================
  // F. Immutability
  // ============================
  describe('F. Immutability', () => {

    it('20. returned context cannot mutate cached state', () => {
      const input = makeInput();
      const ctx1 = getBotIntelligenceContext(input);

      // Attempt to mutate the returned context
      (ctx1 as any).teamId = 'MUTATED';
      (ctx1.squadState as any).squadSize = 999;
      (ctx1.roleGapState as any).totalGapRoles = 999;

      // Get the context again — should be unaffected
      const ctx2 = getBotIntelligenceContext(input);

      expect(ctx2.teamId).toBe('team-alpha');
      expect(ctx2.squadState.squadSize).toBe(5); // original roster size
      expect(ctx2.roleGapState.totalGapRoles).not.toBe(999);
    });

    it('21. caller-owned team is not mutated', () => {
      const team = makeTeam({ purse: 8000 });
      const originalPurse = team.purse;
      const originalName = team.name;

      getBotIntelligenceContext({ team, roster: makeRoster({ BATSMAN: 2 }), maxSquadSize: 25, maxOverseas: 8 });

      expect(team.purse).toBe(originalPurse);
      expect(team.name).toBe(originalName);
    });

    it('22. caller-owned roster is not mutated', () => {
      const roster = makeRoster({ BATSMAN: 2, BOWLER: 1 });
      const originalLength = roster.length;
      const originalFirstRole = roster[0]!.role;

      getBotIntelligenceContext({ team: makeTeam(), roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(roster.length).toBe(originalLength);
      expect(roster[0]!.role).toBe(originalFirstRole);
    });

    it('23. cached data cannot be corrupted through shared references', () => {
      const input = makeInput();
      const ctx1 = getBotIntelligenceContext(input);
      const ctx2 = getBotIntelligenceContext(input);

      // ctx1 and ctx2 should be structurally equal but referentially independent
      expect(ctx1).toEqual(ctx2);
      expect(ctx1).not.toBe(ctx2);
      expect(ctx1.squadState).not.toBe(ctx2.squadState);
      expect(ctx1.roleGapState).not.toBe(ctx2.roleGapState);

      // Mutate ctx1 deeply
      (ctx1.squadState as any).purseRemaining = -1;
      expect(ctx2.squadState.purseRemaining).not.toBe(-1);
    });
  });

  // ============================
  // G. Squad Edge Cases
  // ============================
  describe('G. Squad Edge Cases', () => {

    it('24. empty squad (0 players, all slots remaining)', () => {
      const team = makeTeam({ players_bought: 0, overseas_count: 0, purse: 12000 });
      const roster: V3Player[] = [];

      const ctx = getBotIntelligenceContext({ team, roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(ctx.squadState.squadSize).toBe(0);
      expect(ctx.squadState.remainingSlots).toBe(25);
      expect(ctx.squadState.roleComposition.BATSMAN).toBe(0);
      expect(ctx.squadState.roleComposition.BOWLER).toBe(0);
      expect(ctx.squadState.roleComposition.ALL_ROUNDER).toBe(0);
      expect(ctx.squadState.roleComposition.WICKET_KEEPER).toBe(0);

      // Pipeline should still produce valid outputs
      expect(ctx.roleGapState).toBeDefined();
      expect(ctx.squadConsequenceState).toBeDefined();
      expect(ctx.squadConsequenceState.options.length).toBe(4); // one per role
    });

    it('25. nearly complete squad (24 of 25 players)', () => {
      const team = makeTeam({ players_bought: 24, overseas_count: 5, purse: 200 });
      const roster = makeRoster({ BATSMAN: 7, BOWLER: 7, ALL_ROUNDER: 5, WICKET_KEEPER: 5 });

      const ctx = getBotIntelligenceContext({ team, roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(ctx.squadState.squadSize).toBe(24);
      expect(ctx.squadState.remainingSlots).toBe(1);
      expect(ctx.squadConsequenceState.options.length).toBe(4);
    });

    it('26. fully covered squad (all role minimums met)', () => {
      const team = makeTeam({ players_bought: 16, overseas_count: 4, purse: 3000 });
      const roster = makeRoster({ BATSMAN: 5, BOWLER: 6, ALL_ROUNDER: 3, WICKET_KEEPER: 2 });

      const ctx = getBotIntelligenceContext({ team, roster, maxSquadSize: 25, maxOverseas: 8 });

      // All role needs should be NORMAL or lower (no CRITICAL/HIGH)
      expect(ctx.squadState.roleComposition.BATSMAN).toBe(5);
      expect(ctx.squadState.roleComposition.BOWLER).toBe(6);
      expect(ctx.squadState.roleComposition.ALL_ROUNDER).toBe(3);
      expect(ctx.squadState.roleComposition.WICKET_KEEPER).toBe(2);
    });
  });

  // ============================
  // H. Fingerprint Correctness
  // ============================
  describe('H. Fingerprint Correctness', () => {

    it('27. roster order does not affect fingerprint', () => {
      const team = makeTeam();
      // Create two rosters with the same composition but different ordering
      const batsmanA = makePlayer('BATSMAN');
      const batsmanB = makePlayer('BATSMAN');
      const bowlerA = makePlayer('BOWLER');

      const roster1 = [batsmanA, batsmanB, bowlerA];
      const roster2 = [bowlerA, batsmanA, batsmanB]; // different order

      const fp1 = computeStructuralFingerprint({ team, roster: roster1, maxSquadSize: 25, maxOverseas: 8 });
      const fp2 = computeStructuralFingerprint({ team, roster: roster2, maxSquadSize: 25, maxOverseas: 8 });

      expect(fp1).toBe(fp2);
    });

    it('28. fingerprint changes when players_bought changes', () => {
      const roster = makeRoster({ BATSMAN: 2 });
      const team1 = makeTeam({ players_bought: 5 });
      const team2 = makeTeam({ players_bought: 6 });

      const fp1 = computeStructuralFingerprint({ team: team1, roster, maxSquadSize: 25, maxOverseas: 8 });
      const fp2 = computeStructuralFingerprint({ team: team2, roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(fp1).not.toBe(fp2);
    });

    it('29. fingerprint changes when initial_purse changes', () => {
      const roster = makeRoster({ BATSMAN: 2 });
      const team1 = makeTeam({ initial_purse: 12000 });
      const team2 = makeTeam({ initial_purse: 10000 });

      const fp1 = computeStructuralFingerprint({ team: team1, roster, maxSquadSize: 25, maxOverseas: 8 });
      const fp2 = computeStructuralFingerprint({ team: team2, roster, maxSquadSize: 25, maxOverseas: 8 });

      expect(fp1).not.toBe(fp2);
    });

    it('30. fingerprint encodes all structural components', () => {
      const input = makeInput();
      const fp = computeStructuralFingerprint(input);

      // Verify structural markers are present
      expect(fp).toContain('t:team-alpha');
      expect(fp).toContain('p:8000');
      expect(fp).toContain('ip:12000');
      expect(fp).toContain('oc:2');
      expect(fp).toContain('pb:5');
      expect(fp).toContain('ms:25');
      expect(fp).toContain('mo:8');
      expect(fp).toContain('r:[');
    });

    it('31. fingerprint is a string and never empty', () => {
      const input = makeInput();
      const fp = computeStructuralFingerprint(input);

      expect(typeof fp).toBe('string');
      expect(fp.length).toBeGreaterThan(0);
    });

    it('32. two pipeline runs with identical fingerprint produce identical contexts', () => {
      const team = makeTeam();
      const roster = makeRoster({ BATSMAN: 3, BOWLER: 2, ALL_ROUNDER: 1, WICKET_KEEPER: 1 });
      const input: BotIntelligenceInput = { team, roster, maxSquadSize: 25, maxOverseas: 8 };

      // Run 1
      const ctx1 = getBotIntelligenceContext(input);
      clearAllBotIntelligence(); // force recompute
      // Run 2
      const ctx2 = getBotIntelligenceContext(input);

      expect(ctx1.fingerprint).toBe(ctx2.fingerprint);
      expect(ctx1).toEqual(ctx2);
    });
  });

  // ============================
  // I. Additional Cache Lifecycle
  // ============================
  describe('I. Additional Cache Lifecycle', () => {

    it('33. getCacheSize reflects accurate entry count', () => {
      expect(getCacheSize()).toBe(0);

      const roster = makeRoster({ BATSMAN: 2 });
      getBotIntelligenceContext({ team: makeTeam({ id: 't1' }), roster, maxSquadSize: 25, maxOverseas: 8 });
      expect(getCacheSize()).toBe(1);

      getBotIntelligenceContext({ team: makeTeam({ id: 't2' }), roster, maxSquadSize: 25, maxOverseas: 8 });
      expect(getCacheSize()).toBe(2);

      invalidateBotIntelligence('t1');
      expect(getCacheSize()).toBe(1);
    });

    it('34. hasCachedIntelligence reports correctly', () => {
      expect(hasCachedIntelligence('team-alpha')).toBe(false);

      getBotIntelligenceContext(makeInput());
      expect(hasCachedIntelligence('team-alpha')).toBe(true);
      expect(hasCachedIntelligence('team-beta')).toBe(false);
    });

    it('35. stale fingerprint triggers recomputation without explicit invalidation', () => {
      const roster1 = makeRoster({ BATSMAN: 2, BOWLER: 1 });
      const roster2 = makeRoster({ BATSMAN: 2, BOWLER: 2 }); // added 1 bowler
      const team = makeTeam();

      const ctx1 = getBotIntelligenceContext({ team, roster: roster1, maxSquadSize: 25, maxOverseas: 8 });
      // Same team ID, different structural input → fingerprint changes → auto-recompute
      const ctx2 = getBotIntelligenceContext({ team, roster: roster2, maxSquadSize: 25, maxOverseas: 8 });

      expect(ctx1.fingerprint).not.toBe(ctx2.fingerprint);
      expect(ctx1.squadState.roleComposition.BOWLER).toBe(1);
      expect(ctx2.squadState.roleComposition.BOWLER).toBe(2);
      // Still only 1 cache entry (overwritten)
      expect(getCacheSize()).toBe(1);
    });
  });
});
