// src/lib/validations/room.ts

// Phase 5 Room & Team Zod Validation Schemas for Mega Auction V1

import { z } from 'zod';

export const ROOM_CODE_REGEX = /^[A-Z0-9]{6}$/;

export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export const createRoomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Room name must be at least 3 characters')
    .max(50, 'Room name cannot exceed 50 characters'),

  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      ROOM_CODE_REGEX,
      'Room code must be exactly 6 uppercase alphanumeric characters (e.g. KX9P2B)'
    ),

  is_custom_code: z.boolean().optional(),

  player_set_id: z.string().refine(
    (val) => val === 'DEFAULT' || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val),
    { message: 'Please select a valid Player Set' }
  ),

  default_purse: z
    .coerce
    .number()
    .int()
    .min(100, 'Purse must be at least 100 Lakhs/Cr'),

  timer_duration_seconds: z
    .coerce
    .number()
    .int()
    .min(5, 'Timer must be at least 5 seconds')
    .max(60, 'Timer cannot exceed 60 seconds'),

  min_bid_increment: z
    .coerce
    .number()
    .int()
    .min(1, 'Min bid increment must be at least 1'),

  max_squad_size: z
    .coerce
    .number()
    .int()
    .min(11, 'Squad size must be at least 11 players')
    .max(30, 'Squad size cannot exceed 30 players'),

  max_overseas: z
    .coerce
    .number()
    .int()
    .min(0, 'Overseas limit cannot be negative')
    .max(10, 'Overseas limit cannot exceed 10 players'),

  // Host team identity (Phase 5B)
  team_name: z
    .string()
    .trim()
    .min(2, 'Team name must be at least 2 characters')
    .max(30, 'Team name cannot exceed 30 characters'),

  team_short_name: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Short name must be 2-5 characters')
    .max(5, 'Short name must be 2-5 characters'),

  team_color: z
    .string()
    .trim()
    .regex(
      HEX_COLOR_REGEX,
      'Color must be a valid 6-digit hex code (e.g. #FF5733)'
    ),

  bot_count: z
    .coerce
    .number()
    .int()
    .min(0, 'Bot count cannot be negative')
    .max(9, 'Bot count cannot exceed 9')
    .default(0)
    .optional(),

  bot_difficulty: z
    .enum(['Easy', 'Balanced', 'Aggressive'])
    .optional(),

  player_pool: z
    .array(z.string().uuid())
    .optional(),
});

export const joinRoomSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      ROOM_CODE_REGEX,
      'Room code must be exactly 6 uppercase alphanumeric characters (e.g. KX9P2B)'
    ),
});

export const joinRoomWithTeamSchema = z.object({
  team_name: z
    .string()
    .trim()
    .min(2, 'Team name must be at least 2 characters')
    .max(30, 'Team name cannot exceed 30 characters'),

  team_short_name: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Short name must be 2-5 characters')
    .max(5, 'Short name must be 2-5 characters'),

  team_color: z
    .string()
    .trim()
    .regex(
      HEX_COLOR_REGEX,
      'Color must be a valid 6-digit hex code (e.g. #FF5733)'
    ),
});

export const updateMyTeamSchema = z.object({
  team_name: z
    .string()
    .trim()
    .min(2, 'Team name must be at least 2 characters')
    .max(30, 'Team name cannot exceed 30 characters'),

  team_short_name: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Short name must be 2-5 characters')
    .max(5, 'Short name must be 2-5 characters'),

  team_color: z
    .string()
    .trim()
    .regex(
      HEX_COLOR_REGEX,
      'Color must be a valid 6-digit hex code (e.g. #FF5733)'
    ),
});

export const teamSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Team name must be at least 2 characters')
    .max(30, 'Team name cannot exceed 30 characters'),

  short_name: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Short name must be 2-5 characters')
    .max(5, 'Short name must be 2-5 characters'),

  color: z
    .string()
    .trim()
    .regex(
      HEX_COLOR_REGEX,
      'Color must be a valid 6-digit hex code (e.g. #FF5733)'
    ),

  initial_purse: z
    .coerce
    .number()
    .int()
    .min(1, 'Initial purse must be at least 1')
    .optional(),

  is_bot: z
    .boolean()
    .default(false)
    .optional(),

  assigned_participant_id: z
    .string()
    .uuid()
    .nullable()
    .optional(),
});