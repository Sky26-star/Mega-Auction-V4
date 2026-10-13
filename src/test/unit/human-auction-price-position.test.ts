// src/test/unit/human-auction-price-position.test.ts
//
// PHASE 7A — PRICE POSITION / COMMITMENT SEMANTICS
//
// Ladder reference (getNextBidAmount, Lakhs):
//   <=300 +25 | <=600 +50 | <=1000 +75 | <=1500 +100 | <=2000 +150 | <=2500 +175 | else +200

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  evaluatePricePosition,
  derivePricePositionContext
} from '../../lib/auction/human-auction-price-position';
import { evaluateDecision } from '../../lib/auction/human-auction-decision';
import { evaluatePlayerMarketValue } from '../../lib/auction/human-auction-market-value';
import { evaluateTeamValue } from '../../lib/auction/human-auction-team-value';
import { evaluateMaximumBid } from '../../lib/auction/human-auction-maximum-bid';
import { buildDecisionContext, evaluateOpponentContext } from '../../lib/auction/human-auction-decision-context';
import { getNextBidAmount } from '../../lib/auction/server-bot-engine';
import { getNextMinimumBid } from '../../lib/auction/bid-increments';
import type {
  DecisionContext,
  PlayerContext,
  PlayerMarketValueResult,
  TeamValueResult,
  MaximumBidResult,
  OpponentContext,
  TeamValueContext,
  MaximumBidContext,
  AuctionStage
} from '../../lib/auction/human-auction-manager-types';
import type { V3Player, V3Team } from '../../lib/v3-auction-types';

const SOURCE_PATH = resolve(__dirname, '../../lib/auction/human-auction-price-position.ts');
const RAW_SOURCE = readFileSync(SOURCE_PATH, 'utf8');
/** Executable code only (comments stripped) so documentation does not trip static checks. */
const CODE = RAW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Phase 7A — Price Position / Commitment Semantics', () => {
  const basePlayer: PlayerContext = {
    id: 'p1', name: 'Candidate Player', role: 'BATSMAN', category: 'A',
    base_price: 100, is_overseas: false, rating: 85
  };

  const baseMarketValue: PlayerMarketValueResult = {
    playerId: 'p1', marketValue: 1000, confidence: 0.9,
    playerQuality: { playerId: 'p1', role: 'BATSMAN', rating: 85, ratingSource: 'STORED_RATING', tier: 'A' },
    reasons: []
  };

  const baseTeamValue: TeamValueResult = {
    teamId: 'team-alpha', playerId: 'p1', marketValue: 1000, teamValue: 1100,
    factors: {
      need: { role: 'BATSMAN', level: 'USEFUL', currentRoleCount: 2, requiredRoleCount: 5, remainingSquadSlots: 10 },
      xiImprovement: { level: 'USEFUL_STARTER' },
      scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 4 },
      teamFit: { level: 'GOOD' },
      futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 0, remainingCriticalTargets: 0 }
    },
    strategicCommitment: 'JUSTIFIED',
    reasons: []
  };

  const baseMaximumBid: MaximumBidResult = {
    teamValue: 1100, maximumBid: 1100,
    constraints: { purseLimit: 4000, futureBudgetLimit: 3500, solvencyLimit: 3800 },
    bindingConstraint: 'TEAM_VALUE', auctionStage: 'MID', reasons: []
  };

  const baseOpponent: OpponentContext = {
    opponents: [{
      teamId: 'opp1', purse: 3000, remainingSlots: 8, roleCounts: [],
      missingRoles: [], relevantPurchases: [], threat: 'LOW'
    }],
    highestBidderTeamId: null
  };

  const ctxOf = (o: Partial<DecisionContext> = {}): DecisionContext => ({
    player: basePlayer, marketValue: baseMarketValue, teamValue: baseTeamValue,
    maximumBid: baseMaximumBid, opponent: baseOpponent,
    currentBid: 1000, nextRequiredBid: 1075, auctionStage: 'MID', ...o
  });

  const positionOf = (ctx: DecisionContext) => evaluatePricePosition(derivePricePositionContext(ctx));

  it('TEST 1 — Determinism', () => {
    const ctx = ctxOf();
    const first = positionOf(ctx);
    for (let i = 0; i < 25; i++) expect(positionOf(ctx)).toEqual(first);
  });

  it('TEST 2 — Maximum ceiling boundary', () => {
    // Legal (<= ceiling) is never BEYOND_CEILING
    for (const next of [100, 500, 1000, 1075, 1100]) {
      expect(positionOf(ctxOf({ nextRequiredBid: next })).state).not.toBe('BEYOND_CEILING');
    }
    // Illegal is explicitly BEYOND_CEILING
    const beyond = positionOf(ctxOf({ nextRequiredBid: 1150 }));
    expect(beyond.state).toBe('BEYOND_CEILING');
    expect(beyond.followingLegalBid).toBeNull();
  });

  it('TEST 3 — HEADROOM_REMAINS when following legal bid still fits', () => {
    // 1000 → following 1075 <= 1100
    const res = positionOf(ctxOf({ currentBid: 925, nextRequiredBid: 1000 }));
    expect(res.state).toBe('HEADROOM_REMAINS');
    expect(res.followingLegalBid).toBe(1075);
  });

  it('TEST 4 — FINAL_LEGAL_STEP when following legal bid exceeds ceiling', () => {
    // 1075 → following 1175 > 1100
    const res = positionOf(ctxOf({ currentBid: 1000, nextRequiredBid: 1075 }));
    expect(res.state).toBe('FINAL_LEGAL_STEP');
    expect(res.followingLegalBid).toBe(1175);
    expect(res.isExactlyAtCeiling).toBe(false);
  });

  it('TEST 5 — Ceiling position is derived from the ladder (exact ceiling is a final step)', () => {
    const res = positionOf(ctxOf({ nextRequiredBid: 1100 }));
    expect(res.state).toBe('FINAL_LEGAL_STEP');
    expect(res.isExactlyAtCeiling).toBe(true);
    expect(res.followingLegalBid).toBe(getNextBidAmount(1100, 100));

    // Walking the real ladder up to any ceiling yields exactly one FINAL_LEGAL_STEP
    for (const ceiling of [130, 480, 990, 1420, 2210, 3000]) {
      let bid = 100;
      const states: string[] = [];
      while (bid <= ceiling) {
        states.push(evaluatePricePosition({ nextRequiredBid: bid, maximumBid: ceiling, basePrice: 100 }).state);
        bid = getNextBidAmount(bid, 100);
      }
      expect(states.filter(s => s === 'FINAL_LEGAL_STEP')).toHaveLength(1);
      expect(states[states.length - 1]).toBe('FINAL_LEGAL_STEP');
      expect(evaluatePricePosition({ nextRequiredBid: bid, maximumBid: ceiling, basePrice: 100 }).state).toBe('BEYOND_CEILING');
    }
  });

  it('TEST 6 — No arbitrary percentage of maximumBid', () => {
    expect(CODE).not.toMatch(/\*\s*0?\.\d+/);
    expect(CODE).not.toMatch(/\b(70|75|80|85|90|95|99)\b/);
    expect(CODE).not.toMatch(/maximumBid\s*[*/]/);
    expect(CODE).not.toMatch(/[*/]\s*maximumBid/);
  });

  it('TEST 7 — No fixed CR / monetary threshold', () => {
    // No numeric literal at all participates in the classification
    expect(CODE).not.toMatch(/[^\w.]\d+[^\w]/);
    expect(CODE).not.toMatch(/maximumBid\s*-\s*\d/);
  });

  it('TEST 8 — Bid ladder integrity (reused, not duplicated or altered)', () => {
    expect(CODE).toContain("import { getNextBidAmount } from './server-bot-engine'");
    expect(CODE).not.toMatch(/function\s+getNextBidAmount/);
    expect(getNextBidAmount(0, 100)).toBe(100);
    expect(getNextBidAmount(100, 100)).toBe(125);
    expect(getNextBidAmount(700, 100)).toBe(775);
    expect(getNextBidAmount(2200, 100)).toBe(2375);
    // Bot ladder (Lakhs) agrees with UI ladder (Crores)
    for (const l of [100, 300, 325, 600, 650, 1000, 1075, 1500, 1600, 2000, 2150, 2500, 2700]) {
      expect(getNextBidAmount(l, 20)).toBeCloseTo(getNextMinimumBid(l / 100) * 100, 6);
    }
  });

  it('TEST 9 — Maximum bid integrity', () => {
    const ctx = ctxOf();
    const snapshot = JSON.parse(JSON.stringify(ctx.maximumBid));
    const res = positionOf(ctx);
    expect(res.maximumBid).toBe(baseMaximumBid.maximumBid);
    expect(ctx.maximumBid).toEqual(snapshot);
  });

  it('TEST 10 — Team Value independence', () => {
    const a = positionOf(ctxOf({ teamValue: { ...baseTeamValue, teamValue: 200 } }));
    const b = positionOf(ctxOf({ teamValue: { ...baseTeamValue, teamValue: 9000 } }));
    expect(a).toEqual(b);
    expect(CODE).not.toMatch(/teamValue/);
  });

  it('TEST 11 — Market Value independence', () => {
    const a = positionOf(ctxOf({ marketValue: { ...baseMarketValue, marketValue: 50 } }));
    const b = positionOf(ctxOf({ marketValue: { ...baseMarketValue, marketValue: 5000 } }));
    expect(a).toEqual(b);
    expect(CODE).not.toMatch(/marketValue/);
  });

  it('TEST 12 — Opponent independence', () => {
    const extreme: OpponentContext = {
      opponents: [{ ...baseOpponent.opponents[0]!, purse: 99999, remainingSlots: 1, threat: 'HIGH' }],
      highestBidderTeamId: 'opp1'
    };
    expect(positionOf(ctxOf({ opponent: extreme }))).toEqual(positionOf(ctxOf()));
    expect(CODE).not.toMatch(/opponent/i);
  });

  it('TEST 13 — Current bid integrity', () => {
    // Only nextRequiredBid (the legal continuation) matters; currentBid is not read
    const a = positionOf(ctxOf({ currentBid: 0, nextRequiredBid: 1000 }));
    const b = positionOf(ctxOf({ currentBid: 925, nextRequiredBid: 1000 }));
    expect(a).toEqual(b);
    expect(CODE).not.toMatch(/currentBid/);
    // Upstream values unaffected by currentBid
    const d1 = evaluateDecision(ctxOf({ currentBid: 100, nextRequiredBid: 1000 }));
    const d2 = evaluateDecision(ctxOf({ currentBid: 925, nextRequiredBid: 1000 }));
    expect(d1.marketValue).toBe(d2.marketValue);
    expect(d1.teamValue).toBe(d2.teamValue);
    expect(d1.maximumBid).toBe(d2.maximumBid);
  });

  it('TEST 14 — Stage independence', () => {
    const stages: AuctionStage[] = ['EARLY', 'MID', 'LATE', 'ENDGAME'];
    const results = stages.map(s => positionOf(ctxOf({ auctionStage: s })));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(CODE).not.toMatch(/auctionStage|EARLY|ENDGAME/);
  });

  it('TEST 15 — B3 regression: no purse / slot reserve logic', () => {
    expect(CODE).not.toMatch(/averagePurse|remainingSlots|remainingSquadSlots|purse|reserve/i);
  });

  it('TEST 16 — B13 regression: legal bid is never blocked by TV / stage / absolute price', () => {
    const ctx = ctxOf({
      auctionStage: 'EARLY',
      teamValue: { ...baseTeamValue, teamValue: 2000 },
      maximumBid: { ...baseMaximumBid, maximumBid: 2400, teamValue: 2600 },
      currentBid: 2000,
      nextRequiredBid: 2150
    });
    // nextRequiredBid > teamValue, absolute price high, EARLY — still legal
    expect(positionOf(ctx).state).not.toBe('BEYOND_CEILING');
    expect(evaluateDecision(ctx).action).not.toBe('PASS');
    expect(CODE).not.toMatch(/PRICE_EXCEEDS_TV/);
  });

  it('TEST 17 — No player hardcoding', () => {
    expect(CODE).not.toMatch(/player\.name|player\.id|\.name\b|\.id\b/);
    const renamed = positionOf(ctxOf({ player: { ...basePlayer, id: 'zzz', name: 'Someone Else' } }));
    expect(renamed).toEqual(positionOf(ctxOf()));
  });

  it('TEST 18 — Contract round trip preserves the financial ceiling exactly', () => {
    const p5: MaximumBidResult = { ...baseMaximumBid, maximumBid: 1370, bindingConstraint: 'SOLVENCY' };
    const ctx = ctxOf({ maximumBid: p5, nextRequiredBid: 1300 });
    const input = derivePricePositionContext(ctx);
    expect(input.maximumBid).toBe(1370);
    const res = evaluatePricePosition(input);
    expect(res.maximumBid).toBe(1370);
    expect(ctx.maximumBid.maximumBid).toBe(1370);
    expect(evaluateDecision(ctx).maximumBid).toBe(1370);
  });

  it('TEST 19 — Phase boundary: never returns an action', () => {
    for (const next of [500, 1075, 1100, 1500]) {
      const res = positionOf(ctxOf({ nextRequiredBid: next }));
      expect(res).not.toHaveProperty('action');
      expect(res).not.toHaveProperty('bidAmount');
      expect(['HEADROOM_REMAINS', 'FINAL_LEGAL_STEP', 'BEYOND_CEILING']).toContain(res.state);
    }
    expect(CODE).not.toMatch(/'BID'|'STRETCH'|'PASS'/);
  });

  it('TEST 20 — Phase 7 compatibility: one ceiling, one action authority', () => {
    for (const next of [500, 1000, 1075, 1100, 1150, 1500]) {
      const ctx = ctxOf({ nextRequiredBid: next });
      const pos = positionOf(ctx);
      const dec = evaluateDecision(ctx);
      // Same ceiling seen by both
      expect(pos.maximumBid).toBe(dec.maximumBid);
      // BEYOND_CEILING ⇔ Phase 7 hard-ceiling PASS
      if (pos.state === 'BEYOND_CEILING') {
        expect(dec.action).toBe('PASS');
      } else {
        expect(dec.action).not.toBe('PASS');
        if (dec.action !== 'PASS') expect(dec.bidAmount).toBeLessThanOrEqual(pos.maximumBid);
      }
    }
  });

  it('TEST 21 — Full Phase 3 → 4 → 5 → 6 → 7A chain with real outputs', () => {
    const fullPlayer: V3Player = {
      id: basePlayer.id, name: basePlayer.name, role: basePlayer.role, category: basePlayer.category,
      country: 'India', age: 26, batting_hand: 'Right', base_price: basePlayer.base_price,
      is_overseas: false, image_url: null, rating: basePlayer.rating,
      matches: 60, runs: 1800, strike_rate: 135
    };
    const p3 = evaluatePlayerMarketValue({
      player: basePlayer,
      quality: { playerId: 'p1', role: 'BATSMAN', rating: 85, ratingSource: 'STORED_RATING', tier: 'A' }
    }, fullPlayer);

    const tvCtx: TeamValueContext = {
      teamId: 'team-full', player: basePlayer, marketValue: p3, currentRoster: [],
      need: { role: 'BATSMAN', level: 'IMPORTANT', currentRoleCount: 2, requiredRoleCount: 5, remainingSquadSlots: 10 },
      xiImprovement: { level: 'USEFUL_STARTER' },
      scarcity: { level: 'NORMAL', meaningfulAlternativesRemaining: 3 },
      teamFit: { level: 'GOOD' },
      futurePlan: { priority: 'OPTIONAL', futureRequiredRoles: [], protectedFutureBudget: 500, remainingCriticalTargets: 0 }
    };
    const p4 = evaluateTeamValue(tvCtx);

    const mbCtx: MaximumBidContext = {
      teamValue: p4,
      purse: { currentPurse: 4000, remainingSquadSlots: 10, minimumRequiredFutureSpend: 200, health: 'SAFE' },
      auctionStage: 'MID', currentBid: 0, nextRequiredBid: 100, futureBudget: 500
    };
    const p5 = evaluateMaximumBid(mbCtx);
    expect(p5.maximumBid).toBeGreaterThanOrEqual(basePlayer.base_price);

    const oppTeam: V3Team = {
      id: 'opp-t1', name: 'Rival', short_name: 'RIV', purse: 3500, initial_purse: 10000,
      players_bought: 5, overseas_count: 1, is_bot: true
    };

    const buildAt = (currentBid: number, nextRequiredBid: number): DecisionContext => buildDecisionContext({
      player: basePlayer, marketValue: p3, teamValue: p4, maximumBid: p5,
      opponent: evaluateOpponentContext({
        myTeamId: 'team-full', allTeams: [oppTeam], candidatePlayer: basePlayer,
        highestBidderTeamId: 'opp-t1', currentBid, nextRequiredBid
      }),
      currentBid, nextRequiredBid, auctionStage: 'MID'
    });

    // Walk the real ladder from base price
    let current = 0;
    let next = getNextBidAmount(0, basePlayer.base_price);
    const seen: string[] = [];
    while (next <= p5.maximumBid) {
      const pos = positionOf(buildAt(current, next));
      expect(pos.maximumBid).toBe(p5.maximumBid);
      seen.push(pos.state);
      current = next;
      next = getNextBidAmount(current, basePlayer.base_price);
    }
    expect(seen[seen.length - 1]).toBe('FINAL_LEGAL_STEP');
    expect(seen.filter(s => s === 'FINAL_LEGAL_STEP')).toHaveLength(1);
    expect(positionOf(buildAt(current, next)).state).toBe('BEYOND_CEILING');
  });

  it('TEST 22 — No runtime integration: module is not imported by runtime engines', () => {
    for (const f of ['server-bot-engine.ts', 'bot-tactical-engine.ts', 'bot-q-engine.ts']) {
      const src = readFileSync(resolve(__dirname, '../../lib/auction', f), 'utf8');
      expect(src).not.toContain('human-auction-price-position');
    }
    expect(CODE).not.toMatch(/Math\.random|Date\.now/);
  });
});
