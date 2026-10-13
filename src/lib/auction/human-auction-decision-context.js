"use strict";
// src/lib/auction/human-auction-decision-context.ts
//
// PHASE 6 — OPPONENT + AUCTION DECISION CONTEXT
//
// PURPOSE:
//   Constructs the deterministic Opponent Context and compiles the full
//   Decision Context for Phase 7 (BID / STRETCH / PASS).
//
// CORE PRINCIPLE:
//   Phase 6 is CONTEXT, not VALUATION.
//   Opponent behaviour can inform downstream tactical execution in Phase 7,
//   but it MUST NEVER redefine or mutate:
//     - Player Quality (Phase 2)
//     - Market Value (Phase 3)
//     - Team Value (Phase 4)
//     - Maximum Bid (Phase 5)
//
// BOUNDARY RULES:
//   - DOES NOT make BID / STRETCH / PASS decisions.
//   - DOES NOT modify Maximum Bid or Team Value.
//   - DOES NOT use Math.random() or probabilistic heuristics.
//   - DOES NOT use player-name specific logic.
//   - Evaluates opponent relevance and threat level deterministically.
//   - Surfaces actual RivalPurchaseEvent history from memory without inventing synthetic fields.
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STANDARD_AUCTION_ROLES = void 0;
exports.compareOpponents = compareOpponents;
exports.evaluateOpponentThreat = evaluateOpponentThreat;
exports.evaluateOpponentContext = evaluateOpponentContext;
exports.buildDecisionContext = buildDecisionContext;
var server_bot_engine_1 = require("./server-bot-engine");
var bot_q_engine_1 = require("./bot-q-engine");
exports.STANDARD_AUCTION_ROLES = [
    'BATSMAN',
    'BOWLER',
    'ALL_ROUNDER',
    'WICKET_KEEPER'
];
var THREAT_PRIORITY = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
};
var NEED_PRIORITY = {
    CRITICAL: 5,
    HIGH: 4,
    NORMAL: 3,
    LOW: 2,
    REDUNDANT: 1
};
/**
 * Deterministically compares two opponents for ordering:
 * 1. Current highest bidder first
 * 2. Strongest strategic relevance (threat level: HIGH -> MEDIUM -> LOW)
 * 3. Strongest role need for candidate's role (CRITICAL -> HIGH -> NORMAL -> LOW -> REDUNDANT)
 * 4. Deterministic teamId tie-break
 */
function compareOpponents(a, b, highestBidderTeamId) {
    // 1. Current highest bidder first
    var aIsBidder = highestBidderTeamId != null && a.teamId === highestBidderTeamId;
    var bIsBidder = highestBidderTeamId != null && b.teamId === highestBidderTeamId;
    if (aIsBidder !== bIsBidder) {
        return aIsBidder ? -1 : 1;
    }
    // 2. Strongest strategic relevance (threat)
    var threatDiff = THREAT_PRIORITY[b.threat] - THREAT_PRIORITY[a.threat];
    if (threatDiff !== 0) {
        return threatDiff;
    }
    // 3. Strongest role need
    var needDiff = NEED_PRIORITY[b._need] - NEED_PRIORITY[a._need];
    if (needDiff !== 0) {
        return needDiff;
    }
    // 4. Deterministic teamId tie-break
    return a.teamId.localeCompare(b.teamId);
}
/**
 * Evaluates an opponent's strategic threat level deterministically.
 *
 * Threat classification:
 * - HIGH: Solvency intact + critical role need OR high role need with aggressive bidding/strong capacity.
 * - MEDIUM: Solvency intact + high/normal role need OR active highest bidder.
 * - LOW: Redundant role need, depleted squad slots, or inability to afford the required bid.
 */
function evaluateOpponentThreat(params) {
    var candidateRole = params.candidateRole, currentRoleCount = params.currentRoleCount, remainingSlots = params.remainingSlots, maxSquadSize = params.maxSquadSize, purse = params.purse, requiredBid = params.requiredBid, isHighestBidder = params.isHighestBidder;
    if (!candidateRole) {
        return { threat: 'LOW', candidateRoleNeed: 'NORMAL' };
    }
    // 1. Basic Legality and Raw Purse Headroom
    // If opponent has no slots remaining, they cannot legally participate in the auction
    if (remainingSlots <= 0) {
        return { threat: 'LOW', candidateRoleNeed: 'REDUNDANT' };
    }
    // If opponent purse cannot cover the required bid, they cannot compete (unless already holding the bid)
    var canAfford = purse >= requiredBid;
    if (!canAfford && !isHighestBidder) {
        return { threat: 'LOW', candidateRoleNeed: 'NORMAL' };
    }
    // 2. Authoritative role need for candidate's role
    var need = (0, server_bot_engine_1.getRoleNeed)(candidateRole, currentRoleCount, remainingSlots, maxSquadSize).need;
    // 3. Strategic Threat Level
    // Deterministic threat classification:
    // - CRITICAL need: HIGH threat if affordable.
    // - HIGH need: HIGH threat if actively holding bid, MEDIUM if non-bidding.
    // - NORMAL need: MEDIUM threat if actively holding bid, LOW if non-bidding.
    // - LOW / REDUNDANT need: LOW threat.
    if (need === 'CRITICAL') {
        return { threat: 'HIGH', candidateRoleNeed: need };
    }
    if (need === 'HIGH') {
        if (isHighestBidder) {
            return { threat: 'HIGH', candidateRoleNeed: need };
        }
        return { threat: 'MEDIUM', candidateRoleNeed: need };
    }
    if (need === 'NORMAL') {
        if (isHighestBidder) {
            return { threat: 'MEDIUM', candidateRoleNeed: need };
        }
        return { threat: 'LOW', candidateRoleNeed: need };
    }
    return { threat: 'LOW', candidateRoleNeed: need };
}
/**
 * Evaluates the full OpponentContext across all competing teams.
 */
function evaluateOpponentContext(inputs) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    var allTeams = (_a = inputs.allTeams) !== null && _a !== void 0 ? _a : [];
    var teamRosters = (_b = inputs.teamRosters) !== null && _b !== void 0 ? _b : {};
    var rivalPurchases = (_c = inputs.rivalPurchases) !== null && _c !== void 0 ? _c : [];
    var maxSquadSize = (_d = inputs.maxSquadSize) !== null && _d !== void 0 ? _d : 25;
    var highestBidderTeamId = (_e = inputs.highestBidderTeamId) !== null && _e !== void 0 ? _e : null;
    var candidateRole = (_f = inputs.candidatePlayer) === null || _f === void 0 ? void 0 : _f.role;
    var basePrice = (_h = (_g = inputs.candidatePlayer) === null || _g === void 0 ? void 0 : _g.base_price) !== null && _h !== void 0 ? _h : 20;
    var requiredBid = (_k = (_j = inputs.nextRequiredBid) !== null && _j !== void 0 ? _j : inputs.currentBid) !== null && _k !== void 0 ? _k : basePrice;
    // Filter out our own team if specified
    var competingTeams = inputs.myTeamId
        ? allTeams.filter(function (t) { return t.id !== inputs.myTeamId; })
        : allTeams;
    var bounds = (0, bot_q_engine_1.getRoleTargetBounds)(maxSquadSize);
    var evaluatedOpponents = competingTeams.map(function (team) {
        var _a, _b, _c, _d;
        var roster = (_a = teamRosters[team.id]) !== null && _a !== void 0 ? _a : [];
        var playersBought = (_b = team.players_bought) !== null && _b !== void 0 ? _b : roster.length;
        var remainingSlots = Math.max(0, maxSquadSize - playersBought);
        // Calculate role counts
        var roleCountsMap = {
            BATSMAN: 0,
            BOWLER: 0,
            ALL_ROUNDER: 0,
            WICKET_KEEPER: 0
        };
        for (var _i = 0, roster_1 = roster; _i < roster_1.length; _i++) {
            var player = roster_1[_i];
            if (player.role in roleCountsMap) {
                roleCountsMap[player.role] =
                    (roleCountsMap[player.role] || 0) + 1;
            }
        }
        var roleCounts = exports.STANDARD_AUCTION_ROLES.map(function (role) { return ({
            role: role,
            count: roleCountsMap[role]
        }); });
        // Missing roles: count below minimum target or need is CRITICAL/HIGH
        var missingRoles = [];
        for (var _e = 0, STANDARD_AUCTION_ROLES_1 = exports.STANDARD_AUCTION_ROLES; _e < STANDARD_AUCTION_ROLES_1.length; _e++) {
            var role = STANDARD_AUCTION_ROLES_1[_e];
            var count = roleCountsMap[role];
            var minTarget = (_d = (_c = bounds[role]) === null || _c === void 0 ? void 0 : _c.min) !== null && _d !== void 0 ? _d : 2;
            var need = (0, server_bot_engine_1.getRoleNeed)(role, count, remainingSlots, maxSquadSize).need;
            if (count < minTarget || need === 'CRITICAL' || need === 'HIGH') {
                missingRoles.push(role);
            }
        }
        // Rival purchase history
        var relevantPurchases = rivalPurchases.filter(function (p) { return p.winnerId === team.id; });
        // Threat level evaluation
        var isHighestBidder = highestBidderTeamId != null && team.id === highestBidderTeamId;
        var currentCandidateRoleCount = candidateRole ? roleCountsMap[candidateRole] : 0;
        var _f = evaluateOpponentThreat({
            candidateRole: candidateRole,
            currentRoleCount: currentCandidateRoleCount,
            remainingSlots: remainingSlots,
            maxSquadSize: maxSquadSize,
            purse: team.purse,
            requiredBid: requiredBid,
            isHighestBidder: isHighestBidder
        }), threat = _f.threat, candidateRoleNeed = _f.candidateRoleNeed;
        return {
            teamId: team.id,
            purse: team.purse,
            remainingSlots: remainingSlots,
            roleCounts: roleCounts,
            missingRoles: missingRoles,
            relevantPurchases: relevantPurchases,
            threat: threat,
            _need: candidateRoleNeed
        };
    });
    // Deterministic sorting
    evaluatedOpponents.sort(function (a, b) { return compareOpponents(a, b, highestBidderTeamId); });
    var opponents = evaluatedOpponents.map(function (_a) {
        var _need = _a._need, cleanContext = __rest(_a, ["_need"]);
        return cleanContext;
    });
    return {
        opponents: opponents,
        highestBidderTeamId: highestBidderTeamId
    };
}
/**
 * Builds the complete Phase 6 DecisionContext.
 * Pure assembly: does not alter valuations, bid ceilings, or action selections.
 */
function buildDecisionContext(inputs) {
    return {
        player: inputs.player,
        marketValue: inputs.marketValue,
        teamValue: inputs.teamValue,
        maximumBid: inputs.maximumBid,
        opponent: inputs.opponent,
        currentBid: inputs.currentBid,
        nextRequiredBid: inputs.nextRequiredBid,
        auctionStage: inputs.auctionStage
    };
}
