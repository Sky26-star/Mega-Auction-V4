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

import type { V3Player, V3Team, V3PlayerRole } from '../v3-auction-types';
import type { AuctionContext, RoleNeed } from './server-bot-engine';
import { getRoleNeed, estimateQualityFromCategory } from './server-bot-engine';
import type { BotIntelligenceContext } from './bot-intelligence-orchestrator';
import { computeCandidateAlignment } from './bot-candidate-alignment';
import { getRoleTargetBounds } from './bot-q-engine';
import type { RivalPurchaseEvent } from './bot-brain-memory';

import type {
  PlayerContext,
  PlayerQualityResult,
  PlayerQualityContext,
  MarketValueContext,
  TeamNeedContext,
  XIImprovementContext,
  PlayerScarcityContext,
  TeamFitContext,
  FuturePlanContext,
  FutureRoleRequirement,
  PursePositionContext,
  OpponentContext,
  OpponentTeamContext,
  TeamValueContext,
  TeamValueResult,
  MaximumBidContext,
  MaximumBidResult,
  DecisionContext,
  HumanAuctionManagerContext,
  TeamNeedLevel,
  XIImprovementLevel,
  ScarcityLevel,
  TeamFitLevel,
  FuturePlanPriority,
  PurseHealth,
  AuctionStage,
  OpponentThreatLevel
} from './human-auction-manager-types';

// ============================================================
// 1. PLAYER CONTEXT ADAPTER
// ============================================================

export function assemblePlayerContext(player: V3Player): PlayerContext {
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

export function assemblePlayerQualityContext(player: V3Player): PlayerQualityContext {
  return {
    player: assemblePlayerContext(player)
  };
}

export function assemblePlayerQualityResult(ctx: PlayerQualityContext): PlayerQualityResult {
  const ratingSource = ctx.player.rating != null ? 'STORED_RATING' : 'CATEGORY_ESTIMATE';
  const rating = ctx.player.rating != null
    ? ctx.player.rating
    : estimateQualityFromCategory(ctx.player.category);

  return {
    playerId: ctx.player.id,
    role: ctx.player.role,
    rating,
    ratingSource,
    tier: ctx.player.category,
    confidence: 1.0 // Legacy engine has no confidence concept, default to 1.0
  };
}

// ============================================================
// 3. MARKET VALUE ADAPTER
// ============================================================

export interface RawMarketValueInputs {
  readonly player: V3Player;
  readonly quality: PlayerQualityResult;
  readonly auctionCtx: AuctionContext;
}

export function assembleMarketValueContext(inputs: RawMarketValueInputs): MarketValueContext {
  const rolePoolCount = inputs.auctionCtx.futureByRole?.[inputs.player.role]
    ?? inputs.auctionCtx.futurePlayers?.filter(candidate => candidate.role === inputs.player.role).length;

  return {
    player: assemblePlayerContext(inputs.player),
    quality: inputs.quality,
    ...(rolePoolCount === undefined ? {} : { market: { remainingRolePoolCount: rolePoolCount } })
  };
}

// ============================================================
// 4. TEAM NEED ADAPTER
// ============================================================

export interface RawTeamNeedInputs {
  readonly playerRole: string;
  readonly roster: V3Player[];
  readonly maxSquadSize: number;
  readonly botIntelligence?: BotIntelligenceContext;
}

export function assembleTeamNeedContext(inputs: RawTeamNeedInputs): TeamNeedContext {
  const currentRoleCount = inputs.roster.filter(p => p.role === inputs.playerRole).length;
  const remainingSquadSlots = Math.max(0, inputs.maxSquadSize - inputs.roster.length);
  
  // Get bounds from the existing authoritative Q-engine
  const bounds = getRoleTargetBounds(inputs.maxSquadSize);
  const roleBounds = bounds[inputs.playerRole] || { min: 2, ideal: 5 };

  // Run the existing logic to get legacy need
  const legacyNeedResult = getRoleNeed(inputs.playerRole, currentRoleCount, remainingSquadSlots, inputs.maxSquadSize);
  const legacyNeed: RoleNeed = legacyNeedResult.need;

  let level: TeamNeedLevel = 'NOT_NEEDED';
  if (legacyNeed === 'CRITICAL') level = 'CRITICAL';
  else if (legacyNeed === 'HIGH') level = 'IMPORTANT';
  else if (legacyNeed === 'NORMAL') level = 'USEFUL';
  else if (legacyNeed === 'LOW') level = 'OPTIONAL';
  else if (legacyNeed === 'REDUNDANT') level = 'NOT_NEEDED';

  return {
    role: inputs.playerRole as any,
    level,
    currentRoleCount,
    requiredRoleCount: roleBounds.min,
    idealRoleCount: roleBounds.ideal,
    remainingSquadSlots,
    legacyRoleNeed: legacyNeed,
    rolePriority: inputs.botIntelligence?.squadPriorityState.roles[inputs.playerRole as 'BATSMAN' | 'BOWLER' | 'ALL_ROUNDER' | 'WICKET_KEEPER']?.priorityLevel
  };
}

// ============================================================
// 5. XI IMPROVEMENT ADAPTER
// ============================================================

export function assembleXIImprovementContext(quality: PlayerQualityResult): XIImprovementContext {
  // Legacy system does not have explicit XI simulation, map via raw rating heuristics
  let level: XIImprovementLevel = 'NONE';
  
  if (quality.rating >= 92) level = 'TRANSFORMATIVE';
  else if (quality.rating >= 88) level = 'MAJOR_UPGRADE';
  else if (quality.rating >= 82) level = 'USEFUL_STARTER';
  else if (quality.rating >= 78) level = 'DEPTH';
  
  return {
    level
  };
}

// ============================================================
// 6. SCARCITY ADAPTER
// ============================================================

export interface RawScarcityInputs {
  readonly playerRole: string;
  readonly auctionCtx: AuctionContext;
  readonly botIntelligence?: BotIntelligenceContext;
}

export function assemblePlayerScarcityContext(inputs: RawScarcityInputs): PlayerScarcityContext {
  const rolePoolRemaining = inputs.auctionCtx?.futureByRole?.[inputs.playerRole] || 0;
  
  // Pull alternative intelligence if available
  const altAvail = inputs.botIntelligence?.squadAlternativeState.alternativeAvailability;
  
  let level: ScarcityLevel = 'NORMAL';
  if (altAvail === 'NO_MEANINGFUL_ALTERNATIVE') level = 'VERY_SCARCE';
  else if (altAvail === 'LIMITED_ALTERNATIVES') level = 'SCARCE';
  else if (altAvail === 'ALTERNATIVES_AVAILABLE') level = 'ABUNDANT';

  return {
    level,
    meaningfulAlternativesRemaining: rolePoolRemaining, // Approximation from legacy
    alternativeAvailability: altAvail,
    rolePoolRemaining
  };
}

// ============================================================
// 7. TEAM FIT ADAPTER
// ============================================================

export interface RawTeamFitInputs {
  readonly playerRole: string;
  readonly botIntelligence?: BotIntelligenceContext;
}

export function assembleTeamFitContext(inputs: RawTeamFitInputs): TeamFitContext {
  let level: TeamFitLevel = 'NEUTRAL';
  let structuralFit: any = undefined;

  if (inputs.botIntelligence) {
    const alignment = computeCandidateAlignment({
      candidateRole: inputs.playerRole as 'BATSMAN' | 'BOWLER' | 'ALL_ROUNDER' | 'WICKET_KEEPER',
      targetState: inputs.botIntelligence.squadTargetState,
      alternativeState: inputs.botIntelligence.squadAlternativeState
    });

    structuralFit = alignment.structuralFit;

    if (structuralFit === 'EXACT_PRIMARY_TARGET' || structuralFit === 'EXACT_SECONDARY_TARGET') {
      level = 'EXCELLENT';
    } else if (structuralFit === 'NON_PRIORITY_TARGET' || structuralFit === 'FALLBACK_PARTIAL') {
      level = 'GOOD';
    } else if (structuralFit === 'LOW_PRIORITY_TARGET' || structuralFit === 'FALLBACK_WEAK') {
      level = 'NEUTRAL';
    } else if (structuralFit === 'REDUNDANT_ROLE' || structuralFit === 'STRUCTURAL_MISMATCH') {
      level = 'POOR';
    }
  }

  return {
    level,
    structuralFit
  };
}

// ============================================================
// 8. FUTURE PLAN ADAPTER
// ============================================================

export interface RawFuturePlanInputs {
  readonly maxSquadSize: number;
  readonly roster: V3Player[];
  readonly botIntelligence?: BotIntelligenceContext;
}

export function assembleFuturePlanContext(inputs: RawFuturePlanInputs): FuturePlanContext {
  const remainingSquadSlots = Math.max(0, inputs.maxSquadSize - inputs.roster.length);
  const minRequiredSpend = remainingSquadSlots * 20;

  // By default without a dedicated future budget engine, protect the minimum
  let priority: FuturePlanPriority = 'OPTIONAL';
  let protectedFutureBudget = minRequiredSpend;
  let remainingCriticalTargets = 0;
  const futureRequiredRoles: FutureRoleRequirement[] = [];
  
  if (inputs.botIntelligence) {
    const criticalTargets = Object.values(inputs.botIntelligence.squadPriorityState.roles).filter((p: any) => p.priorityLevel === 'CRITICAL');
    remainingCriticalTargets = criticalTargets.length;
    if (criticalTargets.length > 0) {
      priority = 'MUST_HAVE';
      protectedFutureBudget = Math.max(minRequiredSpend, criticalTargets.length * 400); // Heuristic
      
      for (const target of criticalTargets) {
        futureRequiredRoles.push({
          role: target.role as any, // Cast to V3PlayerRole if needed, assuming they align
          count: 1 // Default approximation, not strict for Phase 4 yet
        });
      }
    }
  }

  return {
    priority,
    futureRequiredRoles,
    protectedFutureBudget,
    remainingCriticalTargets
  };
}

// ============================================================
// 9. PURSE POSITION ADAPTER
// ============================================================

export interface RawPursePositionInputs {
  readonly team: V3Team;
  readonly maxSquadSize: number;
}

export function assemblePursePositionContext(inputs: RawPursePositionInputs): PursePositionContext {
  const remainingSquadSlots = Math.max(0, inputs.maxSquadSize - inputs.team.players_bought);
  const minimumRequiredFutureSpend = remainingSquadSlots * 20;

  let health: PurseHealth = 'SAFE';
  if (inputs.team.purse < minimumRequiredFutureSpend + 200) health = 'DANGEROUS';
  else if (inputs.team.purse < minimumRequiredFutureSpend + 1000) health = 'TIGHT';

  return {
    currentPurse: inputs.team.purse,
    initialPurse: inputs.team.initial_purse,
    remainingSquadSlots,
    minimumRequiredFutureSpend,
    health
  };
}

// ============================================================
// 10. AUCTION STAGE ADAPTER
// ============================================================

export function assembleAuctionStage(auctionCtx: AuctionContext): AuctionStage {
  if (auctionCtx.auctionProgress < 0.25) return 'EARLY';
  if (auctionCtx.auctionProgress < 0.65) return 'MID';
  if (auctionCtx.auctionProgress < 0.90) return 'LATE';
  return 'ENDGAME';
}

// ============================================================
// 11. OPPONENT CONTEXT ADAPTER
// ============================================================

import { evaluateOpponentContext, buildDecisionContext } from './human-auction-decision-context';

export interface RawOpponentInputs {
  readonly allTeams: V3Team[];
  readonly teamRosters: Record<string, V3Player[]>;
  readonly highestBidderTeamId?: string | null;
  readonly myTeamId?: string;
  readonly candidatePlayer?: PlayerContext | { readonly role: V3PlayerRole; readonly base_price?: number };
  readonly currentBid?: number;
  readonly nextRequiredBid?: number;
  readonly maxSquadSize?: number;
  readonly rivalPurchases?: readonly RivalPurchaseEvent[];
}

export function assembleOpponentContext(inputs: RawOpponentInputs): OpponentContext {
  return evaluateOpponentContext({
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

// ============================================================
// 12. TEAM VALUE ADAPTER
// ============================================================

export interface RawTeamValueInputs {
  readonly teamId: string;
  readonly player: PlayerContext;
  readonly marketValueResult: any; // We skip deep validation here
  readonly teamNeed: TeamNeedContext;
  readonly xiImprovement: XIImprovementContext;
  readonly scarcity: PlayerScarcityContext;
  readonly teamFit: TeamFitContext;
  readonly futurePlan: FuturePlanContext;
  readonly currentRoster: readonly V3Player[];
}

export function assembleTeamValueContext(inputs: RawTeamValueInputs): TeamValueContext {
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

// ============================================================
// 13. MAXIMUM BID ADAPTER
// ============================================================

export interface RawMaximumBidInputs {
  readonly teamValue: TeamValueResult;
  readonly purse: PursePositionContext;
  readonly auctionStage: AuctionStage;
  readonly currentBid: number;
  readonly nextRequiredBid: number;
  readonly futureBudget: number;
}

export function assembleMaximumBidContext(inputs: RawMaximumBidInputs): MaximumBidContext {
  return {
    teamValue: inputs.teamValue,
    purse: inputs.purse,
    auctionStage: inputs.auctionStage,
    currentBid: inputs.currentBid,
    nextRequiredBid: inputs.nextRequiredBid,
    futureBudget: inputs.futureBudget
  };
}

// ============================================================
// 14. DECISION ADAPTER
// ============================================================

export interface RawDecisionInputs {
  readonly player: PlayerContext;
  readonly marketValue: any;
  readonly teamValue: TeamValueResult;
  readonly maximumBid: MaximumBidResult;
  readonly opponent: OpponentContext;
  readonly currentBid: number;
  readonly nextRequiredBid: number;
  readonly auctionStage: AuctionStage;
}

export function assembleDecisionContext(inputs: RawDecisionInputs): DecisionContext {
  return buildDecisionContext({
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

// ============================================================
// 15. MASTER ENVELOPE (For Diagnostics / Orchestration)
// ============================================================

export interface RawMasterContextInputs {
  readonly team: V3Team;
  readonly player: V3Player;
  readonly roster: V3Player[];
  readonly allTeams: V3Team[];
  readonly teamRosters: Record<string, V3Player[]>;
  readonly maxSquadSize: number;
  readonly auctionCtx: AuctionContext;
  readonly botIntelligence?: BotIntelligenceContext;
  readonly currentBid: number;
  readonly nextRequiredBid: number;
  readonly highestBidderTeamId?: string | null;
  readonly playerQualityResult: PlayerQualityResult;
  readonly marketValueResult: any;
}

export function assembleHumanAuctionManagerContext(
  inputs: RawMasterContextInputs
): HumanAuctionManagerContext {
  const player = assemblePlayerContext(inputs.player);
  const teamNeed = assembleTeamNeedContext({
    playerRole: inputs.player.role,
    roster: inputs.roster,
    maxSquadSize: inputs.maxSquadSize,
    botIntelligence: inputs.botIntelligence
  });
  const xiImprovement = assembleXIImprovementContext(inputs.playerQualityResult);
  const scarcity = assemblePlayerScarcityContext({
    playerRole: inputs.player.role,
    auctionCtx: inputs.auctionCtx,
    botIntelligence: inputs.botIntelligence
  });
  const teamFit = assembleTeamFitContext({
    playerRole: inputs.player.role,
    botIntelligence: inputs.botIntelligence
  });
  const futurePlan = assembleFuturePlanContext({
    maxSquadSize: inputs.maxSquadSize,
    roster: inputs.roster,
    botIntelligence: inputs.botIntelligence
  });
  const purse = assemblePursePositionContext({
    team: inputs.team,
    maxSquadSize: inputs.maxSquadSize
  });
  const opponent = assembleOpponentContext({
    allTeams: inputs.allTeams,
    teamRosters: inputs.teamRosters,
    highestBidderTeamId: inputs.highestBidderTeamId,
    candidatePlayer: player,
    currentBid: inputs.currentBid,
    nextRequiredBid: inputs.nextRequiredBid,
    maxSquadSize: inputs.maxSquadSize
  });
  const auctionStage = assembleAuctionStage(inputs.auctionCtx);

  return {
    teamId: inputs.team.id,
    player,
    playerQuality: inputs.playerQualityResult,
    marketValue: inputs.marketValueResult,
    teamNeed,
    xiImprovement,
    scarcity,
    teamFit,
    futurePlan,
    purse,
    opponent,
    auctionStage,
    currentBid: inputs.currentBid,
    nextRequiredBid: inputs.nextRequiredBid
  };
}
