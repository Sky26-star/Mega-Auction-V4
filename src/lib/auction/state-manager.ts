// src/lib/auction/state-manager.ts
// Authoritative Multiplayer State Manager & Broadcast Sync for Mega Auction V2

import {
  AuctionState,
  RawInputPlayer,
  initializeAuction,
  startNextPlayer,
  pauseAuction,
  resumeAuction,
} from './state';
import {
  fetchAuthoritativeAuctionState,
  logAuctionDebug,
} from './persistence';
import { broadcastToRoom } from '../supabase/broadcast';

// In-memory server/authoritative state store per room
const activeAuctionStates = new Map<string, AuctionState>();

// Event subscriber listeners for client / SSR realtime sync
type StateSubscriber = (state: AuctionState) => void;
const roomSubscribers = new Map<string, Set<StateSubscriber>>();

function saveToSessionStorage(roomId: string, state: AuctionState) {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(`mega_auction_state_${roomId}`, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save auction state to sessionStorage:', e);
    }
  }
}

function loadFromSessionStorage(roomId: string): AuctionState | null {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const raw = window.sessionStorage.getItem(`mega_auction_state_${roomId}`);
      if (raw) {
        return JSON.parse(raw) as AuctionState;
      }
    } catch (e) {
      console.warn('Failed to load auction state from sessionStorage:', e);
    }
  }
  return null;
}

/**
 * Synchronously gets cached in-memory AuctionState (or non-authoritative sessionStorage fallback).
 */
export function getRoomAuctionState(roomId: string): AuctionState | null {
  if (activeAuctionStates.has(roomId)) {
    return activeAuctionStates.get(roomId)!;
  }
  const restored = loadFromSessionStorage(roomId);
  if (restored) {
    activeAuctionStates.set(roomId, restored);
    return restored;
  }
  return null;
}

/**
 * Asynchronously loads and verifies the true authoritative state directly from Supabase Database.
 * Updates in-memory store and notifies room subscribers upon success.
 * Returns null strictly on failure (does NOT fall back to stale sessionStorage).
 */
export async function loadAuthoritativeRoomAuctionState(roomId: string): Promise<AuctionState | null> {
  try {
    const dbState = await fetchAuthoritativeAuctionState(roomId);
    if (dbState) {
      const currentState = activeAuctionStates.get(roomId);
      // Stale event guard: reject DB state if current in-memory state is for the SAME auction and already at a higher lot_index
      if (currentState && currentState.auctionId === dbState.auctionId && currentState.currentPlayerIndex > dbState.currentPlayerIndex) {
        console.warn(`[AUCTION SYNC DEBUG] Rejecting stale DB state for room ${roomId}: current index=${currentState.currentPlayerIndex}, incoming index=${dbState.currentPlayerIndex}`);
        return currentState;
      }

      activeAuctionStates.set(roomId, dbState);
      saveToSessionStorage(roomId, dbState);
      notifySubscribers(roomId, dbState);
      logAuctionDebug('B. loadAuthoritativeRoomAuctionState (Success)', roomId, dbState);
      return dbState;
    } else {
      activeAuctionStates.delete(roomId);
      clearSessionStorageAuctionState(roomId);
    }
  } catch (err) {
    console.warn(`Failed to fetch database state for room ${roomId}:`, err);
  }
  logAuctionDebug('B. loadAuthoritativeRoomAuctionState (Failed/Null)', roomId, null);
  return null;
}

export function clearSessionStorageAuctionState(roomId: string) {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(`mega_auction_state_${roomId}`);
    } catch (e) {
      console.warn('Failed to clear auction state from sessionStorage:', e);
    }
  }
}


/**
 * Sets or overrides the authoritative AuctionState for a room.
 */
export function setRoomAuctionState(roomId: string, state: AuctionState): void {
  activeAuctionStates.set(roomId, state);
  saveToSessionStorage(roomId, state);
  notifySubscribers(roomId, state);
}

/**
 * Synchronous in-memory initializer (used in standalone unit tests & fallbacks).
 */
export function initializeRoomAuction(roomId: string, players: RawInputPlayer[]): AuctionState {
  const state = initializeAuction(players);
  activeAuctionStates.set(roomId, state);
  saveToSessionStorage(roomId, state);

  broadcastAuctionState(roomId, 'auction:initialize', state);
  notifySubscribers(roomId, state);

  return state;
}


/**
 * Clears room state (for cleanup / testing).
 */
export function resetRoomAuctionState(roomId: string): void {
  activeAuctionStates.delete(roomId);
  roomSubscribers.delete(roomId);
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(`mega_auction_state_${roomId}`);
    } catch (e) {
      // ignore
    }
  }
}

/**
 * Subscribes a client listener callback to state updates for a room.
 */
export function subscribeToRoomAuctionState(roomId: string, callback: StateSubscriber): () => void {
  if (!roomSubscribers.has(roomId)) {
    roomSubscribers.set(roomId, new Set());
  }
  const subs = roomSubscribers.get(roomId)!;
  subs.add(callback);

  const current = getRoomAuctionState(roomId);
  if (current) {
    callback(current);
  }

  return () => {
    subs.delete(callback);
    if (subs.size === 0) {
      roomSubscribers.delete(roomId);
    }
  };
}

function notifySubscribers(roomId: string, state: AuctionState) {
  const subs = roomSubscribers.get(roomId);
  if (subs) {
    subs.forEach((cb) => {
      try {
        cb(state);
      } catch (err) {
        console.error(`Error in room subscriber callback for room ${roomId}:`, err);
      }
    });
  }
}

async function broadcastAuctionState(roomId: string, event: string, state: AuctionState) {
  try {
    await broadcastToRoom({
      roomId,
      event,
      payload: state as unknown as Record<string, unknown>,
    });
  } catch (err) {
    console.error(`Failed to broadcast event ${event} for room ${roomId}:`, err);
  }
}
