import { describe, it, expect, expectTypeOf } from 'vitest';
import { evaluateTeamValue } from '@/lib/auction/human-auction-team-value';
import { assembleTeamValueContext, assembleHumanAuctionManagerContext } from '@/lib/auction/human-auction-manager-context';
import type { TeamValueContext, TeamValueResult, PlayerMarketValueResult } from '@/lib/auction/human-auction-manager-types';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';
import type { BotIntelligenceContext } from '@/lib/auction/bot-intelligence-orchestrator';
import type { AuctionContext } from '@/lib/auction/server-bot-engine';

describe('Human Auction Manager - Team Value Engine (Phase 4 Integrity)', () => {

  const createMockPlayer = (id: string, rating: number, role: 'BATSMAN' | 'BOWLER' | 'ALL_ROUNDER' | 'WICKET_KEEPER' = 'BATSMAN'): V3Player => ({
    id,
    name: `Player ${id}`,
    role,
    category: 'A',
    country: 'India',
    age: 25,
    batting_hand: 'Right',
    base_price: 200,
    is_overseas: false,
    image_url: null,
    rating
  });

  const candidate = createMockPlayer('candidate_1', 92, 'BATSMAN');

  const mockMarketValueResult: PlayerMarketValueResult = {
    playerId: candidate.id,
    marketValue: 1400,
    confidence: 0.8,
    playerQuality: {
      playerId: candidate.id,
      role: candidate.role,
      rating: candidate.rating!,
      ratingSource: 'STORED_RATING',
      tier: 'A'
    },
    reasons: ['Base market value']
  };

  const createBaseContext = (overrides: Partial<TeamValueContext> = {}): TeamValueContext => ({
    teamId: 't1',
    player: {
      id: candidate.id,
      name: candidate.name,
      role: candidate.role,
      category: candidate.category,
      base_price: candidate.base_price,
      is_overseas: candidate.is_overseas,
      rating: candidate.rating
    },
    marketValue: mockMarketValueResult,
    need: { role: 'BATSMAN', level: 'USEFUL', currentRoleCount: 2, requiredRoleCount: 5, remainingSquadSlots: 15 },
    xiImprovement: { level: 'USEFUL_STARTER' },
    scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
    teamFit: { level: 'NEUTRAL' },
    futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 },
    currentRoster: [],
    ...overrides
  });

  it('TEST 1 — TEAM A VS TEAM B STRATEGIC DIFFERENCE', () => {
    // Team A: Critical Need, Transformative XI, Excellent Fit, Very Scarce, Healthy Future
    const ctxA = createBaseContext({
      need: { ...createBaseContext().need, level: 'CRITICAL' },
      teamFit: { level: 'EXCELLENT' },
      scarcity: { level: 'VERY_SCARCE', meaningfulAlternativesRemaining: 1 },
      futurePlan: { ...createBaseContext().futurePlan, remainingCriticalTargets: 0 },
      currentRoster: [] // Empty roster -> 88 candidate is Transformative
    });

    // Team B: Optional Need, Depth XI, Neutral Fit, Abundant Alternatives, 3 Critical Future Targets
    const ctxB = createBaseContext({
      need: { ...createBaseContext().need, level: 'OPTIONAL' },
      teamFit: { level: 'NEUTRAL' },
      scarcity: { level: 'ABUNDANT', meaningfulAlternativesRemaining: 10 },
      futurePlan: { ...createBaseContext().futurePlan, remainingCriticalTargets: 3 },
      currentRoster: [
        createMockPlayer('exist_1', 97, 'BATSMAN'),
        createMockPlayer('exist_2', 96, 'BATSMAN'),
        createMockPlayer('exist_3', 95, 'BATSMAN'),
        createMockPlayer('exist_4', 94, 'BATSMAN')
      ] // Candidate is 92, which makes him DEPTH since 4 better starters exist.
    });

    const resA = evaluateTeamValue(ctxA);
    const resB = evaluateTeamValue(ctxB);

    expect(resA.marketValue).toBe(1400);
    expect(resB.marketValue).toBe(1400);
    
    expect(resA.teamValue).toBeGreaterThan(resB.teamValue);
    
    // Team A should have a strategic consequence reasoning highlighting IRREPLACEABLE CRITICAL SOLUTION
    expect(resA.reasons.join(' ')).toContain('IRREPLACEABLE CRITICAL SOLUTION');
    
    // Team B should have a strategic consequence highlighting DEPTH (CONSTRAINED)
    expect(resB.reasons.join(' ')).toContain('DEPTH (CONSTRAINED)');
  });

  it('TEST 2 — REDUNDANT ELITE PLAYER', () => {
    const eliteCandidate = createMockPlayer('elite_1', 95, 'WICKET_KEEPER');
    const ctx = createBaseContext({
      player: eliteCandidate,
      currentRoster: [
        createMockPlayer('exist_wk', 97, 'WICKET_KEEPER')
      ]
    });

    const res = evaluateTeamValue(ctx);
    // Even though rating is 95, because 97 exists and WK ideal is 1, he's DEPTH.
    expect(res.factors.xiImprovement.level).toBe('DEPTH');
  });

  it('TEST 3 — WEAK ROLE UPGRADE', () => {
    const averageCandidate = createMockPlayer('avg_1', 82, 'BOWLER');
    const ctx = createBaseContext({
      player: averageCandidate,
      currentRoster: [
        createMockPlayer('exist_1', 75, 'BOWLER'),
        createMockPlayer('exist_2', 74, 'BOWLER')
      ]
    });

    const res = evaluateTeamValue(ctx);
    expect(res.factors.xiImprovement.level).toBe('TRANSFORMATIVE');
  });

  it('TEST 4, 16 — FUTURE PLAN RUNTIME FLOW & RUNTIME BOUNDARY ISOLATION', () => {
    // We assemble the master context using the real path and prove it connects.
    const mockTeam: V3Team = { id: 't1', name: 'Team A', short_name: 'TA', purse: 5000, initial_purse: 10000, players_bought: 5, overseas_count: 0, is_bot: true };
    const mockAuctionCtx: AuctionContext = {
      maxSquadSize: 25, maxOverseas: 8, totalLots: 100, futurePlayers: [], futureByRole: {}, futureOverseasCount: 0,
      futureAvgBasePrice: 100, futureMinBasePrice: 20, teamPurchasePrices: {}, lotsCompleted: 20, lotsRemaining: 80,
      auctionProgress: 0.20, futureByRoleAndQuality: {}, futureOverseasByRole: {}
    };

    const mockBotIntelligence = {
      squadPriorityState: {
        totalTargetCount: 3,
        roles: {
          'BOWLER': { role: 'BOWLER', priorityLevel: 'CRITICAL', currentCount: 0 } as any,
          'BATSMAN': { role: 'BATSMAN', priorityLevel: 'OPTIONAL', currentCount: 1 } as any
        }
      },
      candidateAlignmentState: { structuralFit: 'GOOD', matchReason: '', constraints: [] },
      squadAlternativeState: {
        alternatives: [
          { role: 'BOWLER', meaningfulCount: 0, totalRemaining: 0, qualityDropoff: 0 } as any
        ]
      }
    } as any;

    const masterCtx = assembleHumanAuctionManagerContext({
      team: mockTeam,
      player: createMockPlayer('p1', 90, 'BOWLER'),
      roster: [],
      allTeams: [mockTeam],
      teamRosters: {},
      maxSquadSize: 25,
      auctionCtx: mockAuctionCtx,
      botIntelligence: mockBotIntelligence,
      currentBid: 200,
      nextRequiredBid: 225,
      highestBidderTeamId: null,
      playerQualityResult: { playerId: 'p1', role: 'BOWLER', rating: 90, ratingSource: 'STORED_RATING', tier: 'A' },
      marketValueResult: { marketValue: 800 }
    });

    const teamValueCtx = assembleTeamValueContext({
      teamId: masterCtx.teamId,
      player: masterCtx.player,
      marketValueResult: masterCtx.marketValue,
      teamNeed: masterCtx.teamNeed,
      xiImprovement: masterCtx.xiImprovement,
      scarcity: masterCtx.scarcity,
      teamFit: masterCtx.teamFit,
      futurePlan: masterCtx.futurePlan,
      currentRoster: [] // explicitly pass since it's not stored in masterCtx
    });

    const res = evaluateTeamValue(teamValueCtx);

    // Assert the data actually flowed from botIntelligence through assembleHumanAuctionManagerContext
    expect(res.factors.futurePlan.remainingCriticalTargets).toBe(1); // 1 critical role in mock
    expect(res.factors.futurePlan.futureRequiredRoles).toEqual([{ role: 'BOWLER', count: 1 }]);
    
    // Boundary Isolation: TeamValueContext definitely doesn't have purse/currentBid
    expectTypeOf(teamValueCtx).not.toHaveProperty('purse');
    expectTypeOf(teamValueCtx).not.toHaveProperty('currentBid');
    expectTypeOf(teamValueCtx).not.toHaveProperty('opponent');
  });

  it('TEST 5, 6, 7, 8 — INVARIANCE (Current Bid, Next Req Bid, Purse, Opponent)', () => {
    // If we only change these fields, the output Team Value must be EXACTLY identical.
    
    const buildMaster = (overrides: any) => assembleHumanAuctionManagerContext({
      team: { id: 't1', name: 'Team A', short_name: 'TA', purse: 5000, initial_purse: 10000, players_bought: 5, overseas_count: 0, is_bot: true },
      player: createMockPlayer('p1', 90, 'BOWLER'),
      roster: [],
      allTeams: [{ id: 't1', name: 'Team A', short_name: 'TA', purse: 5000, initial_purse: 10000, players_bought: 5, overseas_count: 0, is_bot: true }],
      teamRosters: {},
      maxSquadSize: 25,
      auctionCtx: { maxSquadSize: 25, maxOverseas: 8, totalLots: 100, futurePlayers: [], futureByRole: {}, futureOverseasCount: 0, futureAvgBasePrice: 100, futureMinBasePrice: 20, teamPurchasePrices: {}, lotsCompleted: 20, lotsRemaining: 80, auctionProgress: 0.20, futureByRoleAndQuality: {}, futureOverseasByRole: {} },
      botIntelligence: undefined,
      currentBid: 200,
      nextRequiredBid: 225,
      highestBidderTeamId: null,
      playerQualityResult: { playerId: 'p1', role: 'BOWLER', rating: 90, ratingSource: 'STORED_RATING', tier: 'A' },
      marketValueResult: { marketValue: 800 },
      ...overrides
    });

    const evaluateMaster = (master: any) => evaluateTeamValue(assembleTeamValueContext({
      teamId: master.teamId, player: master.player, marketValueResult: master.marketValue, teamNeed: master.teamNeed, xiImprovement: master.xiImprovement, scarcity: master.scarcity, teamFit: master.teamFit, futurePlan: master.futurePlan, currentRoster: []
    }));

    const baseResult = evaluateMaster(buildMaster({}));
    const bidResult = evaluateMaster(buildMaster({ currentBid: 1500 }));
    const nextBidResult = evaluateMaster(buildMaster({ nextRequiredBid: 1600 }));
    const purseResult = evaluateMaster(buildMaster({ team: { id: 't1', name: 'Team A', short_name: 'TA', purse: 9000, initial_purse: 10000, players_bought: 5, overseas_count: 0, is_bot: true } }));
    const opponentResult = evaluateMaster(buildMaster({ highestBidderTeamId: 't2' }));

    expect(baseResult.teamValue).toBe(bidResult.teamValue);
    expect(baseResult.teamValue).toBe(nextBidResult.teamValue);
    expect(baseResult.teamValue).toBe(purseResult.teamValue);
    expect(baseResult.teamValue).toBe(opponentResult.teamValue);
  });

  it('TEST 9 — NO DOUBLE COUNTING', () => {
    // Critical Need + Transformative XI + Excellent Fit
    const ctx = createBaseContext({
      need: { ...createBaseContext().need, level: 'CRITICAL' },
      currentRoster: [], // -> Transformative
      teamFit: { level: 'EXCELLENT' }
    });

    const res = evaluateTeamValue(ctx);
    // Market value 1400. 
    // Core strategic consequence for CRITICAL + TRANSFORMATIVE is 1.40.
    // Excellent fit is subsumed into the critical consequence to prevent double counting.
    // TeamValue should be 1400 * 1.40 = 1960.
    expect(res.teamValue).toBe(1960);
  });

  it('TEST 10 — SCARCITY', () => {
    // Compare VERY_SCARCE vs ABUNDANT
    const baseCtx = createBaseContext({
      need: { ...createBaseContext().need, level: 'IMPORTANT' },
      currentRoster: [createMockPlayer('exist_1', 85, 'BATSMAN')] // Candidate 88 is Major Upgrade
    });

    const resScarce = evaluateTeamValue({ ...baseCtx, scarcity: { level: 'VERY_SCARCE', meaningfulAlternativesRemaining: 0 } });
    const resAbundant = evaluateTeamValue({ ...baseCtx, scarcity: { level: 'ABUNDANT', meaningfulAlternativesRemaining: 15 } });

    expect(resScarce.teamValue).toBeGreaterThan(resAbundant.teamValue);
    
    // Now verify redundant player with scarce role does not explode in value
    const redundantCtx = { ...baseCtx, 
      need: { ...baseCtx.need, level: 'NOT_NEEDED' as const }, 
      currentRoster: [createMockPlayer('exist_1', 99, 'BATSMAN')] 
    };
    
    const resRedundantScarce = evaluateTeamValue({ ...redundantCtx, scarcity: { level: 'VERY_SCARCE', meaningfulAlternativesRemaining: 0 } });
    
    // The core strategic consequence for redundant is 0.50. 
    // Scarcity does NOT add to it if multiplier < 1.0.
    expect(resRedundantScarce.teamValue).toBe(1400 * 0.50); // 700
  });

  it('TEST 11 — FIT', () => {
    const ctx = createBaseContext({ need: { ...createBaseContext().need, level: 'IMPORTANT' }, currentRoster: [] });
    const resNeutral = evaluateTeamValue({ ...ctx, teamFit: { level: 'NEUTRAL' } });
    const resPoor = evaluateTeamValue({ ...ctx, teamFit: { level: 'POOR' } });
    expect(resNeutral.teamValue).toBeGreaterThan(resPoor.teamValue);
  });

  it('TEST 12A — MANDATORY TEST 1: MATCHING ROLE', () => {
    const baseCtx = createBaseContext({ need: { ...createBaseContext().need, level: 'CRITICAL' }, currentRoster: [] });
    // Candidate is BATSMAN. 
    // futureRequiredRoles contains BATSMAN.
    const ctxA = { ...baseCtx, futurePlan: { ...baseCtx.futurePlan, remainingCriticalTargets: 0, futureRequiredRoles: [] } };
    const ctxB = { ...baseCtx, futurePlan: { ...baseCtx.futurePlan, remainingCriticalTargets: 3, futureRequiredRoles: [{ role: 'BATSMAN', count: 1 } as any] } };

    const resA = evaluateTeamValue(ctxA);
    const resB = evaluateTeamValue(ctxB);

    expect(resA.reasons.join(' ')).toContain('CRITICAL SOLUTION');
    expect(resB.reasons.join(' ')).toContain('RESOLVES FUTURE CONSTRAINT');
    // Baseline CRITICAL SOLUTION (1.40x) vs RESOLVES FUTURE CONSTRAINT (1.45x)
    // Base market value is 1400.
    expect(resA.teamValue).toBe(1960); // 1400 * 1.40
    expect(resB.teamValue).toBe(2030); // 1400 * 1.45
    expect(resB.teamValue).toBeGreaterThan(resA.teamValue);
  });

  it('TEST 12B — MANDATORY TEST 2: WRONG ROLE', () => {
    const baseCtx = createBaseContext({ need: { ...createBaseContext().need, level: 'CRITICAL' }, currentRoster: [] });
    // Candidate is BATSMAN. 
    // futureRequiredRoles contains BOWLER only.
    const ctxMatching = { ...baseCtx, futurePlan: { ...baseCtx.futurePlan, remainingCriticalTargets: 3, futureRequiredRoles: [{ role: 'BATSMAN', count: 1 } as any] } };
    const ctxWrong = { ...baseCtx, futurePlan: { ...baseCtx.futurePlan, remainingCriticalTargets: 3, futureRequiredRoles: [{ role: 'BOWLER', count: 1 } as any] } };

    const resMatching = evaluateTeamValue(ctxMatching);
    const resWrong = evaluateTeamValue(ctxWrong);

    expect(resWrong.reasons.join(' ')).not.toContain('RESOLVES FUTURE CONSTRAINT');
    expect(resWrong.teamValue).toBeLessThan(resMatching.teamValue); // Wrong role misses the premium
  });

  it('TEST 12C — MANDATORY TEST 3: LUXURY', () => {
    const ctxUnconstrained = createBaseContext({ need: { ...createBaseContext().need, level: 'OPTIONAL' }, currentRoster: [], futurePlan: { ...createBaseContext().futurePlan, remainingCriticalTargets: 0, futureRequiredRoles: [] } });
    const ctxConstrained = createBaseContext({ need: { ...createBaseContext().need, level: 'OPTIONAL' }, currentRoster: [], futurePlan: { ...createBaseContext().futurePlan, remainingCriticalTargets: 3, futureRequiredRoles: [{ role: 'BOWLER', count: 1 } as any] } });

    const resUnconstrained = evaluateTeamValue(ctxUnconstrained);
    const resConstrained = evaluateTeamValue(ctxConstrained);

    expect(resConstrained.teamValue).toBeLessThan(resUnconstrained.teamValue);
    expect(resConstrained.reasons.join(' ')).toContain('dangerous pressure on remaining critical targets');
  });

  it('TEST 12D — MANDATORY TEST 4: NO FUTURE PRESSURE', () => {
    const ctx = createBaseContext({ need: { ...createBaseContext().need, level: 'CRITICAL' }, currentRoster: [], futurePlan: { ...createBaseContext().futurePlan, remainingCriticalTargets: 0, futureRequiredRoles: [{ role: 'BATSMAN', count: 1 } as any] } });
    const res = evaluateTeamValue(ctx);

    expect(res.reasons.join(' ')).not.toContain('RESOLVES FUTURE CONSTRAINT');
    expect(res.reasons.join(' ')).not.toContain('CONSTRAINED');
  });

  it('TEST 14 — DETERMINISM', () => {
    const ctx = createBaseContext();
    const r1 = evaluateTeamValue(ctx);
    const r2 = evaluateTeamValue(ctx);
    expect(r1.teamValue).toBe(r2.teamValue);
    expect(r1.reasons).toEqual(r2.reasons);
  });

  it('TEST 15 — PHASE 4 CONTRACT ISOLATION', () => {
    expectTypeOf<TeamValueContext>().not.toHaveProperty('purse');
    expectTypeOf<TeamValueContext>().not.toHaveProperty('opponents');
    expectTypeOf<TeamValueContext>().not.toHaveProperty('currentBid');
    expectTypeOf<TeamValueResult>().not.toHaveProperty('maximumBid');
    expectTypeOf<TeamValueResult>().not.toHaveProperty('action');
  });

  it('TEST 17 — MARKET VALUE ISOLATION', () => {
    const ctx = createBaseContext();
    const originalMarketValue = ctx.marketValue.marketValue;
    const res = evaluateTeamValue(ctx);
    expect(res.marketValue).toBe(originalMarketValue);
    expect(ctx.marketValue.marketValue).toBe(originalMarketValue); // Mutation check
  });

  describe('PHASE 4 STRATEGIC COMMITMENT MAPPING (16 EXISTING CONSEQUENCE BRANCHES)', () => {
    // TIER 1 — CRITICAL + TRANSFORMATIVE
    it('Branch 1: IRREPLACEABLE CRITICAL SOLUTION → COMMITTED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 92, 'BATSMAN'),
        currentRoster: [], // Transformative
        need: { ...createBaseContext().need, level: 'CRITICAL' },
        scarcity: { level: 'VERY_SCARCE', meaningfulAlternativesRemaining: 0 },
        teamFit: { level: 'EXCELLENT' },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('IRREPLACEABLE CRITICAL SOLUTION');
      expect(res.strategicCommitment).toBe('COMMITTED');
      expect(res.teamValue).toBe(1400 * 1.50); // 2100L
    });

    it('Branch 2: CRITICAL SOLUTION (RESOLVES FUTURE CONSTRAINT) → COMMITTED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 92, 'BATSMAN'),
        currentRoster: [], // Transformative
        need: { ...createBaseContext().need, level: 'CRITICAL' },
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        futurePlan: { priority: 'MUST_HAVE', futureRequiredRoles: [{ role: 'BATSMAN', count: 1 }], protectedFutureBudget: 500, remainingCriticalTargets: 2 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('CRITICAL SOLUTION (RESOLVES FUTURE CONSTRAINT)');
      expect(res.strategicCommitment).toBe('COMMITTED');
      expect(res.teamValue).toBe(1400 * 1.45); // 2030L
    });

    it('Branch 3: CRITICAL SOLUTION (ABUNDANT ALTERNATIVES) → JUSTIFIED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 92, 'BATSMAN'),
        currentRoster: [], // Transformative
        need: { ...createBaseContext().need, level: 'CRITICAL' },
        scarcity: { level: 'ABUNDANT', meaningfulAlternativesRemaining: 10 },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('CRITICAL SOLUTION (ABUNDANT ALTERNATIVES)');
      expect(res.strategicCommitment).toBe('JUSTIFIED');
      expect(res.teamValue).toBe(1400 * 1.30); // 1820L
    });

    it('Branch 4: CRITICAL SOLUTION → COMMITTED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 92, 'BATSMAN'),
        currentRoster: [], // Transformative
        need: { ...createBaseContext().need, level: 'CRITICAL' },
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('Strategic Consequence: CRITICAL SOLUTION.');
      expect(res.strategicCommitment).toBe('COMMITTED');
      expect(res.teamValue).toBe(1960); // 1400 * 1.40 = 1960L
    });

    // TIER 2 — MAJOR UPGRADE / TRANSFORMATIVE
    it('Branch 5: MAJOR UPGRADE (CONSTRAINED) → JUSTIFIED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 92, 'BATSMAN'),
        currentRoster: [], // Transformative
        need: { ...createBaseContext().need, level: 'IMPORTANT' }, // Non-critical so createsFuturePressure is active
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        teamFit: { level: 'GOOD' },
        futurePlan: { priority: 'MUST_HAVE', futureRequiredRoles: [], protectedFutureBudget: 500, remainingCriticalTargets: 2 } // createsFuturePressure: marketValue > 500, targets >= 2
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('MAJOR UPGRADE (CONSTRAINED)');
      expect(res.strategicCommitment).toBe('JUSTIFIED');
      expect(res.teamValue).toBe(1540); // 1400 * 1.10 = 1540L
    });

    it('Branch 6: MAJOR UPGRADE (POOR FIT) → JUSTIFIED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 92, 'BATSMAN'),
        currentRoster: [], // Transformative
        need: { ...createBaseContext().need, level: 'IMPORTANT' },
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        teamFit: { level: 'POOR' },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('MAJOR UPGRADE (POOR FIT)');
      expect(res.strategicCommitment).toBe('JUSTIFIED');
      expect(res.teamValue).toBe(1540); // 1400 * 1.10 = 1540L
    });

    it('Branch 7: SCARCE MAJOR UPGRADE → COMMITTED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 85, 'BATSMAN'),
        currentRoster: [createMockPlayer('exist_1', 82, 'BATSMAN')], // Major Upgrade
        need: { ...createBaseContext().need, level: 'CRITICAL' },
        scarcity: { level: 'VERY_SCARCE', meaningfulAlternativesRemaining: 0 },
        teamFit: { level: 'GOOD' },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('SCARCE MAJOR UPGRADE');
      expect(res.strategicCommitment).toBe('COMMITTED');
      expect(res.teamValue).toBe(1400 * 1.30); // 1820L
    });

    it('Branch 8: MAJOR UPGRADE (RESOLVES FUTURE CONSTRAINT) → COMMITTED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 85, 'BATSMAN'),
        currentRoster: [createMockPlayer('exist_1', 82, 'BATSMAN')], // Major Upgrade
        need: { ...createBaseContext().need, level: 'CRITICAL' },
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        teamFit: { level: 'GOOD' },
        futurePlan: { priority: 'MUST_HAVE', futureRequiredRoles: [{ role: 'BATSMAN', count: 1 }], protectedFutureBudget: 500, remainingCriticalTargets: 2 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('MAJOR UPGRADE (RESOLVES FUTURE CONSTRAINT)');
      expect(res.strategicCommitment).toBe('COMMITTED');
      expect(res.teamValue).toBe(1400 * 1.25); // 1750L
    });

    it('Branch 9: MAJOR UPGRADE → JUSTIFIED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 85, 'BATSMAN'),
        currentRoster: [createMockPlayer('exist_1', 82, 'BATSMAN')], // Major Upgrade
        need: { ...createBaseContext().need, level: 'CRITICAL' },
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        teamFit: { level: 'GOOD' },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('Strategic Consequence: MAJOR UPGRADE.');
      expect(res.strategicCommitment).toBe('JUSTIFIED');
      expect(res.teamValue).toBe(1400 * 1.20); // 1680L
    });

    // TIER 3 — SOLID ADDITION
    it('Branch 10: SOLID ADDITION (HEAVILY CONSTRAINED) → JUSTIFIED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 85, 'BATSMAN'),
        currentRoster: [createMockPlayer('exist_1', 82, 'BATSMAN')], // Major Upgrade
        need: { ...createBaseContext().need, level: 'IMPORTANT' }, // Enters tier 3
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        teamFit: { level: 'GOOD' },
        futurePlan: { priority: 'MUST_HAVE', futureRequiredRoles: [], protectedFutureBudget: 500, remainingCriticalTargets: 2 } // createsFuturePressure: marketValue > 500, targets >= 2
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('SOLID ADDITION (HEAVILY CONSTRAINED)');
      expect(res.strategicCommitment).toBe('JUSTIFIED');
      expect(res.teamValue).toBe(1330); // 1400 * 0.95 = 1330L
    });

    it('Branch 11: SOLID ADDITION (ABUNDANT ALTERNATIVES) → JUSTIFIED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 85, 'BATSMAN'),
        currentRoster: [createMockPlayer('exist_1', 82, 'BATSMAN')], // Major Upgrade
        need: { ...createBaseContext().need, level: 'IMPORTANT' },
        scarcity: { level: 'ABUNDANT', meaningfulAlternativesRemaining: 10 },
        teamFit: { level: 'GOOD' },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('SOLID ADDITION (ABUNDANT ALTERNATIVES)');
      expect(res.strategicCommitment).toBe('JUSTIFIED');
      expect(res.teamValue).toBe(1400 * 1.05); // 1470L
    });

    it('Branch 12: SOLID ADDITION → JUSTIFIED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 85, 'BATSMAN'),
        currentRoster: [createMockPlayer('exist_1', 82, 'BATSMAN')], // Major Upgrade
        need: { ...createBaseContext().need, level: 'IMPORTANT' },
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        teamFit: { level: 'GOOD' },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('Strategic Consequence: SOLID ADDITION.');
      expect(res.strategicCommitment).toBe('JUSTIFIED');
      expect(res.teamValue).toBe(1540); // 1400 * 1.10 = 1540L
    });

    // TIER 4 — DEPTH
    it('Branch 13: DEPTH (CONSTRAINED) → NOT_COMMITTED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 82, 'BATSMAN'),
        currentRoster: [
          createMockPlayer('e1', 88, 'BATSMAN'),
          createMockPlayer('e2', 87, 'BATSMAN'),
          createMockPlayer('e3', 86, 'BATSMAN'),
          createMockPlayer('e4', 85, 'BATSMAN')
        ], // Depth
        need: { ...createBaseContext().need, level: 'USEFUL' },
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        teamFit: { level: 'GOOD' },
        futurePlan: { priority: 'MUST_HAVE', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 2 } // createsFuturePressure
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('DEPTH (CONSTRAINED)');
      expect(res.strategicCommitment).toBe('NOT_COMMITTED');
      expect(res.teamValue).toBe(980); // 1400 * 0.70 = 980L
    });

    it('Branch 14: POOR FIT DEPTH → NOT_COMMITTED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 82, 'BATSMAN'),
        currentRoster: [
          createMockPlayer('e1', 88, 'BATSMAN'),
          createMockPlayer('e2', 87, 'BATSMAN'),
          createMockPlayer('e3', 86, 'BATSMAN'),
          createMockPlayer('e4', 85, 'BATSMAN')
        ], // Depth
        need: { ...createBaseContext().need, level: 'USEFUL' },
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        teamFit: { level: 'POOR' },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('POOR FIT DEPTH');
      expect(res.strategicCommitment).toBe('NOT_COMMITTED');
      expect(res.teamValue).toBe(1400 * 0.75); // 1050L
    });

    it('Branch 15: DEPTH → NOT_COMMITTED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 82, 'BATSMAN'),
        currentRoster: [
          createMockPlayer('e1', 88, 'BATSMAN'),
          createMockPlayer('e2', 87, 'BATSMAN'),
          createMockPlayer('e3', 86, 'BATSMAN'),
          createMockPlayer('e4', 85, 'BATSMAN')
        ], // Depth (ideal is 4, worst starter is 85, candidate is 82 >= 80)
        need: { ...createBaseContext().need, level: 'USEFUL' },
        scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 5 },
        teamFit: { level: 'GOOD' },
        futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('Strategic Consequence: DEPTH.');
      expect(res.strategicCommitment).toBe('NOT_COMMITTED');
      expect(res.teamValue).toBe(1400 * 0.85); // 1190L
    });

    // TIER 5 — REDUNDANT
    it('Branch 16: REDUNDANT → NOT_COMMITTED (teamValue unchanged)', () => {
      const ctx = createBaseContext({
        player: createMockPlayer('c1', 92, 'BATSMAN'),
        need: { ...createBaseContext().need, level: 'NOT_NEEDED' }
      });
      const res = evaluateTeamValue(ctx);
      expect(res.reasons.join(' ')).toContain('Strategic Consequence: REDUNDANT');
      expect(res.strategicCommitment).toBe('NOT_COMMITTED');
      expect(res.teamValue).toBe(1400 * 0.50); // 700L
    });
  });
});

