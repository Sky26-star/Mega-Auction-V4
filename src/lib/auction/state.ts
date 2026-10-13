// src/lib/auction/state.ts
// Authoritative Auction State Model & Deterministic Player Queue Engine for Mega Auction V2

export type EngineAuctionStatus = 'NOT_STARTED' | 'LIVE' | 'PAUSED' | 'COMPLETED';
export type QueuedPlayerStatus = 'UPCOMING' | 'LIVE' | 'SOLD' | 'UNSOLD';
export type NormalizedCategory = 'ICON' | 'ELITE' | 'PREMIER' | 'CORE' | 'RISING';

export interface RawInputPlayer {
  id?: string;
  playerId?: string;
  name: string;
  category: string;
  base_price?: number;
  basePrice?: number;
  country?: string;
  role?: string;
  image_url?: string | null;
  [key: string]: unknown;
}

import type { PlayerStats } from '@/types/player';

export interface QueuedPlayer {
  playerId: string;
  name: string;
  category: NormalizedCategory;
  basePrice: number;
  auctionOrder: number;
  status: QueuedPlayerStatus;
  country?: string;
  role?: string;
  image_url?: string | null;
  age?: number;
  battingHand?: string;
  stats?: PlayerStats;
}

export interface AuctionState {
  auctionId?: string | null;
  lotId?: string | null;
  currentPlayerId: string | null;
  currentPlayer: QueuedPlayer | null;
  currentBid: number;
  highestBidderId: string | null;
  bidCount: number;
  auctionStatus: EngineAuctionStatus;
  currentCategory: NormalizedCategory | null;
  playerQueue: QueuedPlayer[];
  currentPlayerIndex: number;
  lotStatus?: string;
  timerExpiresAt?: string | null;
  timerDurationSeconds?: number;
  isGetReady?: boolean;
  getReadyExpiresAt?: string | null;
}

export const CATEGORY_ORDER: NormalizedCategory[] = ['ICON', 'ELITE', 'PREMIER', 'CORE', 'RISING'];

export const CATEGORY_PRIORITY: Record<NormalizedCategory, number> = {
  ICON: 1,
  ELITE: 2,
  PREMIER: 3,
  CORE: 4,
  RISING: 5,
};

export const DEFAULT_CATEGORY_BASE_PRICES: Record<NormalizedCategory, number> = {
  ICON: 200,
  ELITE: 150,
  PREMIER: 100,
  CORE: 75,
  RISING: 50,
};

/**
 * Normalizes input category string to standard category enum (ICON, ELITE, PREMIER, CORE, RISING).
 * Supports both V1 DB codes (MARQUEE, A, B, C, D) and V2 UI codes (ICON, ELITE, PREMIER, CORE, RISING).
 */
export function normalizeCategory(rawCat?: string | null): NormalizedCategory {
  if (!rawCat) {
    throw new Error('Player validation error: Category is missing');
  }

  const normalized = rawCat.trim().toUpperCase();

  if (normalized === 'MARQUEE' || normalized === 'ICON') return 'ICON';
  if (normalized === 'A' || normalized === 'ELITE') return 'ELITE';
  if (normalized === 'B' || normalized === 'PREMIER') return 'PREMIER';
  if (normalized === 'C' || normalized === 'CORE') return 'CORE';
  if (normalized === 'D' || normalized === 'RISING') return 'RISING';

  throw new Error(`Player validation error: Invalid category '${rawCat}'. Must be one of ICON (MARQUEE), ELITE (A), PREMIER (B), CORE (C), RISING (D).`);
}

/**
 * Gets default base price in Lakhs for a category if base price is not specified.
 */
export function getDefaultBasePrice(category: NormalizedCategory): number {
  return DEFAULT_CATEGORY_BASE_PRICES[category] || 50;
}

/**
 * Validates raw player list and constructs a deterministic, deduplicated auction queue.
 * Ordering rules: ICON -> ELITE -> PREMIER -> CORE -> RISING (deterministic within categories).
 */
export function validateAndBuildQueue(rawPlayers: RawInputPlayer[]): QueuedPlayer[] {
  if (!Array.isArray(rawPlayers) || rawPlayers.length === 0) {
    return [];
  }

  const seenPlayerIds = new Set<string>();
  const validatedPlayers: Array<{ player: RawInputPlayer; id: string; category: NormalizedCategory; basePrice: number; inputIndex: number }> = [];

  for (let i = 0; i < rawPlayers.length; i++) {
    const p = rawPlayers[i];
    if (!p) continue;

    const id = p.id || p.playerId;

    if (!id || typeof id !== 'string' || id.trim() === '') {
      throw new Error(`Player validation error at index ${i}: Player ID is missing`);
    }

    const cleanId = id.trim();

    if (seenPlayerIds.has(cleanId)) {
      throw new Error(`Player validation error: Duplicate player ID '${cleanId}' detected`);
    }
    seenPlayerIds.add(cleanId);

    if (!p.name || typeof p.name !== 'string' || p.name.trim() === '') {
      throw new Error(`Player validation error for ID '${cleanId}': Name is missing`);
    }

    const category = normalizeCategory(p.category);
    const rawPrice = p.base_price !== undefined ? p.base_price : p.basePrice;
    const basePrice = typeof rawPrice === 'number' && rawPrice > 0 ? rawPrice : getDefaultBasePrice(category);

    if (isNaN(basePrice) || basePrice <= 0) {
      throw new Error(`Player validation error for ID '${cleanId}': Invalid base price '${rawPrice}'`);
    }

    validatedPlayers.push({
      player: p,
      id: cleanId,
      category,
      basePrice,
      inputIndex: i,
    });
  }

  // Sort deterministically: Category Priority (ICON -> ELITE -> PREMIER -> CORE -> RISING), then original input order
  validatedPlayers.sort((a, b) => {
    const catDiff = CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
    if (catDiff !== 0) return catDiff;
    return a.inputIndex - b.inputIndex;
  });

  // Map to QueuedPlayer structure with 1-based auctionOrder and UPCOMING status
  return validatedPlayers.map((item, idx) => ({
    playerId: item.id,
    name: item.player.name.trim(),
    category: item.category,
    basePrice: item.basePrice,
    auctionOrder: idx + 1,
    status: 'UPCOMING' as QueuedPlayerStatus,
    country: item.player.country,
    role: item.player.role,
    image_url: item.player.image_url,
  }));
}

/**
 * Initializes a new authoritative AuctionState from an input player array.
 * Sets status to NOT_STARTED, currentPlayerIndex to -1, currentPlayer to null, currentBid to 0.
 */
export function initializeAuction(rawPlayers: RawInputPlayer[]): AuctionState {
  const queue = validateAndBuildQueue(rawPlayers);

  return {
    currentPlayerId: null,
    currentPlayer: null,
    currentBid: 0,
    highestBidderId: null,
    bidCount: 0,
    auctionStatus: 'NOT_STARTED',
    currentCategory: null,
    playerQueue: queue,
    currentPlayerIndex: -1,
  };
}

/**
 * Advances auction to the next UPCOMING player in the queue.
 * Updates auctionStatus to LIVE, sets currentBid to player's base price, resets highestBidderId & bidCount.
 * If no UPCOMING players remain, sets auctionStatus to COMPLETED and currentPlayer to null.
 */
export function startNextPlayer(state: AuctionState): AuctionState {
  const { playerQueue, currentPlayerIndex } = state;

  // Find next index with status 'UPCOMING'
  let nextIndex = -1;
  for (let i = currentPlayerIndex + 1; i < playerQueue.length; i++) {
    const candidate = playerQueue[i];
    if (candidate && candidate.status === 'UPCOMING') {
      nextIndex = i;
      break;
    }
  }

  // If no upcoming player remains in queue: COMPLETED
  if (nextIndex === -1 || nextIndex >= playerQueue.length) {
    return {
      ...state,
      currentPlayerId: null,
      currentPlayer: null,
      currentBid: 0,
      highestBidderId: null,
      bidCount: 0,
      auctionStatus: 'COMPLETED',
      currentCategory: null,
      currentPlayerIndex: playerQueue.length,
    };
  }

  // Immutably update player status in queue to LIVE
  const updatedQueue = playerQueue.map((p, idx) => {
    if (idx === nextIndex) {
      return { ...p, status: 'LIVE' as QueuedPlayerStatus };
    }
    return p;
  });

  const livePlayer = updatedQueue[nextIndex];
  if (!livePlayer) {
    return state;
  }

  return {
    ...state,
    currentPlayerId: livePlayer.playerId,
    currentPlayer: livePlayer,
    currentBid: livePlayer.basePrice,
    highestBidderId: null,
    bidCount: 0,
    auctionStatus: 'LIVE',
    currentCategory: livePlayer.category,
    playerQueue: updatedQueue,
    currentPlayerIndex: nextIndex,
  };
}

/**
 * Pauses a LIVE auction session.
 */
export function pauseAuction(state: AuctionState): AuctionState {
  if (state.auctionStatus !== 'LIVE') {
    return state;
  }
  return {
    ...state,
    auctionStatus: 'PAUSED',
  };
}

/**
 * Resumes a PAUSED auction session.
 */
export function resumeAuction(state: AuctionState): AuctionState {
  if (state.auctionStatus !== 'PAUSED') {
    return state;
  }
  return {
    ...state,
    auctionStatus: 'LIVE',
  };
}
