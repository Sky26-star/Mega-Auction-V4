"use strict";
// src/lib/auction/bot-brain-memory.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBotMemory = getBotMemory;
exports.clearAuctionMemory = clearAuctionMemory;
exports.clearInactiveAuctionMemory = clearInactiveAuctionMemory;
exports.clearBotMemory = clearBotMemory;
exports.recordBotBidObservation = recordBotBidObservation;
exports.recordRivalBidObservation = recordRivalBidObservation;
exports.syncBotMemoryWithState = syncBotMemoryWithState;
// Global cache singleton (Survives Next.js HMR in development)
var globalForBotMemory = globalThis;
var botMemoryCache = globalForBotMemory.__BOT_MEMORY_CACHE__ || new Map();
if (process.env.NODE_ENV !== 'production') {
    globalForBotMemory.__BOT_MEMORY_CACHE__ = botMemoryCache;
}
function getCacheKey(auctionId, teamId) {
    return "".concat(auctionId, "_").concat(teamId);
}
/**
 * Retrieves or lazily initializes memory for a specific bot in an auction.
 */
function getBotMemory(auctionId, teamId) {
    var key = getCacheKey(auctionId, teamId);
    if (!botMemoryCache.has(key)) {
        botMemoryCache.set(key, {
            auctionId: auctionId,
            teamId: teamId,
            observedBids: {},
            observedRivalBids: {},
            purchases: [],
            rivalPurchases: [],
            failedTargets: [],
            lotsSinceLastPurchase: 0,
            isInitialized: false,
            lastSeenLotId: null,
            processedCompletedLots: new Set()
        });
    }
    return botMemoryCache.get(key);
}
/**
 * Clears memory for an entire auction (e.g., when completed/cancelled).
 */
function clearAuctionMemory(auctionId) {
    for (var _i = 0, _a = Array.from(botMemoryCache.keys()); _i < _a.length; _i++) {
        var key = _a[_i];
        if (key.startsWith("".concat(auctionId, "_"))) {
            botMemoryCache.delete(key);
        }
    }
}
/**
 * Clears memory for all auctions that are no longer in the active tracked set.
 */
function clearInactiveAuctionMemory(activeAuctionIds) {
    for (var _i = 0, _a = Array.from(botMemoryCache.keys()); _i < _a.length; _i++) {
        var key = _a[_i];
        var auctionId = key.split('_')[0];
        if (auctionId && !activeAuctionIds.has(auctionId)) {
            botMemoryCache.delete(key);
        }
    }
}
/**
 * Clears memory for a specific bot.
 */
function clearBotMemory(auctionId, teamId) {
    botMemoryCache.delete(getCacheKey(auctionId, teamId));
}
/**
 * Safely records a bid placed by this bot. Used to infer participation.
 */
function recordBotBidObservation(auctionId, teamId, playerId, bidAmount, isFinalBid) {
    var _a;
    if (isFinalBid === void 0) { isFinalBid = false; }
    var memory = getBotMemory(auctionId, teamId);
    var existing = memory.observedBids[playerId];
    if (!existing || bidAmount > existing.highestBid || isFinalBid) {
        memory.observedBids[playerId] = {
            highestBid: Math.max(bidAmount, (_a = existing === null || existing === void 0 ? void 0 : existing.highestBid) !== null && _a !== void 0 ? _a : 0),
            observedAt: Date.now(),
            isFinalBid: isFinalBid || (existing === null || existing === void 0 ? void 0 : existing.isFinalBid) || false
        };
    }
}
/**
 * Safely records an observed bid placed by a rival franchise.
 * Validates that rivalTeamId !== observingTeamId.
 * Idempotent: Does not downgrade highestBid if a lower/stale bid is reported.
 */
function recordRivalBidObservation(auctionId, observingTeamId, playerId, rivalTeamId, bidAmount) {
    var _a;
    if (!rivalTeamId || rivalTeamId === observingTeamId)
        return;
    var memory = getBotMemory(auctionId, observingTeamId);
    if (!memory.observedRivalBids) {
        memory.observedRivalBids = {};
    }
    var existing = memory.observedRivalBids[playerId];
    if (!existing || bidAmount >= existing.highestBid) {
        memory.observedRivalBids[playerId] = {
            bidderTeamId: rivalTeamId,
            highestBid: Math.max(bidAmount, (_a = existing === null || existing === void 0 ? void 0 : existing.highestBid) !== null && _a !== void 0 ? _a : 0),
            observedAt: Date.now()
        };
    }
}
/**
 * Reconstructs / Updates BotMemory based on authoritative state.
 * Idempotent: Can be called repeatedly on the same tick without double-counting.
 */
function syncBotMemoryWithState(auctionId, teamId, currentLotId, allLots // Expects array of lots with id, status, player_id, winning_team_id, winning_bid, players(role)
) {
    var _a;
    var memory = getBotMemory(auctionId, teamId);
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
        for (var _i = 0, allLots_1 = allLots; _i < allLots_1.length; _i++) {
            var lot = allLots_1[_i];
            if (lot.status === 'SOLD') {
                memory.processedCompletedLots.add(lot.id);
            }
        }
        memory.isInitialized = true;
        // Do not generate events for baseline lots
        return memory;
    }
    // 3. Process Newly Completed Lots for Purchases and Failed Targets
    for (var _b = 0, allLots_2 = allLots; _b < allLots_2.length; _b++) {
        var lot = allLots_2[_b];
        // Only process SOLD lots that we haven't seen finalize yet
        if (lot.status !== 'SOLD' || memory.processedCompletedLots.has(lot.id)) {
            continue;
        }
        var playerId = lot.player_id;
        var winnerId = lot.winning_team_id;
        var winningBid = lot.winning_bid || lot.base_price;
        var playerRole = ((_a = lot.players) === null || _a === void 0 ? void 0 : _a.role) || 'UNKNOWN';
        // Check if this bot was involved or won
        if (winnerId === teamId) {
            // It's an observed purchase!
            memory.purchases.push({
                playerId: playerId,
                amount: winningBid,
                role: playerRole,
                observedAt: Date.now()
            });
            // Reset lotsSinceLastPurchase explicitly on win
            memory.lotsSinceLastPurchase = 0;
        }
        else {
            // Rival purchase
            if (winnerId) {
                if (!memory.rivalPurchases)
                    memory.rivalPurchases = [];
                memory.rivalPurchases.push({
                    playerId: playerId,
                    winnerId: winnerId,
                    amount: winningBid,
                    role: playerRole,
                    observedAt: Date.now()
                });
            }
            // It's a loss. Did we actually bid on this player?
            var observation = memory.observedBids[playerId];
            if (observation) {
                memory.failedTargets.push({
                    playerId: playerId,
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
