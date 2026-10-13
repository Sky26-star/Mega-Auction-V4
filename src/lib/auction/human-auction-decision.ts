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

import type {
  DecisionContext,
  HumanAuctionDecision,
  HumanBidDecision,
  HumanStretchDecision,
  HumanPassDecision,
  OpponentThreatLevel,
  DecisionStage
} from './human-auction-manager-types';
import { derivePricePositionContext, evaluatePricePosition } from './human-auction-price-position';
export { derivePricePositionContext, evaluatePricePosition };

/**
 * Extracts the highest observed opponent threat level deterministically.
 */
function getHighestOpponentThreat(ctx: DecisionContext): OpponentThreatLevel {
  return ctx.opponent.opponents.reduce<OpponentThreatLevel>((max, o) => {
    if (o.threat === 'HIGH') return 'HIGH';
    if (o.threat === 'MEDIUM' && max !== 'HIGH') return 'MEDIUM';
    return max;
  }, 'LOW');
}

/**
 * Pure deterministic Phase 7 Action-Decision Engine.
 *
 * Implements the single decision policy authority for Human Auction Manager.
 */
export const evaluateDecision: DecisionStage = (ctx: DecisionContext): HumanAuctionDecision => {
  const { player, marketValue, teamValue, maximumBid, nextRequiredBid, auctionStage } = ctx;
  const highestThreat = getHighestOpponentThreat(ctx);

  // =========================================================================
  // STEP 1 — HARD MAXIMUM-BID CEILING & PRICE-POSITION CONTRACT
  // =========================================================================
  // Phase 7 consumes Phase 7A's descriptive price-position contract.
  // If price position is BEYOND_CEILING (nextRequiredBid > maximumBid.maximumBid),
  // PASS unconditionally. No opponent pressure, scarcity, critical need, marquee status,
  // auction stage, or endgame urgency may override this ceiling.
  const pricePosition = evaluatePricePosition(derivePricePositionContext(ctx));

  if (pricePosition.state === 'BEYOND_CEILING') {
    const passDecision: HumanPassDecision = {
      action: 'PASS',
      playerId: player.id,
      teamId: teamValue.teamId,
      maximumBid: maximumBid.maximumBid,
      teamValue: teamValue.teamValue,
      marketValue: marketValue.marketValue,
      reason: `Next required bid (${nextRequiredBid}L) exceeds maximum rational bid ceiling (${maximumBid.maximumBid}L) bounded by ${maximumBid.bindingConstraint}.`,
      factors: [
        {
          kind: 'PRICE_VS_MAXIMUM',
          detail: `Next required bid ${nextRequiredBid}L exceeds maximum bid ceiling ${maximumBid.maximumBid}L (binding constraint: ${maximumBid.bindingConstraint}).`
        },
        {
          kind: 'PURSE',
          detail: `Ceiling bounded by ${maximumBid.bindingConstraint} (ceiling: ${maximumBid.maximumBid}L).`
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
  const legalBidAmount = nextRequiredBid;

  // =========================================================================
  // STEP 3 — STRATEGIC COMMITMENT (PHASE 4 AUTHORITY)
  // =========================================================================
  // Phase 4 owns squad consequence and strategic commitment.
  // NOT_COMMITTED indicates the player is structurally redundant or low-impact depth
  // that does not justify squad commitment.
  const commitment = teamValue.strategicCommitment;
  if (commitment === 'NOT_COMMITTED') {
    const passDecision: HumanPassDecision = {
      action: 'PASS',
      playerId: player.id,
      teamId: teamValue.teamId,
      maximumBid: maximumBid.maximumBid,
      teamValue: teamValue.teamValue,
      marketValue: marketValue.marketValue,
      reason: `Player is not strategically justified for squad acquisition (strategic commitment: NOT_COMMITTED).`,
      factors: [
        { kind: 'TEAM_NEED', detail: `Role need level is ${teamValue.factors.need.level}.` },
        { kind: 'XI_IMPROVEMENT', detail: `Provides ${teamValue.factors.xiImprovement.level} XI improvement.` },
        { kind: 'TEAM_FIT', detail: `Team fit is ${teamValue.factors.teamFit.level}.` }
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
    const stretchDecision: HumanStretchDecision = {
      action: 'STRETCH',
      bidAmount: legalBidAmount,
      playerId: player.id,
      teamId: teamValue.teamId,
      maximumBid: maximumBid.maximumBid,
      teamValue: teamValue.teamValue,
      marketValue: marketValue.marketValue,
      reason: `Final legal commitment within maximum rational bid (${legalBidAmount}L <= ${maximumBid.maximumBid}L) authorized by Phase 4 COMMITTED squad consequence.`,
      factors: [
        {
          kind: 'PRICE_VS_MAXIMUM',
          detail: `Next required bid ${legalBidAmount}L is the final legal step within maximum bid ceiling ${maximumBid.maximumBid}L.`
        },
        {
          kind: 'TEAM_NEED',
          detail: `Team need level is ${teamValue.factors.need.level}.`
        },
        {
          kind: 'XI_IMPROVEMENT',
          detail: `XI improvement impact is ${teamValue.factors.xiImprovement.level}.`
        },
        {
          kind: 'SCARCITY',
          detail: `Scarcity is ${teamValue.factors.scarcity.level} (${teamValue.factors.scarcity.meaningfulAlternativesRemaining} alternatives remaining).`
        },
        {
          kind: 'TEAM_FIT',
          detail: `Team fit is ${teamValue.factors.teamFit.level}.`
        },
        {
          kind: 'OPPONENT',
          detail: `Opponent competitive pressure evaluated; highest threat is ${highestThreat}.`
        },
        {
          kind: 'AUCTION_STAGE',
          detail: `Auction stage is ${auctionStage}.`
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
  const bidDecision: HumanBidDecision = {
    action: 'BID',
    bidAmount: legalBidAmount,
    playerId: player.id,
    teamId: teamValue.teamId,
    maximumBid: maximumBid.maximumBid,
    teamValue: teamValue.teamValue,
    marketValue: marketValue.marketValue,
    reason: `Affordable strategic continuation within maximum rational bid (${legalBidAmount}L <= ${maximumBid.maximumBid}L, strategic commitment: ${commitment}).`,
    factors: [
      {
        kind: 'PRICE_VS_MAXIMUM',
        detail: `Next required bid ${legalBidAmount}L is within maximum bid ceiling ${maximumBid.maximumBid}L (binding constraint: ${maximumBid.bindingConstraint}).`
      },
      {
        kind: 'TEAM_NEED',
        detail: `Team need level is ${teamValue.factors.need.level}.`
      },
      {
        kind: 'XI_IMPROVEMENT',
        detail: `XI improvement impact is ${teamValue.factors.xiImprovement.level}.`
      },
      {
        kind: 'SCARCITY',
        detail: `Scarcity is ${teamValue.factors.scarcity.level} (${teamValue.factors.scarcity.meaningfulAlternativesRemaining} alternatives remaining).`
      },
      {
        kind: 'TEAM_FIT',
        detail: `Team fit is ${teamValue.factors.teamFit.level}.`
      },
      {
        kind: 'OPPONENT',
        detail: `Opponent competitive pressure evaluated; highest threat is ${highestThreat}.`
      },
      {
        kind: 'AUCTION_STAGE',
        detail: `Auction stage is ${auctionStage}.`
      }
    ],
    confidence: 1.0
  };

  return bidDecision;
};
