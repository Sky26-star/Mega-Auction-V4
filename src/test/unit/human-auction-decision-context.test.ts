import { describe, it, expect } from 'vitest';
import type {
  PlayerContext,
  PlayerMarketValueResult,
  TeamValueResult,
  MaximumBidResult,
  DecisionContext
} from '../../lib/auction/human-auction-manager-types';
import type { V3Team, V3Player, V3PlayerRole } from '../../lib/v3-auction-types';
import type { RivalPurchaseEvent } from '../../lib/auction/bot-brain-memory';
import {
  evaluateOpponentContext,
  buildDecisionContext
} from '../../lib/auction/human-auction-decision-context';
import { assembleDecisionContext } from '../../lib/auction/human-auction-manager-context';

describe('Phase 6 — Opponent + Decision Context Layer', () => {

  const mockPlayer: PlayerContext = {
    id: 'p1',
    name: 'Jasprit Bumrah',
    role: 'BOWLER',
    category: 'MARQUEE',
    base_price: 200,
    is_overseas: false,
    rating: 95
  };

  const mockMarketValue: PlayerMarketValueResult = {
    playerId: 'p1',
    marketValue: 1200,
    confidence: 1.0,
    playerQuality: {
      playerId: 'p1',
      role: 'BOWLER',
      rating: 95,
      ratingSource: 'STORED_RATING',
      tier: 'MARQUEE'
    },
    reasons: ['Elite marquee bowler']
  };

  const mockTeamValue: TeamValueResult = {
    teamId: 'team-my',
    playerId: 'p1',
    marketValue: 1200,
    teamValue: 1500,
    factors: {} as any,
    strategicCommitment: 'JUSTIFIED',
    reasons: ['Critical bowling upgrade']
  };

  const mockMaximumBid: MaximumBidResult = {
    teamValue: 1500,
    maximumBid: 1400,
    constraints: {
      purseLimit: 5000,
      futureBudgetLimit: 3000,
      solvencyLimit: 1400
    },
    bindingConstraint: 'SOLVENCY',
    auctionStage: 'MID',
    reasons: ['Solvency caps bid at 1400L']
  };

  const createTeam = (id: string, purse: number, playersBought: number = 5): V3Team => ({
    id,
    name: `Team ${id}`,
    short_name: id.toUpperCase(),
    purse,
    initial_purse: 10000,
    players_bought: playersBought,
    overseas_count: 0,
    is_bot: true
  });

  const createPlayer = (id: string, name: string, role: V3PlayerRole, basePrice: number = 50): V3Player => ({
    id,
    name,
    role,
    category: 'A',
    country: 'India',
    age: 28,
    batting_hand: 'Right',
    base_price: basePrice,
    is_overseas: false,
    image_url: null
  });

  // =========================================================================
  // MANDATORY PHASE 6 SPECIFICATION TESTS
  // =========================================================================

  it('TEST 1 — NO OPPONENTS', () => {
    // When no competing teams exist
    const opponentCtx = evaluateOpponentContext({
      allTeams: [],
      highestBidderTeamId: null
    });

    expect(opponentCtx.opponents).toEqual([]);
    expect(opponentCtx.highestBidderTeamId).toBeNull();

    const decisionCtx = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: opponentCtx,
      currentBid: 500,
      nextRequiredBid: 550,
      auctionStage: 'MID'
    });

    expect(decisionCtx.maximumBid.maximumBid).toBe(1400);
    expect(decisionCtx.opponent.opponents).toHaveLength(0);
  });

  it('TEST 2 — SINGLE RELEVANT OPPONENT', () => {
    // Opponent with 0 bowlers (critical need for BOWLER) and ample purse
    const opponentTeam = createTeam('team-2', 6000, 5);
    const opponentCtx = evaluateOpponentContext({
      myTeamId: 'team-my',
      candidatePlayer: mockPlayer, // BOWLER
      allTeams: [createTeam('team-my', 5000), opponentTeam],
      teamRosters: {
        'team-2': [
          createPlayer('b1', 'Bat 1', 'BATSMAN'),
          createPlayer('b2', 'Bat 2', 'BATSMAN'),
          createPlayer('ar1', 'AR 1', 'ALL_ROUNDER'),
          createPlayer('wk1', 'WK 1', 'WICKET_KEEPER')
        ]
      },
      highestBidderTeamId: 'team-2',
      currentBid: 600,
      nextRequiredBid: 650
    });

    expect(opponentCtx.opponents).toHaveLength(1);
    const opp = opponentCtx.opponents[0];
    expect(opp).toBeDefined();
    expect(opp!.teamId).toBe('team-2');
    expect(opp!.purse).toBe(6000);
    expect(opp!.remainingSlots).toBe(20);
    expect(opp!.missingRoles).toContain('BOWLER');
    expect(opp!.threat).toBe('HIGH'); // Critical role need + ample purse + highest bidder
    expect(opponentCtx.highestBidderTeamId).toBe('team-2');
  });

  it('TEST 3 — IRRELEVANT OPPONENT', () => {
    // Opponent already has 9 bowlers (redundant need for BOWLER)
    const bowlers: V3Player[] = Array.from({ length: 9 }, (_, i) =>
      createPlayer(`bwl-${i}`, `Bowler ${i}`, 'BOWLER')
    );

    const opponentTeam = createTeam('team-rich-redundant', 9000, 9);
    const opponentCtx = evaluateOpponentContext({
      candidatePlayer: mockPlayer, // BOWLER
      allTeams: [opponentTeam],
      teamRosters: {
        'team-rich-redundant': bowlers
      },
      currentBid: 400,
      nextRequiredBid: 450
    });

    expect(opponentCtx.opponents).toHaveLength(1);
    const opp = opponentCtx.opponents[0];
    expect(opp).toBeDefined();
    // Irrelevant opponent must be classified LOW threat despite 9000L purse
    expect(opp!.threat).toBe('LOW');
  });

  it('TEST 4 — CURRENT HIGHEST BIDDER', () => {
    const opp1 = createTeam('team-2', 4000);
    const opp2 = createTeam('team-3', 4000);

    const opponentCtx = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [opp1, opp2],
      highestBidderTeamId: 'team-2'
    });

    expect(opponentCtx.highestBidderTeamId).toBe('team-2');
  });

  it('TEST 5 — HIGH THREAT DOES NOT CHANGE MAXIMUM BID', () => {
    const ctxA = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid, // 1400L
      opponent: {
        opponents: [{
          teamId: 'team-low',
          purse: 2000,
          remainingSlots: 10,
          roleCounts: [],
          missingRoles: [],
          relevantPurchases: [],
          threat: 'LOW'
        }],
        highestBidderTeamId: null
      },
      currentBid: 500,
      nextRequiredBid: 550,
      auctionStage: 'MID'
    });

    const ctxB = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid, // 1400L
      opponent: {
        opponents: [{
          teamId: 'team-high',
          purse: 9000,
          remainingSlots: 15,
          roleCounts: [],
          missingRoles: ['BOWLER'],
          relevantPurchases: [],
          threat: 'HIGH'
        }],
        highestBidderTeamId: 'team-high'
      },
      currentBid: 500,
      nextRequiredBid: 550,
      auctionStage: 'MID'
    });

    // Both must retain exact Phase 3/4/5 values without mutation
    expect(ctxA.marketValue.marketValue).toBe(ctxB.marketValue.marketValue);
    expect(ctxA.teamValue.teamValue).toBe(ctxB.teamValue.teamValue);
    expect(ctxA.maximumBid.maximumBid).toBe(1400);
    expect(ctxB.maximumBid.maximumBid).toBe(1400);
  });

  it('TEST 6 — OPPONENT PURSE DOES NOT CHANGE OUR MAXIMUM BID', () => {
    const oppSmall = createTeam('team-2', 500);
    const oppGigantic = createTeam('team-2', 50000);

    const resSmall = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [oppSmall]
    });
    const resGigantic = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [oppGigantic]
    });

    const decSmall = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: resSmall,
      currentBid: 300,
      nextRequiredBid: 350,
      auctionStage: 'MID'
    });

    const decGigantic = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: resGigantic,
      currentBid: 300,
      nextRequiredBid: 350,
      auctionStage: 'MID'
    });

    expect(decSmall.maximumBid.maximumBid).toBe(1400);
    expect(decGigantic.maximumBid.maximumBid).toBe(1400);
    expect(decSmall.teamValue.teamValue).toBe(decGigantic.teamValue.teamValue);
  });

  it('TEST 7 — OPPONENT ROLE NEED DOES NOT CHANGE OUR TEAM VALUE', () => {
    const oppTeam = createTeam('team-2', 5000, 2);

    const oppCtxNeed = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [oppTeam],
      teamRosters: { 'team-2': [] } // 0 bowlers -> CRITICAL need
    });

    const oppCtxNoNeed = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [oppTeam],
      teamRosters: {
        'team-2': Array.from({ length: 8 }, (_, i) =>
          createPlayer(`bw-${i}`, `Bwl ${i}`, 'BOWLER')
        )
      }
    });

    const d1 = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: oppCtxNeed,
      currentBid: 400,
      nextRequiredBid: 450,
      auctionStage: 'MID'
    });

    const d2 = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: oppCtxNoNeed,
      currentBid: 400,
      nextRequiredBid: 450,
      auctionStage: 'MID'
    });

    expect(d1.teamValue.teamValue).toBe(1500);
    expect(d2.teamValue.teamValue).toBe(1500);
  });

  it('TEST 8 — CURRENT BID DOES NOT CHANGE OPPONENT INTRINSIC VALUE', () => {
    const opp = createTeam('team-2', 5000);

    const dLow = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: evaluateOpponentContext({ allTeams: [opp], candidatePlayer: mockPlayer, currentBid: 300 }),
      currentBid: 300,
      nextRequiredBid: 350,
      auctionStage: 'MID'
    });

    const dHigh = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: evaluateOpponentContext({ allTeams: [opp], candidatePlayer: mockPlayer, currentBid: 1300 }),
      currentBid: 1300,
      nextRequiredBid: 1350,
      auctionStage: 'MID'
    });

    expect(dLow.marketValue.marketValue).toBe(dHigh.marketValue.marketValue);
    expect(dLow.teamValue.teamValue).toBe(dHigh.teamValue.teamValue);
    expect(dLow.maximumBid.maximumBid).toBe(dHigh.maximumBid.maximumBid);
  });

  it('TEST 9 — RIVAL PURCHASE MEMORY', () => {
    const opp = createTeam('team-rival', 4000);
    const purchaseEvent: RivalPurchaseEvent = {
      playerId: 'p-prev-1',
      winnerId: 'team-rival',
      amount: 850,
      role: 'BATSMAN',
      observedAt: 1700000000
    };

    const opponentCtx = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [opp],
      rivalPurchases: [
        purchaseEvent,
        { playerId: 'p-other', winnerId: 'team-other', amount: 500, role: 'BOWLER', observedAt: 1700000001 }
      ]
    });

    expect(opponentCtx.opponents).toHaveLength(1);
    expect(opponentCtx.opponents[0]?.relevantPurchases).toEqual([purchaseEvent]);
  });

  it('TEST 10 — MULTIPLE OPPONENT ORDERING', () => {
    const oppA = createTeam('team-a', 6000, 4); // Will have 1 bowler -> HIGH need, non-bidder -> MEDIUM threat
    const oppB = createTeam('team-b', 8000, 2); // Will have 0 bowlers -> CRITICAL -> HIGH threat
    const oppC = createTeam('team-c', 3000, 5); // Will be highest bidder

    const run1 = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [oppA, oppB, oppC],
      teamRosters: {
        'team-a': [createPlayer('bw1', 'B1', 'BOWLER')],
        'team-b': [],
        'team-c': [createPlayer('bw2', 'B2', 'BOWLER')]
      },
      highestBidderTeamId: 'team-c'
    });

    const run2 = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [oppA, oppB, oppC],
      teamRosters: {
        'team-a': [createPlayer('bw1', 'B1', 'BOWLER')],
        'team-b': [],
        'team-c': [createPlayer('bw2', 'B2', 'BOWLER')]
      },
      highestBidderTeamId: 'team-c'
    });

    // Strict deterministic ordering:
    // 1. Current highest bidder first: team-c
    // 2. High threat next: team-b (CRITICAL need for BOWLER)
    // 3. Medium threat: team-a
    expect(run1.opponents.map(o => o.teamId)).toEqual(['team-c', 'team-b', 'team-a']);
    expect(run1).toEqual(run2);
  });

  it('TEST 11 — PURSE + NEED INTERACTION', () => {
    // Both teams have 5000L purse.
    // Team Strong: 0 Bowlers (CRITICAL role need) -> HIGH threat
    // Team Weak: 8 Bowlers (NORMAL role need, non-bidder) -> LOW threat
    const teamStrong = createTeam('team-strong-need', 5000, 3);
    const teamWeak = createTeam('team-weak-need', 5000, 8);

    const opponentCtx = evaluateOpponentContext({
      candidatePlayer: mockPlayer, // BOWLER
      allTeams: [teamWeak, teamStrong],
      teamRosters: {
        'team-strong-need': [],
        'team-weak-need': Array.from({ length: 8 }, (_, i) =>
          createPlayer(`bw-${i}`, `Bwl ${i}`, 'BOWLER')
        )
      }
    });

    const strongOpp = opponentCtx.opponents.find(o => o.teamId === 'team-strong-need');
    const weakOpp = opponentCtx.opponents.find(o => o.teamId === 'team-weak-need');

    expect(strongOpp).toBeDefined();
    expect(weakOpp).toBeDefined();
    expect(strongOpp!.threat).toBe('HIGH');
    expect(weakOpp!.threat).toBe('LOW');
    // Strong opponent must rank before weak opponent in deterministic ordering
    expect(opponentCtx.opponents[0]?.teamId).toBe('team-strong-need');
  });

  it('TEST 12 — CURRENT BIDDER VS NON-BIDDER', () => {
    // Current bidder with NORMAL need should NOT be automatically marked HIGH threat
    const oppBidder = createTeam('team-bidder', 3000, 7);
    const oppNonBidder = createTeam('team-critical-non-bidder', 6000, 2);

    const opponentCtx = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [oppBidder, oppNonBidder],
      teamRosters: {
        // Has 7 bowlers -> NORMAL need (between min 6 and ideal 8)
        'team-bidder': Array.from({ length: 7 }, (_, i) =>
          createPlayer(`b${i}`, `B${i}`, 'BOWLER')
        ),
        // Has 0 bowlers -> CRITICAL need
        'team-critical-non-bidder': []
      },
      highestBidderTeamId: 'team-bidder'
    });

    const bidder = opponentCtx.opponents.find(o => o.teamId === 'team-bidder');
    const nonBidder = opponentCtx.opponents.find(o => o.teamId === 'team-critical-non-bidder');

    expect(bidder).toBeDefined();
    expect(nonBidder).toBeDefined();

    // Current bidder is NOT automatically HIGH (it is MEDIUM because need is NORMAL)
    expect(bidder!.threat).toBe('MEDIUM');
    // Non-bidder with critical need is HIGH
    expect(nonBidder!.threat).toBe('HIGH');
    expect(opponentCtx.highestBidderTeamId).toBe('team-bidder');
  });

  it('TEST 13 — PHASE 5 HANDOFF', () => {
    const knownPhase5Result: MaximumBidResult = {
      teamValue: 1500,
      maximumBid: 1400,
      constraints: {
        purseLimit: 8000,
        futureBudgetLimit: 6000,
        solvencyLimit: 1400
      },
      bindingConstraint: 'TEAM_VALUE',
      auctionStage: 'MID',
      reasons: ['Baseline handoff test']
    };

    const dCtx = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: knownPhase5Result,
      opponent: { opponents: [], highestBidderTeamId: null },
      currentBid: 600,
      nextRequiredBid: 650,
      auctionStage: 'MID'
    });

    expect(dCtx.maximumBid.maximumBid).toBe(1400);
    expect(dCtx.maximumBid.teamValue).toBe(1500);
    expect(dCtx.maximumBid.bindingConstraint).toBe('TEAM_VALUE');
  });

  it('TEST 14 — DECISION CONTEXT CONTRACT', () => {
    const oppCtx = evaluateOpponentContext({ allTeams: [] });
    const decisionCtx = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: oppCtx,
      currentBid: 800,
      nextRequiredBid: 850,
      auctionStage: 'LATE'
    });

    expect(decisionCtx).toHaveProperty('player');
    expect(decisionCtx).toHaveProperty('marketValue');
    expect(decisionCtx).toHaveProperty('teamValue');
    expect(decisionCtx).toHaveProperty('maximumBid');
    expect(decisionCtx).toHaveProperty('opponent');
    expect(decisionCtx).toHaveProperty('currentBid');
    expect(decisionCtx).toHaveProperty('nextRequiredBid');
    expect(decisionCtx).toHaveProperty('auctionStage');

    // Phase 6 MUST NOT expose action decisions
    expect(decisionCtx).not.toHaveProperty('action');
    expect(decisionCtx).not.toHaveProperty('BID');
    expect(decisionCtx).not.toHaveProperty('PASS');
    expect(decisionCtx).not.toHaveProperty('STRETCH');
  });

  it('TEST 15 — DETERMINISM', () => {
    const opp = createTeam('team-2', 5000);
    const params = {
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: evaluateOpponentContext({ allTeams: [opp], candidatePlayer: mockPlayer }),
      currentBid: 400,
      nextRequiredBid: 450,
      auctionStage: 'MID' as const
    };

    const r1 = buildDecisionContext(params);
    const r2 = buildDecisionContext(params);

    expect(r1).toEqual(r2);
  });

  it('TEST 16 — NO RANDOMNESS', () => {
    // Verify pure determinism across 50 iterations with varying inputs
    const opps = [createTeam('t1', 2000), createTeam('t2', 8000), createTeam('t3', 5000)];
    const baseline = evaluateOpponentContext({ allTeams: opps, candidatePlayer: mockPlayer });

    for (let i = 0; i < 50; i++) {
      const trial = evaluateOpponentContext({ allTeams: opps, candidatePlayer: mockPlayer });
      expect(trial).toEqual(baseline);
    }
  });

  it('TEST 17 — BOUNDARY ISOLATION', () => {
    // Type-level and contract boundary:
    // MarketValueContext, TeamValueContext, MaximumBidContext contain no opponent property.
    // OpponentContext exists strictly on DecisionContext.
    const decisionCtx = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: { opponents: [], highestBidderTeamId: null },
      currentBid: 200,
      nextRequiredBid: 220,
      auctionStage: 'EARLY'
    });

    expect(decisionCtx.opponent).toBeDefined();
    expect((decisionCtx.marketValue as any).opponent).toBeUndefined();
    expect((decisionCtx.teamValue as any).opponent).toBeUndefined();
    expect((decisionCtx.maximumBid as any).opponent).toBeUndefined();
  });

  it('TEST 18 — NO VALUE INFLATION', () => {
    // Construct known baseline
    const teamValue = 1500;
    const maximumBid = 1400;

    const oppHighThreat = {
      teamId: 'super-rival',
      purse: 50000,
      remainingSlots: 10,
      roleCounts: [],
      missingRoles: ['BOWLER' as const],
      relevantPurchases: [],
      threat: 'HIGH' as const
    };

    const decisionCtx = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: { ...mockTeamValue, teamValue },
      maximumBid: { ...mockMaximumBid, teamValue, maximumBid },
      opponent: {
        opponents: [oppHighThreat],
        highestBidderTeamId: 'super-rival'
      },
      currentBid: 1200,
      nextRequiredBid: 1250,
      auctionStage: 'LATE'
    });

    // Maximum Bid remains 1400, never inflated to 1500+ due to high opponent threat
    expect(decisionCtx.maximumBid.maximumBid).toBe(1400);
    expect(decisionCtx.maximumBid.teamValue).toBe(1500);
    expect(decisionCtx.maximumBid.maximumBid).not.toBeGreaterThan(1400);
  });

  // =========================================================================
  // HARDENING TESTS 19 THROUGH 24
  // =========================================================================

  it('TEST 19 — OPPONENT FINANCIAL CONTEXT IS NON-AUTHORITATIVE', () => {
    // Two contexts with identical player, market value, team value, and maximum bid.
    // Only opponent purse and remaining slots differ.
    const oppA = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [createTeam('team-2', 500, 20)] // Low purse, few slots left
    });

    const oppB = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [createTeam('team-2', 15000, 2)] // High purse, many slots left
    });

    const ctxA = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: oppA,
      currentBid: 500,
      nextRequiredBid: 550,
      auctionStage: 'MID'
    });

    const ctxB = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: oppB,
      currentBid: 500,
      nextRequiredBid: 550,
      auctionStage: 'MID'
    });

    // Our financial ceiling and strategic valuation must remain completely identical
    expect(ctxA.marketValue.marketValue).toBe(ctxB.marketValue.marketValue);
    expect(ctxA.teamValue.teamValue).toBe(ctxB.teamValue.teamValue);
    expect(ctxA.maximumBid.maximumBid).toBe(ctxB.maximumBid.maximumBid);
    expect(ctxA.maximumBid.bindingConstraint).toBe(ctxB.maximumBid.bindingConstraint);
    expect(ctxA.maximumBid.bindingConstraint).toBe('SOLVENCY');

    // Opponent contexts legitimately reflect the different opponent financial inputs
    expect(ctxA.opponent.opponents[0]?.purse).toBe(500);
    expect(ctxB.opponent.opponents[0]?.purse).toBe(15000);
  });

  it('TEST 20 — OPPONENT FINANCIAL EXTREMES', () => {
    // Extreme A: Opponent with very low purse (50L) and many slots (20 slots left)
    const oppExtremeLow = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [createTeam('team-broke', 50, 5)],
      currentBid: 100,
      nextRequiredBid: 120
    });

    // Extreme B: Opponent with very high purse (80000L) and few slots (2 slots left)
    const oppExtremeHigh = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [createTeam('team-ultra-rich', 80000, 23)],
      currentBid: 100,
      nextRequiredBid: 120
    });

    const decLow = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: oppExtremeLow,
      currentBid: 100,
      nextRequiredBid: 120,
      auctionStage: 'MID'
    });

    const decHigh = buildDecisionContext({
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: oppExtremeHigh,
      currentBid: 100,
      nextRequiredBid: 120,
      auctionStage: 'MID'
    });

    // Phase 6 does not create or modify our financial ceiling
    expect(decLow.maximumBid.maximumBid).toBe(1400);
    expect(decHigh.maximumBid.maximumBid).toBe(1400);
    expect(decLow.maximumBid.bindingConstraint).toBe('SOLVENCY');
    expect(decHigh.maximumBid.bindingConstraint).toBe('SOLVENCY');
  });

  it('TEST 21 — FULL PHASE 3 → 4 → 5 → 6 HANDOFF', () => {
    // Construct representative Phase 3, Phase 4, Phase 5 outputs and OpponentContext
    const p3: PlayerMarketValueResult = {
      playerId: 'p1',
      marketValue: 1200,
      confidence: 0.95,
      playerQuality: {
        playerId: 'p1',
        role: 'BOWLER',
        rating: 95,
        ratingSource: 'STORED_RATING',
        tier: 'MARQUEE'
      },
      reasons: ['Elite bowler handoff']
    };

    const p4: TeamValueResult = {
      teamId: 'team-my',
      playerId: 'p1',
      marketValue: 1200,
      teamValue: 1500,
      factors: {} as any,
      strategicCommitment: 'JUSTIFIED',
      reasons: ['P4 strategic upgrade']
    };

    const p5: MaximumBidResult = {
      teamValue: 1500,
      maximumBid: 1400,
      constraints: {
        purseLimit: 5000,
        futureBudgetLimit: 3000,
        solvencyLimit: 1400
      },
      bindingConstraint: 'SOLVENCY',
      auctionStage: 'MID',
      reasons: ['P5 solvency ceiling']
    };

    const p6Opponent = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [createTeam('team-2', 4000)],
      highestBidderTeamId: 'team-2'
    });

    const decisionCtx = buildDecisionContext({
      player: mockPlayer,
      marketValue: p3,
      teamValue: p4,
      maximumBid: p5,
      opponent: p6Opponent,
      currentBid: 800,
      nextRequiredBid: 850,
      auctionStage: 'MID'
    });

    // Assert exact identity and equality of every upstream result
    expect(decisionCtx.player).toBe(mockPlayer);
    expect(decisionCtx.marketValue).toBe(p3);
    expect(decisionCtx.teamValue).toBe(p4);
    expect(decisionCtx.maximumBid).toBe(p5);
    expect(decisionCtx.opponent).toBe(p6Opponent);
    expect(decisionCtx.currentBid).toBe(800);
    expect(decisionCtx.nextRequiredBid).toBe(850);
    expect(decisionCtx.auctionStage).toBe('MID');
  });

  it('TEST 22 — PHASE 6 IS ASSEMBLY ONLY', () => {
    // When opponent threat transitions from LOW to MEDIUM to HIGH
    const threats: Array<'LOW' | 'MEDIUM' | 'HIGH'> = ['LOW', 'MEDIUM', 'HIGH'];

    for (const threat of threats) {
      const decisionCtx = buildDecisionContext({
        player: mockPlayer,
        marketValue: mockMarketValue,
        teamValue: mockTeamValue,
        maximumBid: mockMaximumBid,
        opponent: {
          opponents: [{
            teamId: 't-threat',
            purse: 4000,
            remainingSlots: 10,
            roleCounts: [],
            missingRoles: [],
            relevantPurchases: [],
            threat
          }],
          highestBidderTeamId: threat === 'HIGH' ? 't-threat' : null
        },
        currentBid: 500,
        nextRequiredBid: 550,
        auctionStage: 'MID'
      });

      expect(decisionCtx.marketValue.marketValue).toBe(1200);
      expect(decisionCtx.teamValue.teamValue).toBe(1500);
      expect(decisionCtx.maximumBid.maximumBid).toBe(1400);
      expect(decisionCtx.maximumBid.bindingConstraint).toBe('SOLVENCY');
      expect(decisionCtx.opponent.opponents[0]?.threat).toBe(threat);
    }
  });

  it('TEST 23 — NO SECOND OPPONENT MAX-BID MODEL', () => {
    // Verify that Phase 6 opponent context does not calculate or expose
    // opponentMaximumBid, opponentBidCeiling, opponentFutureBudget, or opponentSolvencyCeiling
    const oppCtx = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [createTeam('t2', 7000, 3)]
    });

    expect(oppCtx.opponents).toHaveLength(1);
    const opp = oppCtx.opponents[0];
    expect(opp).toBeDefined();

    expect((opp as any).opponentMaximumBid).toBeUndefined();
    expect((opp as any).opponentBidCeiling).toBeUndefined();
    expect((opp as any).opponentFutureBudget).toBeUndefined();
    expect((opp as any).opponentSolvencyCeiling).toBeUndefined();
    expect((opp as any).maximumBid).toBeUndefined();
  });

  it('TEST 24 — DECISION CONTEXT CONTRACT THROUGH ADAPTER', () => {
    // Verify that assembleDecisionContext() from human-auction-manager-context
    // produces the exact same DecisionContext as buildDecisionContext()
    const oppCtx = evaluateOpponentContext({
      candidatePlayer: mockPlayer,
      allTeams: [createTeam('t2', 5000)]
    });

    const inputs = {
      player: mockPlayer,
      marketValue: mockMarketValue,
      teamValue: mockTeamValue,
      maximumBid: mockMaximumBid,
      opponent: oppCtx,
      currentBid: 600,
      nextRequiredBid: 650,
      auctionStage: 'MID' as const
    };

    const direct = buildDecisionContext(inputs);
    const viaAdapter = assembleDecisionContext(inputs);

    expect(viaAdapter).toEqual(direct);
  });

});
