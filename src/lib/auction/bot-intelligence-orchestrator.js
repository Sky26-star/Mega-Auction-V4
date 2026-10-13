"use strict";
// src/lib/auction/bot-intelligence-orchestrator.ts
//
// Phase 2I: Bot Intelligence Orchestrator & Cache
//
// PURPOSE:
//   Orchestrate the complete 2A → 2H pure intelligence pipeline.
//   Cache structural intelligence per bot.
//   Expose immutable, read-only intelligence context to future consumers.
//
// RESPONSIBILITY:
//   1. Accept BotIntelligenceInput.
//   2. Construct BotSquadState (2A) from raw inputs.
//   3. Execute the full 2A → 2B → 2C → 2D → 2E → 2F → 2G → 2H pipeline.
//   4. Compose all outputs into one immutable BotIntelligenceContext.
//   5. Cache per bot with deterministic structural fingerprinting.
//   6. Recompute only when structural inputs change.
//   7. Provide explicit cache invalidation and clear operations.
//
// THIS MODULE:
//   - Is standalone.
//   - Does NOT modify any existing auction behaviour.
//   - Does NOT integrate into the live auction tick.
//   - Does NOT make bidding decisions.
//   - Does NOT introduce new scoring or intelligence algorithms.
//   - Does NOT access the database or network.
//   - Does NOT modify any existing file.
//
// ARCHITECTURAL BOUNDARIES:
//   - Internal Structural Intelligence: 2A–2H (cached here)
//   - Live Market Intelligence: existing AuctionContext (NOT cached here)
//   - Decision Synthesis: future Phase 2J (NOT implemented here)
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeStructuralFingerprint = computeStructuralFingerprint;
exports.getBotIntelligenceContext = getBotIntelligenceContext;
exports.invalidateBotIntelligence = invalidateBotIntelligence;
exports.clearAllBotIntelligence = clearAllBotIntelligence;
exports.getCacheSize = getCacheSize;
exports.hasCachedIntelligence = hasCachedIntelligence;
// 2A–2H imports: call existing functions directly, zero algorithm duplication
var bot_squad_intelligence_1 = require("./bot-squad-intelligence");
var bot_role_gap_intelligence_1 = require("./bot-role-gap-intelligence");
var bot_squad_quality_intelligence_1 = require("./bot-squad-quality-intelligence");
var bot_squad_priority_intelligence_1 = require("./bot-squad-priority-intelligence");
var bot_squad_target_intelligence_1 = require("./bot-squad-target-intelligence");
var bot_squad_alternative_intelligence_1 = require("./bot-squad-alternative-intelligence");
var bot_squad_tradeoff_intelligence_1 = require("./bot-squad-tradeoff-intelligence");
var bot_squad_consequence_intelligence_1 = require("./bot-squad-consequence-intelligence");
// ============================================================
// STRUCTURAL FINGERPRINT
// ============================================================
/**
 * Compute a deterministic structural fingerprint from the intelligence input.
 *
 * The fingerprint captures every input that can affect the 2A–2H pipeline output:
 *
 *   1. team.id           — cache partition key
 *   2. team.purse        — affects spentRatio, purseRemaining in 2A
 *   3. team.initial_purse — affects spentRatio, amountSpent in 2A
 *   4. team.overseas_count — affects overseasSlotsRemaining in 2A
 *   5. team.players_bought — NOT used directly by 2A (2A uses roster.length),
 *                            but included for safety as it should always equal roster.length
 *   6. maxSquadSize      — affects remainingSlots and getRoleNeed scale in 2A
 *   7. maxOverseas       — affects overseasSlotsRemaining in 2A
 *   8. Roster composition — the actual role distribution (sorted for order-independence)
 *
 * The fingerprint does NOT include:
 *   - Current bid, highest bidder, opponent state (live market)
 *   - Auction progress, scarcity, timestamps (live market)
 *   - Future player pool (live market)
 *   - Personality, difficulty (decision-layer concerns)
 *
 * Roster fingerprint: We sort roles alphabetically so that different
 * array orderings of the same roster produce identical fingerprints.
 * Individual player identity within a role does not affect 2A–2H
 * (only role counts matter), so we encode role counts, not player IDs.
 */
function computeStructuralFingerprint(input) {
    var team = input.team, roster = input.roster, maxSquadSize = input.maxSquadSize, maxOverseas = input.maxOverseas;
    // Role composition: count per role, sorted deterministically
    var roleCounts = {};
    for (var _i = 0, roster_1 = roster; _i < roster_1.length; _i++) {
        var player = roster_1[_i];
        roleCounts[player.role] = (roleCounts[player.role] || 0) + 1;
    }
    // Sort by role name for deterministic ordering
    var sortedRoles = Object.keys(roleCounts).sort();
    var rosterFingerprint = sortedRoles
        .map(function (role) { return "".concat(role, ":").concat(roleCounts[role]); })
        .join(',');
    // Combine all structural inputs into a single deterministic string
    return [
        "t:".concat(team.id),
        "p:".concat(team.purse),
        "ip:".concat(team.initial_purse),
        "oc:".concat(team.overseas_count),
        "pb:".concat(team.players_bought),
        "ms:".concat(maxSquadSize),
        "mo:".concat(maxOverseas),
        "r:[".concat(rosterFingerprint, "]"),
    ].join('|');
}
// ============================================================
// PIPELINE EXECUTION
// ============================================================
/**
 * Execute the complete 2A → 2H intelligence pipeline.
 *
 * This calls the existing phase functions in exact dependency order.
 * Zero algorithm duplication — every function is the original export.
 *
 * Pipeline:
 *   2A: buildBotSquadState(team, roster, minimalCtx)
 *   2B: buildBotRoleGapState(squadState)
 *   2C: buildBotSquadQualityState(squadState)
 *   2D: buildBotSquadPriorityState(squadState, gapState, qualityState)
 *   2E: buildBotSquadTargetState(squadState, gapState, qualityState, priorityState)
 *   2F: buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState)
 *   2G: buildBotSquadTradeoffState(squadState, gapState, qualityState, priorityState, targetState, altState)
 *   2H: buildBotSquadConsequenceState(squadState, gapState, tradeoffState)
 *
 * All functions are synchronous, deterministic, and pure.
 */
function executePipeline(input) {
    var team = input.team, roster = input.roster, maxSquadSize = input.maxSquadSize, maxOverseas = input.maxOverseas;
    // Construct a minimal AuctionContext stub.
    // 2A only reads ctx.maxSquadSize and ctx.maxOverseas.
    // All other AuctionContext fields are live market data, irrelevant to structural intelligence.
    var minimalCtx = {
        maxSquadSize: maxSquadSize,
        maxOverseas: maxOverseas,
        // The following fields are NOT consumed by 2A but are required by the AuctionContext type.
        // They are set to inert defaults that cannot influence the pipeline.
        totalLots: 0,
        futurePlayers: [],
        futureByRole: {},
        futureOverseasCount: 0,
        futureAvgBasePrice: 0,
        futureMinBasePrice: 0,
        teamPurchasePrices: {},
        lotsCompleted: 0,
        lotsRemaining: 0,
        auctionProgress: 0,
        futureByRoleAndQuality: {},
        futureOverseasByRole: {},
    };
    // 2A: Squad State
    var squadState = (0, bot_squad_intelligence_1.buildBotSquadState)(team, roster, minimalCtx);
    // 2B: Role Gap
    var roleGapState = (0, bot_role_gap_intelligence_1.buildBotRoleGapState)(squadState);
    // 2C: Squad Quality
    var squadQualityState = (0, bot_squad_quality_intelligence_1.buildBotSquadQualityState)(squadState);
    // 2D: Squad Priority
    var squadPriorityState = (0, bot_squad_priority_intelligence_1.buildBotSquadPriorityState)(squadState, roleGapState, squadQualityState);
    // 2E: Squad Target
    var squadTargetState = (0, bot_squad_target_intelligence_1.buildBotSquadTargetState)(squadState, roleGapState, squadQualityState, squadPriorityState);
    // 2F: Squad Alternative
    var squadAlternativeState = (0, bot_squad_alternative_intelligence_1.buildBotSquadAlternativeState)(squadState, roleGapState, squadQualityState, squadPriorityState, squadTargetState);
    // 2G: Squad Trade-off
    var squadTradeoffState = (0, bot_squad_tradeoff_intelligence_1.buildBotSquadTradeoffState)(squadState, roleGapState, squadQualityState, squadPriorityState, squadTargetState, squadAlternativeState);
    // 2H: Squad Consequence
    var squadConsequenceState = (0, bot_squad_consequence_intelligence_1.buildBotSquadConsequenceState)(squadState, roleGapState, squadTradeoffState);
    // Compose the fingerprint for this context
    var fingerprint = computeStructuralFingerprint(input);
    return {
        teamId: team.id,
        fingerprint: fingerprint,
        squadState: squadState,
        roleGapState: roleGapState,
        squadQualityState: squadQualityState,
        squadPriorityState: squadPriorityState,
        squadTargetState: squadTargetState,
        squadAlternativeState: squadAlternativeState,
        squadTradeoffState: squadTradeoffState,
        squadConsequenceState: squadConsequenceState,
    };
}
// ============================================================
// DEEP CLONE (IMMUTABILITY BARRIER)
// ============================================================
/**
 * Produce a deep clone of a BotIntelligenceContext.
 *
 * This ensures that the returned context is structurally independent
 * from the cached copy. Consumers cannot accidentally mutate cached state
 * through shared object references.
 *
 * Uses JSON round-trip which is safe because all 2A–2H outputs are
 * plain data objects (no functions, no Date instances, no undefined values,
 * no circular references).
 */
function deepCloneContext(ctx) {
    return JSON.parse(JSON.stringify(ctx));
}
var cache = new Map();
// ============================================================
// PUBLIC API
// ============================================================
/**
 * Get the complete structural intelligence context for a bot.
 *
 * If the cached context has a matching structural fingerprint, returns
 * a deep clone of the cached context (cache hit).
 *
 * If the fingerprint differs or no cache exists, executes the full
 * 2A → 2H pipeline, stores the result, and returns a deep clone (cache miss).
 *
 * The input objects (team, roster) are NOT mutated.
 * The returned context is a structurally independent deep clone.
 * Mutating the returned context does NOT affect the cache.
 *
 * @param input - The bot's structural intelligence input
 * @returns A deep-cloned, immutable BotIntelligenceContext
 */
function getBotIntelligenceContext(input) {
    var fingerprint = computeStructuralFingerprint(input);
    var teamId = input.team.id;
    var cached = cache.get(teamId);
    if (cached && cached.fingerprint === fingerprint) {
        // Cache hit: structural inputs unchanged
        return deepCloneContext(cached.context);
    }
    // Cache miss: execute the full pipeline
    var context = executePipeline(input);
    // Store canonical copy in cache
    cache.set(teamId, { fingerprint: fingerprint, context: context });
    // Return deep clone so consumer cannot mutate cached state
    return deepCloneContext(context);
}
/**
 * Invalidate the cached intelligence for a specific team.
 *
 * After invalidation, the next call to getBotIntelligenceContext for this
 * team will unconditionally recompute the full pipeline.
 *
 * @param teamId - The team ID to invalidate
 * @returns true if a cache entry was removed, false if no entry existed
 */
function invalidateBotIntelligence(teamId) {
    return cache.delete(teamId);
}
/**
 * Clear all cached intelligence for all teams.
 *
 * Useful for auction lifecycle management (e.g., auction reset)
 * and testing teardown.
 */
function clearAllBotIntelligence() {
    cache.clear();
}
/**
 * Get the current number of cached intelligence entries.
 *
 * Useful for testing and diagnostics.
 */
function getCacheSize() {
    return cache.size;
}
/**
 * Check whether a cached entry exists for a given team.
 *
 * Does NOT validate fingerprint freshness. Only checks presence.
 * Useful for testing cache lifecycle.
 *
 * @param teamId - The team ID to check
 * @returns true if a cache entry exists (possibly stale)
 */
function hasCachedIntelligence(teamId) {
    return cache.has(teamId);
}
