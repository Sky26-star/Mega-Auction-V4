import { V3Team, V3Player } from '../v3-auction-types';
import { computePlayerRating } from '../player-rating';
import { getBotIntelligenceContext, type BotIntelligenceContext } from './bot-intelligence-orchestrator';
import { computeCandidateAlignment } from './bot-candidate-alignment';
import { buildStrategicDecisionPolicy, type StrategicDecisionPolicy } from './bot-strategic-adapter';

import { evaluateQAndTV } from './bot-q-engine';
import { evaluateTacticalDecision, computeReactionDelay, getDeterministicPseudoRandom } from './bot-tactical-engine';
import { getBotBrainState } from './bot-brain-state';
import { recordBotBidObservation, recordRivalBidObservation } from './bot-brain-memory';
import {
  assemblePlayerContext,
  assemblePlayerQualityContext,
  assemblePlayerQualityResult,
  assembleMarketValueContext,
  assembleTeamNeedContext,
  assembleXIImprovementContext,
  assemblePlayerScarcityContext,
  assembleTeamFitContext,
  assembleFuturePlanContext,
  assemblePursePositionContext,
  assembleAuctionStage,
  assembleOpponentContext,
  assembleTeamValueContext,
  assembleMaximumBidContext,
  assembleDecisionContext,
} from './human-auction-manager-context';
import { evaluatePlayerMarketValue } from './human-auction-market-value';
import { evaluateTeamValue } from './human-auction-team-value';
import { evaluateMaximumBid } from './human-auction-maximum-bid';
import {
  evaluateDecision,
  derivePricePositionContext,
  evaluatePricePosition
} from './human-auction-decision';
import type {
  HumanAuctionDecision,
  StrategicCommitment,
  PricePositionState,
  BindingConstraint,
} from './human-auction-manager-types';

// ============================================================
// TYPES
// ============================================================

export type BotPersonality = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | 'OPPORTUNISTIC' | 'STRATEGIC';
export type BotDecision = 'SKIP' | 'ENTER' | 'HESITATE' | 'DROP' | 'ONE_LAST_BID';
export type RoleNeed = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'REDUNDANT';

export interface BotDecisionEvidence {
  teamId: string;
  decision: string;
  valuation: number;
  tv: number;
  eligibilityReason?: string;
  actionReason?: string;
  pacingState?: string;

  // Authoritative Phase 3–7 outputs
  playerId?: string;
  playerName?: string;
  marketValue?: number;
  teamValue?: number;
  strategicCommitment?: StrategicCommitment;
  maximumBid?: number;
  bindingConstraint?: BindingConstraint;
  currentBid?: number;
  nextRequiredBid?: number;
  pricePosition?: PricePositionState;
  auctionStage?: string;
  opponentThreat?: string;
  finalAction?: 'BID' | 'STRETCH' | 'PASS';
  bidAmount?: number;
  reasons?: string[];
  humanDecision?: HumanAuctionDecision;
}

export interface FuturePlayer {
  player_id?: string;
  role: string;
  category: string;
  base_price: number;
  is_overseas: boolean;
}

export interface AuctionContext {
  maxSquadSize: number;
  maxOverseas: number;
  totalLots: number;
  futurePlayers: FuturePlayer[];
  futureByRole: Record<string, number>;
  futureOverseasCount: number;
  futureAvgBasePrice: number;
  futureMinBasePrice: number;
  teamPurchasePrices: Record<string, number[]>;

  // Auction progression tracking (computed from existing data, zero new DB queries)
  lotsCompleted: number;
  lotsRemaining: number;
  auctionProgress: number;  // 0.0 → 1.0 ratio

  // Enriched future pool analysis for opportunity cost
  futureByRoleAndQuality: Record<string, { count: number; avgEstRating: number }>;
  futureOverseasByRole: Record<string, number>;
}

export const DEFAULT_CONTEXT: AuctionContext = {
  maxSquadSize: 25,
  maxOverseas: 8,
  totalLots: 50,
  futurePlayers: [],
  futureByRole: {},
  futureOverseasCount: 0,
  futureAvgBasePrice: 100,
  futureMinBasePrice: 20,
  teamPurchasePrices: {},
  lotsCompleted: 0,
  lotsRemaining: 50,
  auctionProgress: 0,
  futureByRoleAndQuality: {},
  futureOverseasByRole: {},
};

// ============================================================
// CORE UTILITIES
// ============================================================

export function getNextBidAmount(currentBid: number, basePrice: number): number {
  if (currentBid === 0) return basePrice;
  let inc = 200;
  if (currentBid <= 300) inc = 25;
  else if (currentBid <= 600) inc = 50;
  else if (currentBid <= 1000) inc = 75;
  else if (currentBid <= 1500) inc = 100;
  else if (currentBid <= 2000) inc = 150;
  else if (currentBid <= 2500) inc = 175;
  return currentBid + inc;
}

export function getBotPersonality(teamId: string): BotPersonality {
  const hash = teamId.charCodeAt(0) + teamId.charCodeAt(teamId.length - 1) + teamId.length;
  const val = hash % 5;
  switch (val) {
    case 0: return 'CONSERVATIVE';
    case 1: return 'AGGRESSIVE';
    case 2: return 'OPPORTUNISTIC';
    case 3: return 'STRATEGIC';
    default: return 'BALANCED';
  }
}

// ============================================================
// DYNAMIC SQUAD EVALUATION
// ============================================================

export function getRoleNeed(
  role: string,
  roleCount: number,
  remainingSlots: number,
  maxSquadSize: number
): { need: RoleNeed } {
  const scale = Math.max(0.5, maxSquadSize / 25);

  let minTarget: number, idealTarget: number;
  switch (role) {
    case 'WICKET_KEEPER':
      minTarget = Math.max(1, Math.round(2 * scale));
      idealTarget = Math.max(2, Math.round(3 * scale));
      break;
    case 'BATSMAN':
      minTarget = Math.max(2, Math.round(5 * scale));
      idealTarget = Math.max(3, Math.round(7 * scale));
      break;
    case 'ALL_ROUNDER':
      minTarget = Math.max(2, Math.round(3 * scale));
      idealTarget = Math.max(3, Math.round(5 * scale));
      break;
    case 'BOWLER':
      minTarget = Math.max(2, Math.round(6 * scale));
      idealTarget = Math.max(3, Math.round(8 * scale));
      break;
    default:
      minTarget = Math.max(1, Math.round(2 * scale));
      idealTarget = Math.max(2, Math.round(4 * scale));
  }

  let need: RoleNeed;

  if (roleCount === 0 && minTarget >= 1) {
    need = 'CRITICAL';
  } else if (roleCount < minTarget) {
    need = 'HIGH';
  } else if (roleCount <= idealTarget) {
    need = 'NORMAL';
  } else if (roleCount <= idealTarget + 2) {
    need = 'LOW';
  } else {
    need = 'REDUNDANT';
  }

  return { need };
}

// ============================================================
// SCARCITY ENGINE (Audit #10)
// Deep role + overseas scarcity with quality awareness
// ============================================================



// ============================================================
// AUCTION STAGE ENGINE (Audit #11)
// Purse-pacing advisor — NOT scripted phases
// ============================================================



// ============================================================
// OPPORTUNITY COST ENGINE (Audit #12, #84)
// "If I spend ₹14 Cr here, can I still fill my bowling gap?"
// Uses ONLY legitimate visible metadata (no hidden future stats)
// ============================================================



// ============================================================
// STRATEGIC IMPERFECTION ENGINE (Audit #60, #61)
// Rare legal bounded mistakes — rational-but-suboptimal choices
// Target: ~5-8% of eligible decisions
// ============================================================



// ============================================================
// INFORMATION FIREWALL (Audit #83)
// ============================================================
//
// STRUCTURAL GUARANTEE: Bot knowledge boundaries
//
// The bot sees ONLY:
// 1. Current player on auction block — full public stats (V3Player)
// 2. All teams' purse, roster, overseas count — public state (V3Team[])
// 3. PENDING lots' role, category, base_price, is_overseas — public queue
//    via FuturePlayer[] which contains NO stats, NO rating
// 4. Its own personality and computed valuation — internal derivation
//
// The bot NEVER sees:
// - Player stats of future players (only role/category/price)
// - Hidden player sets or unloaded data
// - Exact opponent bot valuations or decisions
// - Future lot ordering beyond what's in the public queue
//
// Future quality is estimated ONLY from category metadata:
//   MARQUEE/ICON → est ~88, A/ELITE → est ~85, B/PREMIER → est ~82,
//   C/CORE → est ~79, D/RISING → est ~76
// This is legitimate because category is publicly visible in the queue.

export function estimateQualityFromCategory(category: string): number {
  const cat = (category || '').toUpperCase();
  if (cat === 'MARQUEE' || cat === 'ICON') return 88;
  if (cat === 'A' || cat === 'ELITE') return 85;
  if (cat === 'B' || cat === 'PREMIER') return 82;
  if (cat === 'C' || cat === 'CORE') return 79;
  if (cat === 'D' || cat === 'RISING') return 76;
  return 78;
}

// Helper to compute enriched future pool analysis from FuturePlayer[]
export function computeFutureQualityMap(
  futurePlayers: FuturePlayer[]
): Record<string, { count: number; avgEstRating: number }> {
  const map: Record<string, { count: number; totalEst: number }> = {};
  for (const fp of futurePlayers) {
    if (!map[fp.role]) map[fp.role] = { count: 0, totalEst: 0 };
    const entry = map[fp.role];
    if (entry) {
      entry.count++;
      entry.totalEst += estimateQualityFromCategory(fp.category);
    }
  }
  const result: Record<string, { count: number; avgEstRating: number }> = {};
  for (const [role, data] of Object.entries(map)) {
    result[role] = {
      count: data.count,
      avgEstRating: data.count > 0 ? data.totalEst / data.count : 78,
    };
  }
  return result;
}

export function computeFutureOverseasByRole(
  futurePlayers: FuturePlayer[]
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const fp of futurePlayers) {
    if (fp.is_overseas) {
      result[fp.role] = (result[fp.role] || 0) + 1;
    }
  }
  return result;
}

// ============================================================
// BOT ENGINE CORE LOOP
// This executes for EVERY single bid placed.
// Continuous re-evaluation: every price change triggers fresh evaluation.
// ============================================================

export function evaluateBotsForLot(
  botTeams: V3Team[],
  player: V3Player,
  currentBid: number,
  basePrice: number,
  highestBidderTeamId: string | undefined,
  botDifficulty: string,
  allTeams: V3Team[],
  teamRosters: Record<string, V3Player[]>,
  ctx: AuctionContext,
  timerExpiresAt: string | undefined | null,
  evidenceArr?: BotDecisionEvidence[],
  passedAuctionId?: string
) {
  const nextBidAmount = getNextBidAmount(currentBid, basePrice);
  const validBids: { teamId: string; nextBidAmount: number; delayMs: number }[] = [];

  const highestBidder = allTeams.find(t => t.id === highestBidderTeamId);
  const remainingTimerMs = timerExpiresAt ? new Date(timerExpiresAt).getTime() - Date.now() : 15000;

  for (const bot of botTeams) {
    if (bot.id === highestBidderTeamId) {
      console.error(JSON.stringify({ logType: 'TACTICAL_EVAL_PROOF', botId: bot.id, decision: 'REJECTED_ELIGIBILITY', reason: 'ALREADY_HIGHEST_BIDDER', purse: bot.purse, currentBid }));
      if (evidenceArr) evidenceArr.push({ teamId: bot.id, decision: 'REJECTED_ELIGIBILITY', valuation: 0, tv: 0, eligibilityReason: 'ALREADY_HIGHEST_BIDDER' });
      continue;
    }
    if (bot.purse < nextBidAmount) {
      console.error(JSON.stringify({ logType: 'TACTICAL_EVAL_PROOF', botId: bot.id, decision: 'REJECTED_ELIGIBILITY', reason: 'PURSE_INSUFFICIENT', purse: bot.purse, currentBid }));
      if (evidenceArr) evidenceArr.push({ teamId: bot.id, decision: 'REJECTED_ELIGIBILITY', valuation: 0, tv: 0, eligibilityReason: 'PURSE_INSUFFICIENT' });
      continue;
    }
    if (bot.players_bought >= ctx.maxSquadSize) {
      console.error(JSON.stringify({ logType: 'TACTICAL_EVAL_PROOF', botId: bot.id, decision: 'REJECTED_ELIGIBILITY', reason: 'SQUAD_FULL', purse: bot.purse, currentBid }));
      if (evidenceArr) evidenceArr.push({ teamId: bot.id, decision: 'REJECTED_ELIGIBILITY', valuation: 0, tv: 0, eligibilityReason: 'SQUAD_FULL' });
      continue;
    }
    if (bot.id === '4122f2b6-39f2-4ae1-b587-d4d2be6d0b92' || true) {
      console.error(`[OVERSEAS DEBUG] Bot: ${bot.id}, player.is_overseas: ${player?.is_overseas}, bot.overseas_count: ${bot.overseas_count}, ctx.maxOverseas: ${ctx.maxOverseas}`);
    }
    if (player?.is_overseas && bot.overseas_count >= ctx.maxOverseas) {
      console.error(JSON.stringify({ logType: 'TACTICAL_EVAL_PROOF', botId: bot.id, decision: 'REJECTED_ELIGIBILITY', reason: 'OVERSEAS_FULL', purse: bot.purse, currentBid }));
      if (evidenceArr) evidenceArr.push({ teamId: bot.id, decision: 'REJECTED_ELIGIBILITY', valuation: 0, tv: 0, eligibilityReason: 'OVERSEAS_FULL' });
      continue;
    }

    const roster = teamRosters[bot.id] || [];
    let botIntelligence: BotIntelligenceContext | undefined = undefined;
    let strategicPolicy: StrategicDecisionPolicy | null = null;
    
    try {
      botIntelligence = getBotIntelligenceContext({
        team: bot,
        roster,
        maxSquadSize: ctx.maxSquadSize,
        maxOverseas: ctx.maxOverseas
      });

      const candidateAlignment = computeCandidateAlignment({
        candidateRole: player.role,
        targetState: botIntelligence.squadTargetState,
        alternativeState: botIntelligence.squadAlternativeState
      });

      strategicPolicy = buildStrategicDecisionPolicy(player.role, botIntelligence, candidateAlignment);
    } catch (e) {
      strategicPolicy = buildStrategicDecisionPolicy(player.role, null, null);
    }

    const personality = (bot as any).personality || getBotPersonality(bot.id);
    const roleCount = roster.filter(p => p.role === player.role).length;
    const remainingSlots = Math.max(0, ctx.maxSquadSize - bot.players_bought);
    let { need: roleNeed } = getRoleNeed(player.role, roleCount, remainingSlots, ctx.maxSquadSize);

    if (strategicPolicy && !strategicPolicy.isFallback) {
      switch (strategicPolicy.pursuitStance) {
        case 'CRITICAL_PURSUIT': roleNeed = 'CRITICAL'; break;
        case 'STRONG_PURSUIT': roleNeed = 'HIGH'; break;
        case 'OPPORTUNISTIC_PURSUIT': roleNeed = 'NORMAL'; break;
        case 'CONTINGENCY_PURSUIT': roleNeed = 'NORMAL'; break;
        case 'WEAK_PURSUIT': roleNeed = 'LOW'; break;
        case 'ABANDON_PREFERENCE': roleNeed = 'REDUNDANT'; break;
      }
    }

    const auctionId = passedAuctionId || (player as any).auction_id || 'AUCTION';

    // -------------------------------------------------------------
    // CONTROLLED RANDOM PLAYER PARTICIPATION
    // -------------------------------------------------------------
    if (roleNeed !== 'CRITICAL' && roleNeed !== 'HIGH') {
      const seedStr = `${bot.id}-${player.id}-${auctionId}`;
      const rand = getDeterministicPseudoRandom(seedStr);
      let prob = 1.0;
      const cat = player.category;
      
      if (cat === 'B') prob = 0.8;
      else if (cat === 'C') prob = 0.6;
      else if (cat === 'D') prob = 0.4;
      // MARQUEE and A are 1.0

      if (rand > prob) {
        if (evidenceArr) evidenceArr.push({ teamId: bot.id, decision: 'PASS', valuation: 0, tv: 0, eligibilityReason: `PARTICIPATION_OPT_OUT_CAT_${cat}` });
        continue;
      }
    }

    // -------------------------------------------------------------
    // AUTHORITATIVE HUMAN AUCTION MANAGER PIPELINE (PHASES 3 -> 7)
    // -------------------------------------------------------------

    // 1. Phase 3: Player Quality + Market Value
    const playerQualityCtx = assemblePlayerQualityContext(player);
    const playerQualityResult = assemblePlayerQualityResult(playerQualityCtx);
    const marketValueCtx = assembleMarketValueContext({
      player,
      quality: playerQualityResult,
      auctionCtx: ctx
    });
    const marketValueResult = evaluatePlayerMarketValue(marketValueCtx, player);

    // If player does not have an explicit rating, resolve it from the Phase 3 quality result
    const resolvedPlayer: V3Player = player.rating != null
      ? player
      : { ...player, rating: playerQualityResult.rating };
    const playerCtx = assemblePlayerContext(resolvedPlayer);

    // 2. Phase 4: Team Value + Strategic Commitment
    const teamNeedCtx = assembleTeamNeedContext({
      playerRole: player.role,
      roster,
      maxSquadSize: ctx.maxSquadSize,
      botIntelligence
    });
    const xiImprovementCtx = assembleXIImprovementContext(playerQualityResult);
    const scarcityCtx = assemblePlayerScarcityContext({
      playerRole: player.role,
      auctionCtx: ctx,
      botIntelligence
    });
    const teamFitCtx = assembleTeamFitContext({
      playerRole: player.role,
      botIntelligence
    });
    const futurePlanCtx = assembleFuturePlanContext({
      maxSquadSize: ctx.maxSquadSize,
      roster,
      botIntelligence
    });
    const teamValueCtx = assembleTeamValueContext({
      player: playerCtx,
      marketValueResult,
      teamNeed: teamNeedCtx,
      xiImprovement: xiImprovementCtx,
      scarcity: scarcityCtx,
      teamFit: teamFitCtx,
      futurePlan: futurePlanCtx,
      teamId: bot.id,
      currentRoster: roster
    });
    const teamValueResult = evaluateTeamValue(teamValueCtx);

    // 3. Phase 5: Maximum Bid / Financial Ceiling
    const pursePosCtx = assemblePursePositionContext({
      team: bot,
      maxSquadSize: ctx.maxSquadSize
    });
    const auctionStage = assembleAuctionStage(ctx);
    const maxBidCtx = assembleMaximumBidContext({
      teamValue: teamValueResult,
      purse: pursePosCtx,
      auctionStage,
      currentBid,
      nextRequiredBid: nextBidAmount,
      futureBudget: futurePlanCtx.protectedFutureBudget
    });
    const maxBidResult = evaluateMaximumBid(maxBidCtx);

    // 4. Phase 6: Opponent + Decision Context
    const opponentCtx = assembleOpponentContext({
      allTeams,
      teamRosters,
      highestBidderTeamId,
      candidatePlayer: playerCtx,
      currentBid,
      nextRequiredBid: nextBidAmount,
      maxSquadSize: ctx.maxSquadSize,
      myTeamId: bot.id
    });
    const decisionCtx = assembleDecisionContext({
      player: playerCtx,
      marketValue: marketValueResult,
      teamValue: teamValueResult,
      maximumBid: maxBidResult,
      opponent: opponentCtx,
      currentBid,
      nextRequiredBid: nextBidAmount,
      auctionStage
    });

    // 5. Phase 7A: Price Position
    const pricePosCtx = derivePricePositionContext(decisionCtx);
    const pricePosResult = evaluatePricePosition(pricePosCtx);

    // 6. Phase 7: Sole Strategic Action Authority
    const humanDecision = evaluateDecision(decisionCtx);

    // Rival observation memory recording
    if (highestBidderTeamId && highestBidderTeamId !== bot.id && currentBid > 0) {
      recordRivalBidObservation(auctionId, bot.id, player.id, highestBidderTeamId, currentBid);
    }

    const brainState = (ctx as any)?.brainStates?.[bot.id] ?? (ctx as any)?.brainState ?? getBotBrainState(auctionId, bot.id) ?? null;

    // Optional legacy context / diagnostics evaluation (zero authority to override Phase 7)
    let tactical: any = null;
    let qResult: any = null;
    try {
      qResult = evaluateQAndTV(
        player,
        ctx.futurePlayers || [],
        {
          purse: bot.purse,
          playersBought: bot.players_bought,
          overseasCount: bot.overseas_count,
          roleCounts: roster.reduce((acc, p) => {
            acc[p.role] = (acc[p.role] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        },
        currentBid,
        false,
        { maxSquadSize: ctx.maxSquadSize, maxOverseas: ctx.maxOverseas }
      );

      tactical = evaluateTacticalDecision({
        teamId: bot.id,
        auctionId,
        lotId: player.id,
        personality,
        qResult,
        roleNeed,
        strategicPolicy,
        brainState,
        basePrice,
        remainingSlots,
        purse: bot.purse,
        remainingTimerMs,
        initialPurse: bot.initial_purse,
        auctionProgress: ctx.auctionProgress,
        futurePoolCount: (ctx.futurePlayers || []).length,
        maxSquadSize: ctx.maxSquadSize
      });
    } catch (e) {
      // Diagnostic failure must not disrupt authoritative execution
    }

    // -------------------------------------------------------------
    // RUNTIME ACTION ADAPTER
    // Maps Phase 7 HumanAuctionDecision directly to runtime execution.
    // -------------------------------------------------------------
    let decision: BotDecision = 'DROP';
    let delayMs = 0;

    if (humanDecision.action === 'BID') {
      decision = 'ENTER';
      const seed = `${auctionId}_${player.id}_${bot.id}_${nextBidAmount}_${currentBid}`;
      const prng = getDeterministicPseudoRandom(seed);
      delayMs = computeReactionDelay(personality, teamNeedCtx.level, remainingTimerMs, prng, brainState?.plan?.urgency ?? 0);

      validBids.push({
        teamId: bot.id,
        nextBidAmount: humanDecision.bidAmount,
        delayMs
      });
    } else if (humanDecision.action === 'STRETCH') {
      decision = 'ONE_LAST_BID';
      delayMs = Math.min(
        Math.max(1500, Math.floor(3000 * (1 - (brainState?.plan?.urgency ?? 0)))),
        Math.max(500, remainingTimerMs - 400)
      );

      validBids.push({
        teamId: bot.id,
        nextBidAmount: humanDecision.bidAmount,
        delayMs
      });
    } else {
      // humanDecision.action === 'PASS'
      decision = 'DROP';
      delayMs = 0;
    }

    // Determine primary diagnostic action reason:
    // If tactical engine ran and its action agrees with Phase 7, preserve tactical reason for legacy compatibility.
    // Otherwise, authoritative Phase 7 reason explains the decision.
    const actionReason = (tactical?.action === humanDecision.action ? tactical?.reason : undefined) ?? humanDecision.reason;

    if (evidenceArr) {
      evidenceArr.push({
        teamId: bot.id,
        decision,
        valuation: teamValueResult.teamValue,
        tv: teamValueResult.teamValue,
        actionReason,
        pacingState: tactical?.pacingState,
        playerId: player.id,
        playerName: player.name,
        marketValue: marketValueResult.marketValue,
        teamValue: teamValueResult.teamValue,
        strategicCommitment: teamValueResult.strategicCommitment,
        maximumBid: maxBidResult.maximumBid,
        bindingConstraint: maxBidResult.bindingConstraint,
        currentBid,
        nextRequiredBid: nextBidAmount,
        pricePosition: pricePosResult.state,
        auctionStage,
        finalAction: humanDecision.action,
        bidAmount: humanDecision.action !== 'PASS' ? humanDecision.bidAmount : 0,
        reasons: [humanDecision.reason],
        humanDecision
      });
    }

    const logObj = {
      logType: 'HUMAN_AUCTION_DECISION_PROOF',
      auctionId,
      lotId: player.id,
      botId: bot.id,
      role: player.role,
      roleNeed: teamNeedCtx.level,
      futurePlayersCount: (ctx.futurePlayers || []).length,
      remainingSlots,
      purse: bot.purse,
      currentBid,
      nextRequiredBid: nextBidAmount,
      marketValue: marketValueResult.marketValue,
      teamValue: teamValueResult.teamValue,
      strategicCommitment: teamValueResult.strategicCommitment,
      maximumBid: maxBidResult.maximumBid,
      bindingConstraint: maxBidResult.bindingConstraint,
      pricePosition: pricePosResult.state,
      auctionStage,
      finalAction: humanDecision.action,
      bidAmount: humanDecision.action !== 'PASS' ? humanDecision.bidAmount : 0,
      decision,
      reasons: [humanDecision.reason],
      delayMs,
      remainingTimerMs,
      brainStateAvailable: !!brainState
    };
    console.error(JSON.stringify(logObj));
    try {
      require('fs').appendFileSync('C:\\Users\\Palasanilavanya\\Mega-Auction-V3\\scratch\\human_auction_eval_proofs.jsonl', JSON.stringify(logObj) + '\n');
    } catch(e) {}
  }

  return validBids;
}