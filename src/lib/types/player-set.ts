// src/lib/types/player-set.ts
// Player & Player Set TypeScript Interfaces for Mega Auction V2

export type PlayerRole = 'BATSMAN' | 'BOWLER' | 'ALL_ROUNDER' | 'WICKET_KEEPER';
export type PlayerCategory = 'MARQUEE' | 'A' | 'B' | 'C' | 'D';

export const CATEGORY_UI_LABELS: Record<PlayerCategory, string> = {
  MARQUEE: 'ICON PLAYERS',
  A: 'ELITE PLAYERS',
  B: 'PREMIER PLAYERS',
  C: 'CORE PLAYERS',
  D: 'RISING STARS',
};

export const CATEGORY_SHORT_LABELS: Record<PlayerCategory, string> = {
  MARQUEE: 'ICON',
  A: 'ELITE',
  B: 'PREMIER',
  C: 'CORE',
  D: 'RISING',
};

export const CATEGORY_BASE_PRICES: Record<PlayerCategory, number> = {
  MARQUEE: 200,
  A: 150,
  B: 100,
  C: 75,
  D: 50,
};

export interface PlayerSetCategoryCounts {
  MARQUEE: number;
  A: number;
  B: number;
  C: number;
  D: number;
}

export interface PlayerSet {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  player_count?: number;
  category_counts?: PlayerSetCategoryCounts;
  preview_images?: string[];
}

export interface Player {
  id: string;
  player_set_id: string;
  name: string;
  country: string;
  role: PlayerRole;
  age: number | null;
  batting_hand: string | null;
  category: PlayerCategory;
  base_price: number;
  is_overseas: boolean;
  image_url: string | null;

  // Batting Statistics
  matches: number | null;
  runs: number | null;
  batting_average: number | null;
  strike_rate: number | null;
  hundreds: number | null;
  fifties: number | null;
  highest_score: number | null;
  boundaries: number | null;

  // Bowling Statistics
  overs: number | null;
  wickets: number | null;
  bowling_average: number | null;
  economy_rate: number | null;
  bowling_strike_rate: number | null;
  best_bowling: string | null;
  three_wicket_hauls: number | null;

  // Wicket-Keeping Statistics
  catches: number | null;
  stumpings: number | null;

  created_at: string;
}

export interface PlayerSetFormInput {
  name: string;
  description?: string | null;
  is_public: boolean;
}

export interface PlayerFormInput {
  name: string;
  country: string;
  role: PlayerRole;
  age?: number | null;
  batting_hand?: string | null;
  category: PlayerCategory;
  base_price: number;
  is_overseas?: boolean;
  image_url?: string | null;

  // Batting Statistics
  matches?: number | null;
  runs?: number | null;
  batting_average?: number | null;
  strike_rate?: number | null;
  hundreds?: number | null;
  fifties?: number | null;
  highest_score?: number | null;
  boundaries?: number | null;

  // Bowling Statistics
  overs?: number | null;
  wickets?: number | null;
  bowling_average?: number | null;
  economy_rate?: number | null;
  bowling_strike_rate?: number | null;
  best_bowling?: string | null;
  three_wicket_hauls?: number | null;

  // Keeping Statistics
  catches?: number | null;
  stumpings?: number | null;
}

export interface CSVPlayerRow {
  name: string;
  country?: string;
  role: string;
  age?: string | number;
  batting_hand?: string;
  category?: string;
  base_price?: string | number;
  is_overseas?: string | boolean;
  image_url?: string;

  matches?: string | number;
  runs?: string | number;
  batting_average?: string | number;
  strike_rate?: string | number;
  hundreds?: string | number;
  fifties?: string | number;
  highest_score?: string | number;
  boundaries?: string | number;

  overs?: string | number;
  wickets?: string | number;
  bowling_average?: string | number;
  economy_rate?: string | number;
  bowling_strike_rate?: string | number;
  best_bowling?: string;
  three_wicket_hauls?: string | number;

  catches?: string | number;
  stumpings?: string | number;
}

export interface CSVRowValidationError {
  rowNumber: number;
  field: string;
  message: string;
  rawValue: string;
}

export interface CSVImportResult {
  validRows: PlayerFormInput[];
  errors: CSVRowValidationError[];
  totalRowsProcessed: number;
}
