"use strict";
// src/lib/auction/human-auction-decision.ts
//
// PHASE 7 — BID / STRETCH / PASS DECISION ENGINE
//
// PURPOSE:
//   Pure deterministic decision authority for the Human Auction Manager.
//   Takes the already-computed outputs of Phases 3–6 and Phase 7A and
//   deterministically selects exactly one action:
//     - BID
//     - STRETCH
//     - PASS
//
// ARCHITECTURAL CONTRACT:
//   - Phase 3 is the authority for Market Value / Player Quality output.
//   - Phase 4 is the sole authority for Team Value, squad consequence, and Strategic Commitment.
//   - Phase 5 is the sole and final financial ceiling authority (maximumBid).
//   - Phase 6 is the contextual opponent/stage intelligence authority.
//   - Phase 7A is the descriptive price-position authority (HEADROOM_REMAINS, FINAL_LEGAL_STEP, BEYOND_CEILING).
//   - Phase 7 is the sole ACTION POLICY authority.
//   - Phase 8 will perform runtime wiring into server-bot-engine.
//
// HARD BOUNDARIES & ANTI-REGRESSION RULES:
//   - Step 1 Hard Ceiling: If nextRequiredBid > maximumBid.maximumBid (BEYOND_CEILING) -> PASS unconditionally.
//   - Step 2 Bid Legality: If continuation is possible, bidAmount === nextRequiredBid.
//     Never emit bidAmount < nextRequiredBid or bidAmount > maximumBid.maximumBid.
//   - Step 3 Strategic Commitment Authority: Phase 4 provides strategicCommitment ('NOT_COMMITTED' | 'JUSTIFIED' | 'COMMITTED').
//     NOT_COMMITTED -> PASS.
//   - Step 4 Stretch Classification: STRETCH requires pricePosition === 'FINAL_LEGAL_STEP' AND
//     strategicCommitment === 'COMMITTED'. Never triggered by recipes, scores, or opponent threat alone.
//   - Step 5 Continuation Default: If nextRequiredBid <= maximumBid.maximumBid and
//     player is strategically justified -> BID. A failed STRETCH condition must NEVER PASS (B13 fix).
//   - B3 Fix: No averagePurse / remainingSlots ceiling or hidden slot-reserve calculations.
//   - B13 Fix: No independent Team Value ceiling. nextRequiredBid > teamValue is NOT an action gate.
//   - Invariance: currentBid never modifies intrinsic player quality, market value, or team value.
//   - Determinism: 100% pure function, no Math.random, Date.now, player-name hardcoding, or side effects.
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateDecision = exports.evaluatePricePosition = exports.derivePricePositionContext = void 0;
var human_auction_price_position_1 = require("./human-auction-price-position");
Object.defineProperty(exports, "derivePricePositionContext", { enumerable: true, get: function () { return human_auction_price_position_1.derivePricePositionContext; } });
Object.defineProperty(exports, "evaluatePricePosition", { enumerable: true, get: function () { return human_auction_price_position_1.evaluatePricePosition; } });
/**
 * Extracts the highest observed opponent threat level deterministically.
 */
function getHighestOpponentThreat(ctx) {
    return ctx.opponent.opponents.reduce(function (max, o) {
        if (o.threat === 'HIGH')
            return 'HIGH';
        if (o.threat === 'MEDIUM' && max !== 'HIGH')
            return 'MEDIUM';
        return max;
    }, 'LOW');
}
/**
 * Pure deterministic Phase 7 Action-Decision Engine.
 *
 * Implements the single decision policy authority for Human Auction Manager.
 */
var evaluateDecision = function (ctx) {
    var player = ctx.player, marketValue = ctx.marketValue, teamValue = ctx.teamValue, maximumBid = ctx.maximumBid, nextRequiredBid = ctx.nextRequiredBid, auctionStage = ctx.auctionStage;
    var highestThreat = getHighestOpponentThreat(ctx);
    // =========================================================================
    // STEP 1 — HARD MAXIMUM-BID CEILING & PRICE-POSITION CONTRACT
    // =========================================================================
    // Phase 7 consumes Phase 7A's descriptive price-position contract.
    // If price position is BEYOND_CEILING (nextRequiredBid > maximumBid.maximumBid),
    // PASS unconditionally. No opponent pressure, scarcity, critical need, marquee status,
    // auction stage, or endgame urgency may override this ceiling.
    var pricePosition = (0, human_auction_price_position_1.evaluatePricePosition)((0, human_auction_price_position_1.derivePricePositionContext)(ctx));
    if (pricePosition.state === 'BEYOND_CEILING') {
        var passDecision = {
            action: 'PASS',
            playerId: player.id,
            teamId: teamValue.teamId,
            maximumBid: maximumBid.maximumBid,
            teamValue: teamValue.teamValue,
            marketValue: marketValue.marketValue,
            reason: "Next required bid (".concat(nextRequiredBid, "L) exceeds maximum rational bid ceiling (").concat(maximumBid.maximumBid, "L) bounded by ").concat(maximumBid.bindingConstraint, "."),
            factors: [
                {
                    kind: 'PRICE_VS_MAXIMUM',
                    detail: "Next required bid ".concat(nextRequiredBid, "L exceeds maximum bid ceiling ").concat(maximumBid.maximumBid, "L (binding constraint: ").concat(maximumBid.bindingConstraint, ").")
                },
                {
                    kind: 'PURSE',
                    detail: "Ceiling bounded by ".concat(maximumBid.bindingConstraint, " (ceiling: ").concat(maximumBid.maximumBid, "L).")
                }
            ],
            confidence: 1.0
        };
        return passDecision;
    }
    // =========================================================================
    // STEP 2 — VALID BID AMOUNT
    // =========================================================================
    // If continuation is financially legal (nextRequiredBid <= maximumBid.maximumBid),
    // bidAmount must use the repository's legal next bid: nextRequiredBid.
    // Never emit bidAmount < nextRequiredBid or bidAmount > maximumBid.maximumBid.
    var legalBidAmount = nextRequiredBid;
    // =========================================================================
    // STEP 3 — STRATEGIC COMMITMENT (PHASE 4 AUTHORITY)
    // =========================================================================
    // Phase 4 owns squad consequence and strategic commitment.
    // NOT_COMMITTED indicates the player is structurally redundant or low-impact depth
    // that does not justify squad commitment.
    var commitment = teamValue.strategicCommitment;
    if (commitment === 'NOT_COMMITTED') {
        var passDecision = {
            action: 'PASS',
            playerId: player.id,
            teamId: teamValue.teamId,
            maximumBid: maximumBid.maximumBid,
            teamValue: teamValue.teamValue,
            marketValue: marketValue.marketValue,
            reason: "Player is not strategically justified for squad acquisition (strategic commitment: NOT_COMMITTED).",
            factors: [
                { kind: 'TEAM_NEED', detail: "Role need level is ".concat(teamValue.factors.need.level, ".") },
                { kind: 'XI_IMPROVEMENT', detail: "Provides ".concat(teamValue.factors.xiImprovement.level, " XI improvement.") },
                { kind: 'TEAM_FIT', detail: "Team fit is ".concat(teamValue.factors.teamFit.level, ".") }
            ],
            confidence: 1.0
        };
        return passDecision;
    }
    // =========================================================================
    // STEP 4 — STRETCH EVALUATION (FINAL_LEGAL_STEP + COMMITTED)
    // =========================================================================
    // STRETCH is returned if and only if:
    // 1. pricePosition.state === 'FINAL_LEGAL_STEP' (Phase 7A upper-commitment boundary)
    // 2. teamValue.strategicCommitment === 'COMMITTED' (Phase 4 consequence authority)
    // If HEADROOM_REMAINS or commitment is JUSTIFIED: FALL BACK TO BID (never PASS).
    if (pricePosition.state === 'FINAL_LEGAL_STEP' && commitment === 'COMMITTED') {
        var stretchDecision = {
            action: 'STRETCH',
            bidAmount: legalBidAmount,
            playerId: player.id,
            teamId: teamValue.teamId,
            maximumBid: maximumBid.maximumBid,
            teamValue: teamValue.teamValue,
            marketValue: marketValue.marketValue,
            reason: "Final legal commitment within maximum rational bid (".concat(legalBidAmount, "L <= ").concat(maximumBid.maximumBid, "L) authorized by Phase 4 COMMITTED squad consequence."),
            factors: [
                {
                    kind: 'PRICE_VS_MAXIMUM',
                    detail: "Next required bid ".concat(legalBidAmount, "L is the final legal step within maximum bid ceiling ").concat(maximumBid.maximumBid, "L.")
                },
                {
                    kind: 'TEAM_NEED',
                    detail: "Team need level is ".concat(teamValue.factors.need.level, ".")
                },
                {
                    kind: 'XI_IMPROVEMENT',
                    detail: "XI improvement impact is ".concat(teamValue.factors.xiImprovement.level, ".")
                },
                {
                    kind: 'SCARCITY',
                    detail: "Scarcity is ".concat(teamValue.factors.scarcity.level, " (").concat(teamValue.factors.scarcity.meaningfulAlternativesRemaining, " alternatives remaining).")
                },
                {
                    kind: 'TEAM_FIT',
                    detail: "Team fit is ".concat(teamValue.factors.teamFit.level, ".")
                },
                {
                    kind: 'OPPONENT',
                    detail: "Opponent competitive pressure evaluated; highest threat is ".concat(highestThreat, ".")
                },
                {
                    kind: 'AUCTION_STAGE',
                    detail: "Auction stage is ".concat(auctionStage, ".")
                }
            ],
            confidence: 1.0
        };
        return stretchDecision;
    }
    // =========================================================================
    // STEP 5 — NORMAL CONTINUATION (BID)
    // =========================================================================
    // Default action when nextRequiredBid <= maximumBid.maximumBid and player is
    // strategically justified.
    // - HEADROOM_REMAINS + (JUSTIFIED | COMMITTED) -> BID
    // - FINAL_LEGAL_STEP + JUSTIFIED -> BID (failed stretch fallback, never PASS)
    var bidDecision = {
        action: 'BID',
        bidAmount: legalBidAmount,
        playerId: player.id,
        teamId: teamValue.teamId,
        maximumBid: maximumBid.maximumBid,
        teamValue: teamValue.teamValue,
        marketValue: marketValue.marketValue,
        reason: "Affordable strategic continuation within maximum rational bid (".concat(legalBidAmount, "L <= ").concat(maximumBid.maximumBid, "L, strategic commitment: ").concat(commitment, ")."),
        factors: [
            {
                kind: 'PRICE_VS_MAXIMUM',
                detail: "Next required bid ".concat(legalBidAmount, "L is within maximum bid ceiling ").concat(maximumBid.maximumBid, "L (binding constraint: ").concat(maximumBid.bindingConstraint, ").")
            },
            {
                kind: 'TEAM_NEED',
                detail: "Team need level is ".concat(teamValue.factors.need.level, ".")
            },
            {
                kind: 'XI_IMPROVEMENT',
                detail: "XI improvement impact is ".concat(teamValue.factors.xiImprovement.level, ".")
            },
            {
                kind: 'SCARCITY',
                detail: "Scarcity is ".concat(teamValue.factors.scarcity.level, " (").concat(teamValue.factors.scarcity.meaningfulAlternativesRemaining, " alternatives remaining).")
            },
            {
                kind: 'TEAM_FIT',
                detail: "Team fit is ".concat(teamValue.factors.teamFit.level, ".")
            },
            {
                kind: 'OPPONENT',
                detail: "Opponent competitive pressure evaluated; highest threat is ".concat(highestThreat, ".")
            },
            {
                kind: 'AUCTION_STAGE',
                detail: "Auction stage is ".concat(auctionStage, ".")
            }
        ],
        confidence: 1.0
    };
    return bidDecision;
};
exports.evaluateDecision = evaluateDecision;
