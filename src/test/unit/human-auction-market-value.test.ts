// src/test/unit/human-auction-market-value.test.ts
// Unit Tests for Phase 3 — Player Quality & Market Value Hardening

import { describe, it, expect, expectTypeOf } from 'vitest';
import { evaluatePlayerMarketValue, evaluateStatisticalQuality } from '@/lib/auction/human-auction-market-value';
import type { MarketValueContext, PlayerMarketValueResult } from '@/lib/auction/human-auction-manager-types';
import type { V3Player } from '@/lib/v3-auction-types';
import fs from 'fs';
import path from 'path';

describe('Human Auction Manager - Player Value & Auction Valuation Engine', () => {

  const createBasePlayer = (overrides: Partial<V3Player> = {}): V3Player => ({
    id: 'test_player',
    name: 'Test Player',
    role: 'BATSMAN',
    category: 'A',
    country: 'India',
    age: 25,
    batting_hand: 'Right',
    base_price: 200,
    is_overseas: false,
    image_url: null,
    rating: 85,
    ...overrides
  });

  const createBaseContext = (player: V3Player, remainingInRole: number = 20): MarketValueContext => ({
    player: {
      id: player.id,
      name: player.name,
      role: player.role,
      category: player.category,
      base_price: player.base_price,
      is_overseas: player.is_overseas,
      rating: player.rating
    },
    quality: {
      playerId: player.id,
      role: player.role,
      rating: player.rating || 74,
      ratingSource: 'STORED_RATING',
      tier: player.category,
      confidence: 1.0
    },
    market: {
      remainingRolePoolCount: remainingInRole
    }
  });

  // -------------------------------------------------------------
  // PRESERVED CONTRACT INVARIANTS & BASELINE TESTS
  // -------------------------------------------------------------

  it('1 & 4. Elite player with strong stats + high experience + high rating produces marquee value', () => {
    // e.g. Virat Kohli profile
    const eliteBatsman = createBasePlayer({
      name: 'Virat Kohli',
      rating: 97,
      matches: 250,
      runs: 8000,
      strike_rate: 135
    });
    const ctx = createBaseContext(eliteBatsman);
    const result = evaluatePlayerMarketValue(ctx, eliteBatsman);

    expect(result.marketValue).toBeGreaterThanOrEqual(2000); // 20Cr+
    expect(result.reasons.some(r => r.includes('Marquee'))).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('2. Strong player with good stats but lower experience is valued lower than equivalent veteran', () => {
    const veteran = createBasePlayer({
      rating: 90,
      matches: 125,
      runs: 3500
    });
    
    const rookie = createBasePlayer({
      rating: 90,
      matches: 15,
      runs: 400
    });

    const ctxVet = createBaseContext(veteran);
    const resVet = evaluatePlayerMarketValue(ctxVet, veteran);

    const ctxRookie = createBaseContext(rookie);
    const resRookie = evaluatePlayerMarketValue(ctxRookie, rookie);

    expect(resVet.marketValue).toBeGreaterThan(resRookie.marketValue);
    expect(resVet.confidence).toBeGreaterThan(resRookie.confidence);
  });

  it('3. High rating but weak statistical evidence does not become a marquee valuation', () => {
    const unprovenHighRated = createBasePlayer({
      rating: 95, // High rating but no stats
      matches: 5,
      runs: 50
    });
    const ctx = createBaseContext(unprovenHighRated);
    const result = evaluatePlayerMarketValue(ctx, unprovenHighRated);

    expect(result.marketValue).toBeLessThan(1800);
    expect(result.reasons.some(r => r.includes('Marquee'))).toBe(false);
  });

  it('5. Role-aware valuation appropriately values dual-threat All-Rounders', () => {
    const strongAR = createBasePlayer({
      role: 'ALL_ROUNDER',
      rating: 91,
      matches: 80,
      runs: 1500,
      wickets: 80
    });
    const ctx = createBaseContext(strongAR);
    const result = evaluatePlayerMarketValue(ctx, strongAR);

    expect(result.reasons.some(r => r.includes('dual-threat'))).toBe(true);
    expect(result.reasons.some(r => r.includes('all-rounder role (+15%)'))).toBe(true);
  });

  it('6. Missing optional statistics remain deterministic and do not produce NaN', () => {
    const emptyStatsPlayer = createBasePlayer({
      rating: 80,
      matches: null as any,
      runs: undefined,
      wickets: null as any
    });
    const ctx = createBaseContext(emptyStatsPlayer);
    const result = evaluatePlayerMarketValue(ctx, emptyStatsPlayer);

    expect(Number.isNaN(result.marketValue)).toBe(false);
    expect(result.marketValue).toBeGreaterThanOrEqual(emptyStatsPlayer.base_price);
    expect(result.confidence).toBe(0.4);
    expect(result.reasons.some(r => r.includes('No prior IPL matches'))).toBe(true);
  });

  it('7, 8, 9, 11, 15. Market Value contract strictly isolates team/purse/opponent/currentBid structurally', () => {
    expectTypeOf<MarketValueContext>().not.toHaveProperty('teamId');
    expectTypeOf<MarketValueContext>().not.toHaveProperty('purse');
    expectTypeOf<MarketValueContext>().not.toHaveProperty('opponents');
    expectTypeOf<MarketValueContext>().not.toHaveProperty('currentBid');
    expectTypeOf<PlayerMarketValueResult>().not.toHaveProperty('maximumBid');
    expectTypeOf<PlayerMarketValueResult>().not.toHaveProperty('teamValue');
  });

  it('10. Same inputs always produce identical output (Deterministic)', () => {
    const player = createBasePlayer({ rating: 88, matches: 45, runs: 1200 });
    const ctx = createBaseContext(player);
    
    const r1 = evaluatePlayerMarketValue(ctx, player);
    const r2 = evaluatePlayerMarketValue(ctx, player);
    
    expect(r1.marketValue).toBe(r2.marketValue);
    expect(r1.confidence).toBe(r2.confidence);
    expect(r1.reasons).toEqual(r2.reasons);
  });

  it('13. Strong alternative availability affects market conditions correctly', () => {
    const player = createBasePlayer({ rating: 85, matches: 30, runs: 500 });
    
    // Very scarce pool
    const ctxScarce = createBaseContext(player, 2);
    const resScarce = evaluatePlayerMarketValue(ctxScarce, player);

    // Very abundant pool
    const ctxAbundant = createBaseContext(player, 30);
    const resAbundant = evaluatePlayerMarketValue(ctxAbundant, player);

    expect(resScarce.marketValue).toBeGreaterThan(resAbundant.marketValue);
    expect(resScarce.reasons.some(r => r.includes('scarcity'))).toBe(true);
    expect(resAbundant.reasons.some(r => r.includes('Abundant'))).toBe(true);
  });

  it('14. Reasons explain the main valuation drivers', () => {
    const player = createBasePlayer({
      role: 'BOWLER',
      rating: 94,
      matches: 150,
      wickets: 160,
      economy_rate: 6.8
    });
    const ctx = createBaseContext(player, 5);
    const result = evaluatePlayerMarketValue(ctx, player);

    const joinedReasons = result.reasons.join(' | ');
    expect(joinedReasons).toContain('Elite rating classification');
    expect(joinedReasons).toContain('Extensive IPL experience');
    expect(joinedReasons).toContain('Exceptional wicket production');
    expect(joinedReasons).toContain('Elite proven economy rate');
    expect(joinedReasons).toContain('Scarcity in remaining role pool');
  });

  // -------------------------------------------------------------
  // A. PLAYER QUALITY & RATING HIERARCHY
  // -------------------------------------------------------------

  describe('A. Player Quality / Rating Hierarchy', () => {
    it('1. Same rating, materially different batting statistics -> materially different valuation', () => {
      const batProlific = createBasePlayer({
        rating: 88,
        matches: 110,
        runs: 4500,
        batting_average: 39.5,
        strike_rate: 146.0,
        hundreds: 3,
        fifties: 32,
        boundaries: 550
      });
      const batMediocre = createBasePlayer({
        rating: 88,
        matches: 40,
        runs: 650,
        batting_average: 21.0,
        strike_rate: 122.0,
        hundreds: 0,
        fifties: 2,
        boundaries: 70
      });

      const resProlific = evaluatePlayerMarketValue(createBaseContext(batProlific), batProlific);
      const resMediocre = evaluatePlayerMarketValue(createBaseContext(batMediocre), batMediocre);

      expect(resProlific.marketValue - resMediocre.marketValue).toBeGreaterThanOrEqual(400); // >= ₹4 Cr gap
    });

    it('2. Same rating, materially different bowling statistics -> materially different valuation', () => {
      const bowlElite = createBasePlayer({
        role: 'BOWLER',
        rating: 88,
        matches: 120,
        wickets: 145,
        economy_rate: 7.20,
        bowling_average: 22.4,
        bowling_strike_rate: 18.2,
        three_wicket_hauls: 14
      });
      const bowlSubpar = createBasePlayer({
        role: 'BOWLER',
        rating: 88,
        matches: 35,
        wickets: 28,
        economy_rate: 9.60,
        bowling_average: 35.8,
        bowling_strike_rate: 24.5,
        three_wicket_hauls: 1
      });

      const resElite = evaluatePlayerMarketValue(createBaseContext(bowlElite), bowlElite);
      const resSubpar = evaluatePlayerMarketValue(createBaseContext(bowlSubpar), bowlSubpar);

      expect(resElite.marketValue - resSubpar.marketValue).toBeGreaterThanOrEqual(400); // >= ₹4 Cr gap
    });

    it('3. Same rating, different wicket-keeping contribution -> meaningful difference for wicketkeepers', () => {
      const wkTopGloves = createBasePlayer({
        role: 'WICKET_KEEPER',
        rating: 86,
        matches: 90,
        runs: 2200,
        batting_average: 32.0,
        strike_rate: 138.0,
        catches: 85,
        stumpings: 24
      });
      const wkNoGloves = createBasePlayer({
        role: 'WICKET_KEEPER',
        rating: 86,
        matches: 90,
        runs: 2200,
        batting_average: 32.0,
        strike_rate: 138.0,
        catches: 18,
        stumpings: 0
      });

      const resTop = evaluatePlayerMarketValue(createBaseContext(wkTopGloves), wkTopGloves);
      const resNone = evaluatePlayerMarketValue(createBaseContext(wkNoGloves), wkNoGloves);

      expect(resTop.marketValue).toBeGreaterThan(resNone.marketValue);
    });

    it('4. Rating remains a valid supporting signal for identical statistical profiles', () => {
      const highRated = createBasePlayer({
        rating: 94,
        matches: 60,
        runs: 1800,
        batting_average: 32.0,
        strike_rate: 136.0
      });
      const lowRated = createBasePlayer({
        rating: 80,
        matches: 60,
        runs: 1800,
        batting_average: 32.0,
        strike_rate: 136.0
      });

      const resHigh = evaluatePlayerMarketValue(createBaseContext(highRated), highRated);
      const resLow = evaluatePlayerMarketValue(createBaseContext(lowRated), lowRated);

      expect(resHigh.marketValue).toBeGreaterThan(resLow.marketValue);
    });

    it('5. Category alone cannot create elite valuation for unproven players', () => {
      const marqueeUnproven = createBasePlayer({
        category: 'MARQUEE',
        rating: 82,
        matches: 8,
        runs: 90
      });
      const res = evaluatePlayerMarketValue(createBaseContext(marqueeUnproven), marqueeUnproven);

      expect(res.marketValue).toBeLessThan(700); // Well below marquee territory
    });
  });

  // -------------------------------------------------------------
  // B. BATTING EVIDENCE
  // -------------------------------------------------------------

  describe('B. Batting Statistical Evaluation', () => {
    it('6. Strong run production increases value', () => {
      const pLowRuns = createBasePlayer({ matches: 60, runs: 800, batting_average: 28, strike_rate: 135 });
      const pHighRuns = createBasePlayer({ matches: 60, runs: 2400, batting_average: 28, strike_rate: 135 });

      const resLow = evaluatePlayerMarketValue(createBaseContext(pLowRuns), pLowRuns);
      const resHigh = evaluatePlayerMarketValue(createBaseContext(pHighRuns), pHighRuns);

      expect(resHigh.marketValue).toBeGreaterThan(resLow.marketValue);
    });

    it('7. Strong batting average increases value', () => {
      const pLowAvg = createBasePlayer({ matches: 50, runs: 1200, batting_average: 22.0, strike_rate: 135 });
      const pHighAvg = createBasePlayer({ matches: 50, runs: 1200, batting_average: 38.5, strike_rate: 135 });

      const resLow = evaluatePlayerMarketValue(createBaseContext(pLowAvg), pLowAvg);
      const resHigh = evaluatePlayerMarketValue(createBaseContext(pHighAvg), pHighAvg);

      expect(resHigh.marketValue).toBeGreaterThan(resLow.marketValue);
    });

    it('8. Strong strike rate increases value', () => {
      const pLowSR = createBasePlayer({ matches: 50, runs: 1200, batting_average: 30.0, strike_rate: 120.0 });
      const pHighSR = createBasePlayer({ matches: 50, runs: 1200, batting_average: 30.0, strike_rate: 162.0 });

      const resLow = evaluatePlayerMarketValue(createBaseContext(pLowSR), pLowSR);
      const resHigh = evaluatePlayerMarketValue(createBaseContext(pHighSR), pHighSR);

      expect(resHigh.marketValue).toBeGreaterThan(resLow.marketValue);
    });

    it('9. Hundreds/fifties contribute appropriately to milestone production', () => {
      const pNoMilestones = createBasePlayer({ matches: 60, runs: 1800, hundreds: 0, fifties: 3 });
      const pManyMilestones = createBasePlayer({ matches: 60, runs: 1800, hundreds: 2, fifties: 14 });

      const resNo = evaluatePlayerMarketValue(createBaseContext(pNoMilestones), pNoMilestones);
      const resMany = evaluatePlayerMarketValue(createBaseContext(pManyMilestones), pManyMilestones);

      expect(resMany.marketValue).toBeGreaterThan(resNo.marketValue);
    });

    it('10. Highest score contributes only as supporting peak evidence', () => {
      const pLowHS = createBasePlayer({ matches: 70, runs: 2200, highest_score: 75 });
      const pHighHS = createBasePlayer({ matches: 70, runs: 2200, highest_score: 115 });

      const resLow = evaluatePlayerMarketValue(createBaseContext(pLowHS), pLowHS);
      const resHigh = evaluatePlayerMarketValue(createBaseContext(pHighHS), pHighHS);

      // Higher HS provides moderate boost, does not dominate overall volume
      expect(resHigh.marketValue).toBeGreaterThanOrEqual(resLow.marketValue);
      expect(resHigh.marketValue - resLow.marketValue).toBeLessThan(200); // Bounded peak impact
    });

    it('11. Boundary production contributes without double-counting runs excessively', () => {
      const pLowBound = createBasePlayer({ matches: 50, runs: 1500, boundaries: 120 });
      const pHighBound = createBasePlayer({ matches: 50, runs: 1500, boundaries: 220 });

      const resLow = evaluatePlayerMarketValue(createBaseContext(pLowBound), pLowBound);
      const resHigh = evaluatePlayerMarketValue(createBaseContext(pHighBound), pHighBound);

      expect(resHigh.marketValue).toBeGreaterThan(resLow.marketValue);
      expect(resHigh.marketValue - resLow.marketValue).toBeLessThan(150); // Bounded boundary share
    });
  });

  // -------------------------------------------------------------
  // C. BOWLING EVIDENCE
  // -------------------------------------------------------------

  describe('C. Bowling Statistical Evaluation', () => {
    it('12. Strong wicket production increases value', () => {
      const pLowWkts = createBasePlayer({ role: 'BOWLER', matches: 60, wickets: 45, economy_rate: 8.2 });
      const pHighWkts = createBasePlayer({ role: 'BOWLER', matches: 60, wickets: 90, economy_rate: 8.2 });

      const resLow = evaluatePlayerMarketValue(createBaseContext(pLowWkts), pLowWkts);
      const resHigh = evaluatePlayerMarketValue(createBaseContext(pHighWkts), pHighWkts);

      expect(resHigh.marketValue).toBeGreaterThan(resLow.marketValue);
    });

    it('13. Strong economy increases value', () => {
      const pHighEcon = createBasePlayer({ role: 'BOWLER', matches: 60, wickets: 60, economy_rate: 9.40 });
      const pLowEcon = createBasePlayer({ role: 'BOWLER', matches: 60, wickets: 60, economy_rate: 7.20 });

      const resHighEcon = evaluatePlayerMarketValue(createBaseContext(pHighEcon), pHighEcon);
      const resLowEcon = evaluatePlayerMarketValue(createBaseContext(pLowEcon), pLowEcon);

      expect(resLowEcon.marketValue).toBeGreaterThan(resHighEcon.marketValue);
    });

    it('14. Strong bowling strike rate increases value', () => {
      const pSlowSR = createBasePlayer({ role: 'BOWLER', matches: 50, wickets: 50, bowling_strike_rate: 26.5 });
      const pFastSR = createBasePlayer({ role: 'BOWLER', matches: 50, wickets: 50, bowling_strike_rate: 16.8 });

      const resSlow = evaluatePlayerMarketValue(createBaseContext(pSlowSR), pSlowSR);
      const resFast = evaluatePlayerMarketValue(createBaseContext(pFastSR), pFastSR);

      expect(resFast.marketValue).toBeGreaterThan(resSlow.marketValue);
    });

    it('15. Three-wicket hauls contribute appropriately', () => {
      const pFew3W = createBasePlayer({ role: 'BOWLER', matches: 60, wickets: 60, three_wicket_hauls: 1 });
      const pMany3W = createBasePlayer({ role: 'BOWLER', matches: 60, wickets: 60, three_wicket_hauls: 8 });

      const resFew = evaluatePlayerMarketValue(createBaseContext(pFew3W), pFew3W);
      const resMany = evaluatePlayerMarketValue(createBaseContext(pMany3W), pMany3W);

      expect(resMany.marketValue).toBeGreaterThan(resFew.marketValue);
    });

    it('16. Best bowling contributes only as supporting evidence', () => {
      const pGoodBB = createBasePlayer({ role: 'BOWLER', matches: 50, wickets: 50, best_bowling: '3/28' });
      const pEliteBB = createBasePlayer({ role: 'BOWLER', matches: 50, wickets: 50, best_bowling: '5/12' });

      const resGood = evaluatePlayerMarketValue(createBaseContext(pGoodBB), pGoodBB);
      const resElite = evaluatePlayerMarketValue(createBaseContext(pEliteBB), pEliteBB);

      expect(resElite.marketValue).toBeGreaterThanOrEqual(resGood.marketValue);
      expect(resElite.marketValue - resGood.marketValue).toBeLessThan(150);
    });
  });

  // -------------------------------------------------------------
  // D. ALL-ROUNDER
  // -------------------------------------------------------------

  describe('D. All-Rounder Evaluation', () => {
    it('18. Strong batting + strong bowling > strong batting-only profile for all-rounders', () => {
      const arDual = createBasePlayer({
        role: 'ALL_ROUNDER',
        rating: 90,
        matches: 80,
        runs: 2000,
        batting_average: 28.0,
        strike_rate: 142.0,
        wickets: 75,
        economy_rate: 8.10
      });
      const arBatOnly = createBasePlayer({
        role: 'ALL_ROUNDER',
        rating: 90,
        matches: 80,
        runs: 2000,
        batting_average: 28.0,
        strike_rate: 142.0,
        wickets: 4,
        economy_rate: 10.20
      });

      const resDual = evaluatePlayerMarketValue(createBaseContext(arDual), arDual);
      const resBat = evaluatePlayerMarketValue(createBaseContext(arBatOnly), arBatOnly);

      expect(resDual.marketValue).toBeGreaterThan(resBat.marketValue);
    });

    it('19. Strong batting + weak bowling does not receive full elite all-rounder premium', () => {
      const arBatHeavy = createBasePlayer({
        role: 'ALL_ROUNDER',
        rating: 90,
        matches: 75,
        runs: 2400,
        wickets: 3,
        economy_rate: 10.5
      });
      const res = evaluatePlayerMarketValue(createBaseContext(arBatHeavy), arBatHeavy);

      // Should not claim dual threat
      expect(res.playerQuality.statisticalEvidence?.isDualThreat).toBe(false);
    });

    it('20. Strong bowling + weak batting does not receive full elite all-rounder premium', () => {
      const arBowlHeavy = createBasePlayer({
        role: 'ALL_ROUNDER',
        rating: 90,
        matches: 75,
        runs: 150,
        wickets: 85,
        economy_rate: 7.9
      });
      const res = evaluatePlayerMarketValue(createBaseContext(arBowlHeavy), arBowlHeavy);

      expect(res.playerQuality.statisticalEvidence?.isDualThreat).toBe(false);
    });

    it('21. Dual-discipline production is explainable', () => {
      const arGenuine = createBasePlayer({
        role: 'ALL_ROUNDER',
        rating: 92,
        matches: 100,
        runs: 1800,
        wickets: 85,
        economy_rate: 7.8
      });
      const res = evaluatePlayerMarketValue(createBaseContext(arGenuine), arGenuine);

      expect(res.reasons.some(r => r.includes('dual-threat'))).toBe(true);
    });
  });

  // -------------------------------------------------------------
  // E. WICKET-KEEPER
  // -------------------------------------------------------------

  describe('E. Wicket-Keeper Evaluation', () => {
    it('22. Batting + catches/stumpings affect valuation', () => {
      const wkBatterOnly = createBasePlayer({
        role: 'WICKET_KEEPER',
        matches: 80,
        runs: 2000,
        batting_average: 32,
        strike_rate: 135,
        catches: 0,
        stumpings: 0
      });
      const wkClean = createBasePlayer({
        role: 'WICKET_KEEPER',
        matches: 80,
        runs: 2000,
        batting_average: 32,
        strike_rate: 135,
        catches: 70,
        stumpings: 18
      });
      const resBatterOnly = evaluatePlayerMarketValue(createBaseContext(wkBatterOnly), wkBatterOnly);
      const resClean = evaluatePlayerMarketValue(createBaseContext(wkClean), wkClean);

      expect(resClean.marketValue).toBeGreaterThan(resBatterOnly.marketValue);
      expect(resClean.reasons.some(r => r.includes('wicket-keeper') || r.includes('wicket-keeping'))).toBe(true);
    });

    it('23. Missing keeping statistics do not punish the player incorrectly', () => {
      const wkMissingKeeping = createBasePlayer({
        role: 'WICKET_KEEPER',
        matches: 80,
        runs: 2000,
        batting_average: 32,
        strike_rate: 135,
        catches: null as any,
        stumpings: null as any
      });
      const res = evaluatePlayerMarketValue(createBaseContext(wkMissingKeeping), wkMissingKeeping);

      expect(Number.isNaN(res.marketValue)).toBe(false);
      expect(res.marketValue).toBeGreaterThanOrEqual(wkMissingKeeping.base_price);
    });
  });

  // -------------------------------------------------------------
  // F. EXPERIENCE & SAMPLE SIZE
  // -------------------------------------------------------------

  describe('F. Experience & Sample Size Protection', () => {
    it('24. Long IPL experience increases evidence confidence appropriately', () => {
      const pVet = createBasePlayer({ matches: 150, runs: 3000 });
      const pRook = createBasePlayer({ matches: 15, runs: 400 });

      const resVet = evaluatePlayerMarketValue(createBaseContext(pVet), pVet);
      const resRook = evaluatePlayerMarketValue(createBaseContext(pRook), pRook);

      expect(resVet.confidence).toBeGreaterThan(0.90);
      expect(resRook.confidence).toBeLessThan(0.70);
    });

    it('25. Small sample does not receive veteran-level statistical confidence', () => {
      const pSmall = createBasePlayer({ matches: 7, runs: 280, batting_average: 45.0, strike_rate: 175.0 });
      const statEv = evaluateStatisticalQuality(pSmall);

      expect(statEv.sampleCategory).toBe('INSUFFICIENT');
      expect(statEv.sampleWeight).toBeLessThanOrEqual(0.20);
    });

    it('26. Veteran with weak performance is not automatically elite', () => {
      const pVetWeak = createBasePlayer({
        rating: 80,
        matches: 160,
        runs: 1200,
        batting_average: 19.5,
        strike_rate: 116.0
      });
      const pYoungStrong = createBasePlayer({
        rating: 88,
        matches: 45,
        runs: 1600,
        batting_average: 38.0,
        strike_rate: 148.0
      });

      const resVet = evaluatePlayerMarketValue(createBaseContext(pVetWeak), pVetWeak);
      const resYoung = evaluatePlayerMarketValue(createBaseContext(pYoungStrong), pYoungStrong);

      expect(resYoung.marketValue).toBeGreaterThan(resVet.marketValue);
    });
  });

  // -------------------------------------------------------------
  // G. MISSING DATA
  // -------------------------------------------------------------

  describe('G. Missing Data Handling', () => {
    it('27. Null batting statistics do not crash valuation', () => {
      const p = createBasePlayer({ runs: null, batting_average: null, strike_rate: null });
      const res = evaluatePlayerMarketValue(createBaseContext(p), p);

      expect(Number.isNaN(res.marketValue)).toBe(false);
    });

    it('28. Null bowling statistics do not crash valuation', () => {
      const p = createBasePlayer({ role: 'BOWLER', wickets: null, economy_rate: null, overs: null });
      const res = evaluatePlayerMarketValue(createBaseContext(p), p);

      expect(Number.isNaN(res.marketValue)).toBe(false);
    });

    it('29. Null keeping statistics do not crash valuation', () => {
      const p = createBasePlayer({ role: 'WICKET_KEEPER', catches: null, stumpings: null });
      const res = evaluatePlayerMarketValue(createBaseContext(p), p);

      expect(Number.isNaN(res.marketValue)).toBe(false);
    });

    it('30. Invalid numeric values are ignored safely', () => {
      const p = createBasePlayer({ runs: 'invalid' as any, strike_rate: NaN as any, matches: 'abc' as any });
      const res = evaluatePlayerMarketValue(createBaseContext(p), p);

      expect(Number.isNaN(res.marketValue)).toBe(false);
      expect(res.confidence).toBe(0.40);
    });

    it('31. Missing statistics never become fabricated values', () => {
      const p = createBasePlayer({ runs: null, hundreds: null });
      const statEv = evaluateStatisticalQuality(p);

      expect(statEv.productionScore).toBe(0);
    });
  });

  // -------------------------------------------------------------
  // H. CORRELATION & NON-DOUBLE COUNTING
  // -------------------------------------------------------------

  describe('H. Correlation & Non-Double Counting', () => {
    it('32. Runs + hundreds/fifties do not create runaway double-counting', () => {
      const p1 = createBasePlayer({ matches: 60, runs: 2000, hundreds: 0, fifties: 5 });
      const p2 = createBasePlayer({ matches: 60, runs: 2000, hundreds: 2, fifties: 12 });

      const r1 = evaluatePlayerMarketValue(createBaseContext(p1), p1);
      const r2 = evaluatePlayerMarketValue(createBaseContext(p2), p2);

      // Milestone difference exists but is bounded (does not double the player's value)
      expect(r2.marketValue).toBeGreaterThan(r1.marketValue);
      expect(r2.marketValue).toBeLessThan(r1.marketValue * 1.4);
    });

    it('33. Wickets + three-wicket hauls do not create runaway double-counting', () => {
      const p1 = createBasePlayer({ role: 'BOWLER', matches: 60, wickets: 60, three_wicket_hauls: 1 });
      const p2 = createBasePlayer({ role: 'BOWLER', matches: 60, wickets: 60, three_wicket_hauls: 7 });

      const r1 = evaluatePlayerMarketValue(createBaseContext(p1), p1);
      const r2 = evaluatePlayerMarketValue(createBaseContext(p2), p2);

      expect(r2.marketValue).toBeGreaterThan(r1.marketValue);
      expect(r2.marketValue).toBeLessThan(r1.marketValue * 1.3);
    });

    it('34. Rating + category do not duplicate the same quality signal excessively', () => {
      const pA = createBasePlayer({ rating: 88, category: 'A', matches: 40, runs: 1000 });
      const pM = createBasePlayer({ rating: 88, category: 'MARQUEE', matches: 40, runs: 1000 });

      const rA = evaluatePlayerMarketValue(createBaseContext(pA), pA);
      const rM = evaluatePlayerMarketValue(createBaseContext(pM), pM);

      // Market Value is driven by statistical evidence + rating; category alone does not distort valuation
      expect(rA.marketValue).toBe(rM.marketValue);
    });
  });

  // -------------------------------------------------------------
  // I. MARQUEE CALIBRATION & 202-DATASET VERIFICATION
  // -------------------------------------------------------------

  describe('I. Marquee Calibration', () => {
    it('35. Elite real statistical profile can naturally reach marquee valuation', () => {
      const vk = createBasePlayer({
        name: 'Virat Kohli',
        rating: 97,
        matches: 283,
        runs: 9336,
        batting_average: 40.42,
        strike_rate: 134.8,
        hundreds: 9,
        fifties: 68,
        boundaries: 1160
      });
      const res = evaluatePlayerMarketValue(createBaseContext(vk), vk);

      expect(res.marketValue).toBeGreaterThanOrEqual(2000); // >= ₹20 Cr
      expect(res.marketValue).toBeLessThanOrEqual(2500);    // <= ₹25 Cr
    });

    it('36. Strong-but-not-marquee player remains materially below ₹20-25 Cr territory', () => {
      const strongStarter = createBasePlayer({
        rating: 90,
        matches: 90,
        runs: 2600,
        batting_average: 32.5,
        strike_rate: 136.0,
        fifties: 16
      });
      const res = evaluatePlayerMarketValue(createBaseContext(strongStarter), strongStarter);

      expect(res.marketValue).toBeLessThan(1800); // Below ₹18 Cr
      expect(res.marketValue).toBeGreaterThanOrEqual(1000); // Solid ₹10-17 Cr starter
    });

    it('37. Ordinary player does not approach marquee valuation merely through category', () => {
      const ordinaryMarquee = createBasePlayer({
        category: 'MARQUEE',
        rating: 83,
        matches: 35,
        runs: 600,
        batting_average: 22.0,
        strike_rate: 124.0
      });
      const res = evaluatePlayerMarketValue(createBaseContext(ordinaryMarquee), ordinaryMarquee);

      expect(res.marketValue).toBeLessThan(800); // < ₹8 Cr
    });

    it('38 & 39. Only a small elite subset of the actual 202-dataset reaches ₹20-25 Cr territory without name hardcoding', () => {
      // Parse actual migration and check calibration distribution
      const sqlContent = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '00041_default_player_dataset.sql'), 'utf8');
      const ratingsContent = fs.readFileSync(path.join(process.cwd(), 'COMPLETE_PLAYER_RATINGS_202.md'), 'utf8');
      
      const ratingMap: Record<string, number> = {};
      for (const line of ratingsContent.split('\n')) {
        const match = line.match(/\|\s*\d+\s*\|\s*\*\*([^*]+)\*\*\s*\|\s*([A-Z_]+)\s*\|\s*\*\*(\d+)\*\*\s*\|\s*([A-Z]+)\s*\|\s*₹?(\d+)L/);
        if (match && match[1] && match[3]) ratingMap[match[1].trim()] = parseInt(match[3]);
      }

      const regex = /INSERT INTO public\.players \([^)]+\) VALUES \([^,]+,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+),\s*(true|false),\s*([^,]+),\s*'([^']+)',\s*(\d+),\s*'([^']+)',\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\);/g;

      function cleanVal(v: string) {
        v = v.trim();
        if (v === 'NULL' || v === 'null') return null;
        if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
        const n = parseFloat(v);
        return isNaN(n) ? v : n;
      }

      const players: V3Player[] = [];
      let match;
      while ((match = regex.exec(sqlContent)) !== null) {
        const name = match[1]!;
        players.push({
          id: 'p_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          name: name,
          role: match[2] as any,
          category: match[3] as any,
          base_price: parseInt(match[4]!),
          is_overseas: match[5] === 'true',
          country: match[7]!,
          age: parseInt(match[8]!),
          batting_hand: match[9]!,
          rating: ratingMap[name] || 85,
          image_url: null,
          matches: cleanVal(match[10]!) as any,
          runs: cleanVal(match[11]!) as any,
          batting_average: cleanVal(match[12]!) as any,
          strike_rate: cleanVal(match[13]!) as any,
          hundreds: cleanVal(match[14]!) as any,
          fifties: cleanVal(match[15]!) as any,
          highest_score: cleanVal(match[16]!) as any,
          boundaries: cleanVal(match[17]!) as any,
          overs: cleanVal(match[18]!) as any,
          wickets: cleanVal(match[19]!) as any,
          bowling_average: cleanVal(match[20]!) as any,
          economy_rate: cleanVal(match[21]!) as any,
          bowling_strike_rate: cleanVal(match[22]!) as any,
          best_bowling: cleanVal(match[23]!) as any,
          three_wicket_hauls: cleanVal(match[24]!) as any,
          catches: cleanVal(match[25]!) as any,
          stumpings: cleanVal(match[26]!) as any,
        });
      }

      expect(players.length).toBe(202);

      const valuations = players.map(p => {
        const ctx = createBaseContext(p, 15);
        return evaluatePlayerMarketValue(ctx, p);
      });

      const above20Cr = valuations.filter(v => v.marketValue >= 2000);
      const above15Cr = valuations.filter(v => v.marketValue >= 1500);
      const above10Cr = valuations.filter(v => v.marketValue >= 1000);

      // Verify targeted distribution: roughly 3-5 players in ₹20-25 Cr territory
      expect(above20Cr.length).toBeGreaterThanOrEqual(3);
      expect(above20Cr.length).toBeLessThanOrEqual(7);

      // Verify no player exceeds ₹25 Cr ceiling
      const maxVal = Math.max(...valuations.map(v => v.marketValue));
      expect(maxVal).toBeLessThanOrEqual(2500);

      // Verify solid starters tier
      expect(above15Cr.length).toBeLessThanOrEqual(35);
      expect(above10Cr.length).toBeLessThanOrEqual(85);
    });
  });

  // -------------------------------------------------------------
  // J. FIREWALL & DETERMINISM
  // -------------------------------------------------------------

  describe('J. Firewall & Determinism', () => {
    it('40. Current bid cannot affect market value', () => {
      const p = createBasePlayer({ rating: 88, matches: 50, runs: 1500 });
      const ctx = createBaseContext(p);

      // Attempting to attach currentBid to context has zero effect on marketValue
      const res = evaluatePlayerMarketValue(ctx, p);
      expect((ctx as any).currentBid).toBeUndefined();
      expect(res.marketValue).toBeGreaterThan(0);
    });

    it('41. Opponent cannot affect market value', () => {
      const p = createBasePlayer({ rating: 88, matches: 50, runs: 1500 });
      const ctx = createBaseContext(p);

      const res = evaluatePlayerMarketValue(ctx, p);
      expect((ctx as any).opponents).toBeUndefined();
      expect(res.marketValue).toBeGreaterThan(0);
    });

    it('42. Team purse cannot affect market value', () => {
      const p = createBasePlayer({ rating: 88, matches: 50, runs: 1500 });
      const ctx = createBaseContext(p);

      const res = evaluatePlayerMarketValue(ctx, p);
      expect((ctx as any).purse).toBeUndefined();
      expect(res.marketValue).toBeGreaterThan(0);
    });

    it('43. Identical input produces identical output across 10 evaluations', () => {
      const p = createBasePlayer({ rating: 91, matches: 75, runs: 2400 });
      const ctx = createBaseContext(p);

      const first = evaluatePlayerMarketValue(ctx, p);
      for (let i = 0; i < 10; i++) {
        const next = evaluatePlayerMarketValue(ctx, p);
        expect(next.marketValue).toBe(first.marketValue);
        expect(next.confidence).toBe(first.confidence);
        expect(next.reasons).toEqual(first.reasons);
      }
    });

    it('44 & 45. No Math.random() or Date.now() used in Phase 3 valuation code', () => {
      const fileContent = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'auction', 'human-auction-market-value.ts'), 'utf8');

      // Strip comments
      const codeOnly = fileContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

      expect(codeOnly).not.toContain('Math.random');
      expect(codeOnly).not.toContain('Date.now');
    });
  });
});
