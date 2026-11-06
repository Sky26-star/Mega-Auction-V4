// src/lib/trade/bot-trade-evaluator.ts
// Deterministic Bot Decision Engine for Player Trades

import type { V3Player, V3Team } from '../v3-auction-types';
import type { BotPersonality } from '../auction/server-bot-engine';
import {
  evaluateTradeFairness,
  validateTradeConstraints,
  IDEAL_ROLE_COUNTS,
  DEFAULT_MAX_SQUAD_SIZE,
  DEFAULT_MAX_OVERSEAS,
} from './trade-valuation-engine';

export interface BotTradeDecisionResult {
  decision: 'ACCEPT' | 'REJECT' | 'COUNTER';
  reason: string;
  counterOffer?: {
    proposerPlayerIds: string[]; // What the bot will offer in counter
    receiverPlayerIds: string[]; // What the bot will request in counter
    notes: string;
  };
}

export interface BotProposalCandidate {
  targetTeam: V3Team;
  offeredPlayers: V3Player[];
  requestedPlayers: V3Player[];
  notes: string;
}

/**
 * Evaluates an incoming trade proposal from the perspective of a Bot franchise.
 */
export function evaluateBotTradeResponse(params: {
  botTeam: V3Team;
  botPersonality?: BotPersonality;
  proposerTeam: V3Team;
  incomingPlayers: V3Player[]; // Offered to bot
  outgoingPlayers: V3Player[]; // Requested from bot
  botRoster: V3Player[];
  proposerRoster: V3Player[];
  maxSquadSize?: number;
  maxOverseas?: number;
}): BotTradeDecisionResult {
  const {
    botTeam,
    botPersonality = 'BALANCED',
    proposerTeam,
    incomingPlayers,
    outgoingPlayers,
    botRoster,
    proposerRoster,
    maxSquadSize = DEFAULT_MAX_SQUAD_SIZE,
    maxOverseas = DEFAULT_MAX_OVERSEAS,
  } = params;

  // 1. Check hard legal bounds
  const validation = validateTradeConstraints({
    proposerTeam,
    receiverTeam: botTeam,
    proposerPlayers: incomingPlayers,
    receiverPlayers: outgoingPlayers,
    maxSquadSize,
    maxOverseas,
  });

  if (!validation.valid) {
    return {
      decision: 'REJECT',
      reason: `Trade violates roster constraints: ${validation.error}`,
    };
  }

  // 2. Critical squad depletion veto:
  // Bot will not trade away their only starter in a required role (e.g., sole WICKET_KEEPER)
  for (const outgoing of outgoingPlayers) {
    const roleCount = botRoster.filter(p => p.role === outgoing.role).length;
    const remainingInRole = roleCount - outgoingPlayers.filter(p => p.role === outgoing.role).length;
    const incomingInRole = incomingPlayers.filter(p => p.role === outgoing.role).length;

    if (remainingInRole + incomingInRole === 0) {
      return {
        decision: 'REJECT',
        reason: `Cannot surrender ${outgoing.name}; it would leave the franchise with zero ${outgoing.role}s.`,
      };
    }
  }

  // 3. Evaluate deterministic fairness
  const fairness = evaluateTradeFairness({
    proposerTeam,
    receiverTeam: botTeam,
    proposerPlayers: incomingPlayers,
    receiverPlayers: outgoingPlayers,
    proposerRoster,
    receiverRoster: botRoster,
    maxOverseas,
  });

  const ratio = fairness.fairnessRatio;
  const isSuperstarIncoming = incomingPlayers.some(p => (p.base_price >= 200 || p.category === 'MARQUEE'));

  // 4. Personality-driven thresholds
  let acceptThreshold = 1.00;
  let counterThreshold = 0.85;

  switch (botPersonality) {
    case 'CONSERVATIVE':
      acceptThreshold = 1.12;
      counterThreshold = 0.92;
      break;

    case 'BALANCED':
      acceptThreshold = 1.00;
      counterThreshold = 0.85;
      break;

    case 'AGGRESSIVE':
      acceptThreshold = isSuperstarIncoming && fairness.roleImpact.receiverDeficitFilled ? 0.94 : 0.98;
      counterThreshold = 0.80;
      break;

    case 'OPPORTUNISTIC':
      acceptThreshold = incomingPlayers.length > 1 ? 1.02 : 1.06;
      counterThreshold = 0.88;
      break;

    case 'STRATEGIC':
      acceptThreshold = fairness.roleImpact.receiverDeficitFilled ? 0.96 : 1.00;
      counterThreshold = 0.85;
      break;
  }

  // 5. Decision branch
  if (ratio >= acceptThreshold) {
    return {
      decision: 'ACCEPT',
      reason: `${botTeam.name} (${botPersonality}) accepts: deal yields favorable return (${fairness.receiverReceivedValue} pts vs ${fairness.receiverGivenValue} pts).`,
    };
  }

  if (ratio >= counterThreshold) {
    // Generate an equitable counter-offer
    const counterOffer = generateBotCounterOffer({
      botTeam,
      proposerTeam,
      incomingPlayers,
      outgoingPlayers,
      botRoster,
      proposerRoster,
      fairnessRatio: ratio,
      maxSquadSize,
      maxOverseas,
    });

    if (counterOffer) {
      return {
        decision: 'COUNTER',
        reason: `${botTeam.name} (${botPersonality}) seeks a rebalanced deal. Terms adjusted to ensure fair compensation.`,
        counterOffer,
      };
    }
  }

  return {
    decision: 'REJECT',
    reason: `${botTeam.name} (${botPersonality}) declines: proposal does not provide sufficient value (${fairness.receiverReceivedValue} pts received vs ${fairness.receiverGivenValue} pts requested).`,
  };
}

/**
 * Builds a deterministic counter-offer by rebalancing the requested or offered assets.
 */
function generateBotCounterOffer(params: {
  botTeam: V3Team;
  proposerTeam: V3Team;
  incomingPlayers: V3Player[];
  outgoingPlayers: V3Player[];
  botRoster: V3Player[];
  proposerRoster: V3Player[];
  fairnessRatio: number;
  maxSquadSize: number;
  maxOverseas: number;
}): BotTradeDecisionResult['counterOffer'] | undefined {
  const {
    botTeam,
    proposerTeam,
    incomingPlayers,
    outgoingPlayers,
    proposerRoster,
    maxSquadSize,
    maxOverseas,
  } = params;

  // The bot is giving outgoingPlayers and receiving incomingPlayers.
  // In a counteroffer:
  // The bot becomes the new proposer.
  // Proposer (Bot) gives: outgoingPlayers (or adjusted bot players).
  // Proposer (Bot) requests from Receiver (Human): incomingPlayers + an additional bench asset if deficit exists.

  // Option A: Ask for an extra bench player from proposer's roster if they haven't maxed out at 3 players
  if (incomingPlayers.length < 3) {
    const candidateExtras = proposerRoster
      .filter(p => !incomingPlayers.some(inc => inc.id === p.id))
      .filter(p => !outgoingPlayers.some(out => out.id === p.id))
      .sort((a, b) => a.base_price - b.base_price); // Pick a modest bench player

    for (const extra of candidateExtras) {
      const newRequested = [...incomingPlayers, extra];
      const testValidation = validateTradeConstraints({
        proposerTeam: botTeam,
        receiverTeam: proposerTeam,
        proposerPlayers: outgoingPlayers,
        receiverPlayers: newRequested,
        maxSquadSize,
        maxOverseas,
      });

      if (testValidation.valid) {
        return {
          proposerPlayerIds: outgoingPlayers.map(p => p.id),
          receiverPlayerIds: newRequested.map(p => p.id),
          notes: `Counter-offer: Please include ${extra.name} to balance the trade value.`,
        };
      }
    }
  }

  // Option B: If the bot is requested for multiple players, remove one of the requested players
  if (outgoingPlayers.length > 1) {
    const trimmedOutgoing = outgoingPlayers.slice(0, outgoingPlayers.length - 1);
    const testValidation = validateTradeConstraints({
      proposerTeam: botTeam,
      receiverTeam: proposerTeam,
      proposerPlayers: trimmedOutgoing,
      receiverPlayers: incomingPlayers,
      maxSquadSize,
      maxOverseas,
    });

    if (testValidation.valid) {
      return {
        proposerPlayerIds: trimmedOutgoing.map(p => p.id),
        receiverPlayerIds: incomingPlayers.map(p => p.id),
        notes: `Counter-offer: Willing to trade for ${incomingPlayers.map(p => p.name).join(', ')}, but excluding ${outgoingPlayers[outgoingPlayers.length - 1]?.name}.`,
      };
    }
  }

  return undefined;
}

/**
 * Generates an autonomous, deterministic trade proposal from a Bot team targeting another franchise.
 */
export function generateBotTradeProposals(params: {
  botTeam: V3Team;
  botRoster: V3Player[];
  otherTeams: V3Team[];
  allRostersByTeamId: Record<string, V3Player[]>;
  maxSquadSize?: number;
  maxOverseas?: number;
}): BotProposalCandidate[] {
  const {
    botTeam,
    botRoster,
    otherTeams,
    allRostersByTeamId,
    maxSquadSize = DEFAULT_MAX_SQUAD_SIZE,
    maxOverseas = DEFAULT_MAX_OVERSEAS,
  } = params;

  if (botRoster.length === 0) return [];

  const roleCounts: Record<string, number> = {
    BATSMAN: 0,
    BOWLER: 0,
    ALL_ROUNDER: 0,
    WICKET_KEEPER: 0,
  };
  botRoster.forEach(player => {
    if (roleCounts[player.role] !== undefined) roleCounts[player.role] = (roleCounts[player.role] || 0) + 1;
  });

  const deficitRoles = Object.entries(IDEAL_ROLE_COUNTS)
    .map(([role, ideal]) => ({ role, deficit: ideal - (roleCounts[role] || 0) }))
    .filter(({ deficit }) => deficit > 0)
    .sort((a, b) => b.deficit - a.deficit);
  if (deficitRoles.length === 0) return [];

  let surplusRole: string | null = null;
  let maxSurplus = 0;
  for (const [role, ideal] of Object.entries(IDEAL_ROLE_COUNTS)) {
    const surplus = (roleCounts[role] || 0) - ideal;
    if (surplus > maxSurplus) {
      maxSurplus = surplus;
      surplusRole = role;
    }
  }
  if (!surplusRole) {
    surplusRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  if (!surplusRole) return [];

  const outgoingCandidates = botRoster
    .filter(player => player.role === surplusRole)
    .sort((a, b) => a.base_price - b.base_price);
  const candidates: BotProposalCandidate[] = [];

  for (const { role: neededRole } of deficitRoles) {
    const partnerIdeal = IDEAL_ROLE_COUNTS[neededRole] || 2;
    for (const partner of otherTeams) {
      if (partner.id === botTeam.id) continue;
      const partnerRoster = allRostersByTeamId[partner.id] || [];
      const incomingCandidates = partnerRoster
        .filter(player => player.role === neededRole)
        .sort((a, b) => a.base_price - b.base_price);
      if (incomingCandidates.length <= partnerIdeal) continue;

      for (const outgoing of outgoingCandidates) {
        for (const incoming of incomingCandidates) {
          if (outgoing.id === incoming.id) continue;
          const validation = validateTradeConstraints({
            proposerTeam: botTeam,
            receiverTeam: partner,
            proposerPlayers: [outgoing],
            receiverPlayers: [incoming],
            maxSquadSize,
            maxOverseas,
          });
          if (!validation.valid) continue;

          const remainingRoleCount =
            botRoster.filter(player => player.role === outgoing.role).length - 1 +
            (incoming.role === outgoing.role ? 1 : 0);
          if (remainingRoleCount <= 0) continue;

          const fairness = evaluateTradeFairness({
            proposerTeam: botTeam,
            receiverTeam: partner,
            proposerPlayers: [outgoing],
            receiverPlayers: [incoming],
            proposerRoster: botRoster,
            receiverRoster: partnerRoster,
            maxOverseas,
          });
          if (fairness.fairnessRatio < 0.90 || fairness.fairnessRatio > 1.20) continue;

          candidates.push({
            targetTeam: partner,
            offeredPlayers: [outgoing],
            requestedPlayers: [incoming],
            notes: `${botTeam.name} proposes a positional exchange to balance ${neededRole} depth.`,
          });
        }
      }
    }
  }

  return candidates;
}

/** Backwards-compatible first-candidate helper for callers that need a single proposal. */
export function generateBotTradeProposal(params: {
  botTeam: V3Team;
  botRoster: V3Player[];
  otherTeams: V3Team[];
  allRostersByTeamId: Record<string, V3Player[]>;
  maxSquadSize?: number;
  maxOverseas?: number;
}): BotProposalCandidate | null {
  return generateBotTradeProposals(params)[0] || null;
}
