"use strict";
// src/lib/auction/bot-squad-intelligence.ts
//
// Phase 2A: Squad State Model
//
// Provides a clean, deterministic, derived read model of a bot's
// current squad composition. This is NOT a database model, NOT a
// replacement for V3Team, and NOT authoritative for auction rules.
//
// It is a strategic snapshot consumed by future phases (2B–2I).
//
// THIS MODULE IS STANDALONE.
// It does NOT modify any existing auction behaviour.
// It does NOT integrate into the live auction tick.
// It does NOT make bidding decisions.
// It does NOT access the database or network.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotSquadState = buildBotSquadState;
var server_bot_engine_1 = require("./server-bot-engine");
// ============================================================
// PUBLIC API
// ============================================================
/**
 * Build a BotSquadState snapshot from authoritative auction data.
 *
 * - Synchronous
 * - Deterministic (same input → same output)
 * - Pure (no side effects)
 * - Does NOT mutate bot, botRoster, or ctx
 * - Does NOT access the database or network
 * - Does NOT make bidding decisions
 *
 * @param bot        - The bot's V3Team (authoritative for purse/overseas)
 * @param botRoster  - The bot's current purchased players
 * @param ctx        - AuctionContext (authoritative for maxSquadSize/maxOverseas)
 */
function buildBotSquadState(bot, botRoster, ctx) {
    // --- Squad size ---
    var squadSize = botRoster.length;
    var remainingSlots = Math.max(0, ctx.maxSquadSize - squadSize);
    // --- Purse ---
    var purseRemaining = bot.purse;
    var amountSpent = Math.max(0, bot.initial_purse - bot.purse);
    var spentRatio = bot.initial_purse > 0
        ? Math.min(1, Math.max(0, amountSpent / bot.initial_purse))
        : 0;
    // --- Overseas ---
    var overseasCount = bot.overseas_count;
    var overseasSlotsRemaining = Math.max(0, ctx.maxOverseas - overseasCount);
    // --- Role composition ---
    // Count only valid roles. Invalid/unknown roles are silently excluded.
    var roleCounts = {
        BATSMAN: 0,
        BOWLER: 0,
        ALL_ROUNDER: 0,
        WICKET_KEEPER: 0,
    };
    for (var _i = 0, botRoster_1 = botRoster; _i < botRoster_1.length; _i++) {
        var player = botRoster_1[_i];
        if (player.role in roleCounts) {
            roleCounts[player.role]++;
        }
        // Invalid roles are silently ignored — no arbitrary keys created
    }
    var roleComposition = {
        BATSMAN: roleCounts['BATSMAN'],
        BOWLER: roleCounts['BOWLER'],
        ALL_ROUNDER: roleCounts['ALL_ROUNDER'],
        WICKET_KEEPER: roleCounts['WICKET_KEEPER'],
    };
    // --- Role needs ---
    // Reuse the existing getRoleNeed() from server-bot-engine.ts.
    // DO NOT duplicate or override its logic.
    var roleNeeds = {
        BATSMAN: (0, server_bot_engine_1.getRoleNeed)('BATSMAN', roleComposition.BATSMAN, remainingSlots, ctx.maxSquadSize).need,
        BOWLER: (0, server_bot_engine_1.getRoleNeed)('BOWLER', roleComposition.BOWLER, remainingSlots, ctx.maxSquadSize).need,
        ALL_ROUNDER: (0, server_bot_engine_1.getRoleNeed)('ALL_ROUNDER', roleComposition.ALL_ROUNDER, remainingSlots, ctx.maxSquadSize).need,
        WICKET_KEEPER: (0, server_bot_engine_1.getRoleNeed)('WICKET_KEEPER', roleComposition.WICKET_KEEPER, remainingSlots, ctx.maxSquadSize).need,
    };
    return {
        teamId: bot.id,
        squadSize: squadSize,
        remainingSlots: remainingSlots,
        purseRemaining: purseRemaining,
        amountSpent: amountSpent,
        spentRatio: spentRatio,
        overseasCount: overseasCount,
        overseasSlotsRemaining: overseasSlotsRemaining,
        roleComposition: roleComposition,
        roleNeeds: roleNeeds,
    };
}
