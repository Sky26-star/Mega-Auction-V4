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
//     NOT_COMMITTED normally returns PASS; Step 3 allows only the defined roster-deficit exception.
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
  // STEP 3 — STRATEGIC COMMITMENT & ROSTER DEFICIT RELAXATION
  // =========================================================================
  // Phase 4 owns squad consequence and baseline strategic commitment.
  // When commitment is NOT_COMMITTED, the player is not a primary target.
  // However, if the bot's squad is materially incomplete (roster deficit exists),
  // a useful non-priority player (DEPTH or USEFUL_STARTER) may be reconsidered
  // to prevent ending the auction with empty squad slots and unspent budget,
  // provided the acquisition is financially rational and does not compromise
  // future critical targets.
  const commitment = teamValue.strategicCommitment;
  if (commitment === 'NOT_COMMITTED') {
    const need = teamValue.factors.need;
    const xiLevel = teamValue.factors.xiImprovement.level;
    const teamFit = teamValue.factors.teamFit.level;
    const futurePlan = teamValue.factors.futurePlan;

    const remainingSlots = need.remainingSquadSlots;
    const currentRoleCount = need.currentRoleCount;
    const idealRoleCount = need.idealRoleCount ?? need.requiredRoleCount;

    // Check for disqualifying conditions:
    // 1. Squad is already complete (no remaining slots to fill)
    const isSquadComplete = remainingSlots <= 0;

    // 2. Player is structurally redundant (no improvement or redundant role)
    const isRedundant = xiLevel === 'NONE' || need.level === 'NOT_NEEDED';

    // 3. Role is already saturated (already met or exceeded ideal count)
    const isRoleSaturated = currentRoleCount >= idealRoleCount;

    // 4. Structural mismatch (poor fit)
    const isPoorFit = teamFit === 'POOR';

    // 5. Jeopardizes future critical targets (expensive player while critical gaps remain)
    const createsFuturePressure =
      futurePlan.remainingCriticalTargets >= 2 &&
      marketValue.marketValue > 500;

    // A player is eligible for roster-deficit reconsideration IF:
    // - Squad is incomplete (remainingSlots > 0)
    // - Role is not saturated (currentRoleCount < idealRoleCount)
    // - Player provides genuine utility (DEPTH or USEFUL_STARTER, not NONE)
    // - Structural fit is not POOR
    // - Does not create dangerous future critical budget pressure
    const isRosterDeficitCandidate =
      !isSquadComplete &&
      !isRedundant &&
      !isRoleSaturated &&
      !isPoorFit &&
      !createsFuturePressure &&
      (xiLevel === 'DEPTH' || xiLevel === 'USEFUL_STARTER');

    if (!isRosterDeficitCandidate) {
      const passDecision: HumanPassDecision = {
        action: 'PASS',
        playerId: player.id,
        teamId: teamValue.teamId,
        maximumBid: maximumBid.maximumBid,
        teamValue: teamValue.teamValue,
        marketValue: marketValue.marketValue,
        reason: isSquadComplete
          ? `Squad is already complete (${remainingSlots} slots remaining). Non-priority player passed.`
          : isRoleSaturated
          ? `Role ${need.role} already satisfies target count (${currentRoleCount}/${idealRoleCount}). Additional depth not justified.`
          : `Player is not strategically justified for squad acquisition (strategic commitment: NOT_COMMITTED).`,
        factors: [
          { kind: 'TEAM_NEED', detail: `Role need level is ${need.level} (${currentRoleCount}/${idealRoleCount} filled, ${remainingSlots} slots remaining).` },
          { kind: 'XI_IMPROVEMENT', detail: `Provides ${xiLevel} XI improvement.` },
          { kind: 'TEAM_FIT', detail: `Team fit is ${teamFit}.` }
        ],
        confidence: 1.0
      };
      return passDecision;
    }
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
  // strategically justified, including a qualified NOT_COMMITTED roster-deficit candidate.
  // - HEADROOM_REMAINS + (JUSTIFIED | COMMITTED) -> BID
  // - FINAL_LEGAL_STEP + JUSTIFIED -> BID (failed stretch fallback, never PASS)
  // - Eligible NOT_COMMITTED roster-deficit candidate + legal price -> BID
  const bidDecision: HumanBidDecision = {
    action: 'BID',
    bidAmount: legalBidAmount,
    playerId: player.id,
    teamId: teamValue.teamId,
    maximumBid: maximumBid.maximumBid,
    teamValue: teamValue.teamValue,
    marketValue: marketValue.marketValue,
    reason: commitment === 'NOT_COMMITTED'
      ? `Roster-deficit continuation: Affordable depth player reconsidered to fill incomplete squad rotation (${legalBidAmount}L <= ${maximumBid.maximumBid}L, remaining slots: ${teamValue.factors.need.remainingSquadSlots}).`
      : `Affordable strategic continuation within maximum rational bid (${legalBidAmount}L <= ${maximumBid.maximumBid}L, strategic commitment: ${commitment}).`,
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
