// src/lib/validations/player-set.ts
// Zod Validation Schemas for Player Sets & Players (V2)

import { z } from 'zod';

export const PLAYER_ROLES = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'] as const;
export const PLAYER_CATEGORIES = ['MARQUEE', 'A', 'B', 'C', 'D'] as const;

export const playerSetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Player set name is required')
    .max(100, 'Name cannot exceed 100 characters'),
  description: z
    .string()
    .trim()
    .max(500, 'Description cannot exceed 500 characters')
    .nullable()
    .optional()
    .or(z.literal('')),
  is_public: z.boolean().default(false),
});

const nonNegativeInt = z
  .number({ invalid_type_error: 'Must be a number' })
  .int('Must be an integer')
  .min(0, 'Value cannot be negative')
  .nullable()
  .optional();

const nonNegativeNumber = z
  .number({ invalid_type_error: 'Must be a number' })
  .min(0, 'Value cannot be negative')
  .nullable()
  .optional();

export const playerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Player name is required')
    .max(100, 'Name cannot exceed 100 characters'),
  country: z
    .string()
    .trim()
    .min(1, 'Country is required')
    .max(100, 'Country cannot exceed 100 characters'),
  role: z.enum(PLAYER_ROLES, {
    errorMap: () => ({ message: 'Invalid role. Must be BATSMAN, BOWLER, ALL_ROUNDER, or WICKET_KEEPER' }),
  }),
  age: nonNegativeInt,
  batting_hand: z.string().trim().nullable().optional().or(z.literal('')),
  category: z
    .enum(PLAYER_CATEGORIES, {
      errorMap: () => ({ message: 'Invalid category. Must be MARQUEE, A, B, C, or D' }),
    })
    .default('C'),
  base_price: z
    .number({ invalid_type_error: 'Base price must be a number' })
    .int('Base price must be an integer')
    .min(1, 'Base price must be at least 1 credit/lakh'),
  is_overseas: z.boolean().default(false),
  image_url: z.string().url('Invalid image URL').nullable().optional().or(z.literal('')),

  // Batting Statistics
  matches: nonNegativeInt,
  runs: nonNegativeInt,
  batting_average: nonNegativeNumber,
  strike_rate: nonNegativeNumber,
  hundreds: nonNegativeInt,
  fifties: nonNegativeInt,
  highest_score: nonNegativeInt,
  boundaries: nonNegativeInt,

  // Bowling Statistics
  overs: nonNegativeNumber,
  wickets: nonNegativeInt,
  bowling_average: nonNegativeNumber,
  economy_rate: nonNegativeNumber,
  bowling_strike_rate: nonNegativeNumber,
  best_bowling: z.string().trim().nullable().optional().or(z.literal('')),
  three_wicket_hauls: nonNegativeInt,

  // Keeping Statistics
  catches: nonNegativeInt,
  stumpings: nonNegativeInt,
});
