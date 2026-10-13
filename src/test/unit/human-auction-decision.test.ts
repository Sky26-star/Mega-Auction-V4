// src/test/unit/human-auction-decision.test.ts
//
// PHASE 7 — BID / STRETCH / PASS DECISION ENGINE UNIT SUITE
//
// Comprehensive test suite covering the 25 required Phase 7 tests:
//   1. HEADROOM + JUSTIFIED → BID
//   2. HEADROOM + COMMITTED → BID
//   3. FINAL_LEGAL_STEP + JUSTIFIED → BID
//   4. FINAL_LEGAL_STEP + COMMITTED → STRETCH
//   5. BEYOND_CEILING + COMMITTED → PASS
//   6. NOT_COMMITTED → PASS
//   7. STRETCH uses exactly nextRequiredBid
//   8. STRETCH never exceeds maximumBid
//   9. Team Value is not a second ceiling
//   10. B13 remains protected
//   11. B3 remains protected
//   12. HIGH opponent alone cannot create STRETCH
//   13. ENDGAME alone cannot create STRETCH
//   14. CRITICAL alone cannot create STRETCH through Phase 7
//   15. TRANSFORMATIVE alone cannot create STRETCH through Phase 7
//   16. SCARCE alone cannot create STRETCH through Phase 7
//   17. MUST_HAVE alone cannot create STRETCH through Phase 7
//   18. Deterministic repeated evaluation returns identical action
//   19. No player-name-specific behaviour
//   20. No player-id-specific behaviour
//   21. No numeric commitment score exists
//   22. No stretch percentage exists
//   23. No fixed ₹/CR stretch threshold exists
//   24. No signal-count mechanism exists
//   25. Full Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 pipeline produces the expected action

import { describe, it, expect, expectTypeOf } from 'vitest';
import { evaluateDecision } from '../../lib/auction/human-auction-decision';
import { derivePricePositionContext, evaluatePricePosition } from '../../lib/auction/human-auction-price-position';
import { evaluatePlayerMarketValue } from '../../lib/auction/human-auction-market-value';
import { evaluateTeamValue } from '../../lib/auction/human-auction-team-value';
import { evaluateMaximumBid } from '../../lib/auction/human-auction-maximum-bid';
import { buildDecisionContext, evaluateOpponentContext } from '../../lib/auction/human-auction-decision-context';
import { getNextBidAmount } from '../../lib/auction/server-bot-engine';
import type {
  DecisionContext,
  HumanAuctionDecision,
  HumanBidDecision,
  HumanStretchDecision,
  HumanPassDecision,
  PlayerContext,
  PlayerMarketValueResult,
  TeamValueResult,
  MaximumBidResult,
  OpponentContext,
  StrategicCommitment
} from '../../lib/auction/human-auction-manager-types';
import type { V3Team, V3Player } from '../../lib/v3-auction-types';

describe('Phase 7 — Action Decision Engine', () => {

  const basePlayer: PlayerContext = {
    id: 'p1',
    name: 'Candidate Player',
    role: 'BATSMAN',
    category: 'A',
    base_price: 100,
    is_overseas: false,
    rating: 85
  };

  const baseMarketValue: PlayerMarketValueResult = {
    playerId: 'p1',
    marketValue: 1000,
    confidence: 0.9,
    playerQuality: {
      playerId: 'p1',
      role: 'BATSMAN',
      rating: 85,
      ratingSource: 'STORED_RATING',
      tier: 'A'
    },
    reasons: ['Base market value 1000L']
  };

  const baseTeamValue: TeamValueResult = {
    teamId: 'team-alpha',
    playerId: 'p1',
    marketValue: 1000,
    teamValue: 1100,
    factors: {
      need: {
        role: 'BATSMAN',
        level: 'USEFUL',
        currentRoleCount: 2,
        requiredRoleCount: 5,
        remainingSquadSlots: 10
      },
      xiImprovement: {
        level: 'USEFUL_STARTER'
      },
      scarcity: {
        level: 'NORMAL',
        meaningfulAlternativesRemaining: 4
      },
      teamFit: {
        level: 'GOOD'
      },
      futurePlan: {
        priority: 'OPTIONAL',
        futureRequiredRoles: [],
        protectedFutureBudget: 500,
        remainingCriticalTargets: 0
      }
    },
    strategicCommitment: 'JUSTIFIED',
    reasons: ['Strategic fit for top order']
  };

  const baseMaximumBid: MaximumBidResult = {
    teamValue: 1100,
    maximumBid: 1100,
    constraints: {
      purseLimit: 4000,
      futureBudgetLimit: 3500,
      solvencyLimit: 3800
    },
    bindingConstraint: 'TEAM_VALUE',
    auctionStage: 'MID',
    reasons: ['Ceiling bounded by Team Value']
  };

  const baseOpponent: OpponentContext = {
    opponents: [
      {
        teamId: 'opp1',
        purse: 3000,
        remainingSlots: 8,
        roleCounts: [{ role: 'BATSMAN', count: 3 }],
        missingRoles: ['BOWLER'],
        relevantPurchases: [],
        threat: 'LOW'
      }
    ],
    highestBidderTeamId: null
  };

  function createDecisionContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
    return {
      player: basePlayer,
      marketValue: baseMarketValue,
      teamValue: baseTeamValue,
      maximumBid: baseMaximumBid,
      opponent: baseOpponent,
      currentBid: 500,
      nextRequiredBid: 550,
      auctionStage: 'MID',
      ...overrides
    };
  }

  // =========================================================================
  // TEST 1 — HEADROOM + JUSTIFIED → BID
  // =========================================================================
  it('TEST 1 — HEADROOM + JUSTIFIED → BID', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 600,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'JUSTIFIED' }
    });

    const pricePos = evaluatePricePosition(derivePricePositionContext(ctx));
    expect(pricePos.state).toBe('HEADROOM_REMAINS');

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('BID');
    if (res.action === 'BID') {
      expect(res.bidAmount).toBe(600);
      expect(res.bidAmount).toBe(ctx.nextRequiredBid);
    }
  });

  // =========================================================================
  // TEST 2 — HEADROOM + COMMITTED → BID
  // =========================================================================
  it('TEST 2 — HEADROOM + COMMITTED → BID', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 600,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const pricePos = evaluatePricePosition(derivePricePositionContext(ctx));
    expect(pricePos.state).toBe('HEADROOM_REMAINS');

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('BID');
    if (res.action === 'BID') {
      expect(res.bidAmount).toBe(600);
    }
  });

  // =========================================================================
  // TEST 3 — FINAL_LEGAL_STEP + JUSTIFIED → BID
  // =========================================================================
  it('TEST 3 — FINAL_LEGAL_STEP + JUSTIFIED → BID', () => {
    // nextRequiredBid 1000, maximumBid 1000 -> next bid 1075 > 1000 (FINAL_LEGAL_STEP)
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'JUSTIFIED' }
    });

    const pricePos = evaluatePricePosition(derivePricePositionContext(ctx));
    expect(pricePos.state).toBe('FINAL_LEGAL_STEP');

    const res = evaluateDecision(ctx);
    // Must fall back to BID, NEVER PASS!
    expect(res.action).toBe('BID');
    if (res.action === 'BID') {
      expect(res.bidAmount).toBe(1000);
    }
  });

  // =========================================================================
  // TEST 4 — FINAL_LEGAL_STEP + COMMITTED → STRETCH
  // =========================================================================
  it('TEST 4 — FINAL_LEGAL_STEP + COMMITTED → STRETCH', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const pricePos = evaluatePricePosition(derivePricePositionContext(ctx));
    expect(pricePos.state).toBe('FINAL_LEGAL_STEP');

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('STRETCH');
    if (res.action === 'STRETCH') {
      expect(res.bidAmount).toBe(1000);
      expect(res.reason).toContain('Final legal commitment');
    }
  });

  // =========================================================================
  // TEST 5 — BEYOND_CEILING + COMMITTED → PASS
  // =========================================================================
  it('TEST 5 — BEYOND_CEILING + COMMITTED → PASS', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1100,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const pricePos = evaluatePricePosition(derivePricePositionContext(ctx));
    expect(pricePos.state).toBe('BEYOND_CEILING');

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('PASS');
    expect(res).not.toHaveProperty('bidAmount');
    expect(res.reason).toContain('exceeds maximum rational bid ceiling');
  });

  // =========================================================================
  // TEST 6 — NOT_COMMITTED → PASS
  // =========================================================================
  it('TEST 6 — NOT_COMMITTED → PASS', () => {
    // Even at comfortable headroom price, NOT_COMMITTED leads to PASS
    const ctx = createDecisionContext({
      nextRequiredBid: 400,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'NOT_COMMITTED' }
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('PASS');
    expect(res.reason).toContain('not strategically justified');
  });

  // =========================================================================
  // TEST 7 — STRETCH uses exactly nextRequiredBid
  // =========================================================================
  it('TEST 7 — STRETCH uses exactly nextRequiredBid', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('STRETCH');
    if (res.action === 'STRETCH') {
      expect(res.bidAmount).toBe(1000);
      expect(res.bidAmount).toBe(ctx.nextRequiredBid);
    }
  });

  // =========================================================================
  // TEST 8 — STRETCH never exceeds maximumBid
  // =========================================================================
  it('TEST 8 — STRETCH never exceeds maximumBid', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const res = evaluateDecision(ctx);
    if (res.action === 'STRETCH') {
      expect(res.bidAmount).toBeLessThanOrEqual(ctx.maximumBid.maximumBid);
    }
  });

  // =========================================================================
  // TEST 9 — Team Value is not a second ceiling
  // =========================================================================
  it('TEST 9 — Team Value is not a second ceiling', () => {
    // nextRequiredBid 950 > teamValue 900, but nextRequiredBid <= maximumBid 1100
    const ctx = createDecisionContext({
      nextRequiredBid: 950,
      teamValue: { ...baseTeamValue, teamValue: 900, strategicCommitment: 'JUSTIFIED' },
      maximumBid: { ...baseMaximumBid, maximumBid: 1100 }
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('BID');
    expect(res.action).not.toBe('PASS');
  });

  // =========================================================================
  // TEST 10 — B13 remains protected
  // =========================================================================
  it('TEST 10 — B13 remains protected', () => {
    // Failed stretch condition at FINAL_LEGAL_STEP must fall back to BID, never PASS
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, teamValue: 900, strategicCommitment: 'JUSTIFIED' }
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('BID');
    expect(res.action).not.toBe('PASS');
    expect(res.reason).not.toContain('PRICE_EXCEEDS_TV');
  });

  // =========================================================================
  // TEST 11 — B3 remains protected
  // =========================================================================
  it('TEST 11 — B3 remains protected', () => {
    // Early stage, 20 remaining slots, high value marquee player
    const ctx = createDecisionContext({
      auctionStage: 'EARLY',
      marketValue: { ...baseMarketValue, marketValue: 1500 },
      teamValue: {
        ...baseTeamValue,
        teamValue: 1600,
        strategicCommitment: 'JUSTIFIED',
        factors: {
          ...baseTeamValue.factors,
          need: { ...baseTeamValue.factors.need, remainingSquadSlots: 20 }
        }
      },
      maximumBid: { ...baseMaximumBid, maximumBid: 1500, auctionStage: 'EARLY' },
      nextRequiredBid: 800
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('BID');
    expect(res.action).not.toBe('PASS');
  });

  // =========================================================================
  // TEST 12 — HIGH opponent alone cannot create STRETCH
  // =========================================================================
  it('TEST 12 — HIGH opponent alone cannot create STRETCH', () => {
    // At HEADROOM_REMAINS:
    const ctxHeadroom = createDecisionContext({
      nextRequiredBid: 600,
      maximumBid: { ...baseMaximumBid, maximumBid: 1200 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'JUSTIFIED' },
      opponent: {
        opponents: [{ ...baseOpponent.opponents[0]!, threat: 'HIGH' }],
        highestBidderTeamId: 'opp1'
      }
    });
    const resHeadroom = evaluateDecision(ctxHeadroom);
    expect(resHeadroom.action).toBe('BID');

    // At FINAL_LEGAL_STEP with JUSTIFIED commitment:
    const ctxFinalStep = createDecisionContext({
      nextRequiredBid: 1200,
      maximumBid: { ...baseMaximumBid, maximumBid: 1200 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'JUSTIFIED' },
      opponent: {
        opponents: [{ ...baseOpponent.opponents[0]!, threat: 'HIGH' }],
        highestBidderTeamId: 'opp1'
      }
    });
    const resFinalStep = evaluateDecision(ctxFinalStep);
    expect(resFinalStep.action).toBe('BID');
  });

  // =========================================================================
  // TEST 13 — ENDGAME alone cannot create STRETCH
  // =========================================================================
  it('TEST 13 — ENDGAME alone cannot create STRETCH', () => {
    // HEADROOM in ENDGAME with JUSTIFIED commitment:
    const ctxHeadroom = createDecisionContext({
      auctionStage: 'ENDGAME',
      nextRequiredBid: 600,
      maximumBid: { ...baseMaximumBid, maximumBid: 1200 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'JUSTIFIED' }
    });
    const resHeadroom = evaluateDecision(ctxHeadroom);
    expect(resHeadroom.action).toBe('BID');

    // FINAL_LEGAL_STEP in ENDGAME with JUSTIFIED commitment:
    const ctxFinalStep = createDecisionContext({
      auctionStage: 'ENDGAME',
      nextRequiredBid: 1200,
      maximumBid: { ...baseMaximumBid, maximumBid: 1200 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'JUSTIFIED' }
    });
    const resFinalStep = evaluateDecision(ctxFinalStep);
    expect(resFinalStep.action).toBe('BID');
  });

  // =========================================================================
  // TEST 14 — CRITICAL alone cannot create STRETCH through Phase 7
  // =========================================================================
  it('TEST 14 — CRITICAL alone cannot create STRETCH through Phase 7', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: {
        ...baseTeamValue,
        strategicCommitment: 'JUSTIFIED',
        factors: {
          ...baseTeamValue.factors,
          need: { ...baseTeamValue.factors.need, level: 'CRITICAL' }
        }
      }
    });

    const res = evaluateDecision(ctx);
    // Phase 7 respects strategicCommitment === 'JUSTIFIED' -> BID
    expect(res.action).toBe('BID');
    expect(res.action).not.toBe('STRETCH');
  });

  // =========================================================================
  // TEST 15 — TRANSFORMATIVE alone cannot create STRETCH through Phase 7
  // =========================================================================
  it('TEST 15 — TRANSFORMATIVE alone cannot create STRETCH through Phase 7', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: {
        ...baseTeamValue,
        strategicCommitment: 'JUSTIFIED',
        factors: {
          ...baseTeamValue.factors,
          xiImprovement: { level: 'TRANSFORMATIVE' }
        }
      }
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('BID');
    expect(res.action).not.toBe('STRETCH');
  });

  // =========================================================================
  // TEST 16 — SCARCE alone cannot create STRETCH through Phase 7
  // =========================================================================
  it('TEST 16 — SCARCE alone cannot create STRETCH through Phase 7', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: {
        ...baseTeamValue,
        strategicCommitment: 'JUSTIFIED',
        factors: {
          ...baseTeamValue.factors,
          scarcity: { level: 'VERY_SCARCE', meaningfulAlternativesRemaining: 0 }
        }
      }
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('BID');
    expect(res.action).not.toBe('STRETCH');
  });

  // =========================================================================
  // TEST 17 — MUST_HAVE alone cannot create STRETCH through Phase 7
  // =========================================================================
  it('TEST 17 — MUST_HAVE alone cannot create STRETCH through Phase 7', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: {
        ...baseTeamValue,
        strategicCommitment: 'JUSTIFIED',
        factors: {
          ...baseTeamValue.factors,
          futurePlan: { ...baseTeamValue.factors.futurePlan, priority: 'MUST_HAVE' }
        }
      }
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('BID');
    expect(res.action).not.toBe('STRETCH');
  });

  // =========================================================================
  // TEST 18 — Deterministic repeated evaluation returns identical action
  // =========================================================================
  it('TEST 18 — Deterministic repeated evaluation returns identical action', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const baseline = evaluateDecision(ctx);
    for (let i = 0; i < 100; i++) {
      const run = evaluateDecision(ctx);
      expect(run).toEqual(baseline);
    }
  });

  // =========================================================================
  // TEST 19 — No player-name-specific behaviour
  // =========================================================================
  it('TEST 19 — No player-name-specific behaviour', () => {
    const ctx1 = createDecisionContext({
      player: { ...basePlayer, name: 'MS Dhoni' }
    });
    const ctx2 = createDecisionContext({
      player: { ...basePlayer, name: 'Virat Kohli' }
    });

    const res1 = evaluateDecision(ctx1);
    const res2 = evaluateDecision(ctx2);

    expect(res1.action).toBe(res2.action);
    if (res1.action !== 'PASS' && res2.action !== 'PASS') {
      expect(res1.bidAmount).toBe(res2.bidAmount);
    }
  });

  // =========================================================================
  // TEST 20 — No player-id-specific behaviour
  // =========================================================================
  it('TEST 20 — No player-id-specific behaviour', () => {
    const ctx1 = createDecisionContext({
      player: { ...basePlayer, id: 'player-alpha-123' }
    });
    const ctx2 = createDecisionContext({
      player: { ...basePlayer, id: 'player-omega-789' }
    });

    const res1 = evaluateDecision(ctx1);
    const res2 = evaluateDecision(ctx2);

    expect(res1.action).toBe(res2.action);
    if (res1.action !== 'PASS' && res2.action !== 'PASS') {
      expect(res1.bidAmount).toBe(res2.bidAmount);
    }
  });

  // =========================================================================
  // TEST 21 — No numeric commitment score exists
  // =========================================================================
  it('TEST 21 — No numeric commitment score exists', () => {
    const ctx = createDecisionContext({
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const res = evaluateDecision(ctx);
    expectTypeOf(ctx.teamValue.strategicCommitment).toEqualTypeOf<StrategicCommitment>();
    expect(typeof ctx.teamValue.strategicCommitment).toBe('string');
    expect(res.factors.some(f => f.detail.toLowerCase().includes('score'))).toBe(false);
  });

  // =========================================================================
  // TEST 22 — No stretch percentage exists
  // =========================================================================
  it('TEST 22 — No stretch percentage exists', () => {
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('STRETCH');
    expect(res.reason).not.toMatch(/%|percent/i);
    expect(res.factors.some(f => f.detail.match(/%|percent/i))).toBe(false);
  });

  // =========================================================================
  // TEST 23 — No fixed ₹/CR stretch threshold exists
  // =========================================================================
  it('TEST 23 — No fixed ₹/CR stretch threshold exists', () => {
    // Stretch is determined by FINAL_LEGAL_STEP + COMMITTED, not a fixed CR band
    // Test with low values (200L) and high values (2000L)
    const ctxLow = createDecisionContext({
      nextRequiredBid: 200,
      maximumBid: { ...baseMaximumBid, maximumBid: 200 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });
    const ctxHigh = createDecisionContext({
      nextRequiredBid: 2000,
      maximumBid: { ...baseMaximumBid, maximumBid: 2000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const resLow = evaluateDecision(ctxLow);
    const resHigh = evaluateDecision(ctxHigh);

    expect(resLow.action).toBe('STRETCH');
    expect(resHigh.action).toBe('STRETCH');
  });

  // =========================================================================
  // TEST 24 — No signal-count mechanism exists
  // =========================================================================
  it('TEST 24 — No signal-count mechanism exists', () => {
    // When COMMITTED, single authoritative field drives STRETCH at FINAL_LEGAL_STEP
    const ctx = createDecisionContext({
      nextRequiredBid: 1000,
      maximumBid: { ...baseMaximumBid, maximumBid: 1000 },
      teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('STRETCH');
    // Ensure no signal counting exists in factors
    expect(res.factors.some(f => f.detail.toLowerCase().includes('count') && f.detail.toLowerCase().includes('signal'))).toBe(false);
  });

  // =========================================================================
  // TEST 25 — Full Phase 3 → 4 → 5 → 6 → 7A → 7 pipeline
  // =========================================================================
  it('TEST 25 — Full Phase 3 → 4 → 5 → 6 → 7A → 7 pipeline produces expected action', () => {
    const rawPlayer: V3Player = {
      id: 'p-real',
      name: 'Real Candidate',
      role: 'BATSMAN',
      category: 'A',
      country: 'India',
      age: 28,
      batting_hand: 'RIGHT',
      base_price: 100,
      is_overseas: false,
      image_url: null,
      rating: 92
    };

    const rawTeam: V3Team = {
      id: 'team-real',
      name: 'Team Real',
      short_name: 'TR',
      purse: 6000,
      initial_purse: 12000,
      players_bought: 0,
      overseas_count: 0,
      is_bot: true
    };
    const currentRoster: readonly V3Player[] = [];

    // Phase 3: Market Value
    const p3MarketValue = evaluatePlayerMarketValue(
      {
        player: {
          id: rawPlayer.id,
          name: rawPlayer.name,
          role: rawPlayer.role,
          category: rawPlayer.category,
          base_price: rawPlayer.base_price,
          is_overseas: rawPlayer.is_overseas,
          rating: rawPlayer.rating ?? 92
        },
        quality: {
          playerId: rawPlayer.id,
          role: rawPlayer.role,
          rating: rawPlayer.rating ?? 92,
          ratingSource: 'STORED_RATING',
          tier: rawPlayer.category
        }
      },
      rawPlayer
    );
    expect(p3MarketValue.marketValue).toBeGreaterThan(0);

    // Phase 4: Team Value (Transformative + Critical + Very Scarce -> COMMITTED)
    const p4TeamValue = evaluateTeamValue({
      teamId: rawTeam.id,
      player: {
        id: rawPlayer.id,
        name: rawPlayer.name,
        role: rawPlayer.role,
        category: rawPlayer.category,
        base_price: rawPlayer.base_price,
        is_overseas: rawPlayer.is_overseas,
        rating: rawPlayer.rating ?? 92
      },
      marketValue: p3MarketValue,
      currentRoster,
      need: {
        role: 'BATSMAN',
        level: 'CRITICAL',
        currentRoleCount: 0,
        requiredRoleCount: 4,
        remainingSquadSlots: 15
      },
      xiImprovement: {
        level: 'TRANSFORMATIVE'
      },
      scarcity: {
        level: 'VERY_SCARCE',
        meaningfulAlternativesRemaining: 0
      },
      teamFit: {
        level: 'EXCELLENT'
      },
      futurePlan: {
        priority: 'MUST_HAVE',
        futureRequiredRoles: [{ role: 'BATSMAN', count: 1 }],
        protectedFutureBudget: 500,
        remainingCriticalTargets: 1
      }
    });
    expect(p4TeamValue.strategicCommitment).toBe('COMMITTED');

    // Phase 5: Maximum Bid
    const p5MaxBid = evaluateMaximumBid({
      teamValue: p4TeamValue,
      purse: {
        currentPurse: rawTeam.purse,
        remainingSquadSlots: 15,
        minimumRequiredFutureSpend: 280,
        health: 'SAFE'
      },
      futureBudget: 500,
      auctionStage: 'MID',
      currentBid: 500,
      nextRequiredBid: 550
    });
    expect(p5MaxBid.maximumBid).toBeGreaterThan(0);

    // Phase 6: Opponent Context & Decision Context
    const p6Opponent = evaluateOpponentContext({
      candidatePlayer: {
        id: rawPlayer.id,
        role: rawPlayer.role,
        base_price: rawPlayer.base_price
      },
      allTeams: [rawTeam],
      myTeamId: rawTeam.id,
      currentBid: 500,
      nextRequiredBid: 550,
      highestBidderTeamId: null
    });

    const p6DecisionContext = buildDecisionContext({
      player: {
        id: rawPlayer.id,
        name: rawPlayer.name,
        role: rawPlayer.role,
        category: rawPlayer.category,
        base_price: rawPlayer.base_price,
        is_overseas: rawPlayer.is_overseas,
        rating: rawPlayer.rating ?? 92
      },
      marketValue: p3MarketValue,
      teamValue: p4TeamValue,
      maximumBid: p5MaxBid,
      opponent: p6Opponent,
      currentBid: 500,
      nextRequiredBid: 550,
      auctionStage: 'MID'
    });

    // Phase 7A: Headroom remains -> Action BID
    const p7DecisionHeadroom = evaluateDecision(p6DecisionContext);
    expect(p7DecisionHeadroom.action).toBe('BID');
    if (p7DecisionHeadroom.action === 'BID') {
      expect(p7DecisionHeadroom.bidAmount).toBe(550);
    }

    // Advance to final legal step (exact ceiling) -> Action STRETCH
    const p6FinalStepContext = {
      ...p6DecisionContext,
      nextRequiredBid: p5MaxBid.maximumBid
    };
    const p7DecisionStretch = evaluateDecision(p6FinalStepContext);
    expect(p7DecisionStretch.action).toBe('STRETCH');
    if (p7DecisionStretch.action === 'STRETCH') {
      expect(p7DecisionStretch.bidAmount).toBe(p5MaxBid.maximumBid);
    }

    // Advance beyond ceiling -> Action PASS
    const p6BeyondContext = {
      ...p6DecisionContext,
      nextRequiredBid: p5MaxBid.maximumBid + 50
    };
    const p7DecisionPass = evaluateDecision(p6BeyondContext);
    expect(p7DecisionPass.action).toBe('PASS');
  });

  // =========================================================================
  // SUPPLEMENTARY CONTRACT TESTS
  // =========================================================================
  describe('Supplementary Contract Tests', () => {
    it('Phase 7A is descriptive only; Phase 7 is the sole action authority', () => {
      const ctx = createDecisionContext();
      const pPos = evaluatePricePosition(derivePricePositionContext(ctx));
      expect(pPos).not.toHaveProperty('action');
      expect(pPos).not.toHaveProperty('bidAmount');

      const res = evaluateDecision(ctx);
      expect(['BID', 'STRETCH', 'PASS']).toContain(res.action);
    });

    it('Maximum ceiling is strictly respected across all actions', () => {
      const ceiling = 1000;
      const ctxBid = createDecisionContext({
        nextRequiredBid: 800,
        maximumBid: { ...baseMaximumBid, maximumBid: ceiling }
      });
      const resBid = evaluateDecision(ctxBid);
      if (resBid.action !== 'PASS') {
        expect(resBid.bidAmount).toBeLessThanOrEqual(ceiling);
      }

      const ctxStretch = createDecisionContext({
        nextRequiredBid: ceiling,
        maximumBid: { ...baseMaximumBid, maximumBid: ceiling },
        teamValue: { ...baseTeamValue, strategicCommitment: 'COMMITTED' }
      });
      const resStretch = evaluateDecision(ctxStretch);
      if (resStretch.action !== 'PASS') {
        expect(resStretch.bidAmount).toBeLessThanOrEqual(ceiling);
      }
    });

    it('One final legal step on the legal bid ladder', () => {
      const ceiling = 1000;
      const basePrice = 100;
      let bid = basePrice;
      const ladder: number[] = [bid];

      while (bid <= ceiling + 100) {
        bid = getNextBidAmount(bid, basePrice);
        ladder.push(bid);
      }

      let finalStepCount = 0;
      for (const step of ladder) {
        const pContext = { nextRequiredBid: step, maximumBid: ceiling, basePrice };
        const pPos = evaluatePricePosition(pContext);
        if (pPos.state === 'FINAL_LEGAL_STEP') {
          finalStepCount++;
          expect(step).toBe(ceiling);
        }
      }

      expect(finalStepCount).toBe(1);
    });
  });
});
