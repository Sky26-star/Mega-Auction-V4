"use strict";
// src/lib/auction/bot-brain-state.ts
//
// Phase 1C: Bot Brain State Updater
//
// Sits ABOVE BotMemory, BELOW future strategic integration.
// Produces BotBeliefs + BotPlan from authoritative auction state + BotMemory.
//
// THIS LAYER IS OBSERVATIONAL/PLANNING-ONLY.
// It does NOT modify evaluateBotsForLot() behaviour.
// It does NOT modify BotMemory.
// It does NOT make network calls or write to the database.
Object.defineProperty(exports, "__esModule", { value: true });
exports.replanBotState = void 0;
exports.getBotBrainState = getBotBrainState;
exports.clearInactiveBrainStateCache = clearInactiveBrainStateCache;
exports.clearBrainStateCache = clearBrainStateCache;
exports.updateBotBrainState = updateBotBrainState;
var bot_brain_memory_1 = require("./bot-brain-memory");
var server_bot_engine_1 = require("./server-bot-engine");
// ============================================================
// BELIEF CALCULATIONS
// ============================================================
/**
 * Compute current-lot market price pressure (see BotBeliefs.marketInflation).
 *
 * This measures the CURRENT lot's price premium relative to its base price.
 * It is NOT a historical market inflation rate â€” it uses only the current
 * lot's currentBid and basePrice, which are observable right now.
 *
 * Formula:
 *   ratio = currentBid / basePrice
 *   pressure = clamp((ratio - 1) / 5, 0, 2)
 *
 * At base price (ratio=1): pressure = 0.0
 * At 3Ã— base  (ratio=3):  pressure = 0.4
 * At 6Ã— base  (ratio=6):  pressure = 1.0
 * At 11Ã— base (ratio=11): pressure = 2.0 (capped)
 *
 * Returns neutral 0.0 when no current bid exists or bid â‰¤ base price.
 */
function computeMarketInflation(currentBid, basePrice) {
    if (basePrice <= 0 || currentBid <= 0)
        return 0.0;
    var ratio = currentBid / basePrice;
    return Math.min(2.0, Math.max(0.0, (ratio - 1) / 5));
}
/**
 * Compute role scarcity panic for the bot regarding the current player's role.
 * Uses the existing getRoleNeed() from server-bot-engine as the authority on role needs.
 *
 * Mapping from RoleNeed to panic:
 *   CRITICAL  â†’ 1.0
 *   HIGH      â†’ 0.7
 *   NORMAL    â†’ 0.3
 *   LOW       â†’ 0.1
 *   REDUNDANT â†’ 0.0
 */
function computeRoleScarcityPanic(playerRole, botRoster, maxSquadSize, playersBought) {
    var roleCount = botRoster.filter(function (p) { return p.role === playerRole; }).length;
    var remainingSlots = Math.max(0, maxSquadSize - playersBought);
    var need = (0, server_bot_engine_1.getRoleNeed)(playerRole, roleCount, remainingSlots, maxSquadSize).need;
    return roleNeedToPanic(need);
}
function roleNeedToPanic(need) {
    switch (need) {
        case 'CRITICAL': return 1.0;
        case 'HIGH': return 0.7;
        case 'NORMAL': return 0.3;
        case 'LOW': return 0.1;
        case 'REDUNDANT': return 0.0;
        default: return 0.3;
    }
}
/**
 * Compute rival aggression estimate.
 * Uses currently visible information only:
 *   - How many other eligible teams can afford the next bid
 *   - Whether those teams also need this role
 *   - Current bid pressure (bid vs base price)
 *
 * Formula:
 *   eligibleRivals = teams that can afford the next bid, have squad/overseas room
 *   thirstyRivals  = eligible rivals with CRITICAL or HIGH need for this role
 *   rivalPressure  = clamp(thirstyRivals / 3, 0, 0.6) + clamp(bidPressure, 0, 0.4)
 *   where bidPressure = min(0.4, (currentBid / basePrice - 1) / 10)
 */
function computeRivalAggression(bot, currentBid, basePrice, nextBidAmount, playerRole, playerIsOverseas, allTeams, teamRosters, maxSquadSize, maxOverseas) {
    var thirstyRivals = 0;
    for (var _i = 0, allTeams_1 = allTeams; _i < allTeams_1.length; _i++) {
        var team = allTeams_1[_i];
        if (team.id === bot.id)
            continue;
        if (team.purse < nextBidAmount)
            continue;
        if (team.players_bought >= maxSquadSize)
            continue;
        if (playerIsOverseas && team.overseas_count >= maxOverseas)
            continue;
        var roster = teamRosters[team.id] || [];
        var roleCount = roster.filter(function (p) { return p.role === playerRole; }).length;
        var remainingSlots = Math.max(0, maxSquadSize - team.players_bought);
        var need = (0, server_bot_engine_1.getRoleNeed)(playerRole, roleCount, remainingSlots, maxSquadSize).need;
        if (need === 'CRITICAL' || need === 'HIGH') {
            thirstyRivals++;
        }
    }
    var rivalComponent = Math.min(0.6, thirstyRivals / 3);
    var bidPressure = basePrice > 0 && currentBid > 0
        ? Math.min(0.4, (currentBid / basePrice - 1) / 10)
        : 0;
    return Math.min(1.0, Math.max(0.0, rivalComponent + bidPressure));
}
/**
 * Compute estimated squad quality from the bot's current roster.
 * Uses computePlayerRating indirectly via a simple heuristic:
 *   average the category-based quality estimate for owned players.
 *
 * We do NOT call computePlayerRating here to avoid importing player-rating.ts
 * and to keep this lightweight. Instead we use the same categoryâ†’quality mapping
 * that the existing bot engine uses (estimateQualityFromCategory).
 *
 * Quality is normalized: (avgRating - 74) / 24  â†’  0.0 to 1.0
 * where 74 is the rating floor and 98 is the ceiling per player-rating.ts.
 *
 * Empty roster â†’ 0.0
 */
function computeEstimatedSquadQuality(botRoster) {
    if (botRoster.length === 0)
        return 0.0;
    var totalEst = 0;
    for (var _i = 0, botRoster_1 = botRoster; _i < botRoster_1.length; _i++) {
        var p = botRoster_1[_i];
        totalEst += estimateQualityFromCategoryLocal(p.category);
    }
    var avgRating = totalEst / botRoster.length;
    // Normalize to 0.0â€“1.0 range (rating system bounds: 74â€“98)
    return Math.min(1.0, Math.max(0.0, (avgRating - 74) / 24));
}
/**
 * Local copy of the categoryâ†’quality mapping from server-bot-engine.ts.
 * We duplicate this small lookup to avoid adding a dependency on a function
 * that the instructions say not to import from (keeping server-bot-engine untouched).
 */
function estimateQualityFromCategoryLocal(category) {
    var cat = (category || '').toUpperCase();
    if (cat === 'MARQUEE' || cat === 'ICON')
        return 88;
    if (cat === 'A' || cat === 'ELITE')
        return 85;
    if (cat === 'B' || cat === 'PREMIER')
        return 82;
    if (cat === 'C' || cat === 'CORE')
        return 79;
    if (cat === 'D' || cat === 'RISING')
        return 76;
    return 78;
}
// ============================================================
// PLAN CALCULATIONS
// ============================================================
/**
 * Compute urgency from memory, beliefs, and squad state.
 *
 * Factors:
 *   - lotsSinceLastPurchase: more lots without buying â†’ more urgent
 *   - remaining squad slots vs auction progress
 *   - roleScarcityPanic: critical needs amplify urgency
 *   - failedTargets count: losing targets increases desperation
 *
 * Formula:
 *   base = clamp(lotsSinceLastPurchase / 8, 0, 0.4)
 *   slotPressure = clamp((1 - slotsFilledRatio) * auctionProgress * 0.8, 0, 0.3)
 *   rolePanic = roleScarcityPanic * 0.2
 *   failedPenalty = clamp(failedTargets.length / 10, 0, 0.1)
 *   urgency = clamp(base + slotPressure + rolePanic + failedPenalty, 0, 1)
 */
function computeUrgency(memory, beliefs, playersBought, maxSquadSize, auctionProgress) {
    var lotsDry = Math.min(0.4, memory.lotsSinceLastPurchase / 8);
    var slotsFilledRatio = maxSquadSize > 0 ? playersBought / maxSquadSize : 0;
    var slotPressure = Math.min(0.3, (1 - slotsFilledRatio) * auctionProgress * 0.8);
    var rolePanic = beliefs.roleScarcityPanic * 0.2;
    var failedPenalty = Math.min(0.1, memory.failedTargets.length / 10);
    return Math.min(1.0, Math.max(0.0, lotsDry + slotPressure + rolePanic + failedPenalty));
}
/**
 * Compute strategic reservation estimate (see BudgetAllocation).
 *
 * This is a FIRST-STEP strategic signal only. It estimates how much purse
 * the bot should conceptually preserve for remaining critical/high role needs.
 *
 * reserveForCriticalNeeds:
 *   Estimated minimum cost to fill unfilled critical/high roles.
 *   Uses futureMinBasePrice as a conservative floor per needed slot.
 *   This is a rough heuristic â€” NOT a full budget planner.
 *
 * discretionaryBudget:
 *   purse minus the strategic reserve estimate.
 *
 * IMPORTANT â€” NON-AUTHORITATIVE:
 * This calculation is purely advisory. It MUST NEVER override:
 *   - actual purse validation (V3Team.purse is authoritative)
 *   - minimum bid or bid increment rules
 *   - squad size or overseas limits
 *   - hard valuation clamps in server-bot-engine.ts
 *   - auction settlement rules
 *
 * Future phases may add target-specific reservations, cross-set budgeting,
 * or portfolio allocation. Those are NOT part of Phase 1C.
 */
function computeBudgetAllocation(bot, botRoster, maxSquadSize, ctx) {
    var spentRatio = bot.initial_purse > 0
        ? (bot.initial_purse - bot.purse) / bot.initial_purse
        : 0;
    // Estimate how many critical/high-need role slots remain unfilled
    var roleCounts = {};
    for (var _i = 0, botRoster_2 = botRoster; _i < botRoster_2.length; _i++) {
        var p = botRoster_2[_i];
        roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
    }
    var roles = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
    var criticalSlots = 0;
    var remainingSlots = Math.max(0, maxSquadSize - bot.players_bought);
    for (var _a = 0, roles_1 = roles; _a < roles_1.length; _a++) {
        var role = roles_1[_a];
        var count = roleCounts[role] || 0;
        var need = (0, server_bot_engine_1.getRoleNeed)(role, count, remainingSlots, maxSquadSize).need;
        if (need === 'CRITICAL')
            criticalSlots += 2;
        else if (need === 'HIGH')
            criticalSlots += 1;
    }
    var reserveForCriticalNeeds = criticalSlots * Math.max(ctx.futureMinBasePrice, 20);
    var discretionaryBudget = Math.max(0, bot.purse - reserveForCriticalNeeds);
    return Object.freeze({
        totalRemaining: bot.purse,
        reserveForCriticalNeeds: reserveForCriticalNeeds,
        discretionaryBudget: discretionaryBudget,
        spentRatio: spentRatio,
    });
}
/**
 * Determine strategic focus from auction state and beliefs.
 *
 * Logic (deterministic, checked in order):
 *   1. auctionProgress > 0.80               â†’ LATE_AUCTION
 *   2. spentRatio > 0.70 and urgency < 0.5  â†’ PROTECT_PURSE
 *   3. roleScarcityPanic >= 0.7             â†’ FILL_GAPS
 *   4. marketInflation < 0.2 and urgency < 0.4 â†’ TARGET_VALUE
 *   5. default                               â†’ BUILD_CORE
 */
function computeStrategicFocus(beliefs, urgency, spentRatio, auctionProgress) {
    if (auctionProgress > 0.80)
        return 'LATE_AUCTION';
    if (spentRatio > 0.70 && urgency < 0.5)
        return 'PROTECT_PURSE';
    if (beliefs.roleScarcityPanic >= 0.7)
        return 'FILL_GAPS';
    if (beliefs.marketInflation < 0.2 && urgency < 0.4)
        return 'TARGET_VALUE';
    return 'BUILD_CORE';
}
/**
 * Determine whether the bot would sacrifice an overseas slot for quality.
 *
 * Deterministic rule:
 *   true if overseas headroom is >= 3 AND squad quality is below 0.4
 *   (meaning the bot has plenty of overseas room and needs quality upgrades)
 */
function computeWillSacrificeOverseas(overseasCount, maxOverseas, squadQuality) {
    var headroom = maxOverseas - overseasCount;
    return headroom >= 3 && squadQuality < 0.4;
}
// ============================================================
// BOT BRAIN STATE CACHE
// ============================================================
//
// Authoritative in-memory cache for the LATEST BotBrainState snapshot
// per auction + team. This is NOT a history system â€” each update
// REPLACES the previous snapshot entirely.
//
// State ownership:
//   PAST EVENTS        â†’ BotMemory (bot-brain-memory.ts)
//   CURRENT BELIEFS    â†’ BotBrainState.beliefs (this cache)
//   CURRENT PLAN       â†’ BotBrainState.plan (this cache)
//
// Do NOT copy BotMemory arrays into this cache.
// Do NOT create separate caches for beliefs, plans, purchases, etc.
//
// Cleanup uses the same auction lifecycle boundary as BotMemory.
// ============================================================
/** Cache key: "auctionId_teamId" â†’ latest frozen BotBrainState */
var globalForBotBrainState = globalThis;
var brainStateCache = globalForBotBrainState.__BOT_BRAIN_STATE_CACHE__ || new Map();
if (!globalForBotBrainState.__BOT_BRAIN_STATE_CACHE__) {
    globalForBotBrainState.__BOT_BRAIN_STATE_CACHE__ = brainStateCache;
}
function brainStateCacheKey(auctionId, teamId) {
    return "".concat(auctionId, "_").concat(teamId);
}
/**
 * Retrieve the latest cached BotBrainState snapshot for a given bot.
 *
 * Returns a frozen (read-only) object, or undefined if no state has
 * been calculated yet for this auction + team combination.
 *
 * Callers MUST NOT use the returned state to influence
 * evaluateBotsForLot() in Phase 1D. The state is observational only.
 */
function getBotBrainState(auctionId, teamId) {
    return brainStateCache.get(brainStateCacheKey(auctionId, teamId));
}
/**
 * Clear cached BotBrainState entries for auctions that are no longer active.
 *
 * Uses the same cleanup boundary as clearInactiveAuctionMemory() in
 * bot-brain-memory.ts â€” any auction NOT in the provided activeAuctionIds
 * set has its cached state removed.
 *
 * This ensures the BotBrainState cache does not leak memory for
 * completed/cancelled auctions and shares the same lifecycle as BotMemory.
 */
function clearInactiveBrainStateCache(activeAuctionIds) {
    for (var _i = 0, _a = Array.from(brainStateCache.keys()); _i < _a.length; _i++) {
        var key = _a[_i];
        var auctionId = key.split('_')[0];
        if (auctionId && !activeAuctionIds.has(auctionId)) {
            brainStateCache.delete(key);
        }
    }
}
/**
 * Clear ALL cached BotBrainState entries. Used by tests.
 */
function clearBrainStateCache() {
    brainStateCache.clear();
}
/**
 * Compute the full BotBrainState (memory + beliefs + plan) and cache it.
 *
 * - Synchronous
 * - No network calls
 * - No database writes
 * - Does NOT mutate BotMemory
 * - Deterministic given same inputs
 * - REPLACES the previous cached snapshot for this auction + team
 */
function updateBotBrainState(input) {
    var auctionId = input.auctionId, teamId = input.teamId, bot = input.bot, botRoster = input.botRoster, currentBid = input.currentBid, basePrice = input.basePrice, playerRole = input.playerRole, playerIsOverseas = input.playerIsOverseas, allTeams = input.allTeams, teamRosters = input.teamRosters, ctx = input.ctx;
    // 1. Obtain existing memory (read-only consumption)
    var memory = (0, bot_brain_memory_1.getBotMemory)(auctionId, teamId);
    // 2. Compute next bid amount for rival analysis
    //
    // TODO: TEMPORARY TECHNICAL DEBT â€” Local bid-increment duplication.
    // The authoritative bid-increment logic lives in getNextBidAmount()
    // in server-bot-engine.ts. This is a local copy used ONLY for rival
    // eligibility estimation within BotBeliefs. It is NOT an auction-rule
    // authority and MUST NEVER control actual bidding.
    //
    // This duplication exists because server-bot-engine.ts must not be
    // modified in Phase 1C. It should be consolidated when a safe
    // read-only shared helper is available (e.g. a shared utils module
    // or when Phase 1E integration exposes it).
    var nextBidAmount;
    if (currentBid === 0) {
        nextBidAmount = basePrice;
    }
    else {
        var inc = 200;
        if (currentBid <= 300)
            inc = 25;
        else if (currentBid <= 600)
            inc = 50;
        else if (currentBid <= 1000)
            inc = 75;
        else if (currentBid <= 1500)
            inc = 100;
        else if (currentBid <= 2000)
            inc = 150;
        else if (currentBid <= 2500)
            inc = 175;
        nextBidAmount = currentBid + inc;
    }
    // 3. Calculate BotBeliefs
    var beliefs = {
        marketInflation: computeMarketInflation(currentBid, basePrice),
        roleScarcityPanic: computeRoleScarcityPanic(playerRole, botRoster, ctx.maxSquadSize, bot.players_bought),
        rivalAggression: computeRivalAggression(bot, currentBid, basePrice, nextBidAmount, playerRole, playerIsOverseas, allTeams, teamRosters, ctx.maxSquadSize, ctx.maxOverseas),
        estimatedSquadQuality: computeEstimatedSquadQuality(botRoster),
    };
    // 4. Calculate BotPlan
    var budgetAllocation = computeBudgetAllocation(bot, botRoster, ctx.maxSquadSize, ctx);
    var urgency = computeUrgency(memory, beliefs, bot.players_bought, ctx.maxSquadSize, ctx.auctionProgress);
    var strategicFocus = computeStrategicFocus(beliefs, urgency, budgetAllocation.spentRatio, ctx.auctionProgress);
    var willSacrificeOverseasForQuality = computeWillSacrificeOverseas(bot.overseas_count, ctx.maxOverseas, beliefs.estimatedSquadQuality);
    var plan = {
        urgency: urgency,
        budgetAllocation: budgetAllocation,
        strategicFocus: strategicFocus,
        willSacrificeOverseasForQuality: willSacrificeOverseasForQuality,
    };
    var state = { memory: memory, beliefs: beliefs, plan: plan };
    // 5. Cache the latest snapshot (REPLACEMENT, not accumulation).
    //    Freeze beliefs and plan (including nested budgetAllocation) so
    //    callers of getBotBrainState() cannot mutate cached strategic state.
    //    NOTE: BotMemory is NOT frozen â€” it is owned by Phase 1B and must
    //    remain mutable through its existing memory-management functions.
    Object.freeze(beliefs);
    // budgetAllocation is already frozen via Object.freeze() in computeBudgetAllocation,
    // but freeze it explicitly here for defense-in-depth.
    Object.freeze(plan.budgetAllocation);
    Object.freeze(plan);
    var frozenState = Object.freeze(state);
    brainStateCache.set(brainStateCacheKey(auctionId, teamId), frozenState);
    return frozenState;
}
/**
 * Re-evaluates and replans the bot's strategic brain state (beliefs + plan)
 * incorporating the latest factual BotMemory observations.
 * Semantic alias for updateBotBrainState representing the B17-B replanning phase.
 */
exports.replanBotState = updateBotBrainState;
