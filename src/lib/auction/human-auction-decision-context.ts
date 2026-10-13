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

import type { V3Team, V3Player, V3PlayerRole } from '../v3-auction-types';
import type {
  OpponentContext,
  OpponentTeamContext,
  OpponentThreatLevel,
  OpponentRoleCount,
  DecisionContext,
  PlayerContext,
  PlayerMarketValueResult,
  TeamValueResult,
  MaximumBidResult,
  AuctionStage,
  Lakhs
} from './human-auction-manager-types';
import type { RivalPurchaseEvent } from './bot-brain-memory';
import { getRoleNeed, type RoleNeed } from './server-bot-engine';
import { getRoleTargetBounds } from './bot-q-engine';

export const STANDARD_AUCTION_ROLES: readonly V3PlayerRole[] = [
  'BATSMAN',
  'BOWLER',
  'ALL_ROUNDER',
  'WICKET_KEEPER'
];

export interface OpponentEvaluationInputs {
  /** Our team ID (if provided, excludes our own team from the opponents list) */
  readonly myTeamId?: string;
  /** Candidate player being auctioned */
  readonly candidatePlayer?: PlayerContext | { readonly role: V3PlayerRole; readonly base_price?: number };
  /** All competing teams in the auction */
  readonly allTeams: readonly V3Team[];
  /** Current rosters per team */
  readonly teamRosters?: Record<string, readonly V3Player[]>;
  /** Current highest bidder team ID if any, or null */
  readonly highestBidderTeamId?: string | null;
  /** Current bid on the lot */
  readonly currentBid?: number;
  /** Next required bid on the lot */
  readonly nextRequiredBid?: number;
  /** Maximum squad size (defaults to 25) */
  readonly maxSquadSize?: number;
  /** Memory of past purchases by rivals */
  readonly rivalPurchases?: readonly RivalPurchaseEvent[];
}

export interface DecisionContextInputs {
  readonly player: PlayerContext;
  readonly marketValue: PlayerMarketValueResult;
  readonly teamValue: TeamValueResult;
  readonly maximumBid: MaximumBidResult;
  readonly opponent: OpponentContext;
  readonly currentBid: Lakhs;
  readonly nextRequiredBid: Lakhs;
  readonly auctionStage: AuctionStage;
}

interface OpponentInternalSortable extends OpponentTeamContext {
  readonly _need: RoleNeed;
}

const THREAT_PRIORITY: Record<OpponentThreatLevel, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

const NEED_PRIORITY: Record<RoleNeed, number> = {
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
export function compareOpponents(
  a: OpponentInternalSortable,
  b: OpponentInternalSortable,
  highestBidderTeamId: string | null
): number {
  // 1. Current highest bidder first
  const aIsBidder = highestBidderTeamId != null && a.teamId === highestBidderTeamId;
  const bIsBidder = highestBidderTeamId != null && b.teamId === highestBidderTeamId;
  if (aIsBidder !== bIsBidder) {
    return aIsBidder ? -1 : 1;
  }

  // 2. Strongest strategic relevance (threat)
  const threatDiff = THREAT_PRIORITY[b.threat] - THREAT_PRIORITY[a.threat];
  if (threatDiff !== 0) {
    return threatDiff;
  }

  // 3. Strongest role need
  const needDiff = NEED_PRIORITY[b._need] - NEED_PRIORITY[a._need];
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
export function evaluateOpponentThreat(params: {
  candidateRole?: V3PlayerRole;
  currentRoleCount: number;
  remainingSlots: number;
  maxSquadSize: number;
  purse: number;
  requiredBid: number;
  isHighestBidder: boolean;
}): { threat: OpponentThreatLevel; candidateRoleNeed: RoleNeed } {
  const {
    candidateRole,
    currentRoleCount,
    remainingSlots,
    maxSquadSize,
    purse,
    requiredBid,
    isHighestBidder
  } = params;

  if (!candidateRole) {
    return { threat: 'LOW', candidateRoleNeed: 'NORMAL' };
  }

  // 1. Basic Legality and Raw Purse Headroom
  // If opponent has no slots remaining, they cannot legally participate in the auction
  if (remainingSlots <= 0) {
    return { threat: 'LOW', candidateRoleNeed: 'REDUNDANT' };
  }

  // If opponent purse cannot cover the required bid, they cannot compete (unless already holding the bid)
  const canAfford = purse >= requiredBid;
  if (!canAfford && !isHighestBidder) {
    return { threat: 'LOW', candidateRoleNeed: 'NORMAL' };
  }

  // 2. Authoritative role need for candidate's role
  const { need } = getRoleNeed(candidateRole, currentRoleCount, remainingSlots, maxSquadSize);

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
export function evaluateOpponentContext(inputs: OpponentEvaluationInputs): OpponentContext {
  const allTeams = inputs.allTeams ?? [];
  const teamRosters = inputs.teamRosters ?? {};
  const rivalPurchases = inputs.rivalPurchases ?? [];
  const maxSquadSize = inputs.maxSquadSize ?? 25;
  const highestBidderTeamId = inputs.highestBidderTeamId ?? null;
  const candidateRole = inputs.candidatePlayer?.role;
  const basePrice = inputs.candidatePlayer?.base_price ?? 20;
  const requiredBid = inputs.nextRequiredBid ?? inputs.currentBid ?? basePrice;

  // Filter out our own team if specified
  const competingTeams = inputs.myTeamId
    ? allTeams.filter(t => t.id !== inputs.myTeamId)
    : allTeams;

  const bounds = getRoleTargetBounds(maxSquadSize);

  const evaluatedOpponents: OpponentInternalSortable[] = competingTeams.map(team => {
    const roster = teamRosters[team.id] ?? [];
    const playersBought = team.players_bought ?? roster.length;
    const remainingSlots = Math.max(0, maxSquadSize - playersBought);

    // Calculate role counts
    const roleCountsMap: Record<V3PlayerRole, number> = {
      BATSMAN: 0,
      BOWLER: 0,
      ALL_ROUNDER: 0,
      WICKET_KEEPER: 0
    };
    for (const player of roster) {
      if (player.role in roleCountsMap) {
        roleCountsMap[player.role as V3PlayerRole] =
          (roleCountsMap[player.role as V3PlayerRole] || 0) + 1;
      }
    }

    const roleCounts: readonly OpponentRoleCount[] = STANDARD_AUCTION_ROLES.map(role => ({
      role,
      count: roleCountsMap[role]
    }));

    // Missing roles: count below minimum target or need is CRITICAL/HIGH
    const missingRoles: V3PlayerRole[] = [];
    for (const role of STANDARD_AUCTION_ROLES) {
      const count = roleCountsMap[role];
      const minTarget = bounds[role]?.min ?? 2;
      const { need } = getRoleNeed(role, count, remainingSlots, maxSquadSize);
      if (count < minTarget || need === 'CRITICAL' || need === 'HIGH') {
        missingRoles.push(role);
      }
    }

    // Rival purchase history
    const relevantPurchases = rivalPurchases.filter(p => p.winnerId === team.id);

    // Threat level evaluation
    const isHighestBidder = highestBidderTeamId != null && team.id === highestBidderTeamId;
    const currentCandidateRoleCount = candidateRole ? roleCountsMap[candidateRole] : 0;

    const { threat, candidateRoleNeed } = evaluateOpponentThreat({
      candidateRole,
      currentRoleCount: currentCandidateRoleCount,
      remainingSlots,
      maxSquadSize,
      purse: team.purse,
      requiredBid,
      isHighestBidder
    });

    return {
      teamId: team.id,
      purse: team.purse,
      remainingSlots,
      roleCounts,
      missingRoles,
      relevantPurchases,
      threat,
      _need: candidateRoleNeed
    };
  });

  // Deterministic sorting
  evaluatedOpponents.sort((a, b) => compareOpponents(a, b, highestBidderTeamId));

  const opponents: OpponentTeamContext[] = evaluatedOpponents.map(({ _need, ...cleanContext }) => cleanContext);

  return {
    opponents,
    highestBidderTeamId
  };
}

/**
 * Builds the complete Phase 6 DecisionContext.
 * Pure assembly: does not alter valuations, bid ceilings, or action selections.
 */
export function buildDecisionContext(inputs: DecisionContextInputs): DecisionContext {
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
