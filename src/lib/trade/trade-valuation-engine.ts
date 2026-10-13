// src/lib/trade/trade-valuation-engine.ts
// Deterministic Player-to-Player Trade Valuation Engine

import { computePlayerRating } from '../player-rating';
import type { V3Player, V3Team } from '../v3-auction-types';
import type {
  TradeFairnessResult,
  TradeValidationResult,
  FairnessGrade,
  RoleImpactDetails,
} from './trade-types';

export const IDEAL_ROLE_COUNTS: Record<string, number> = {
  BATSMAN: 4,
  BOWLER: 4,
  ALL_ROUNDER: 2,
  WICKET_KEEPER: 1,
};

export const MAX_PLAYERS_PER_SIDE = 3;
export const DEFAULT_MAX_SQUAD_SIZE = 25;
export const DEFAULT_MAX_OVERSEAS = 8;

export interface TeamRosterContext {
  team: V3Team;
  currentRoster: V3Player[];
}

/**
 * Calculates a team's need multiplier for a given player role based on current squad composition.
 */
export function calculateRoleMultiplier(role: string, currentRoster: V3Player[]): number {
  const countInRole = currentRoster.filter(p => p.role === role).length;
  const idealCount = IDEAL_ROLE_COUNTS[role] || 2;

  if (countInRole === 0) {
    // Critical deficit: highest premium
    return 1.40;
  }
  if (countInRole < idealCount) {
    // Starting XI deficiency
    return 1.20;
  }
  if (countInRole === idealCount) {
    // Adequate starters, baseline depth
    return 1.00;
  }
  // Saturated role with surplus depth
  return 0.85;
}

/**
 * Calculates overseas roster friction multiplier.
 */
export function calculateOverseasMultiplier(
  isOverseas: boolean,
  currentOverseasCount: number,
  maxOverseas: number = DEFAULT_MAX_OVERSEAS
): number {
  if (!isOverseas) return 1.0;
  if (currentOverseasCount >= maxOverseas) {
    // Team already at or above cap: heavy penalty
    return 0.70;
  }
  if (currentOverseasCount === maxOverseas - 1) {
    // Taking last overseas slot
    return 0.90;
  }
  return 1.0;
}

/**
 * Evaluates the effective deterministic value of a player to a receiving team.
 */
export function evaluatePlayerValueForTeam(
  player: V3Player,
  currentRoster: V3Player[],
  overseasCount: number,
  maxOverseas: number = DEFAULT_MAX_OVERSEAS
): number {
  const rating = computePlayerRating(player);
  const roleMult = calculateRoleMultiplier(player.role, currentRoster);
  const overseasMult = calculateOverseasMultiplier(player.is_overseas, overseasCount, maxOverseas);

  return Math.round(rating * roleMult * overseasMult * 10) / 10;
}

/**
 * Validates roster limits and constraints for a proposed trade.
 */
export function validateTradeConstraints(params: {
  proposerTeam: V3Team;
  receiverTeam: V3Team;
  proposerPlayers: V3Player[];
  receiverPlayers: V3Player[];
  maxSquadSize?: number;
  maxOverseas?: number;
}): TradeValidationResult {
  const {
    proposerTeam,
    receiverTeam,
    proposerPlayers,
    receiverPlayers,
    maxSquadSize = DEFAULT_MAX_SQUAD_SIZE,
    maxOverseas = DEFAULT_MAX_OVERSEAS,
  } = params;

  // 1. Player count bounds (1 to 3 each side)
  if (proposerPlayers.length < 1 || proposerPlayers.length > MAX_PLAYERS_PER_SIDE) {
    return {
      valid: false,
      error: `You must offer between 1 and ${MAX_PLAYERS_PER_SIDE} players.`,
      proposerNewSquadSize: proposerTeam.players_bought,
      receiverNewSquadSize: receiverTeam.players_bought,
      proposerNewOverseas: proposerTeam.overseas_count,
      receiverNewOverseas: receiverTeam.overseas_count,
    };
  }

  if (receiverPlayers.length < 1 || receiverPlayers.length > MAX_PLAYERS_PER_SIDE) {
    return {
      valid: false,
      error: `You must request between 1 and ${MAX_PLAYERS_PER_SIDE} players.`,
      proposerNewSquadSize: proposerTeam.players_bought,
      receiverNewSquadSize: receiverTeam.players_bought,
      proposerNewOverseas: proposerTeam.overseas_count,
      receiverNewOverseas: receiverTeam.overseas_count,
    };
  }

  // 2. Prevent trading self
  if (proposerTeam.id === receiverTeam.id) {
    return {
      valid: false,
      error: 'Cannot trade players between the same franchise.',
      proposerNewSquadSize: proposerTeam.players_bought,
      receiverNewSquadSize: receiverTeam.players_bought,
      proposerNewOverseas: proposerTeam.overseas_count,
      receiverNewOverseas: receiverTeam.overseas_count,
    };
  }

  // 3. Duplicate player check
  const proposerIds = new Set(proposerPlayers.map(p => p.id));
  const receiverIds = new Set(receiverPlayers.map(p => p.id));

  for (const id of receiverIds) {
    if (proposerIds.has(id)) {
      return {
        valid: false,
        error: 'Trade cannot include the same player on both sides.',
        proposerNewSquadSize: proposerTeam.players_bought,
        receiverNewSquadSize: receiverTeam.players_bought,
        proposerNewOverseas: proposerTeam.overseas_count,
        receiverNewOverseas: receiverTeam.overseas_count,
      };
    }
  }

  // 4. Squad size calculation
  const proposerNewSquadSize =
    proposerTeam.players_bought - proposerPlayers.length + receiverPlayers.length;
  const receiverNewSquadSize =
    receiverTeam.players_bought - receiverPlayers.length + proposerPlayers.length;

  if (proposerNewSquadSize > maxSquadSize) {
    return {
      valid: false,
      error: `${proposerTeam.name} would exceed the squad limit (${proposerNewSquadSize}/${maxSquadSize}).`,
      proposerNewSquadSize,
      receiverNewSquadSize,
      proposerNewOverseas: proposerTeam.overseas_count,
      receiverNewOverseas: receiverTeam.overseas_count,
    };
  }

  if (receiverNewSquadSize > maxSquadSize) {
    return {
      valid: false,
      error: `${receiverTeam.name} would exceed the squad limit (${receiverNewSquadSize}/${maxSquadSize}).`,
      proposerNewSquadSize,
      receiverNewSquadSize,
      proposerNewOverseas: proposerTeam.overseas_count,
      receiverNewOverseas: receiverTeam.overseas_count,
    };
  }

  // 5. Overseas player limit calculation
  const proposerOverseasOut = proposerPlayers.filter(p => p.is_overseas).length;
  const proposerOverseasIn = receiverPlayers.filter(p => p.is_overseas).length;
  const proposerNewOverseas = proposerTeam.overseas_count - proposerOverseasOut + proposerOverseasIn;

  const receiverOverseasOut = receiverPlayers.filter(p => p.is_overseas).length;
  const receiverOverseasIn = proposerPlayers.filter(p => p.is_overseas).length;
  const receiverNewOverseas = receiverTeam.overseas_count - receiverOverseasOut + receiverOverseasIn;

  if (proposerNewOverseas > maxOverseas) {
    return {
      valid: false,
      error: `${proposerTeam.name} would exceed the overseas player limit (${proposerNewOverseas}/${maxOverseas}).`,
      proposerNewSquadSize,
      receiverNewSquadSize,
      proposerNewOverseas,
      receiverNewOverseas,
    };
  }

  if (receiverNewOverseas > maxOverseas) {
    return {
      valid: false,
      error: `${receiverTeam.name} would exceed the overseas player limit (${receiverNewOverseas}/${maxOverseas}).`,
      proposerNewSquadSize,
      receiverNewSquadSize,
      proposerNewOverseas,
      receiverNewOverseas,
    };
  }

  return {
    valid: true,
    proposerNewSquadSize,
    receiverNewSquadSize,
    proposerNewOverseas,
    receiverNewOverseas,
  };
}

/**
 * Evaluates trade fairness, explaining the value received and given by both franchises.
 */
export function evaluateTradeFairness(params: {
  proposerTeam: V3Team;
  receiverTeam: V3Team;
  proposerPlayers: V3Player[];
  receiverPlayers: V3Player[];
  proposerRoster?: V3Player[];
  receiverRoster?: V3Player[];
  maxOverseas?: number;
}): TradeFairnessResult {
  const {
    proposerTeam,
    receiverTeam,
    proposerPlayers,
    receiverPlayers,
    proposerRoster = [],
    receiverRoster = [],
    maxOverseas = DEFAULT_MAX_OVERSEAS,
  } = params;

  // Compute values from the perspective of each receiving team:
  // Proposer gives players to Receiver -> valued according to Receiver's needs
  const receiverReceivesValue = proposerPlayers.reduce((sum, p) => {
    return sum + evaluatePlayerValueForTeam(p, receiverRoster, receiverTeam.overseas_count, maxOverseas);
  }, 0);

  // Receiver gives players to Proposer -> valued according to Proposer's needs
  const proposerReceivesValue = receiverPlayers.reduce((sum, p) => {
    return sum + evaluatePlayerValueForTeam(p, proposerRoster, proposerTeam.overseas_count, maxOverseas);
  }, 0);

  // Rounded values
  const roundedReceiverReceives = Math.round(receiverReceivesValue * 10) / 10;
  const roundedProposerReceives = Math.round(proposerReceivesValue * 10) / 10;

  // Fairness ratio from receiver's perspective: (value received / value surrendered)
  const safeDivisor = Math.max(1, roundedProposerReceives);
  const fairnessRatio = Math.round((roundedReceiverReceives / safeDivisor) * 100) / 100;

  // Determine grade from receiver's perspective
  let fairnessGrade: FairnessGrade = 'FAIR';
  let acceptanceLikelihood = 65;

  if (fairnessRatio >= 1.15) {
    fairnessGrade = 'HIGHLY_FAVORABLE';
    acceptanceLikelihood = Math.min(98, Math.round(75 + (fairnessRatio - 1.15) * 50));
  } else if (fairnessRatio >= 0.95) {
    fairnessGrade = 'FAIR';
    acceptanceLikelihood = Math.round(60 + (fairnessRatio - 0.95) * 50);
  } else if (fairnessRatio >= 0.80) {
    fairnessGrade = 'UNFAVORABLE';
    acceptanceLikelihood = Math.max(15, Math.round(25 + (fairnessRatio - 0.80) * 100));
  } else {
    fairnessGrade = 'HEAVILY_UNFAVORABLE';
    acceptanceLikelihood = Math.max(2, Math.round(fairnessRatio * 15));
  }

  // Check role impact
  const proposerGainsRoles = [...new Set(receiverPlayers.map(p => p.role))];
  const receiverGainsRoles = [...new Set(proposerPlayers.map(p => p.role))];

  const receiverDeficitFilled = receiverGainsRoles.some(r => {
    const existing = receiverRoster.filter(p => p.role === r).length;
    return existing < (IDEAL_ROLE_COUNTS[r] || 2);
  });

  const proposerDeficitFilled = proposerGainsRoles.some(r => {
    const existing = proposerRoster.filter(p => p.role === r).length;
    return existing < (IDEAL_ROLE_COUNTS[r] || 2);
  });

  const roleImpact: RoleImpactDetails = {
    proposerGainsRole: proposerGainsRoles,
    receiverGainsRole: receiverGainsRoles,
    proposerDeficitFilled,
    receiverDeficitFilled,
  };

  // Generate plain-text explanation
  let explanation = '';
  if (fairnessGrade === 'HIGHLY_FAVORABLE') {
    explanation = `${receiverTeam.name} receives significantly superior value (${roundedReceiverReceives} pts vs ${roundedProposerReceives} pts surrendered). High acceptance likelihood.`;
  } else if (fairnessGrade === 'FAIR') {
    explanation = `Equitable exchange: ${receiverTeam.name} receives ${roundedReceiverReceives} pts for ${roundedProposerReceives} pts. Both squads benefit mutually.`;
  } else if (fairnessGrade === 'UNFAVORABLE') {
    explanation = `${receiverTeam.name} would surrender more value (${roundedProposerReceives} pts) than received (${roundedReceiverReceives} pts). Likely requires a sweeter deal.`;
  } else {
    explanation = `Severely lopsided proposal against ${receiverTeam.name}. High risk of immediate rejection.`;
  }

  return {
    proposerGivenValue: roundedReceiverReceives,
    proposerReceivedValue: roundedProposerReceives,
    receiverGivenValue: roundedProposerReceives,
    receiverReceivedValue: roundedReceiverReceives,
    fairnessRatio,
    fairnessGrade,
    roleImpact,
    explanation,
    acceptanceLikelihood,
  };
}
