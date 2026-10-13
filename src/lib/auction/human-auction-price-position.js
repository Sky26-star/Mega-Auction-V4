"use strict";
// src/lib/auction/human-auction-price-position.ts
//
// PHASE 7A — PRICE POSITION / COMMITMENT SEMANTICS
//
// PURPOSE:
//   Describes where the current legal next bid sits relative to the Phase 5
//   maximum-bid ceiling, using ONLY the repository's legal bid ladder
//   (getNextBidAmount in server-bot-engine.ts — the same ladder the bot engine
//   and Q-engine already use; mirrors bid-increments.ts tiers in Lakhs).
//
// THE ONLY NON-ARBITRARY BOUNDARY:
//   After placing nextRequiredBid, can the team legally respond to one more
//   raise without exceeding its ceiling?
//     yes → HEADROOM_REMAINS
//     no  → FINAL_LEGAL_STEP (last bid possible within the ceiling)
//   nextRequiredBid above the ceiling → BEYOND_CEILING
//   This is a mechanical fact of the ladder, not a chosen N-bids window.
//
// AUTHORITY BOUNDARY:
//   - Phase 5 owns maximumBid. This module only echoes it, never changes it.
//   - Phase 7 owns BID / STRETCH / PASS. This module never returns an action.
//   - Inputs are deliberately narrow: no team value, market value, opponent,
//     auction stage, purse, or remaining-slot information is visible here.
//   - Pure and deterministic: no randomness, no clock, no player identity.
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePricePosition = void 0;
exports.derivePricePositionContext = derivePricePositionContext;
var server_bot_engine_1 = require("./server-bot-engine");
/** Extracts the narrow Phase 7A input from an assembled DecisionContext. */
function derivePricePositionContext(ctx) {
    return {
        nextRequiredBid: ctx.nextRequiredBid,
        maximumBid: ctx.maximumBid.maximumBid,
        basePrice: ctx.player.base_price
    };
}
var evaluatePricePosition = function (input) {
    var nextRequiredBid = input.nextRequiredBid, maximumBid = input.maximumBid, basePrice = input.basePrice;
    if (nextRequiredBid > maximumBid) {
        return {
            state: 'BEYOND_CEILING',
            nextRequiredBid: nextRequiredBid,
            maximumBid: maximumBid,
            followingLegalBid: null,
            isExactlyAtCeiling: false,
            reasons: ["Next required bid ".concat(nextRequiredBid, "L exceeds maximum bid ").concat(maximumBid, "L.")]
        };
    }
    var followingLegalBid = (0, server_bot_engine_1.getNextBidAmount)(nextRequiredBid, basePrice);
    var isExactlyAtCeiling = nextRequiredBid === maximumBid;
    if (followingLegalBid > maximumBid) {
        return {
            state: 'FINAL_LEGAL_STEP',
            nextRequiredBid: nextRequiredBid,
            maximumBid: maximumBid,
            followingLegalBid: followingLegalBid,
            isExactlyAtCeiling: isExactlyAtCeiling,
            reasons: [
                "Next required bid ".concat(nextRequiredBid, "L is within maximum bid ").concat(maximumBid, "L, ") +
                    "but the following legal bid ".concat(followingLegalBid, "L would exceed it: this is the final legal step.")
            ]
        };
    }
    return {
        state: 'HEADROOM_REMAINS',
        nextRequiredBid: nextRequiredBid,
        maximumBid: maximumBid,
        followingLegalBid: followingLegalBid,
        isExactlyAtCeiling: isExactlyAtCeiling,
        reasons: [
            "Next required bid ".concat(nextRequiredBid, "L and following legal bid ").concat(followingLegalBid, "L ") +
                "are both within maximum bid ".concat(maximumBid, "L.")
        ]
    };
};
exports.evaluatePricePosition = evaluatePricePosition;
