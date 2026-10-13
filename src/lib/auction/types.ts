// src/lib/auction/types.ts

import { ErrorCode } from '../errors';

export type RoomStatus = 'OPEN' | 'LOCKED' | 'COMPLETED' | 'CANCELLED';

export type AuctionStatus =
  | 'LOBBY'
  | 'READY'
  | 'STARTING'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

export type LotStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'BIDDING'
  | 'SOLD'
  | 'UNSOLD'
  | 'SKIPPED';

export type PlayerRole = 'BATSMAN' | 'BOWLER' | 'ALL_ROUNDER' | 'WICKET_KEEPER';
export type PlayerCategory = 'MARQUEE' | 'A' | 'B' | 'C' | 'D';
export type PlayerOrderOption = 'CATEGORY' | 'RANDOM' | 'BASE_PRICE_DESC' | 'BASE_PRICE_ASC';

export interface RoomSettings {
  timer_duration_seconds: number;
  min_bid_increment: number;
  default_purse: number;
  max_squad_size: number;
  max_overseas: number;
  player_set_id: string | null;
  player_order: PlayerOrderOption;
}

export interface RuleCheckResult {
  allowed: boolean;
  code?: ErrorCode;
  message?: string;
}

export interface BotStrategy {
  aggression: number;
  budget_focus: number;
  max_bid_multiplier: number;
}

export interface RealtimeBroadcastPayload<T = unknown> {
  sequence: number;
  event_type: string;
  payload: T;
}

export type {
  AuctionState,
  QueuedPlayer,
  NormalizedCategory,
  EngineAuctionStatus,
  QueuedPlayerStatus,
  RawInputPlayer,
} from './state';
