// src/lib/auction/constants.ts

export const AUCTION = {
  ROOM_CODE_LENGTH: 6,
  MIN_TEAMS: 2,
  MAX_TEAMS_DEFAULT: 8,
  MAX_TEAMS_LIMIT: 12,

  DEFAULT_PURSE: 1000,
  MIN_PURSE: 100,
  MAX_PURSE: 10000,

  DEFAULT_TIMER_DURATION: 15,
  MIN_TIMER_DURATION: 10,
  MAX_TIMER_DURATION: 60,

  DEFAULT_MIN_BID_INCREMENT: 5,
  MIN_BID_INCREMENT_FLOOR: 1,
  MAX_BID_INCREMENT: 100,

  DEFAULT_MAX_SQUAD_SIZE: 25,
  MIN_SQUAD_SIZE: 7,
  MAX_SQUAD_SIZE: 30,

  DEFAULT_MAX_OVERSEAS: 8,
  MIN_OVERSEAS: 0,
  MAX_OVERSEAS: 15,

  HEARTBEAT_INTERVAL_MS: 2000,
  PRESENCE_TIMEOUT_SECONDS: 30,
  UNSOLD_ROUND_BASE_PRICE_MULTIPLIER: 0.5,

  BOT_MIN_DELAY_MS: 1000,
  BOT_MAX_DELAY_MS: 4000,
  BOT_COOLDOWN_MIN_MS: 2000,
  BOT_COOLDOWN_MAX_MS: 5000,
  BOT_DECISION_TIMEOUT_MS: 2000,

  LOT_REVEAL_DELAY_MS: 2000,
  SOLD_DISPLAY_DURATION_MS: 3000,
  UNSOLD_DISPLAY_DURATION_MS: 2000,
  AUTO_ADVANCE_DELAY_MS: 3000,

  PG_CRON_EXPIRE_LOTS: '10 seconds',
  PG_CRON_KEEP_ALIVE: '0 */6 * * *',
  PG_CRON_CLEAN_LOGS: '0 3 * * *',
} as const;

export const TEAM_TEMPLATES = [
  { name: 'Chennai Super Kings', short_name: 'CSK', color: '#FFFF00' },
  { name: 'Mumbai Indians', short_name: 'MI', color: '#004BA0' },
  { name: 'Royal Challengers Bengaluru', short_name: 'RCB', color: '#EC1C24' },
  { name: 'Kolkata Knight Riders', short_name: 'KKR', color: '#3A225D' },
  { name: 'Sunrisers Hyderabad', short_name: 'SRH', color: '#FF822A' },
  { name: 'Rajasthan Royals', short_name: 'RR', color: '#EA1A85' },
  { name: 'Delhi Capitals', short_name: 'DC', color: '#0078BC' },
  { name: 'Punjab Kings', short_name: 'PBKS', color: '#ED1B24' },
  { name: 'Gujarat Titans', short_name: 'GT', color: '#1C1C1C' },
  { name: 'Lucknow Super Giants', short_name: 'LSG', color: '#A72056' },
] as const;

export const PLAYER_ROLES = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'] as const;
export const PLAYER_CATEGORIES = ['MARQUEE', 'A', 'B', 'C', 'D'] as const;
export const PLAYER_ORDER_OPTIONS = ['CATEGORY', 'RANDOM', 'BASE_PRICE_DESC', 'BASE_PRICE_ASC'] as const;
