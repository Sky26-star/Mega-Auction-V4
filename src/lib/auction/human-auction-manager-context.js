"use strict";
// src/lib/auction/human-auction-manager-context.ts
//
// Human Auction Manager — Phase 2: CONTEXT ASSEMBLY
//
// PURPOSE:
//   Connect existing Mega Auction V3 data sources to the Human Auction Manager
//   contracts defined in Phase 1.
//
// RESPONSIBILITY:
//   - Provide pure adapter functions mapping raw V3 objects to new Phase 1 types.
//   - Ensure hard structural boundaries (e.g., no opponent data in MarketValue).
//   - Zero modification of existing valuation formulas or runtime behaviours.
//
// EXPLICIT INPUT/OUTPUT CONTRACTS:
//   Every adapter has a defined input type and strictly returns the Phase 1 context shape.
Object.defineProperty(exports, "__esModule", { value: true });
exports.assemblePlayerContext = assemblePlayerContext;
exports.assemblePlayerQualityContext = assemblePlayerQualityContext;
exports.assemblePlayerQualityResult = assemblePlayerQualityResult;
exports.assembleMarketValueContext = assembleMarketValueContext;
exports.assembleTeamNeedContext = assembleTeamNeedContext;
exports.assembleXIImprovementContext = assembleXIImprovementContext;
exports.assemblePlayerScarcityContext = assemblePlayerScarcityContext;
exports.assembleTeamFitContext = assembleTeamFitContext;
exports.assembleFuturePlanContext = assembleFuturePlanContext;
exports.assemblePursePositionContext = assemblePursePositionContext;
exports.assembleAuctionStage = assembleAuctionStage;
exports.assembleOpponentContext = assembleOpponentContext;
exports.assembleTeamValueContext = assembleTeamValueContext;
exports.assembleMaximumBidContext = assembleMaximumBidContext;
exports.assembleDecisionContext = assembleDecisionContext;
exports.assembleHumanAuctionManagerContext = assembleHumanAuctionManagerContext;
var server_bot_engine_1 = require("./server-bot-engine");
var bot_candidate_alignment_1 = require("./bot-candidate-alignment");
var bot_q_engine_1 = require("./bot-q-engine");
// ============================================================
// 1. PLAYER CONTEXT ADAPTER
// ============================================================
function assemblePlayerContext(player) {
    return {
        id: player.id,
        name: player.name,
        role: player.role,
        category: player.category,
        base_price: player.base_price,
        is_overseas: player.is_overseas,
        rating: player.rating,
    };
}
// ============================================================
// 2. PLAYER QUALITY ADAPTER
// ============================================================
function assemblePlayerQualityContext(player) {
    return {
        player: assemblePlayerContext(player)
    };
}
function assemblePlayerQualityResult(ctx) {
    var ratingSource = ctx.player.rating != null ? 'STORED_RATING' : 'CATEGORY_ESTIMATE';
    var rating = ctx.player.rating != null
        ? ctx.player.rating
        : (0, server_bot_engine_1.estimateQualityFromCategory)(ctx.player.category);
    return {
        playerId: ctx.player.id,
        role: ctx.player.role,
        rating: rating,
        ratingSource: ratingSource,
        tier: ctx.player.category,
        confidence: 1.0 // Legacy engine has no confidence concept, default to 1.0
    };
}
function assembleMarketValueContext(inputs) {
    var _a, _b;
    return {
        player: assemblePlayerContext(inputs.player),
        quality: inputs.quality,
        market: {
            remainingRolePoolCount: ((_b = (_a = inputs.auctionCtx) === null || _a === void 0 ? void 0 : _a.futureByRole) === null || _b === void 0 ? void 0 : _b[inputs.player.role]) || 0
        }
    };
}
function assembleTeamNeedContext(inputs) {
    var _a, _b;
    var currentRoleCount = inputs.roster.filter(function (p) { return p.role === inputs.playerRole; }).length;
    var remainingSquadSlots = Math.max(0, inputs.maxSquadSize - inputs.roster.length);
    // Get bounds from the existing authoritative Q-engine
    var bounds = (0, bot_q_engine_1.getRoleTargetBounds)(inputs.maxSquadSize);
    var roleBounds = bounds[inputs.playerRole] || { min: 2, ideal: 5 };
    // Run the existing logic to get legacy need
    var legacyNeedResult = (0, server_bot_engine_1.getRoleNeed)(inputs.playerRole, currentRoleCount, remainingSquadSlots, inputs.maxSquadSize);
    var legacyNeed = legacyNeedResult.need;
    var level = 'NOT_NEEDED';
    if (legacyNeed === 'CRITICAL')
        level = 'CRITICAL';
    else if (legacyNeed === 'HIGH')
        level = 'IMPORTANT';
    else if (legacyNeed === 'NORMAL')
        level = 'USEFUL';
    else if (legacyNeed === 'LOW')
        level = 'OPTIONAL';
    else if (legacyNeed === 'REDUNDANT')
        level = 'NOT_NEEDED';
    return {
        role: inputs.playerRole,
        level: level,
        currentRoleCount: currentRoleCount,
        requiredRoleCount: roleBounds.min,
        idealRoleCount: roleBounds.ideal,
        remainingSquadSlots: remainingSquadSlots,
        legacyRoleNeed: legacyNeed,
        rolePriority: (_b = (_a = inputs.botIntelligence) === null || _a === void 0 ? void 0 : _a.squadPriorityState.roles[inputs.playerRole]) === null || _b === void 0 ? void 0 : _b.priorityLevel
    };
}
// ============================================================
// 5. XI IMPROVEMENT ADAPTER
// ============================================================
function assembleXIImprovementContext(quality) {
    // Legacy system does not have explicit XI simulation, map via raw rating heuristics
    var level = 'NONE';
    if (quality.rating >= 92)
        level = 'TRANSFORMATIVE';
    else if (quality.rating >= 88)
        level = 'MAJOR_UPGRADE';
    else if (quality.rating >= 82)
        level = 'USEFUL_STARTER';
    else if (quality.rating >= 78)
        level = 'DEPTH';
    return {
        level: level
    };
}
function assemblePlayerScarcityContext(inputs) {
    var _a, _b, _c;
    var rolePoolRemaining = ((_b = (_a = inputs.auctionCtx) === null || _a === void 0 ? void 0 : _a.futureByRole) === null || _b === void 0 ? void 0 : _b[inputs.playerRole]) || 0;
    // Pull alternative intelligence if available
    var altAvail = (_c = inputs.botIntelligence) === null || _c === void 0 ? void 0 : _c.squadAlternativeState.alternativeAvailability;
    var level = 'NORMAL';
    if (altAvail === 'NO_MEANINGFUL_ALTERNATIVE')
        level = 'VERY_SCARCE';
    else if (altAvail === 'LIMITED_ALTERNATIVES')
        level = 'SCARCE';
    else if (altAvail === 'ALTERNATIVES_AVAILABLE')
        level = 'ABUNDANT';
    return {
        level: level,
        meaningfulAlternativesRemaining: rolePoolRemaining, // Approximation from legacy
        alternativeAvailability: altAvail,
        rolePoolRemaining: rolePoolRemaining
    };
}
function assembleTeamFitContext(inputs) {
    var level = 'NEUTRAL';
    var structuralFit = undefined;
    if (inputs.botIntelligence) {
        var alignment = (0, bot_candidate_alignment_1.computeCandidateAlignment)({
            candidateRole: inputs.playerRole,
            targetState: inputs.botIntelligence.squadTargetState,
            alternativeState: inputs.botIntelligence.squadAlternativeState
        });
        structuralFit = alignment.structuralFit;
        if (structuralFit === 'EXACT_PRIMARY_TARGET' || structuralFit === 'EXACT_SECONDARY_TARGET') {
            level = 'EXCELLENT';
        }
        else if (structuralFit === 'NON_PRIORITY_TARGET' || structuralFit === 'FALLBACK_PARTIAL') {
            level = 'GOOD';
        }
        else if (structuralFit === 'LOW_PRIORITY_TARGET' || structuralFit === 'FALLBACK_WEAK') {
            level = 'NEUTRAL';
        }
        else if (structuralFit === 'REDUNDANT_ROLE' || structuralFit === 'STRUCTURAL_MISMATCH') {
            level = 'POOR';
        }
    }
    return {
        level: level,
        structuralFit: structuralFit
    };
}
function assembleFuturePlanContext(inputs) {
    var remainingSquadSlots = Math.max(0, inputs.maxSquadSize - inputs.roster.length);
    var minRequiredSpend = remainingSquadSlots * 20;
    // By default without a dedicated future budget engine, protect the minimum
    var priority = 'OPTIONAL';
    var protectedFutureBudget = minRequiredSpend;
    var remainingCriticalTargets = 0;
    var futureRequiredRoles = [];
    if (inputs.botIntelligence) {
        var criticalTargets = Object.values(inputs.botIntelligence.squadPriorityState.roles).filter(function (p) { return p.priorityLevel === 'CRITICAL'; });
        remainingCriticalTargets = criticalTargets.length;
        if (criticalTargets.length > 0) {
            priority = 'MUST_HAVE';
            protectedFutureBudget = Math.max(minRequiredSpend, criticalTargets.length * 400); // Heuristic
            for (var _i = 0, criticalTargets_1 = criticalTargets; _i < criticalTargets_1.length; _i++) {
                var target = criticalTargets_1[_i];
                futureRequiredRoles.push({
                    role: target.role, // Cast to V3PlayerRole if needed, assuming they align
                    count: 1 // Default approximation, not strict for Phase 4 yet
                });
            }
        }
    }
    return {
        priority: priority,
        futureRequiredRoles: futureRequiredRoles,
        protectedFutureBudget: protectedFutureBudget,
        remainingCriticalTargets: remainingCriticalTargets
    };
}
function assemblePursePositionContext(inputs) {
    var remainingSquadSlots = Math.max(0, inputs.maxSquadSize - inputs.team.players_bought);
    var minimumRequiredFutureSpend = remainingSquadSlots * 20;
    var health = 'SAFE';
    if (inputs.team.purse < minimumRequiredFutureSpend + 200)
        health = 'DANGEROUS';
    else if (inputs.team.purse < minimumRequiredFutureSpend + 1000)
        health = 'TIGHT';
    return {
        currentPurse: inputs.team.purse,
        initialPurse: inputs.team.initial_purse,
        remainingSquadSlots: remainingSquadSlots,
        minimumRequiredFutureSpend: minimumRequiredFutureSpend,
        health: health
    };
}
// ============================================================
// 10. AUCTION STAGE ADAPTER
// ============================================================
function assembleAuctionStage(auctionCtx) {
    if (auctionCtx.auctionProgress < 0.25)
        return 'EARLY';
    if (auctionCtx.auctionProgress < 0.65)
        return 'MID';
    if (auctionCtx.auctionProgress < 0.90)
        return 'LATE';
    return 'ENDGAME';
}
// ============================================================
// 11. OPPONENT CONTEXT ADAPTER
// ============================================================
var human_auction_decision_context_1 = require("./human-auction-decision-context");
function assembleOpponentContext(inputs) {
    return (0, human_auction_decision_context_1.evaluateOpponentContext)({
        allTeams: inputs.allTeams,
        teamRosters: inputs.teamRosters,
        highestBidderTeamId: inputs.highestBidderTeamId,
        myTeamId: inputs.myTeamId,
        candidatePlayer: inputs.candidatePlayer,
        currentBid: inputs.currentBid,
        nextRequiredBid: inputs.nextRequiredBid,
        maxSquadSize: inputs.maxSquadSize,
        rivalPurchases: inputs.rivalPurchases
    });
}
function assembleTeamValueContext(inputs) {
    return {
        teamId: inputs.teamId,
        player: inputs.player,
        marketValue: inputs.marketValueResult,
        need: inputs.teamNeed,
        xiImprovement: inputs.xiImprovement,
        scarcity: inputs.scarcity,
        teamFit: inputs.teamFit,
        futurePlan: inputs.futurePlan,
        currentRoster: inputs.currentRoster
    };
}
function assembleMaximumBidContext(inputs) {
    return {
        teamValue: inputs.teamValue,
        purse: inputs.purse,
        auctionStage: inputs.auctionStage,
        currentBid: inputs.currentBid,
        nextRequiredBid: inputs.nextRequiredBid,
        futureBudget: inputs.futureBudget
    };
}
function assembleDecisionContext(inputs) {
    return (0, human_auction_decision_context_1.buildDecisionContext)({
        player: inputs.player,
        marketValue: inputs.marketValue,
        teamValue: inputs.teamValue,
        maximumBid: inputs.maximumBid,
        opponent: inputs.opponent,
        currentBid: inputs.currentBid,
        nextRequiredBid: inputs.nextRequiredBid,
        auctionStage: inputs.auctionStage
    });
}
function assembleHumanAuctionManagerContext(inputs) {
    var player = assemblePlayerContext(inputs.player);
    var teamNeed = assembleTeamNeedContext({
        playerRole: inputs.player.role,
        roster: inputs.roster,
        maxSquadSize: inputs.maxSquadSize,
        botIntelligence: inputs.botIntelligence
    });
    var xiImprovement = assembleXIImprovementContext(inputs.playerQualityResult);
    var scarcity = assemblePlayerScarcityContext({
        playerRole: inputs.player.role,
        auctionCtx: inputs.auctionCtx,
        botIntelligence: inputs.botIntelligence
    });
    var teamFit = assembleTeamFitContext({
        playerRole: inputs.player.role,
        botIntelligence: inputs.botIntelligence
    });
    var futurePlan = assembleFuturePlanContext({
        maxSquadSize: inputs.maxSquadSize,
        roster: inputs.roster,
        botIntelligence: inputs.botIntelligence
    });
    var purse = assemblePursePositionContext({
        team: inputs.team,
        maxSquadSize: inputs.maxSquadSize
    });
    var opponent = assembleOpponentContext({
        allTeams: inputs.allTeams,
        teamRosters: inputs.teamRosters,
        highestBidderTeamId: inputs.highestBidderTeamId,
        candidatePlayer: player,
        currentBid: inputs.currentBid,
        nextRequiredBid: inputs.nextRequiredBid,
        maxSquadSize: inputs.maxSquadSize
    });
    var auctionStage = assembleAuctionStage(inputs.auctionCtx);
    return {
        teamId: inputs.team.id,
        player: player,
        playerQuality: inputs.playerQualityResult,
        marketValue: inputs.marketValueResult,
        teamNeed: teamNeed,
        xiImprovement: xiImprovement,
        scarcity: scarcity,
        teamFit: teamFit,
        futurePlan: futurePlan,
        purse: purse,
        opponent: opponent,
        auctionStage: auctionStage,
        currentBid: inputs.currentBid,
        nextRequiredBid: inputs.nextRequiredBid
    };
}
