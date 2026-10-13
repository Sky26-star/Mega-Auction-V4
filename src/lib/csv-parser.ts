// src/lib/csv-parser.ts
// Zero-Dependency Native CSV Parser & Validator for Mega Auction Player Master Data V2

import { PLAYER_ROLES, PLAYER_CATEGORIES } from './validations/player-set';
import type { PlayerFormInput, CSVRowValidationError, CSVImportResult, PlayerRole, PlayerCategory } from './types/player-set';
import { CATEGORY_BASE_PRICES } from './types/player-set';

const MAX_CSV_ROWS = 2000;

/**
 * Splits a single CSV line into fields, handling quotes and escaped quotes.
 */
export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseNonNegativeInt(val: string | undefined, fieldName: string, rowNumber: number, errors: CSVRowValidationError[]): number | null {
  if (!val || val.trim() === '') return null;
  const num = parseInt(val.trim(), 10);
  if (isNaN(num) || num < 0) {
    errors.push({
      rowNumber,
      field: fieldName,
      message: `Invalid value "${val}" for ${fieldName}. Must be a non-negative integer`,
      rawValue: val,
    });
    return null;
  }
  return num;
}

function parseNonNegativeFloat(val: string | undefined, fieldName: string, rowNumber: number, errors: CSVRowValidationError[]): number | null {
  if (!val || val.trim() === '') return null;
  const num = parseFloat(val.trim());
  if (isNaN(num) || num < 0) {
    errors.push({
      rowNumber,
      field: fieldName,
      message: `Invalid value "${val}" for ${fieldName}. Must be a non-negative number`,
      rawValue: val,
    });
    return null;
  }
  return num;
}

/**
 * Maps input category string to valid internal PlayerCategory enum.
 */
function normalizeCategory(raw: string): PlayerCategory | null {
  const upper = raw.trim().toUpperCase();
  if (PLAYER_CATEGORIES.includes(upper as PlayerCategory)) {
    return upper as PlayerCategory;
  }
  if (upper === 'ICON PLAYERS' || upper === 'ICON') return 'MARQUEE';
  if (upper === 'ELITE PLAYERS' || upper === 'ELITE') return 'A';
  if (upper === 'PREMIER PLAYERS' || upper === 'PREMIER') return 'B';
  if (upper === 'CORE PLAYERS' || upper === 'CORE') return 'C';
  if (upper === 'RISING STARS' || upper === 'RISING STAR' || upper === 'RISING') return 'D';
  return null;
}

/**
 * Parses and validates an entire CSV text string for Player Master Data V2.
 */
export function parsePlayerCSV(csvText: string): CSVImportResult {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      validRows: [],
      errors: [{ rowNumber: 0, field: 'file', message: 'CSV file is empty', rawValue: '' }],
      totalRowsProcessed: 0,
    };
  }

  // Parse header
  const headerLine = lines[0] ?? '';
  const rawHeaders = parseCSVLine(headerLine);
  const headers = rawHeaders.map((h) => h.toLowerCase().replace(/[\s_]+/g, ''));

  const nameIndex = headers.indexOf('name');
  const roleIndex = headers.indexOf('role');
  const countryIndex = headers.indexOf('country');
  const categoryIndex = headers.indexOf('category');
  const basePriceIndex = headers.indexOf('baseprice') !== -1 ? headers.indexOf('baseprice') : headers.indexOf('price');
  const isOverseasIndex = headers.indexOf('isoverseas');
  const imageUrlIndex = headers.indexOf('imageurl') !== -1 ? headers.indexOf('imageurl') : headers.indexOf('image');
  const ageIndex = headers.indexOf('age');
  const battingHandIndex = headers.indexOf('battinghand') !== -1 ? headers.indexOf('battinghand') : headers.indexOf('battingstyle');

  // Stat indices
  const matchesIndex = headers.indexOf('matches');
  const runsIndex = headers.indexOf('runs');
  const battingAverageIndex = headers.indexOf('battingaverage') !== -1 ? headers.indexOf('battingaverage') : headers.indexOf('average');
  const strikeRateIndex = headers.indexOf('strikerate');
  const hundredsIndex = headers.indexOf('hundreds') !== -1 ? headers.indexOf('hundreds') : headers.indexOf('100s');
  const fiftiesIndex = headers.indexOf('fifties') !== -1 ? headers.indexOf('fifties') : headers.indexOf('50s');
  const highestScoreIndex = headers.indexOf('highestscore');
  const boundariesIndex = headers.indexOf('boundaries');

  const oversIndex = headers.indexOf('overs');
  const wicketsIndex = headers.indexOf('wickets');
  const bowlingAverageIndex = headers.indexOf('bowlingaverage');
  const economyRateIndex = headers.indexOf('economyrate') !== -1 ? headers.indexOf('economyrate') : headers.indexOf('economy');
  const bowlingStrikeRateIndex = headers.indexOf('bowlingstrikerate');
  const bestBowlingIndex = headers.indexOf('bestbowling');
  const threeWicketHaulsIndex = headers.indexOf('threewickethauls') !== -1 ? headers.indexOf('threewickethauls') : headers.indexOf('3wickethauls');

  const catchesIndex = headers.indexOf('catches');
  const stumpingsIndex = headers.indexOf('stumpings');

  if (nameIndex === -1 || roleIndex === -1) {
    return {
      validRows: [],
      errors: [
        {
          rowNumber: 1,
          field: 'header',
          message: 'Missing required CSV header columns: name, role, country',
          rawValue: headerLine,
        },
      ],
      totalRowsProcessed: 0,
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_CSV_ROWS) {
    return {
      validRows: [],
      errors: [
        {
          rowNumber: 0,
          field: 'file',
          message: `CSV contains ${dataLines.length} rows, exceeding maximum limit of ${MAX_CSV_ROWS} rows per upload`,
          rawValue: '',
        },
      ],
      totalRowsProcessed: dataLines.length,
    };
  }

  const validRows: PlayerFormInput[] = [];
  const errors: CSVRowValidationError[] = [];

  dataLines.forEach((line, idx) => {
    const rowNumber = idx + 2; // 1-based index (Header is row 1)
    const fields = parseCSVLine(line);

    const rawName = fields[nameIndex] ?? '';
    const rawRole = (fields[roleIndex] ?? '').toUpperCase();

    let initialErrorCount = errors.length;

    // Validate Name
    if (!rawName) {
      errors.push({ rowNumber, field: 'name', message: 'Player name is required', rawValue: line });
    }

    // Validate Role
    let role: PlayerRole = 'BATSMAN';
    if (!rawRole || !PLAYER_ROLES.includes(rawRole as PlayerRole)) {
      errors.push({
        rowNumber,
        field: 'role',
        message: `Invalid role "${rawRole}". Must be one of: ${PLAYER_ROLES.join(', ')}`,
        rawValue: rawRole,
      });
    } else {
      role = rawRole as PlayerRole;
    }

    // Validate Country & Derive Overseas
    let country = '';
    if (countryIndex !== -1 && fields[countryIndex] && fields[countryIndex]!.trim()) {
      country = fields[countryIndex]!.trim();
    } else if (isOverseasIndex !== -1 && fields[isOverseasIndex] && fields[isOverseasIndex]!.trim()) {
      // Legacy CSV compatibility where is_overseas was explicitly provided
      const rawIsOverseas = fields[isOverseasIndex]!.trim().toLowerCase();
      const isOv = ['true', '1', 'yes', 'y'].includes(rawIsOverseas);
      country = isOv ? 'Overseas' : 'India';
    } else {
      errors.push({
        rowNumber,
        field: 'country',
        message: 'Country is required',
        rawValue: line,
      });
    }

    const is_overseas = country ? country.trim().toLowerCase() !== 'india' : false;

    // Validate Category
    let category: PlayerCategory = 'C';
    const rawCategory = categoryIndex !== -1 ? fields[categoryIndex] ?? '' : '';
    if (rawCategory) {
      const parsedCat = normalizeCategory(rawCategory);
      if (!parsedCat) {
        errors.push({
          rowNumber,
          field: 'category',
          message: `Invalid category "${rawCategory}". Must be MARQUEE, A, B, C, D (or ICON, ELITE, PREMIER, CORE, RISING)`,
          rawValue: rawCategory,
        });
      } else {
        category = parsedCat;
      }
    }

    // Validate Base Price
    const rawBasePrice = basePriceIndex !== -1 ? fields[basePriceIndex] ?? '' : '';
    let base_price = CATEGORY_BASE_PRICES[category];
    if (rawBasePrice) {
      const parsedPrice = parseInt(rawBasePrice, 10);
      if (isNaN(parsedPrice) || parsedPrice < 1) {
        errors.push({
          rowNumber,
          field: 'base_price',
          message: `Invalid base price "${rawBasePrice}". Must be a positive integer >= 1`,
          rawValue: rawBasePrice,
        });
      } else {
        base_price = parsedPrice;
      }
    }

    // Validate Image URL (optional)
    let image_url: string | null = null;
    const rawImageUrl = imageUrlIndex !== -1 ? fields[imageUrlIndex] ?? '' : '';
    if (rawImageUrl) {
      try {
        new URL(rawImageUrl);
        image_url = rawImageUrl;
      } catch {
        errors.push({
          rowNumber,
          field: 'image_url',
          message: `Invalid image URL "${rawImageUrl}"`,
          rawValue: rawImageUrl,
        });
      }
    }

    // Optional attributes
    const age = parseNonNegativeInt(ageIndex !== -1 ? fields[ageIndex] : undefined, 'age', rowNumber, errors);
    const batting_hand = battingHandIndex !== -1 && fields[battingHandIndex] ? fields[battingHandIndex]!.trim() || null : null;

    // Statistics parsing
    const matches = parseNonNegativeInt(matchesIndex !== -1 ? fields[matchesIndex] : undefined, 'matches', rowNumber, errors);
    const runs = parseNonNegativeInt(runsIndex !== -1 ? fields[runsIndex] : undefined, 'runs', rowNumber, errors);
    const batting_average = parseNonNegativeFloat(battingAverageIndex !== -1 ? fields[battingAverageIndex] : undefined, 'batting_average', rowNumber, errors);
    const strike_rate = parseNonNegativeFloat(strikeRateIndex !== -1 ? fields[strikeRateIndex] : undefined, 'strike_rate', rowNumber, errors);
    const hundreds = parseNonNegativeInt(hundredsIndex !== -1 ? fields[hundredsIndex] : undefined, 'hundreds', rowNumber, errors);
    const fifties = parseNonNegativeInt(fiftiesIndex !== -1 ? fields[fiftiesIndex] : undefined, 'fifties', rowNumber, errors);
    const highest_score = parseNonNegativeInt(highestScoreIndex !== -1 ? fields[highestScoreIndex] : undefined, 'highest_score', rowNumber, errors);
    const boundaries = parseNonNegativeInt(boundariesIndex !== -1 ? fields[boundariesIndex] : undefined, 'boundaries', rowNumber, errors);

    const overs = parseNonNegativeFloat(oversIndex !== -1 ? fields[oversIndex] : undefined, 'overs', rowNumber, errors);
    const wickets = parseNonNegativeInt(wicketsIndex !== -1 ? fields[wicketsIndex] : undefined, 'wickets', rowNumber, errors);
    const bowling_average = parseNonNegativeFloat(bowlingAverageIndex !== -1 ? fields[bowlingAverageIndex] : undefined, 'bowling_average', rowNumber, errors);
    const economy_rate = parseNonNegativeFloat(economyRateIndex !== -1 ? fields[economyRateIndex] : undefined, 'economy_rate', rowNumber, errors);
    const bowling_strike_rate = parseNonNegativeFloat(bowlingStrikeRateIndex !== -1 ? fields[bowlingStrikeRateIndex] : undefined, 'bowling_strike_rate', rowNumber, errors);
    const best_bowling = bestBowlingIndex !== -1 ? fields[bestBowlingIndex] : undefined;
    const three_wicket_hauls = parseNonNegativeInt(threeWicketHaulsIndex !== -1 ? fields[threeWicketHaulsIndex] : undefined, 'three_wicket_hauls', rowNumber, errors);

    const catches = parseNonNegativeInt(catchesIndex !== -1 ? fields[catchesIndex] : undefined, 'catches', rowNumber, errors);
    const stumpings = parseNonNegativeInt(stumpingsIndex !== -1 ? fields[stumpingsIndex] : undefined, 'stumpings', rowNumber, errors);

    // Role-based NULL sanitization
    let finalMatches = matches;
    let finalRuns: number | null = null;
    let finalBattingAvg: number | null = null;
    let finalStrikeRate: number | null = null;
    let finalHundreds: number | null = null;
    let finalFifties: number | null = null;
    let finalHighestScore: number | null = null;
    let finalBoundaries: number | null = null;

    let finalOvers: number | null = null;
    let finalWickets: number | null = null;
    let finalBowlingAvg: number | null = null;
    let finalEconomyRate: number | null = null;
    let finalBowlingStrikeRate: number | null = null;
    let finalBestBowling: string | null = null;
    let finalThreeWicketHauls: number | null = null;

    let finalCatches: number | null = null;
    let finalStumpings: number | null = null;

    if (role === 'BATSMAN') {
      finalRuns = runs;
      finalBattingAvg = batting_average;
      finalStrikeRate = strike_rate;
      finalHundreds = hundreds;
      finalFifties = fifties;
      finalHighestScore = highest_score;
      finalBoundaries = boundaries;
    } else if (role === 'BOWLER') {
      finalOvers = overs;
      finalWickets = wickets;
      finalBowlingAvg = bowling_average;
      finalEconomyRate = economy_rate;
      finalBowlingStrikeRate = bowling_strike_rate;
      finalBestBowling = best_bowling || null;
      finalThreeWicketHauls = three_wicket_hauls;
    } else if (role === 'ALL_ROUNDER') {
      finalRuns = runs;
      finalBattingAvg = batting_average;
      finalStrikeRate = strike_rate;
      finalHundreds = hundreds;
      finalFifties = fifties;
      finalHighestScore = highest_score;
      finalBoundaries = boundaries;
      finalOvers = overs;
      finalWickets = wickets;
      finalBowlingAvg = bowling_average;
      finalEconomyRate = economy_rate;
      finalBowlingStrikeRate = bowling_strike_rate;
      finalBestBowling = best_bowling || null;
      finalThreeWicketHauls = three_wicket_hauls;
    } else if (role === 'WICKET_KEEPER') {
      finalRuns = runs;
      finalBattingAvg = batting_average;
      finalStrikeRate = strike_rate;
      finalHundreds = hundreds;
      finalFifties = fifties;
      finalHighestScore = highest_score;
      finalBoundaries = boundaries;
      finalCatches = catches;
      finalStumpings = stumpings;
    }

    if (errors.length === initialErrorCount) {
      validRows.push({
        name: rawName,
        country,
        role,
        category,
        base_price,
        is_overseas,
        image_url,
        age,
        batting_hand,
        matches: finalMatches,
        runs: finalRuns,
        batting_average: finalBattingAvg,
        strike_rate: finalStrikeRate,
        hundreds: finalHundreds,
        fifties: finalFifties,
        highest_score: finalHighestScore,
        boundaries: finalBoundaries,
        overs: finalOvers,
        wickets: finalWickets,
        bowling_average: finalBowlingAvg,
        economy_rate: finalEconomyRate,
        bowling_strike_rate: finalBowlingStrikeRate,
        best_bowling: finalBestBowling,
        three_wicket_hauls: finalThreeWicketHauls,
        catches: finalCatches,
        stumpings: finalStumpings,
      });
    }
  });

  return {
    validRows,
    errors,
    totalRowsProcessed: dataLines.length,
  };
}
