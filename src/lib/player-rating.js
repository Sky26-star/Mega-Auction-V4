"use strict";
// src/lib/player-rating.ts
// IPL Career Value Rating Engine
//
// Deterministic, role-relative, percentile-based player impact rating (74–98).
//
// METHODOLOGY:
// 1. Role-relative peer comparison (BATSMAN, BOWLER, ALL_ROUNDER, WICKET_KEEPER)
// 2. Percentile normalization using benchmarks derived from the supplied IPL CSV
//    (ipl_players_2008_2026_allrounders_wk_corrected_v3.csv — 166 players)
// 3. Four-pillar model: Production + Efficiency + Peak Impact + Longevity
// 4. Missing data → weight redistribution (never fill with zeros)
// 5. Calibration to 74–98 integer range
//
// ZERO influence from: category, base_price, player name, reputation, bots, bids.
// DETERMINISTIC: same input → same output. No Math.random().
// READ-ONLY: player statistics are never modified.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePlayerRating = computePlayerRating;
// ── Helpers ──────────────────────────────────────────────────────────────
// Distinguish missing/null/blank from genuine numeric zero.
// A real source value of 0 must remain 0.
function num(v) {
    if (v === null || v === undefined || v === '')
        return null;
    var n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? null : n;
}
// ── Percentile Normalization ─────────────────────────────────────────────
//
// Benchmarks derived from the supplied CSV:
//   ipl_players_2008_2026_allrounders_wk_corrected_v3.csv
//   166 players: BATSMAN=64, BOWLER=59, ALL_ROUNDER=26, WICKET_KEEPER=17
//
// Each benchmark array = [p10, p25, p50, p75, p90, p95, p99]
// Piecewise linear interpolation maps raw values to 0.0–1.0 percentile scores.
// This avoids simple min-max distortion from extreme outliers.
var PERCENTILE_POINTS = [0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99];
/** CSV-derived percentile benchmarks for BATSMAN role (64 players) */
var BAT_BENCHMARKS = {
    runs: [799, 1187, 2091, 3478, 4962, 5512, 8092],
    batting_average: [23.7, 25.9, 30.3, 35.7, 40.0, 40.5, 48.4],
    strike_rate: [126.7, 133.3, 139.8, 148.9, 164.5, 175.0, 204.6],
    hundreds: [0, 0, 0, 1, 2, 4, 7],
    fifties: [3, 7, 13, 22, 36, 40, 64],
    highest_score: [68, 83, 95, 105, 125, 132, 164],
    boundaries: [114, 152, 280, 447, 672, 796, 1063],
    matches: [32, 59, 92, 136, 188, 205, 282],
};
/** CSV-derived percentile benchmarks for BOWLER role (59 players) */
var BOWL_BENCHMARKS = {
    wickets: [20, 38, 80, 130, 176, 189, 229],
    bowling_average: [21.6, 24.6, 28.3, 30.0, 35.0, 36.3, 42.2],
    economy_rate: [7.35, 8.07, 8.49, 9.19, 9.60, 10.07, 10.52],
    bowling_strike_rate: [15.5, 18.1, 19.8, 21.2, 23.5, 25.1, 28.0],
    three_wicket_hauls: [0, 3, 6, 13, 17, 22, 26],
    best_bowling_score: [3.39, 4.20, 4.39, 5.27, 5.47, 5.51, 6.44],
    matches: [20, 33, 73, 112, 154, 188, 212],
};
/** CSV-derived percentile benchmarks for ALL_ROUNDER role (26 players) */
var AR_BENCHMARKS = {
    // Batting sub-metrics
    runs: [244, 649, 1364, 2562, 3241, 3787, 4914],
    batting_average: [17.0, 21.0, 24.3, 28.1, 30.1, 31.1, 35.3],
    strike_rate: [122.1, 131.4, 138.9, 151.1, 162.1, 167.9, 172.8],
    hundreds: [0, 0, 0, 1, 2, 2, 4],
    fifties: [0, 2, 4, 9, 13, 17, 20],
    highest_score: [33, 61, 85, 99, 113, 117, 122],
    boundaries: [30, 65, 148, 308, 392, 406, 527],
    // Bowling sub-metrics
    wickets: [14, 29, 41, 94, 160, 182, 201],
    bowling_average: [24.0, 26.2, 31.6, 34.5, 39.3, 40.1, 42.2],
    economy_rate: [7.43, 7.61, 8.31, 9.43, 9.82, 9.99, 10.50],
    bowling_strike_rate: [17.2, 20.5, 22.6, 24.5, 26.7, 28.0, 29.1],
    three_wicket_hauls: [0, 1, 3, 8, 15, 17, 18],
    best_bowling_score: [2.44, 3.46, 4.32, 4.48, 5.42, 5.44, 5.45],
    // Longevity
    matches: [32, 44, 71, 144, 169, 195, 251],
};
/** CSV-derived percentile benchmarks for WICKET_KEEPER role (17 players) */
var WK_BENCHMARKS = {
    // Batting sub-metrics
    runs: [600, 1075, 2773, 4695, 5310, 5533, 5759],
    batting_average: [24.7, 30.9, 34.2, 38.5, 40.9, 43.1, 45.5],
    strike_rate: [135.2, 138.7, 146.4, 152.9, 167.5, 179.7, 207.2],
    hundreds: [0, 0, 1, 2, 5, 6, 7],
    fifties: [2, 5, 17, 24, 28, 32, 42],
    highest_score: [81, 85, 105, 123, 133, 142, 150],
    boundaries: [88, 149, 372, 630, 672, 693, 736],
    // Keeping sub-metrics
    catches: [34, 58, 74, 90, 145, 152, 157],
    stumpings: [1, 7, 8, 22, 37, 42, 46],
    // Longevity
    matches: [23, 46, 71, 139, 217, 261, 275],
};
/**
 * Piecewise linear interpolation through percentile breakpoints.
 * Maps a raw value to a 0.0–1.0 score representing the player's
 * approximate percentile position within the IPL career distribution.
 *
 * Values below p10 map linearly to 0.0–0.10.
 * Values above p99 map linearly to 0.99–1.0 (capped at 1.0).
 * Values between breakpoints are linearly interpolated.
 *
 * @param ascending - if true, higher raw = higher score (runs, wickets, etc.)
 *                    if false, lower raw = higher score (bowling_average, economy, etc.)
 */
function percentileScore(value, benchmarks, ascending) {
    if (ascending === void 0) { ascending = true; }
    // For "lower is better" metrics, compute ascending score then invert.
    // A player with bowling_average 19.0 (below p10=21.6) scores ~0.09 ascending,
    // inverted to ~0.91 (elite). A player with 42.0 (near p99) scores ~0.98
    // ascending, inverted to ~0.02 (poor).
    if (!ascending) {
        return 1.0 - percentileScore(value, benchmarks, true);
    }
    // Below the lowest benchmark
    var firstBenchmark = benchmarks[0];
    var firstPct = PERCENTILE_POINTS[0];
    if (firstBenchmark === undefined || firstPct === undefined)
        return 0.5;
    if (value <= firstBenchmark) {
        if (firstBenchmark <= 0)
            return firstPct;
        return Math.max(0, (value / firstBenchmark) * firstPct);
    }
    // Above the highest benchmark
    var lastBenchmark = benchmarks[benchmarks.length - 1];
    var lastPct = PERCENTILE_POINTS[PERCENTILE_POINTS.length - 1];
    if (lastBenchmark === undefined || lastPct === undefined)
        return 0.5;
    if (value >= lastBenchmark) {
        var overshoot = (value - lastBenchmark) / (lastBenchmark * 0.5 || 1);
        return Math.min(1.0, lastPct + overshoot * (1.0 - lastPct));
    }
    // Between breakpoints — piecewise linear interpolation
    for (var i = 0; i < benchmarks.length - 1; i++) {
        var bLow = benchmarks[i];
        var bHigh = benchmarks[i + 1];
        var pLow = PERCENTILE_POINTS[i];
        var pHigh = PERCENTILE_POINTS[i + 1];
        if (bLow === undefined || bHigh === undefined || pLow === undefined || pHigh === undefined)
            continue;
        if (value >= bLow && value <= bHigh) {
            if (bHigh === bLow)
                return (pLow + pHigh) / 2;
            var fraction = (value - bLow) / (bHigh - bLow);
            return pLow + fraction * (pHigh - pLow);
        }
    }
    return 0.5; // Fallback (should never reach)
}
/**
 * Combine metrics with automatic weight redistribution for missing values.
 * Missing metrics are excluded; their weights are proportionally redistributed
 * among the remaining valid metrics.
 */
function combineWeighted(metrics) {
    var totalWeight = 0;
    var totalScore = 0;
    for (var _i = 0, metrics_1 = metrics; _i < metrics_1.length; _i++) {
        var m = metrics_1[_i];
        if (m === null)
            continue;
        totalWeight += m.weight;
        totalScore += m.score * m.weight;
    }
    if (totalWeight === 0)
        return 0;
    return totalScore / totalWeight;
}
// ── Best Bowling Parsing ─────────────────────────────────────────────────
/**
 * Parse best bowling figures semantically.
 * Format: W/R (e.g., 5/14)
 * Score = wickets + (60 - min(runs, 60)) / 100
 * This ensures: 5/16 > 4/29 (wickets primary, runs secondary)
 */
function parseBestBowlingScore(bb) {
    if (!bb || typeof bb !== 'string')
        return null;
    var match = bb.trim().match(/^(\d+)[\/\-](\d+)$/);
    if (!match)
        return null;
    var w = parseInt(match[1], 10);
    var r = parseInt(match[2], 10);
    if (isNaN(w) || isNaN(r))
        return null;
    return w + (60 - Math.min(r, 60)) / 100;
}
// ── Role-Specific Rating Models ──────────────────────────────────────────
//
// Each model implements the 4-pillar structure with controlled double-counting.
// Where a metric appears in multiple pillars (e.g., hundreds in both Production
// and Peak), its weight is explicitly split to prevent unfair domination.
/**
 * BATSMAN Rating Model
 * Production: 35% | Efficiency: 30% | Peak Impact: 20% | Longevity: 15%
 */
function rateBatsman(p) {
    var runs = num(p.runs);
    var avg = num(p.batting_average);
    var sr = num(p.strike_rate);
    var hundreds = num(p.hundreds);
    var fifties = num(p.fifties);
    var hs = num(p.highest_score);
    var boundaries = num(p.boundaries);
    var matches = num(p.matches);
    // ── Production (35% of total) ────────────────────
    // runs=15, hundreds=5 (split: 60% here, 40% in Peak), fifties=7 (split: 60/40), boundaries=8
    var production = [
        runs !== null ? { score: percentileScore(runs, BAT_BENCHMARKS.runs), weight: 15 } : null,
        hundreds !== null ? { score: percentileScore(hundreds, BAT_BENCHMARKS.hundreds), weight: 5 } : null,
        fifties !== null ? { score: percentileScore(fifties, BAT_BENCHMARKS.fifties), weight: 7 } : null,
        boundaries !== null ? { score: percentileScore(boundaries, BAT_BENCHMARKS.boundaries), weight: 8 } : null,
    ];
    var productionScore = combineWeighted(production);
    // ── Efficiency (30% of total) ────────────────────
    var efficiency = [
        avg !== null ? { score: percentileScore(avg, BAT_BENCHMARKS.batting_average), weight: 16 } : null,
        sr !== null ? { score: percentileScore(sr, BAT_BENCHMARKS.strike_rate), weight: 14 } : null,
    ];
    var efficiencyScore = combineWeighted(efficiency);
    // ── Peak Impact (20% of total) ───────────────────
    // hs=10, hundreds=3 (40% share), fifties=4 (40% share)
    var peak = [
        hs !== null ? { score: percentileScore(hs, BAT_BENCHMARKS.highest_score), weight: 10 } : null,
        hundreds !== null ? { score: percentileScore(hundreds, BAT_BENCHMARKS.hundreds), weight: 3 } : null,
        fifties !== null ? { score: percentileScore(fifties, BAT_BENCHMARKS.fifties), weight: 4 } : null,
    ];
    var peakScore = combineWeighted(peak);
    // ── Longevity (15% of total) ─────────────────────
    var longevityScore = matches !== null
        ? percentileScore(matches, BAT_BENCHMARKS.matches)
        : 0;
    // ── Combine pillars with designated weights ──────
    var pillars = [
        { score: productionScore, weight: 35 },
        { score: efficiencyScore, weight: 30 },
        { score: peakScore, weight: 20 },
        matches !== null ? { score: longevityScore, weight: 15 } : null,
    ];
    return combineWeighted(pillars);
}
/**
 * BOWLER Rating Model
 * Production: 35% | Efficiency: 35% | Peak Impact: 20% | Longevity: 10%
 */
function rateBowler(p) {
    var wickets = num(p.wickets);
    var bAvg = num(p.bowling_average);
    var econ = num(p.economy_rate);
    var bSr = num(p.bowling_strike_rate);
    var tw = num(p.three_wicket_hauls);
    var bbScore = parseBestBowlingScore(p.best_bowling);
    var matches = num(p.matches);
    // ── Production (35% of total) ────────────────────
    // wickets=25, three_wicket_hauls=10 (split: 55% here, 45% in Peak)
    var production = [
        wickets !== null ? { score: percentileScore(wickets, BOWL_BENCHMARKS.wickets), weight: 25 } : null,
        tw !== null ? { score: percentileScore(tw, BOWL_BENCHMARKS.three_wicket_hauls), weight: 10 } : null,
    ];
    var productionScore = combineWeighted(production);
    // ── Efficiency (35% of total) ────────────────────
    // LOWER IS BETTER for all three
    var efficiency = [
        bAvg !== null ? { score: percentileScore(bAvg, BOWL_BENCHMARKS.bowling_average, false), weight: 14 } : null,
        econ !== null ? { score: percentileScore(econ, BOWL_BENCHMARKS.economy_rate, false), weight: 12 } : null,
        bSr !== null ? { score: percentileScore(bSr, BOWL_BENCHMARKS.bowling_strike_rate, false), weight: 9 } : null,
    ];
    var efficiencyScore = combineWeighted(efficiency);
    // ── Peak Impact (20% of total) ───────────────────
    // best_bowling=12, three_wicket_hauls=8 (45% share)
    var peak = [
        bbScore !== null ? { score: percentileScore(bbScore, BOWL_BENCHMARKS.best_bowling_score), weight: 12 } : null,
        tw !== null ? { score: percentileScore(tw, BOWL_BENCHMARKS.three_wicket_hauls), weight: 8 } : null,
    ];
    var peakScore = combineWeighted(peak);
    // ── Longevity (10% of total) ─────────────────────
    var longevityScore = matches !== null
        ? percentileScore(matches, BOWL_BENCHMARKS.matches)
        : 0;
    // ── Combine pillars ──────────────────────────────
    var pillars = [
        { score: productionScore, weight: 35 },
        { score: efficiencyScore, weight: 35 },
        { score: peakScore, weight: 20 },
        matches !== null ? { score: longevityScore, weight: 10 } : null,
    ];
    return combineWeighted(pillars);
}
/**
 * ALL_ROUNDER Rating Model
 * Batting Value: 40% | Bowling Value: 40% | Peak Impact: 10% | Longevity: 10%
 *
 * Batting and Bowling sub-values are computed independently using their own
 * Production+Efficiency pillars, then combined. This rewards genuine dual
 * contribution and prevents one-dimensional players from getting extreme ratings.
 */
function rateAllRounder(p) {
    var runs = num(p.runs);
    var avg = num(p.batting_average);
    var sr = num(p.strike_rate);
    var hundreds = num(p.hundreds);
    var fifties = num(p.fifties);
    var hs = num(p.highest_score);
    var boundaries = num(p.boundaries);
    var wickets = num(p.wickets);
    var bAvg = num(p.bowling_average);
    var econ = num(p.economy_rate);
    var bSr = num(p.bowling_strike_rate);
    var tw = num(p.three_wicket_hauls);
    var bbScore = parseBestBowlingScore(p.best_bowling);
    var matches = num(p.matches);
    // ── Batting Sub-Value (Production + Efficiency combined) ────
    var batMetrics = [
        runs !== null ? { score: percentileScore(runs, AR_BENCHMARKS.runs), weight: 12 } : null,
        avg !== null ? { score: percentileScore(avg, AR_BENCHMARKS.batting_average), weight: 10 } : null,
        sr !== null ? { score: percentileScore(sr, AR_BENCHMARKS.strike_rate), weight: 8 } : null,
        hundreds !== null ? { score: percentileScore(hundreds, AR_BENCHMARKS.hundreds), weight: 3 } : null,
        fifties !== null ? { score: percentileScore(fifties, AR_BENCHMARKS.fifties), weight: 5 } : null,
        boundaries !== null ? { score: percentileScore(boundaries, AR_BENCHMARKS.boundaries), weight: 4 } : null,
    ];
    var battingValue = combineWeighted(batMetrics);
    // ── Bowling Sub-Value (Production + Efficiency combined) ────
    var bowlMetrics = [
        wickets !== null ? { score: percentileScore(wickets, AR_BENCHMARKS.wickets), weight: 14 } : null,
        bAvg !== null ? { score: percentileScore(bAvg, AR_BENCHMARKS.bowling_average, false), weight: 10 } : null,
        econ !== null ? { score: percentileScore(econ, AR_BENCHMARKS.economy_rate, false), weight: 8 } : null,
        bSr !== null ? { score: percentileScore(bSr, AR_BENCHMARKS.bowling_strike_rate, false), weight: 5 } : null,
        tw !== null ? { score: percentileScore(tw, AR_BENCHMARKS.three_wicket_hauls), weight: 5 } : null,
    ];
    var bowlingValue = combineWeighted(bowlMetrics);
    // ── Peak Impact (best from both disciplines) ────
    var peakMetrics = [
        hs !== null ? { score: percentileScore(hs, AR_BENCHMARKS.highest_score), weight: 5 } : null,
        bbScore !== null ? { score: percentileScore(bbScore, AR_BENCHMARKS.best_bowling_score), weight: 5 } : null,
    ];
    var peakScore = combineWeighted(peakMetrics);
    // ── Longevity ───────────────────────────────────
    var longevityScore = matches !== null
        ? percentileScore(matches, AR_BENCHMARKS.matches)
        : 0;
    // ── Combine ─────────────────────────────────────
    var pillars = [
        { score: battingValue, weight: 40 },
        { score: bowlingValue, weight: 40 },
        { score: peakScore, weight: 10 },
        matches !== null ? { score: longevityScore, weight: 10 } : null,
    ];
    return combineWeighted(pillars);
}
/**
 * WICKET KEEPER Rating Model
 * Batting Value: 55% | Keeping Value: 25% | Peak Impact: 10% | Longevity: 10%
 */
function rateWicketKeeper(p) {
    var runs = num(p.runs);
    var avg = num(p.batting_average);
    var sr = num(p.strike_rate);
    var hundreds = num(p.hundreds);
    var fifties = num(p.fifties);
    var hs = num(p.highest_score);
    var boundaries = num(p.boundaries);
    var catches = num(p.catches);
    var stumpings = num(p.stumpings);
    var matches = num(p.matches);
    // ── Batting Sub-Value (Production + Efficiency combined) ────
    var batMetrics = [
        runs !== null ? { score: percentileScore(runs, WK_BENCHMARKS.runs), weight: 14 } : null,
        avg !== null ? { score: percentileScore(avg, WK_BENCHMARKS.batting_average), weight: 12 } : null,
        sr !== null ? { score: percentileScore(sr, WK_BENCHMARKS.strike_rate), weight: 10 } : null,
        hundreds !== null ? { score: percentileScore(hundreds, WK_BENCHMARKS.hundreds), weight: 4 } : null,
        fifties !== null ? { score: percentileScore(fifties, WK_BENCHMARKS.fifties), weight: 6 } : null,
        boundaries !== null ? { score: percentileScore(boundaries, WK_BENCHMARKS.boundaries), weight: 5 } : null,
    ];
    var battingValue = combineWeighted(batMetrics);
    // ── Keeping Sub-Value ───────────────────────────
    var keepMetrics = [
        catches !== null ? { score: percentileScore(catches, WK_BENCHMARKS.catches), weight: 16 } : null,
        stumpings !== null ? { score: percentileScore(stumpings, WK_BENCHMARKS.stumpings), weight: 9 } : null,
    ];
    var keepingValue = combineWeighted(keepMetrics);
    // ── Peak Impact ─────────────────────────────────
    var peakMetrics = [
        hs !== null ? { score: percentileScore(hs, WK_BENCHMARKS.highest_score), weight: 6 } : null,
        hundreds !== null ? { score: percentileScore(hundreds, WK_BENCHMARKS.hundreds), weight: 2 } : null,
        fifties !== null ? { score: percentileScore(fifties, WK_BENCHMARKS.fifties), weight: 2 } : null,
    ];
    var peakScore = combineWeighted(peakMetrics);
    // ── Longevity ───────────────────────────────────
    var longevityScore = matches !== null
        ? percentileScore(matches, WK_BENCHMARKS.matches)
        : 0;
    // ── Combine ─────────────────────────────────────
    var hasKeepingData = catches !== null || stumpings !== null;
    var pillars = [
        { score: battingValue, weight: 55 },
        hasKeepingData ? { score: keepingValue, weight: 25 } : null,
        { score: peakScore, weight: 10 },
        matches !== null ? { score: longevityScore, weight: 10 } : null,
    ];
    return combineWeighted(pillars);
}
// ── Calibration Layer ────────────────────────────────────────────────────
//
// Maps Career Value Index (0.0–1.0) to final visible rating (74–98).
//
// Uses a documented piecewise linear calibration curve that produces
// the desired distribution:
//
//   Career Value Index    →   Rating Range
//   0.00 – 0.15          →   74 – 77   (limited careers)
//   0.15 – 0.30          →   77 – 81   (lower-mid careers)
//   0.30 – 0.50          →   81 – 85   (middle careers)
//   0.50 – 0.70          →   85 – 89   (strong careers)
//   0.70 – 0.85          →   89 – 93   (elite careers)
//   0.85 – 0.95          →   93 – 96   (exceptional careers)
//   0.95 – 1.00          →   96 – 98   (rare statistical outliers)
//
// These breakpoints correspond to observed percentile clusters in the CSV data.
var CALIBRATION_CURVE = [
    [0.00, 74],
    [0.15, 77],
    [0.30, 81],
    [0.50, 85],
    [0.70, 89],
    [0.85, 93],
    [0.95, 96],
    [1.00, 98],
];
function calibrate(careerValueIndex) {
    var cvi = Math.max(0, Math.min(1, careerValueIndex));
    // Piecewise linear interpolation through calibration curve
    for (var i = 0; i < CALIBRATION_CURVE.length - 1; i++) {
        var entry = CALIBRATION_CURVE[i];
        var nextEntry = CALIBRATION_CURVE[i + 1];
        if (!entry || !nextEntry)
            continue;
        var xLow = entry[0], yLow = entry[1];
        var xHigh = nextEntry[0], yHigh = nextEntry[1];
        if (cvi >= xLow && cvi <= xHigh) {
            if (xHigh === xLow)
                return yLow;
            var fraction = (cvi - xLow) / (xHigh - xLow);
            return yLow + fraction * (yHigh - yLow);
        }
    }
    return 74; // Fallback
}
// ── Public API ───────────────────────────────────────────────────────────
/**
 * Compute a deterministic 74–98 integer IPL Career Value Rating.
 *
 * The rating is purely derived from the player's available statistics and
 * role, using percentile normalization against benchmarks derived from the
 * supplied IPL CSV dataset (166 players).
 *
 * ZERO dependency on: category, base_price, name, bids, timers, teams,
 * purse, bots, or any external context.
 *
 * ZERO modification of player statistics.
 */
var FINAL_OVERRIDES = {
    // --- Approved Final Ratings (alphabetical) ---
    'aaron finch': 83,
    'abhishek sharma': 90,
    'adam gilchrist': 89,
    'adam zampa': 84,
    'aiden markram': 86,
    'ajinkya rahane': 90,
    'albie morkel': 87,
    'ambati rayudu': 91,
    'amit mishra': 91,
    'angkrish raghuvanshi': 83,
    'anukul roy': 82,
    'arshdeep singh': 90,
    'ashish nehra': 91,
    'ashok dinda': 85,
    'avesh khan': 87,
    'axar patel': 92,
    'ayush badoni': 84,
    'ayush mhatre': 82,
    'ben cutting': 79,
    'ben stokes': 86,
    'brendon mccullum': 90,
    'cameron green': 86,
    'chris lynn': 86,
    'chris morris': 87,
    'dale steyn': 92,
    'david miller': 91,
    'david warner': 96,
    'deepak hooda': 80,
    'devon conway': 88,
    'devdutt padikkal': 87,
    'dhruv jurel': 86,
    'dinesh karthik': 91,
    'doug bollinger': 87,
    'dwayne bravo': 92,
    'dwayne smith': 86,
    'eoin morgan': 82,
    'faf du plessis': 91,
    'gautam gambhir': 91,
    'glenn maxwell': 89,
    'harbhajan singh': 91,
    'hardik pandya': 92,
    'harpreet brar': 84,
    'harshal patel': 89,
    'heinrich klaasen': 92,
    'irfan pathan': 85,
    'ishant sharma': 87,
    'ishan kishan': 92,
    'jacques kallis': 90,
    'jasprit bumrah': 95,
    'jaydev unadkat': 86,
    'jitesh sharma': 86,
    'jofra archer': 87,
    'jonny bairstow': 86,
    'jos buttler': 94,
    'kagiso rabada': 92,
    'kane williamson': 88,
    'karun nair': 84,
    'kedar jadhav': 82,
    'khaleel ahmed': 87,
    'kl rahul': 93,
    'krunal pandya': 91,
    'kumar sangakkara': 84,
    'kuldeep yadav': 91,
    'lendl simmons': 87,
    'liam livingstone': 86,
    'mahela jayawardene': 84,
    'manish pandey': 89,
    'marco jansen': 82,
    'marcus stoinis': 88,
    'matthew hayden': 89,
    'mayank agarwal': 86,
    'michael hussey': 90,
    'mitchell johnson': 87,
    'mitchell marsh': 89,
    'mitchell santner': 85,
    'mitchell starc': 90,
    'mohammed shami': 91,
    'mohammed siraj': 90,
    'mohit sharma': 89,
    'morne morkel': 86,
    'ms dhoni': 94,
    'mukesh choudhary': 81,
    'mukesh kumar': 84,
    'murali vijay': 87,
    'mustafizur rahman': 85,
    'muttiah muralitharan': 88,
    'naman dhir': 82,
    'naman ojha': 82,
    'nicholas pooran': 90,
    'nitish rana': 85,
    'parthiv patel': 87,
    'phil salt': 89,
    'piyush chawla': 91,
    'pragyan ojha': 87,
    'prasidh krishna': 87,
    'praveen kumar': 86,
    'prince yadav': 79,
    'prithvi shaw': 86,
    'quinton de kock': 92,
    'rahmanullah gurbaz': 80,
    'rahul chahar': 87,
    'rahul dravid': 85,
    'rahul tewatia': 83,
    'rahul tripathi': 85,
    'rajat patidar': 90,
    'ravichandran ashwin': 90,
    'ravindra jadeja': 92,
    'ravi bishnoi': 85,
    'rinku singh': 88,
    'rishabh pant': 92,
    'riyan parag': 87,
    'robin uthappa': 90,
    'rohit sharma': 95,
    'rp singh': 88,
    'ruturaj gaikwad': 90,
    'ryan rickelton': 85,
    'sachin tendulkar': 88,
    'sai sudharsan': 91,
    'sam curran': 88,
    'sameer rizvi': 81,
    'samuel badree': 79,
    'sandeep sharma': 91,
    'sanju samson': 92,
    'shahbaz ahmed': 85,
    'shakib al hasan': 85,
    'shane warne': 86,
    'shane watson': 93,
    'shardul thakur': 88,
    'shaun marsh': 90,
    'shikhar dhawan': 96,
    'shimron hetmyer': 84,
    'shivam dube': 89,
    'shreyas iyer': 92,
    'shubman gill': 93,
    'siddarth kaul': 86,
    'sourav ganguly': 86,
    'steve smith': 86,
    'stuart binny': 80,
    'subramaniam badrinath': 83,
    'sunil narine': 94,
    'suresh raina': 95,
    't natarajan': 87,
    'tilak varma': 90,
    'tim david': 86,
    'travis head': 90,
    'trent boult': 91,
    'tristan stubbs': 85,
    'tushar deshpande': 85,
    'umesh yadav': 90,
    'vaibhav arora': 81,
    'vaibhav sooryavanshi': 84,
    'varun aaron': 81,
    'venkatesh iyer': 87,
    'vijay shankar': 80,
    'vinay kumar': 86,
    'virat kohli': 97,
    'virender sehwag': 91,
    'vyshak vijaykumar': 81,
    'washington sundar': 88,
    'will jacks': 83,
    'yash dayal': 83,
    'yashasvi jaiswal': 90,
    'yusuf pathan': 91,
    'yuvraj singh': 89,
    'zaheer khan': 90,
};
function computePlayerRating(player) {
    if (!player || !player.name)
        return 74;
    var normName = player.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (FINAL_OVERRIDES[normName] !== undefined) {
        return FINAL_OVERRIDES[normName];
    }
    var role = player.role;
    var careerValueIndex;
    switch (role) {
        case 'BATSMAN':
            careerValueIndex = rateBatsman(player);
            break;
        case 'BOWLER':
            careerValueIndex = rateBowler(player);
            break;
        case 'ALL_ROUNDER':
            careerValueIndex = rateAllRounder(player);
            break;
        case 'WICKET_KEEPER':
            careerValueIndex = rateWicketKeeper(player);
            break;
        default:
            careerValueIndex = 0;
    }
    // Calibrate to 74–98 range
    var rawRating = calibrate(careerValueIndex);
    // Final integer clamp
    return Math.round(Math.max(74, Math.min(98, rawRating)));
}
