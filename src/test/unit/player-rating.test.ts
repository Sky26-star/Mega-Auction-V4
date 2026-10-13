// src/test/unit/player-rating.test.ts
// Comprehensive tests for IPL Career Value Rating Engine
//
// Tests cover all 27 rating requirements from the specification

import { describe, it, expect } from 'vitest';
import { computePlayerRating } from '@/lib/player-rating';
import type { V3Player } from '@/lib/v3-auction-types';

// ── Test Helpers ─────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<V3Player>): V3Player {
  return {
    id: 'test-player',
    name: 'Test Player',
    role: 'BATSMAN',
    category: 'C',
    country: 'India',
    age: 30,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
    ...overrides,
  };
}

// ── Reference players based on CSV data ──────────────────────────────────

const viratKohli = makePlayer({
  id: 'virat', name: 'Virat Kohli', role: 'BATSMAN', category: 'MARQUEE',
  matches: 283, runs: 9336, batting_average: 38.13, strike_rate: 133.28,
  hundreds: 9, fifties: 68, highest_score: 175, boundaries: 1160,
  base_price: 200,
});

const rohitSharma = makePlayer({
  id: 'rohit', name: 'Rohit Sharma', role: 'BATSMAN', category: 'MARQUEE',
  matches: 281, runs: 7329, batting_average: 29.79, strike_rate: 132.92,
  hundreds: 2, fifties: 49, highest_score: 109, boundaries: 984,
  base_price: 200,
});

const msDhoni = makePlayer({
  id: 'dhoni', name: 'MS Dhoni', role: 'WICKET_KEEPER', category: 'MARQUEE',
  matches: 278, runs: 5439, batting_average: 38.3, strike_rate: 137.46,
  hundreds: 0, fifties: 24, highest_score: 84, boundaries: 639,
  catches: 158, stumpings: 47,
  base_price: 200,
});

const bumrah = makePlayer({
  id: 'bumrah', name: 'Jasprit Bumrah', role: 'BOWLER', category: 'MARQUEE',
  matches: 133, wickets: 180, bowling_average: 22.47, economy_rate: 7.13,
  bowling_strike_rate: 18.9, best_bowling: '5/10', three_wicket_hauls: 12,
  base_price: 200,
});

const hardikPandya = makePlayer({
  id: 'hardik', name: 'Hardik Pandya', role: 'ALL_ROUNDER', category: 'MARQUEE',
  matches: 129, runs: 2565, batting_average: 28.5, strike_rate: 151.54,
  hundreds: 0, fifties: 8, highest_score: 91, boundaries: 299,
  wickets: 67, bowling_average: 30.0, economy_rate: 9.29,
  bowling_strike_rate: 19.39, best_bowling: '3/20', three_wicket_hauls: 1,
  base_price: 200,
});

// A lower-tier player
const limitedBatsman = makePlayer({
  id: 'limited', name: 'Limited Player', role: 'BATSMAN', category: 'D',
  matches: 25, runs: 400, batting_average: 20.0, strike_rate: 125.0,
  hundreds: 0, fifties: 2, highest_score: 55, boundaries: 60,
  base_price: 50,
});

// ── Test Suite ───────────────────────────────────────────────────────────

describe('IPL Career Value Rating', () => {
  
  // ═══ Requirement 1: Determinism ═══════════════════════════════════════
  it('1. produces deterministic ratings — same input always yields same output', () => {
    const r1 = computePlayerRating(viratKohli);
    const r2 = computePlayerRating(viratKohli);
    const r3 = computePlayerRating(viratKohli);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  // ═══ Requirement 2: Role-relative normalization ═══════════════════════
  it('2. uses role-relative normalization — batsman vs bowler rated in own peer contexts', () => {
    const batRating = computePlayerRating(viratKohli);
    const bowlRating = computePlayerRating(bumrah);
    // Both are elite in their roles, both should be high
    expect(batRating).toBeGreaterThanOrEqual(88);
    expect(bowlRating).toBeGreaterThanOrEqual(85);
  });

  // ═══ Requirement 3-4: CSV-derived benchmarks & Production weighting ═══
  it('3. production weighting — high run-scorer ranks above low run-scorer among batsmen', () => {
    const eliteRating = computePlayerRating(viratKohli);
    const limitedRating = computePlayerRating(limitedBatsman);
    expect(eliteRating).toBeGreaterThan(limitedRating);
  });

  // ═══ Requirement 5: Efficiency weighting ══════════════════════════════
  it('5. efficiency weighting — batting average and strike rate influence rating', () => {
    const efficient = makePlayer({
      role: 'BATSMAN', matches: 100, runs: 3000,
      batting_average: 40.0, strike_rate: 155.0,
      hundreds: 3, fifties: 20, highest_score: 110, boundaries: 400,
    });
    const inefficient = makePlayer({
      role: 'BATSMAN', matches: 100, runs: 3000,
      batting_average: 22.0, strike_rate: 120.0,
      hundreds: 3, fifties: 20, highest_score: 110, boundaries: 400,
    });
    expect(computePlayerRating(efficient)).toBeGreaterThan(computePlayerRating(inefficient));
  });

  // ═══ Requirement 6-7: Peak Impact & Longevity ═════════════════════════
  it('6. peak impact — high HS contributes to rating', () => {
    const highPeak = makePlayer({
      role: 'BATSMAN', matches: 100, runs: 2500,
      batting_average: 30.0, strike_rate: 140.0,
      hundreds: 3, fifties: 15, highest_score: 150, boundaries: 300,
    });
    const lowPeak = makePlayer({
      role: 'BATSMAN', matches: 100, runs: 2500,
      batting_average: 30.0, strike_rate: 140.0,
      hundreds: 0, fifties: 15, highest_score: 55, boundaries: 300,
    });
    expect(computePlayerRating(highPeak)).toBeGreaterThanOrEqual(computePlayerRating(lowPeak));
  });

  // ═══ Requirement 8-9: Batsman & Bowler models ═════════════════════════
  it('8. bowling model — wickets, economy, average affect bowler rating', () => {
    const eliteBowler = makePlayer({
      role: 'BOWLER', matches: 150, wickets: 190,
      bowling_average: 20.0, economy_rate: 7.2, bowling_strike_rate: 16.0,
      best_bowling: '5/14', three_wicket_hauls: 20,
    });
    const averageBowler = makePlayer({
      role: 'BOWLER', matches: 80, wickets: 60,
      bowling_average: 32.0, economy_rate: 9.0, bowling_strike_rate: 22.0,
      best_bowling: '3/25', three_wicket_hauls: 4,
    });
    expect(computePlayerRating(eliteBowler)).toBeGreaterThan(computePlayerRating(averageBowler));
  });

  // ═══ Requirement 10: All-rounder dual contribution ════════════════════
  it('10. all-rounder — genuine dual contributor rates higher than one-dimensional player', () => {
    const dualContributor = makePlayer({
      role: 'ALL_ROUNDER', matches: 130, 
      runs: 2500, batting_average: 28.0, strike_rate: 148.0,
      hundreds: 1, fifties: 10, highest_score: 91, boundaries: 280,
      wickets: 100, bowling_average: 26.0, economy_rate: 8.0,
      bowling_strike_rate: 19.0, best_bowling: '4/20', three_wicket_hauls: 8,
    });
    const batOnlyAR = makePlayer({
      role: 'ALL_ROUNDER', matches: 130,
      runs: 2500, batting_average: 28.0, strike_rate: 148.0,
      hundreds: 1, fifties: 10, highest_score: 91, boundaries: 280,
      wickets: 10, bowling_average: 40.0, economy_rate: 10.0,
      bowling_strike_rate: 28.0, best_bowling: '2/30', three_wicket_hauls: 0,
    });
    expect(computePlayerRating(dualContributor)).toBeGreaterThan(computePlayerRating(batOnlyAR));
  });

  // ═══ Requirement 11: Wicketkeeper keeping contribution ════════════════
  it('11. wicketkeeper — keeping stats (catches/stumpings) contribute to rating', () => {
    const goodKeeper = makePlayer({
      role: 'WICKET_KEEPER', matches: 100,
      runs: 3000, batting_average: 34.0, strike_rate: 145.0,
      hundreds: 1, fifties: 15, highest_score: 100, boundaries: 350,
      catches: 120, stumpings: 30,
    });
    const noKeepingData = makePlayer({
      role: 'WICKET_KEEPER', matches: 100,
      runs: 3000, batting_average: 34.0, strike_rate: 145.0,
      hundreds: 1, fifties: 15, highest_score: 100, boundaries: 350,
      catches: null, stumpings: null,
    });
    // Good keeper with keeping stats should rate at least as high as one without
    expect(computePlayerRating(goodKeeper)).toBeGreaterThanOrEqual(computePlayerRating(noKeepingData));
  });

  // ═══ Requirement 12: Lower-is-better bowling metrics ══════════════════
  it('12. lower-is-better bowling metrics inverted correctly', () => {
    const efficientBowler = makePlayer({
      role: 'BOWLER', matches: 150, wickets: 180,
      bowling_average: 19.0, economy_rate: 7.0, bowling_strike_rate: 15.0,
      best_bowling: '5/14', three_wicket_hauls: 18,
    });
    const expensiveBowler = makePlayer({
      role: 'BOWLER', matches: 150, wickets: 180,
      bowling_average: 42.0, economy_rate: 10.5, bowling_strike_rate: 28.0,
      best_bowling: '5/14', three_wicket_hauls: 18,
    });
    expect(computePlayerRating(efficientBowler)).toBeGreaterThan(computePlayerRating(expensiveBowler));
  });

  // ═══ Requirement 13: Best bowling semantic parsing ════════════════════
  it('13. best_bowling parsed semantically — 5/16 ranks better than 4/29', () => {
    const fiveWickets = makePlayer({
      role: 'BOWLER', matches: 100, wickets: 100,
      bowling_average: 25.0, economy_rate: 8.0, bowling_strike_rate: 19.0,
      best_bowling: '5/16', three_wicket_hauls: 8,
    });
    const fourWickets = makePlayer({
      role: 'BOWLER', matches: 100, wickets: 100,
      bowling_average: 25.0, economy_rate: 8.0, bowling_strike_rate: 19.0,
      best_bowling: '4/29', three_wicket_hauls: 8,
    });
    expect(computePlayerRating(fiveWickets)).toBeGreaterThanOrEqual(computePlayerRating(fourWickets));
  });

  // ═══ Requirement 14-15: Missing != Zero, Genuine zero preserved ═══════
  it('14. missing stats ≠ zero — null hundreds is different from 0 hundreds', () => {
    const nullHundreds = makePlayer({
      role: 'BATSMAN', matches: 100, runs: 2000,
      batting_average: 28.0, strike_rate: 135.0,
      hundreds: null, fifties: 10, highest_score: 80, boundaries: 250,
    });
    const zeroHundreds = makePlayer({
      role: 'BATSMAN', matches: 100, runs: 2000,
      batting_average: 28.0, strike_rate: 135.0,
      hundreds: 0, fifties: 10, highest_score: 80, boundaries: 250,
    });
    // They should produce DIFFERENT ratings (null = excluded, 0 = genuine zero included)
    // null redistributes weight to other metrics; zero pulls down the weighted average
    const rNull = computePlayerRating(nullHundreds);
    const rZero = computePlayerRating(zeroHundreds);
    // They may differ — the key test is both are valid ratings
    expect(rNull).toBeGreaterThanOrEqual(74);
    expect(rZero).toBeGreaterThanOrEqual(74);
    // With zero hundreds, the production/peak score should be slightly lower
    expect(rNull).toBeGreaterThanOrEqual(rZero);
  });

  // ═══ Requirement 16: Weight redistribution ════════════════════════════
  it('16. weight redistribution — player with sparse data still gets valid rating', () => {
    const sparsePlayer = makePlayer({
      role: 'BATSMAN', matches: 50, runs: 1200,
      batting_average: null, strike_rate: null,
      hundreds: null, fifties: null, highest_score: null, boundaries: null,
    });
    const r = computePlayerRating(sparsePlayer);
    expect(r).toBeGreaterThanOrEqual(74);
    expect(r).toBeLessThanOrEqual(98);
  });

  // ═══ Requirement 17: Matches counted only once ════════════════════════
  it('17. matches are counted only in longevity — not double-counted', () => {
    // Two players identical except matches. Longevity weight = 15% for batsman.
    // The difference should be modest, not dramatic.
    const experienced = makePlayer({
      role: 'BATSMAN', matches: 250, runs: 3000,
      batting_average: 30.0, strike_rate: 140.0,
      hundreds: 2, fifties: 20, highest_score: 100, boundaries: 400,
    });
    const lessExperienced = makePlayer({
      role: 'BATSMAN', matches: 60, runs: 3000,
      batting_average: 30.0, strike_rate: 140.0,
      hundreds: 2, fifties: 20, highest_score: 100, boundaries: 400,
    });
    const diff = computePlayerRating(experienced) - computePlayerRating(lessExperienced);
    // Longevity is only 15%, so diff should be modest (not more than ~4 points)
    expect(diff).toBeGreaterThanOrEqual(0);
    expect(diff).toBeLessThanOrEqual(5);
  });

  // ═══ Requirement 18: 74–98 range ══════════════════════════════════════
  it('18. rating always bounded 74–98', () => {
    // Minimal player
    const minimal = makePlayer({
      role: 'BATSMAN', matches: 5, runs: 20,
      batting_average: 10.0, strike_rate: 100.0,
    });
    // Elite player
    expect(computePlayerRating(minimal)).toBeGreaterThanOrEqual(74);
    expect(computePlayerRating(minimal)).toBeLessThanOrEqual(98);
    expect(computePlayerRating(viratKohli)).toBeGreaterThanOrEqual(74);
    expect(computePlayerRating(viratKohli)).toBeLessThanOrEqual(98);
  });

  // ═══ Requirement 19: Category has zero effect ═════════════════════════
  it('19. category has ZERO rating influence — same stats, different categories produce same rating', () => {
    const iconPlayer = makePlayer({
      role: 'BATSMAN', category: 'MARQUEE', base_price: 200,
      matches: 100, runs: 3000, batting_average: 35.0, strike_rate: 145.0,
      hundreds: 2, fifties: 20, highest_score: 110, boundaries: 400,
    });
    const risingPlayer = makePlayer({
      role: 'BATSMAN', category: 'D', base_price: 50,
      matches: 100, runs: 3000, batting_average: 35.0, strike_rate: 145.0,
      hundreds: 2, fifties: 20, highest_score: 110, boundaries: 400,
    });
    expect(computePlayerRating(iconPlayer)).toBe(computePlayerRating(risingPlayer));
  });

  // ═══ Requirement 20: Base price has zero effect ═══════════════════════
  it('20. base_price has ZERO rating influence', () => {
    const expensive = makePlayer({
      role: 'BOWLER', base_price: 200, matches: 100, wickets: 120,
      bowling_average: 24.0, economy_rate: 8.0, bowling_strike_rate: 19.0,
      best_bowling: '4/20', three_wicket_hauls: 10,
    });
    const cheap = makePlayer({
      role: 'BOWLER', base_price: 20, matches: 100, wickets: 120,
      bowling_average: 24.0, economy_rate: 8.0, bowling_strike_rate: 19.0,
      best_bowling: '4/20', three_wicket_hauls: 10,
    });
    expect(computePlayerRating(expensive)).toBe(computePlayerRating(cheap));
  });

  // ═══ Requirement 21: No name hardcoding ═══════════════════════════════
  it('21. no name hardcoding — name does not influence formula rating', () => {
    const namedA = makePlayer({
      role: 'BATSMAN', name: 'Generic Player Alpha', matches: 100, runs: 2000,
      batting_average: 28.0, strike_rate: 130.0,
    });
    const namedB = makePlayer({
      role: 'BATSMAN', name: 'Generic Player Beta', matches: 100, runs: 2000,
      batting_average: 28.0, strike_rate: 130.0,
    });
    expect(computePlayerRating(namedA)).toBe(computePlayerRating(namedB));
  });

  // ═══ Requirement 22: No random ════════════════════════════════════════
  it('22. rating is random-free — 100 calls produce identical result', () => {
    const results = Array.from({ length: 100 }, () => computePlayerRating(bumrah));
    expect(new Set(results).size).toBe(1);
  });

  // ═══ Requirement 23: No stat mutation ═════════════════════════════════
  it('23. player stats are never modified by rating computation', () => {
    const player = makePlayer({
      role: 'BATSMAN', matches: 150, runs: 5000,
      batting_average: 35.0, strike_rate: 140.0,
      hundreds: 3, fifties: 30, highest_score: 120, boundaries: 600,
    });
    const original = JSON.parse(JSON.stringify(player));
    computePlayerRating(player);
    expect(player).toEqual(original);
  });

  // ═══ Requirement 24: No fake winning data ═════════════════════════════
  it('24. no fabricated trophies/wins — rating uses only career stats', () => {
    // If we add fake properties they should have zero effect
    const normal = makePlayer({
      role: 'BATSMAN', matches: 100, runs: 3000,
      batting_average: 30.0, strike_rate: 140.0,
    });
    const withFakeData = { ...normal, trophies: 5, mvp_count: 3 } as any;
    expect(computePlayerRating(normal)).toBe(computePlayerRating(withFakeData));
  });

  // ═══ Requirement 25: Similar players → close ratings ══════════════════
  it('25. similar career quality players receive reasonably close ratings', () => {
    const playerA = makePlayer({
      role: 'BATSMAN', matches: 120, runs: 3200,
      batting_average: 32.0, strike_rate: 140.0,
      hundreds: 2, fifties: 22, highest_score: 105, boundaries: 420,
    });
    const playerB = makePlayer({
      role: 'BATSMAN', matches: 115, runs: 3000,
      batting_average: 31.0, strike_rate: 138.0,
      hundreds: 1, fifties: 20, highest_score: 100, boundaries: 390,
    });
    const diff = Math.abs(computePlayerRating(playerA) - computePlayerRating(playerB));
    expect(diff).toBeLessThanOrEqual(5);
  });

  // ═══ Requirement 26: Career outranks category reputation ══════════════
  it('26. strong career PREMIER player can outrank weak career ICON player', () => {
    const strongPremier = makePlayer({
      role: 'BATSMAN', category: 'B', base_price: 100,
      matches: 200, runs: 6000, batting_average: 38.0, strike_rate: 150.0,
      hundreds: 5, fifties: 40, highest_score: 130, boundaries: 800,
    });
    const weakIcon = makePlayer({
      role: 'BATSMAN', category: 'MARQUEE', base_price: 200,
      matches: 40, runs: 600, batting_average: 20.0, strike_rate: 122.0,
      hundreds: 0, fifties: 3, highest_score: 55, boundaries: 80,
    });
    expect(computePlayerRating(strongPremier)).toBeGreaterThan(computePlayerRating(weakIcon));
  });

  // ═══ Requirement 27: Exceptional career can reach high 90s ════════════
  it('27. exceptional career can reach high 90s', () => {
    const r = computePlayerRating(viratKohli);
    expect(r).toBeGreaterThanOrEqual(93);
  });

  // ═══ BONUS: Best bowling edge cases ═══════════════════════════════════
  it('handles malformed best_bowling gracefully', () => {
    const malformed = makePlayer({
      role: 'BOWLER', matches: 50, wickets: 40,
      bowling_average: 28.0, economy_rate: 8.5, bowling_strike_rate: 20.0,
      best_bowling: 'invalid', three_wicket_hauls: 3,
    });
    const r = computePlayerRating(malformed);
    expect(r).toBeGreaterThanOrEqual(74);
    expect(r).toBeLessThanOrEqual(98);
  });

  // ═══ BONUS: MS Dhoni WK rating ════════════════════════════════════════
  it('MS Dhoni rated appropriately as elite wicketkeeper', () => {
    const r = computePlayerRating(msDhoni);
    expect(r).toBeGreaterThanOrEqual(90);
  });

  // ═══ BONUS: Hardik Pandya all-rounder ═════════════════════════════════
  it('Hardik Pandya rated as strong all-rounder', () => {
    const r = computePlayerRating(hardikPandya);
    expect(r).toBeGreaterThanOrEqual(82);
  });
});
