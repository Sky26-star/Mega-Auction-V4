// src/lib/auction/human-auction-market-value.ts
//
// PHASE 3 — PLAYER VALUE & AUCTION VALUATION ENGINE (HARDENED)
//
// PURPOSE:
//   A standalone, deterministic engine evaluating intrinsic player value.
//   Answers "How valuable is this player generally?" without considering
//   a specific team's purse, need, or current bid.
//
// ARCHITECTURE:
//   PLAYER QUALITY
//     ↓
//   ROLE-SPECIFIC REAL STATISTICS (Production, Efficiency, Peak)
//     ↓
//   IPL EXPERIENCE & SAMPLE SIZE (Confidence, Longevity, Small-Sample Protection)
//     ↓
//   RATING AS ONE INPUT
//     ↓
//   MARKET VALUE (Calibrated to IPL Mega Auction Economy)
//
// RULES & INVARIANTS:
//   - DOES NOT read team purse, need, roster, or fit.
//   - DOES NOT read opponent threat or solvency.
//   - DOES NOT read currentBid, nextRequiredBid, or auction stage.
//   - Zero Math.random(), zero Date.now() for valuation, 100% deterministic.
//   - Missing data never converted to fake performance.
//   - Role-specific evaluation avoids double-counting correlated metrics.
//   - Marquee calibration: only roughly 3-5 truly elite proven performers reach ₹20-25 Cr.

import type { V3Player, V3PlayerRole } from '../v3-auction-types';
import type {
  MarketValueContext,
  PlayerMarketValueResult,
  PlayerStatisticalEvidence
} from './human-auction-manager-types';

// ============================================================
// BENCHMARKS (Percentile breakpoints derived from IPL career dataset)
// Breakpoints = [p10, p25, p50, p75, p90, p95, p99]
// ============================================================

const PERCENTILE_POINTS = [0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99];

export const BAT_BENCHMARKS = {
  runs:            [799, 1187, 2091, 3478, 4962, 5512, 8092],
  batting_average: [23.7, 25.9, 30.3, 35.7, 40.0, 40.5, 48.4],
  strike_rate:     [126.7, 133.3, 139.8, 148.9, 164.5, 175.0, 204.6],
  hundreds:        [0, 0, 0, 1, 2, 4, 7],
  fifties:         [3, 7, 13, 22, 36, 40, 64],
  highest_score:   [68, 83, 95, 105, 125, 132, 164],
  boundaries:      [114, 152, 280, 447, 672, 796, 1063],
  matches:         [32, 59, 92, 136, 188, 205, 282],
};

export const BOWL_BENCHMARKS = {
  wickets:              [20, 38, 80, 130, 176, 189, 229],
  bowling_average:      [21.6, 24.6, 28.3, 30.0, 35.0, 36.3, 42.2],
  economy_rate:         [7.35, 8.07, 8.49, 9.19, 9.60, 10.07, 10.52],
  bowling_strike_rate:  [15.5, 18.1, 19.8, 21.2, 23.5, 25.1, 28.0],
  three_wicket_hauls:   [0, 3, 6, 13, 17, 22, 26],
  best_bowling_score:   [3.39, 4.20, 4.39, 5.27, 5.47, 5.51, 6.44],
  matches:              [20, 33, 73, 112, 154, 188, 212],
};

export const AR_BENCHMARKS = {
  runs:            [244, 649, 1364, 2562, 3241, 3787, 4914],
  batting_average: [17.0, 21.0, 24.3, 28.1, 30.1, 31.1, 35.3],
  strike_rate:     [122.1, 131.4, 138.9, 151.1, 162.1, 167.9, 172.8],
  hundreds:        [0, 0, 0, 1, 2, 2, 4],
  fifties:         [0, 2, 4, 9, 13, 17, 20],
  highest_score:   [33, 61, 85, 99, 113, 117, 122],
  boundaries:      [30, 65, 148, 308, 392, 406, 527],
  wickets:              [14, 29, 41, 94, 160, 182, 201],
  bowling_average:      [24.0, 26.2, 31.6, 34.5, 39.3, 40.1, 42.2],
  economy_rate:         [7.43, 7.61, 8.31, 9.43, 9.82, 9.99, 10.50],
  bowling_strike_rate:  [17.2, 20.5, 22.6, 24.5, 26.7, 28.0, 29.1],
  three_wicket_hauls:   [0, 1, 3, 8, 15, 17, 18],
  best_bowling_score:   [2.44, 3.46, 4.32, 4.48, 5.42, 5.44, 5.45],
  matches:              [32, 44, 71, 144, 169, 195, 251],
};

export const WK_BENCHMARKS = {
  runs:            [600, 1150, 2085, 3700, 4900, 5300, 5800],
  batting_average: [21.5, 24.5, 31.5, 36.0, 40.0, 43.0, 46.0],
  strike_rate:     [121.0, 131.0, 140.0, 151.0, 167.0, 172.0, 175.0],
  hundreds:        [0, 0, 1, 2, 5, 6, 7],
  fifties:         [1, 5, 14, 24, 28, 35, 42],
  highest_score:   [75, 85, 105, 123, 135, 145, 150],
  boundaries:      [50, 130, 250, 450, 640, 680, 730],
  catches:         [21, 34, 59, 74, 91, 145, 158],
  stumpings:       [1, 4, 8, 18, 26, 37, 47],
  matches:         [23, 46, 71, 139, 217, 261, 275],
};

// ============================================================
// STATISTICAL CALCULATION PRIMITIVES
// ============================================================

export function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? null : n;
}

export function percentileScore(
  value: number | null | undefined,
  benchmarks: number[],
  ascending: boolean = true
): number | null {
  if (value === null || value === undefined || isNaN(value)) return null;
  if (!ascending) {
    const asc = percentileScore(value, benchmarks, true);
    return asc !== null ? 1.0 - asc : null;
  }
  const first = benchmarks[0];
  const firstPct = PERCENTILE_POINTS[0];
  if (first === undefined || firstPct === undefined) return 0.5;

  if (value <= first) {
    if (first <= 0) return firstPct;
    return Math.max(0, (value / first) * firstPct);
  }

  const last = benchmarks[benchmarks.length - 1];
  const lastPct = PERCENTILE_POINTS[PERCENTILE_POINTS.length - 1];
  if (last === undefined || lastPct === undefined) return 0.5;

  if (value >= last) {
    const overshoot = (value - last) / (last * 0.5 || 1);
    return Math.min(1.0, lastPct + overshoot * (1.0 - lastPct));
  }

  for (let i = 0; i < benchmarks.length - 1; i++) {
    const bLow = benchmarks[i];
    const bHigh = benchmarks[i + 1];
    const pLow = PERCENTILE_POINTS[i];
    const pHigh = PERCENTILE_POINTS[i + 1];
    if (bLow === undefined || bHigh === undefined || pLow === undefined || pHigh === undefined) continue;

    if (value >= bLow && value <= bHigh) {
      if (bHigh === bLow) return (pLow + pHigh) / 2;
      return pLow + ((value - bLow) / (bHigh - bLow)) * (pHigh - pLow);
    }
  }
  return 0.5;
}

export function parseBestBowlingScore(bb: string | null | undefined): number | null {
  if (!bb || typeof bb !== 'string') return null;
  const match = bb.trim().match(/^(\d+)[\/\-](\d+)$/);
  if (!match) return null;
  const w = parseInt(match[1]!, 10);
  const r = parseInt(match[2]!, 10);
  if (isNaN(w) || isNaN(r)) return null;
  return w + (60 - Math.min(r, 60)) / 100;
}

interface WeightedMetric {
  score: number | null;
  weight: number;
}

function combineWeighted(items: WeightedMetric[]): number | null {
  let totalW = 0;
  let totalS = 0;
  for (const item of items) {
    if (item && item.score !== null && !isNaN(item.score)) {
      totalW += item.weight;
      totalS += item.score * item.weight;
    }
  }
  return totalW > 0 ? totalS / totalW : null;
}

function combinePillars(pillars: { score: number | null; weight: number }[]): number {
  let totalW = 0;
  let totalS = 0;
  for (const p of pillars) {
    if (p.score !== null && !isNaN(p.score)) {
      totalW += p.weight;
      totalS += p.score * p.weight;
    }
  }
  return totalW > 0 ? totalS / totalW : 0.5;
}

// ============================================================
// STATISTICAL EVIDENCE ENGINE
// ============================================================

export function evaluateStatisticalQuality(player: V3Player): PlayerStatisticalEvidence {
  const role = player.role;
  const matches = num(player.matches) || 0;

  let productionScore: number | null = null;
  let efficiencyScore: number | null = null;
  let peakScore: number | null = null;
  let overallEvidenceScore = 0.5;
  let isDualThreat = false;

  if (role === 'BATSMAN') {
    const runs = num(player.runs);
    const avg = num(player.batting_average);
    const sr = num(player.strike_rate);
    const hundreds = num(player.hundreds);
    const fifties = num(player.fifties);
    const hs = num(player.highest_score);
    const boundaries = num(player.boundaries);

    const milestones = (hundreds !== null ? hundreds * 3 : 0) + (fifties !== null ? fifties : 0);
    const milestoneScore = hundreds !== null || fifties !== null
      ? percentileScore(milestones, [3, 7, 13, 25, 42, 50, 75])
      : null;

    productionScore = combineWeighted([
      { score: percentileScore(runs, BAT_BENCHMARKS.runs), weight: 65 },
      { score: milestoneScore, weight: 20 },
      { score: percentileScore(boundaries, BAT_BENCHMARKS.boundaries), weight: 15 }
    ]);

    efficiencyScore = combineWeighted([
      { score: percentileScore(avg, BAT_BENCHMARKS.batting_average), weight: 55 },
      { score: percentileScore(sr, BAT_BENCHMARKS.strike_rate), weight: 45 }
    ]);

    peakScore = percentileScore(hs, BAT_BENCHMARKS.highest_score);

    overallEvidenceScore = combinePillars([
      { score: productionScore, weight: 58 },
      { score: efficiencyScore, weight: 32 },
      { score: peakScore, weight: 10 }
    ]);

    // Volume bonus: exceptional all-time production adds direct proven quality bonus
    if (runs !== null && runs >= 7000) {
      overallEvidenceScore = Math.min(1.0, overallEvidenceScore + 0.18);
    } else if (runs !== null && runs >= 5000) {
      overallEvidenceScore = Math.min(1.0, overallEvidenceScore + 0.12);
    } else if (runs !== null && runs >= 3500) {
      overallEvidenceScore = Math.min(1.0, overallEvidenceScore + 0.06);
    }
  }
  else if (role === 'BOWLER') {
    const wickets = num(player.wickets);
    const bAvg = num(player.bowling_average);
    const econ = num(player.economy_rate);
    const bSr = num(player.bowling_strike_rate);
    const tw = num(player.three_wicket_hauls);
    const bbScore = parseBestBowlingScore(player.best_bowling);

    productionScore = combineWeighted([
      { score: percentileScore(wickets, BOWL_BENCHMARKS.wickets), weight: 75 },
      { score: percentileScore(tw, BOWL_BENCHMARKS.three_wicket_hauls), weight: 25 }
    ]);

    efficiencyScore = combineWeighted([
      { score: percentileScore(econ, BOWL_BENCHMARKS.economy_rate, false), weight: 55 },
      { score: percentileScore(bAvg, BOWL_BENCHMARKS.bowling_average, false), weight: 25 },
      { score: percentileScore(bSr, BOWL_BENCHMARKS.bowling_strike_rate, false), weight: 20 }
    ]);

    peakScore = percentileScore(bbScore, BOWL_BENCHMARKS.best_bowling_score);

    overallEvidenceScore = combinePillars([
      { score: productionScore, weight: 50 },
      { score: efficiencyScore, weight: 42 },
      { score: peakScore, weight: 8 }
    ]);

    // Volume bonus for bowlers
    if (wickets !== null && wickets >= 180) {
      overallEvidenceScore = Math.min(1.0, overallEvidenceScore + 0.10);
    } else if (wickets !== null && wickets >= 130) {
      overallEvidenceScore = Math.min(1.0, overallEvidenceScore + 0.06);
    } else if (wickets !== null && wickets >= 80) {
      overallEvidenceScore = Math.min(1.0, overallEvidenceScore + 0.03);
    }
  }
  else if (role === 'ALL_ROUNDER') {
    const runs = num(player.runs);
    const avg = num(player.batting_average);
    const sr = num(player.strike_rate);
    const boundaries = num(player.boundaries);
    const wickets = num(player.wickets);
    const bAvg = num(player.bowling_average);
    const econ = num(player.economy_rate);
    const bSr = num(player.bowling_strike_rate);
    const tw = num(player.three_wicket_hauls);

    const batProd = combineWeighted([
      { score: percentileScore(runs, AR_BENCHMARKS.runs), weight: 70 },
      { score: percentileScore(boundaries, AR_BENCHMARKS.boundaries), weight: 30 }
    ]);
    const batEff = combineWeighted([
      { score: percentileScore(avg, AR_BENCHMARKS.batting_average), weight: 50 },
      { score: percentileScore(sr, AR_BENCHMARKS.strike_rate), weight: 50 }
    ]);
    const batScore = combinePillars([
      { score: batProd, weight: 60 },
      { score: batEff, weight: 40 }
    ]);

    const bowlProd = combineWeighted([
      { score: percentileScore(wickets, AR_BENCHMARKS.wickets), weight: 75 },
      { score: percentileScore(tw, AR_BENCHMARKS.three_wicket_hauls), weight: 25 }
    ]);
    const bowlEff = combineWeighted([
      { score: percentileScore(econ, AR_BENCHMARKS.economy_rate, false), weight: 60 },
      { score: percentileScore(bAvg, AR_BENCHMARKS.bowling_average, false), weight: 40 }
    ]);
    const bowlScore = combinePillars([
      { score: bowlProd, weight: 55 },
      { score: bowlEff, weight: 45 }
    ]);

    productionScore = ((batProd ?? 0) + (bowlProd ?? 0)) / 2;
    efficiencyScore = ((batEff ?? 0) + (bowlEff ?? 0)) / 2;
    peakScore = Math.max(
      percentileScore(num(player.highest_score), AR_BENCHMARKS.highest_score) || 0,
      percentileScore(parseBestBowlingScore(player.best_bowling), AR_BENCHMARKS.best_bowling_score) || 0
    );

    const hasMeaningfulBatting = (runs !== null && runs >= 800) || (runs !== null && runs >= 400 && avg !== null && avg >= 22);
    const hasMeaningfulBowling = (wickets !== null && wickets >= 40) || (wickets !== null && wickets >= 20 && econ !== null && econ <= 8.5);

    if (hasMeaningfulBatting && hasMeaningfulBowling) {
      isDualThreat = true;
      overallEvidenceScore = 0.45 * batScore + 0.45 * bowlScore + 0.08;
    } else {
      overallEvidenceScore = 0.65 * Math.max(batScore, bowlScore) + 0.35 * Math.min(batScore, bowlScore);
    }
  }
  else if (role === 'WICKET_KEEPER') {
    const runs = num(player.runs);
    const avg = num(player.batting_average);
    const sr = num(player.strike_rate);
    const hundreds = num(player.hundreds);
    const fifties = num(player.fifties);
    const boundaries = num(player.boundaries);
    const catches = num(player.catches);
    const stumpings = num(player.stumpings);

    const milestones = (hundreds !== null ? hundreds * 3 : 0) + (fifties !== null ? fifties : 0);
    const milestoneScore = hundreds !== null || fifties !== null
      ? percentileScore(milestones, [2, 5, 18, 26, 35, 40, 50])
      : null;

    productionScore = combineWeighted([
      { score: percentileScore(runs, WK_BENCHMARKS.runs), weight: 60 },
      { score: milestoneScore, weight: 25 },
      { score: percentileScore(boundaries, WK_BENCHMARKS.boundaries), weight: 15 }
    ]);
    efficiencyScore = combineWeighted([
      { score: percentileScore(avg, WK_BENCHMARKS.batting_average), weight: 55 },
      { score: percentileScore(sr, WK_BENCHMARKS.strike_rate), weight: 45 }
    ]);
    const batScore = combinePillars([
      { score: productionScore, weight: 55 },
      { score: efficiencyScore, weight: 45 }
    ]);

    const keepScore = combineWeighted([
      { score: percentileScore(catches, WK_BENCHMARKS.catches), weight: 65 },
      { score: percentileScore(stumpings, WK_BENCHMARKS.stumpings), weight: 35 }
    ]);

    peakScore = percentileScore(num(player.highest_score), WK_BENCHMARKS.highest_score) || 0;

    if (keepScore !== null) {
      overallEvidenceScore = 0.75 * batScore + 0.25 * keepScore;
    } else {
      overallEvidenceScore = batScore;
    }
  }

  // Sample size & experience categorization
  let sampleCategory: 'INSUFFICIENT' | 'LIMITED' | 'REGULAR' | 'ESTABLISHED' | 'VETERAN' = 'REGULAR';
  let sampleWeight = 0.50;
  if (matches >= 120) {
    sampleCategory = 'VETERAN';
    sampleWeight = 0.65;
  } else if (matches >= 70) {
    sampleCategory = 'ESTABLISHED';
    sampleWeight = 0.55;
  } else if (matches >= 30) {
    sampleCategory = 'REGULAR';
    sampleWeight = 0.45;
  } else if (matches >= 12) {
    sampleCategory = 'LIMITED';
    sampleWeight = 0.30;
  } else {
    sampleCategory = 'INSUFFICIENT';
    sampleWeight = 0.15;
  }

  return {
    productionScore: productionScore ?? 0,
    efficiencyScore: efficiencyScore ?? 0,
    peakScore: peakScore ?? 0,
    experienceScore: percentileScore(matches, [20, 40, 75, 120, 160, 200, 250]) || 0,
    overallEvidenceScore: Math.max(0, Math.min(1, overallEvidenceScore)),
    sampleCategory,
    sampleWeight,
    isDualThreat
  };
}

// ============================================================
// VALUATION CURVE & ECONOMIC CALIBRATION
// ============================================================

// Non-linear economic valuation curve mapping blended quality index (0.0 to 1.0)
// to value in Lakhs (₹L). Calibrated to IPL auction mechanics.
const VALUE_CURVE: [number, number][] = [
  [0.00, 60],
  [0.15, 120],
  [0.30, 240],
  [0.45, 450],
  [0.55, 750],
  [0.60, 970],
  [0.72, 1250],
  [0.82, 1480],
  [0.88, 1680],
  [0.91, 1800],
  [0.93, 1950],
  [0.95, 2150],
  [0.98, 2380],
  [1.00, 2500]
];

function getValueFromQualityIndex(q: number): number {
  const clamped = Math.max(0, Math.min(1, q));
  for (let i = 0; i < VALUE_CURVE.length - 1; i++) {
    const [qLow, vLow] = VALUE_CURVE[i]!;
    const [qHigh, vHigh] = VALUE_CURVE[i + 1]!;
    if (clamped >= qLow && clamped <= qHigh) {
      if (qHigh === qLow) return vLow;
      const frac = (clamped - qLow) / (qHigh - qLow);
      return vLow + frac * (vHigh - vLow);
    }
  }
  return 60;
}

// ============================================================
// MAIN EVALUATION ENGINE
// ============================================================

export function evaluatePlayerMarketValue(
  ctx: MarketValueContext,
  fullPlayerState: V3Player
): PlayerMarketValueResult {
  const reasons: string[] = [];
  const role = fullPlayerState.role;
  const rating = ctx.quality.rating;
  const matches = num(fullPlayerState.matches) || 0;

  // 1. STATISTICAL EVIDENCE EVALUATION
  const statEv = evaluateStatisticalQuality(fullPlayerState);

  // 2. SAMPLE SIZE & CONFIDENCE DETERMINATION
  const sampleWeight = statEv.sampleWeight ?? 0.50;
  let expMultiplier = 1.00;
  let confidence = 0.75;

  if (statEv.sampleCategory === 'VETERAN') {
    expMultiplier = 1.08;
    confidence = 0.95;
    reasons.push(`Extensive IPL experience (${matches} matches) proves long-term reliability (+8%)`);
  } else if (statEv.sampleCategory === 'ESTABLISHED') {
    expMultiplier = 1.03;
    confidence = 0.88;
    reasons.push(`Proven IPL veteran (${matches} matches) (+3%)`);
  } else if (statEv.sampleCategory === 'REGULAR') {
    expMultiplier = 1.00;
    confidence = 0.78;
    reasons.push(`Established IPL presence (${matches} matches)`);
  } else if (statEv.sampleCategory === 'LIMITED') {
    expMultiplier = 0.94;
    confidence = 0.65;
    reasons.push(`Limited IPL experience (${matches} matches) reduces valuation certainty`);
  } else {
    // INSUFFICIENT
    expMultiplier = 0.88;
    confidence = 0.40;
    reasons.push('No prior IPL matches recorded; relying primarily on reputation/category');
  }

  // 3. RATING ANCHOR SIGNAL (Normalized 74-98 -> 0.0 - 1.0)
  const rNorm = Math.max(0, Math.min(1, (rating - 74) / (98 - 74)));
  if (rating >= 93) {
    reasons.push(`Elite rating classification (${rating}) establishes marquee baseline`);
  } else if (rating >= 85) {
    reasons.push(`Strong rating classification (${rating}) establishes solid starter baseline`);
  } else {
    reasons.push(`Rating (${rating}) establishes depth/rotation baseline`);
  }

  // 4. BLENDED QUALITY INDEX
  // Stored rating acts as anchor; real statistics act as primary evidence.
  const blendedIndex = sampleWeight * statEv.overallEvidenceScore + (1 - sampleWeight) * rNorm;

  // 5. BASE VALUATION CALCULATION
  let marketValue = getValueFromQualityIndex(blendedIndex);

  // Apply experience multiplier
  marketValue *= expMultiplier;

  // Role impact & dual-threat handling
  if (role === 'ALL_ROUNDER') {
    marketValue *= 1.15;
    reasons.push('High intrinsic value of all-rounder role (+15%)');
    if (statEv.isDualThreat) {
      marketValue += 120;
      reasons.push('Rare dual-threat production (meaningful runs & wickets) commands elite premium (+120L)');
    }
  } else if (role === 'WICKET_KEEPER') {
    marketValue *= 1.10;
    reasons.push('Positional scarcity of wicket-keeper role (+10%)');
    const catches = num(fullPlayerState.catches);
    const stumpings = num(fullPlayerState.stumpings);
    if ((catches !== null && catches >= 50) || (stumpings !== null && stumpings >= 10)) {
      reasons.push(`Proven wicket-keeping contribution (${catches || 0} catches, ${stumpings || 0} stumpings)`);
    } else {
      reasons.push('Primary wicket-keeper role valuation');
    }
  }

  // 6. ROLE-SPECIFIC STATISTICAL EXPLANATIONS
  const runs = num(fullPlayerState.runs);
  const wickets = num(fullPlayerState.wickets);
  const sr = num(fullPlayerState.strike_rate);
  const econ = num(fullPlayerState.economy_rate);

  if (role === 'BATSMAN' || role === 'WICKET_KEEPER' || role === 'ALL_ROUNDER') {
    if (runs !== null && runs >= 4000) {
      reasons.push(`Exceptional run production (${runs}+ runs) demands absolute premium (+350L)`);
    } else if (runs !== null && runs >= 2000) {
      reasons.push(`Elite run production (${runs}+ runs) demands premium (+150L)`);
    } else if (runs !== null && runs >= 1000) {
      reasons.push(`Established run production (${runs}+ runs)`);
    }

    if (matches >= 20 && sr !== null && sr >= 150) {
      reasons.push(`Elite proven strike rate (${sr}) accelerates value (+10%)`);
    }
  }

  if (role === 'BOWLER' || role === 'ALL_ROUNDER') {
    if (wickets !== null && wickets >= 120) {
      reasons.push(`Exceptional wicket production (${wickets}+ wickets) demands absolute premium (+350L)`);
    } else if (wickets !== null && wickets >= 70) {
      reasons.push(`Elite wicket production (${wickets}+ wickets) demands premium (+150L)`);
    } else if (wickets !== null && wickets >= 35) {
      reasons.push(`Established wicket production (${wickets}+ wickets)`);
    }

    if (matches >= 20 && econ !== null && econ > 0 && econ <= 7.5) {
      reasons.push(`Elite proven economy rate (${econ}) accelerates value (+10%)`);
    }
  }

  // 7. MARKET CONDITIONS
  // This count is specifically the remaining pool for this player's role. It is
  // a market-wide signal, independent of any one team's needs or purse.
  const remainingInRole = ctx.market?.remainingRolePoolCount;
  if (typeof remainingInRole === 'number' && Number.isFinite(remainingInRole) && remainingInRole >= 0) {
    if (remainingInRole <= 3) {
      marketValue *= 1.15;
      reasons.push(`Extreme scarcity in remaining role pool (${remainingInRole} left) inflates value (+15%)`);
    } else if (remainingInRole <= 8) {
      marketValue *= 1.05;
      reasons.push(`Scarcity in remaining role pool (${remainingInRole} left) inflates value (+5%)`);
    } else if (remainingInRole >= 25) {
      marketValue *= 0.95;
      reasons.push(`Abundant remaining role pool (${remainingInRole} left) softens value (-5%)`);
    }
  }

  // 8. FINAL BOUNDS CHECK
  // Round to nearest 10L, floor at base price, ceiling at ₹25 Cr (2500L)
  marketValue = Math.min(2500, Math.max(fullPlayerState.base_price, Math.round(marketValue / 10) * 10));

  if (marketValue >= 1800) {
    reasons.push('Player qualifies as an absolute Marquee talent based on proven evidence');
  }

  const enrichedQuality = {
    ...ctx.quality,
    statisticalEvidence: statEv
  };

  return {
    playerId: fullPlayerState.id,
    marketValue,
    confidence,
    playerQuality: enrichedQuality,
    reasons
  };
}
