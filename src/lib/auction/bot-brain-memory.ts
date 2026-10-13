// src/lib/auction/bot-brain-memory.ts

export interface BidObservation {
  highestBid: number;
  observedAt: number;
  isFinalBid?: boolean;
}

export interface RivalBidObservation {
  bidderTeamId: string;
  highestBid: number;
  observedAt: number;
}

export interface PurchaseEvent {
  playerId: string;
  amount: number;
  role: string;
  observedAt: number;
}

export interface RivalPurchaseEvent {
  playerId: string;
  winnerId: string;
  amount: number;
  role: string;
  observedAt: number;
}

export interface FailedTargetEvent {
  playerId: string;
  finalBid: number;
  winnerId: string;
  observedAt: number;
}

export interface BotMemory {
  auctionId: string;
  teamId: string;

  // Tactical Memory
  observedBids: Record<string, BidObservation>; // playerId -> own observation
  observedRivalBids: Record<string, RivalBidObservation>; // playerId -> rival observation
  purchases: PurchaseEvent[];
  rivalPurchases: RivalPurchaseEvent[];
  failedTargets: FailedTargetEvent[];
  lotsSinceLastPurchase: number;

  // Internal State Tracking for Idempotence
  isInitialized: boolean;
  lastSeenLotId: string | null;
  processedCompletedLots: Set<string>; // Track processed SOLD lot IDs
}

// Global cache singleton (Survives Next.js HMR in development)
const globalForBotMemory = globalThis as unknown as {
  __BOT_MEMORY_CACHE__: Map<string, BotMemory>;
};

const botMemoryCache = globalForBotMemory.__BOT_MEMORY_CACHE__ || new Map<string, BotMemory>();
if (process.env.NODE_ENV !== 'production') {
  globalForBotMemory.__BOT_MEMORY_CACHE__ = botMemoryCache;
}

function getCacheKey(auctionId: string, teamId: string): string {
  return `${auctionId}_${teamId}`;
}

/**
 * Retrieves or lazily initializes memory for a specific bot in an auction.
 */
export function getBotMemory(auctionId: string, teamId: string): BotMemory {
  const key = getCacheKey(auctionId, teamId);
  if (!botMemoryCache.has(key)) {
    botMemoryCache.set(key, {
      auctionId,
      teamId,
      observedBids: {},
      observedRivalBids: {},
      purchases: [],
      rivalPurchases: [],
      failedTargets: [],
      lotsSinceLastPurchase: 0,
      isInitialized: false,
      lastSeenLotId: null,
      processedCompletedLots: new Set<string>()
    });
  }
  return botMemoryCache.get(key)!;
}

/**
 * Clears memory for an entire auction (e.g., when completed/cancelled).
 */
export function clearAuctionMemory(auctionId: string): void {
  for (const key of botMemoryCache.keys()) {
    if (key.startsWith(`${auctionId}_`)) {
      botMemoryCache.delete(key);
    }
  }
}

/**
 * Clears memory for all auctions that are no longer in the active tracked set.
 */
export function clearInactiveAuctionMemory(activeAuctionIds: Set<string>): void {
  for (const key of botMemoryCache.keys()) {
    const auctionId = key.split('_')[0] as string;
    if (auctionId && !activeAuctionIds.has(auctionId)) {
      botMemoryCache.delete(key);
    }
  }
}

/**
 * Clears memory for a specific bot.
 */
export function clearBotMemory(auctionId: string, teamId: string): void {
  botMemoryCache.delete(getCacheKey(auctionId, teamId));
}

/**
 * Safely records a bid placed by this bot. Used to infer participation.
 */
export function recordBotBidObservation(
  auctionId: string,
  teamId: string,
  playerId: string,
  bidAmount: number,
  isFinalBid: boolean = false
): void {
  const memory = getBotMemory(auctionId, teamId);
  const existing = memory.observedBids[playerId];

  if (!existing || bidAmount > existing.highestBid || isFinalBid) {
    memory.observedBids[playerId] = {
      highestBid: Math.max(bidAmount, existing?.highestBid ?? 0),
      observedAt: Date.now(),
      isFinalBid: isFinalBid || existing?.isFinalBid || false
    };
  }
}

/**
 * Safely records an observed bid placed by a rival franchise.
 * Validates that rivalTeamId !== observingTeamId.
 * Idempotent: Does not downgrade highestBid if a lower/stale bid is reported.
 */
export function recordRivalBidObservation(
  auctionId: string,
  observingTeamId: string,
  playerId: string,
  rivalTeamId: string,
  bidAmount: number
): void {
  if (!rivalTeamId || rivalTeamId === observingTeamId) return;

  const memory = getBotMemory(auctionId, observingTeamId);
  if (!memory.observedRivalBids) {
    memory.observedRivalBids = {};
  }
  const existing = memory.observedRivalBids[playerId];

  if (!existing || bidAmount >= existing.highestBid) {
    memory.observedRivalBids[playerId] = {
      bidderTeamId: rivalTeamId,
      highestBid: Math.max(bidAmount, existing?.highestBid ?? 0),
      observedAt: Date.now()
    };
  }
}

/**
 * Reconstructs / Updates BotMemory based on authoritative state.
 * Idempotent: Can be called repeatedly on the same tick without double-counting.
 */
export function syncBotMemoryWithState(
  auctionId: string,
  teamId: string,
  currentLotId: string | null,
  allLots: any[] // Expects array of lots with id, status, player_id, winning_team_id, winning_bid, players(role)
): BotMemory {
  const memory = getBotMemory(auctionId, teamId);

  // 1. Detect New Lot Transition (Idempotent tracking)
  if (currentLotId && currentLotId !== memory.lastSeenLotId) {
    // Only increment if we actually had a previous lot we were tracking
    if (memory.lastSeenLotId !== null) {
      memory.lotsSinceLastPurchase++;
    }
    memory.lastSeenLotId = currentLotId;
  }

  // 2. Handle Initialization Boundary (Cold Start)
  if (!memory.isInitialized) {
    for (const lot of allLots) {
      if (lot.status === 'SOLD') {
        memory.processedCompletedLots.add(lot.id);
      }
    }
    memory.isInitialized = true;
    // Do not generate events for baseline lots
    return memory;
  }

  // 3. Process Newly Completed Lots for Purchases and Failed Targets
  for (const lot of allLots) {
    // Only process SOLD lots that we haven't seen finalize yet
    if (lot.status !== 'SOLD' || memory.processedCompletedLots.has(lot.id)) {
      continue;
    }

    const playerId = lot.player_id;
    const winnerId = lot.winning_team_id;
    const winningBid = lot.winning_bid || lot.base_price;
    const playerRole = lot.players?.role || 'UNKNOWN';

    // Check if this bot was involved or won
    if (winnerId === teamId) {
      // It's an observed purchase!
      memory.purchases.push({
        playerId,
        amount: winningBid,
        role: playerRole,
        observedAt: Date.now()
      });
      // Reset lotsSinceLastPurchase explicitly on win
      memory.lotsSinceLastPurchase = 0;
    } else {
      // Rival purchase
      if (winnerId) {
        if (!memory.rivalPurchases) memory.rivalPurchases = [];
        memory.rivalPurchases.push({
          playerId,
          winnerId,
          amount: winningBid,
          role: playerRole,
          observedAt: Date.now()
        });
      }
      // It's a loss. Did we actually bid on this player?
      const observation = memory.observedBids[playerId];
      if (observation) {
        memory.failedTargets.push({
          playerId,
          finalBid: winningBid,
          winnerId: winnerId || 'UNKNOWN',
          observedAt: Date.now()
        });
      }
    }

    // Mark as processed to ensure idempotency
    memory.processedCompletedLots.add(lot.id);
  }

  return memory;
}
