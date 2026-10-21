// src/lib/auction/bot-intelligence-orchestrator.ts
//
// Phase 2I: Bot Intelligence Orchestrator & Cache
//
// PURPOSE:
//   Orchestrate the complete 2A → 2H pure intelligence pipeline.
//   Cache structural intelligence per bot.
//   Expose immutable, read-only intelligence context to future consumers.
//
// RESPONSIBILITY:
//   1. Accept BotIntelligenceInput.
//   2. Construct BotSquadState (2A) from raw inputs.
//   3. Execute the full 2A → 2B → 2C → 2D → 2E → 2F → 2G → 2H pipeline.
//   4. Compose all outputs into one immutable BotIntelligenceContext.
//   5. Cache per bot with deterministic structural fingerprinting.
//   6. Recompute only when structural inputs change.
//   7. Provide explicit cache invalidation and clear operations.
//
// THIS MODULE:
//   - Is standalone.
//   - Does NOT modify any existing auction behaviour.
//   - Does NOT integrate into the live auction tick.
//   - Does NOT make bidding decisions.
//   - Does NOT introduce new scoring or intelligence algorithms.
//   - Does NOT access the database or network.
//   - Does NOT modify any existing file.
//
// ARCHITECTURAL BOUNDARIES:
//   - Internal Structural Intelligence: 2A–2H (cached here)
//   - Live Market Intelligence: existing AuctionContext (NOT cached here)
//   - Decision Synthesis: future Phase 2J (NOT implemented here)

import { type V3Team, type V3Player } from '../v3-auction-types';
import { type AuctionContext } from './server-bot-engine';

// 2A–2H imports: call existing functions directly, zero algorithm duplication
import { buildBotSquadState, type BotSquadState } from './bot-squad-intelligence';
import { buildBotRoleGapState, type BotRoleGapState } from './bot-role-gap-intelligence';
import { buildBotSquadQualityState, type BotSquadQualityState } from './bot-squad-quality-intelligence';
import { buildBotSquadPriorityState, type BotSquadPriorityState } from './bot-squad-priority-intelligence';
import { buildBotSquadTargetState, type BotSquadTargetState } from './bot-squad-target-intelligence';
import { buildBotSquadAlternativeState, type BotSquadAlternativeState } from './bot-squad-alternative-intelligence';
import { buildBotSquadTradeoffState, type BotSquadTradeoffState } from './bot-squad-tradeoff-intelligence';
import { buildBotSquadConsequenceState, type BotSquadConsequenceState } from './bot-squad-consequence-intelligence';

// ============================================================
// TYPES
// ============================================================

/**
 * Input contract for the intelligence orchestrator.
 *
 * Verified against actual 2A–2H function contracts:
 *   - 2A (buildBotSquadState) requires: V3Team, V3Player[], AuctionContext
 *     - AuctionContext is only consumed for maxSquadSize and maxOverseas
 *   - 2B–2H require only derived state objects produced by prior phases
 *
 * Therefore the minimum external input is:
 *   team, roster, maxSquadSize, maxOverseas
 *
 * The orchestrator constructs a minimal AuctionContext stub containing
 * only the two fields that 2A actually reads.
 */
export interface BotIntelligenceInput {
  readonly team: V3Team;
  readonly roster: V3Player[];
  readonly maxSquadSize: number;
  readonly maxOverseas: number;
}

/**
 * Complete immutable intelligence context produced by the 2A → 2H pipeline.
 *
 * Contains every intermediate state for full diagnostic/intelligence chain
 * visibility. Future consumers (Phase 2J) may selectively read 2E, 2F, 2H
 * while other phases remain available for debugging and explainability.
 *
 * All fields are readonly. The returned object is a deep structural snapshot
 * that cannot mutate cached state.
 */
export interface BotIntelligenceContext {
  /** The team ID this context belongs to */
  readonly teamId: string;

  /** The structural fingerprint that produced this context */
  readonly fingerprint: string;

  /** Phase 2A: Squad state snapshot */
  readonly squadState: BotSquadState;

  /** Phase 2B: Role gap analysis */
  readonly roleGapState: BotRoleGapState;

  /** Phase 2C: Squad quality assessment */
  readonly squadQualityState: BotSquadQualityState;

  /** Phase 2D: Squad priority ordering */
  readonly squadPriorityState: BotSquadPriorityState;

  /** Phase 2E: Target profiles */
  readonly squadTargetState: BotSquadTargetState;

  /** Phase 2F: Alternative availability */
  readonly squadAlternativeState: BotSquadAlternativeState;

  /** Phase 2G: Trade-off analysis */
  readonly squadTradeoffState: BotSquadTradeoffState;

  /** Phase 2H: Consequence projections */
  readonly squadConsequenceState: BotSquadConsequenceState;
}

// ============================================================
// STRUCTURAL FINGERPRINT
// ============================================================

/**
 * Compute a deterministic structural fingerprint from the intelligence input.
 *
 * The fingerprint captures every input that can affect the 2A–2H pipeline output:
 *
 *   1. team.id           — cache partition key
 *   2. team.purse        — affects spentRatio, purseRemaining in 2A
 *   3. team.initial_purse — affects spentRatio, amountSpent in 2A
 *   4. team.overseas_count — affects overseasSlotsRemaining in 2A
 *   5. team.players_bought — NOT used directly by 2A (2A uses roster.length),
 *                            but included for safety as it should always equal roster.length
 *   6. maxSquadSize      — affects remainingSlots and getRoleNeed scale in 2A
 *   7. maxOverseas       — affects overseasSlotsRemaining in 2A
 *   8. Roster composition — the actual role distribution (sorted for order-independence)
 *
 * The fingerprint does NOT include:
 *   - Current bid, highest bidder, opponent state (live market)
 *   - Auction progress, scarcity, timestamps (live market)
 *   - Future player pool (live market)
 *   - Personality, difficulty (decision-layer concerns)
 *
 * Roster fingerprint: We sort roles alphabetically so that different
 * array orderings of the same roster produce identical fingerprints.
 * Individual player identity within a role does not affect 2A–2H
 * (only role counts matter), so we encode role counts, not player IDs.
 */
export function computeStructuralFingerprint(input: BotIntelligenceInput): string {
  const { team, roster, maxSquadSize, maxOverseas } = input;

  // Role composition: count per role, sorted deterministically
  const roleCounts: Record<string, number> = {};
  for (const player of roster) {
    roleCounts[player.role] = (roleCounts[player.role] || 0) + 1;
  }
  // Sort by role name for deterministic ordering
  const sortedRoles = Object.keys(roleCounts).sort();
  const rosterFingerprint = sortedRoles
    .map(role => `${role}:${roleCounts[role]}`)
    .join(',');

  // Combine all structural inputs into a single deterministic string
  return [
    `t:${team.id}`,
    `p:${team.purse}`,
    `ip:${team.initial_purse}`,
    `oc:${team.overseas_count}`,
    `pb:${team.players_bought}`,
    `ms:${maxSquadSize}`,
    `mo:${maxOverseas}`,
    `r:[${rosterFingerprint}]`,
  ].join('|');
}

// ============================================================
// PIPELINE EXECUTION
// ============================================================

/**
 * Execute the complete 2A → 2H intelligence pipeline.
 *
 * This calls the existing phase functions in exact dependency order.
 * Zero algorithm duplication — every function is the original export.
 *
 * Pipeline:
 *   2A: buildBotSquadState(team, roster, minimalCtx)
 *   2B: buildBotRoleGapState(squadState)
 *   2C: buildBotSquadQualityState(squadState)
 *   2D: buildBotSquadPriorityState(squadState, gapState, qualityState)
 *   2E: buildBotSquadTargetState(squadState, gapState, qualityState, priorityState)
 *   2F: buildBotSquadAlternativeState(squadState, gapState, qualityState, priorityState, targetState)
 *   2G: buildBotSquadTradeoffState(squadState, gapState, qualityState, priorityState, targetState, altState)
 *   2H: buildBotSquadConsequenceState(squadState, gapState, tradeoffState)
 *
 * All functions are synchronous, deterministic, and pure.
 */
function executePipeline(input: BotIntelligenceInput): BotIntelligenceContext {
  const { team, roster, maxSquadSize, maxOverseas } = input;

  // Construct a minimal AuctionContext stub.
  // 2A only reads ctx.maxSquadSize and ctx.maxOverseas.
  // All other AuctionContext fields are live market data, irrelevant to structural intelligence.
  const minimalCtx: AuctionContext = {
    maxSquadSize,
    maxOverseas,
    // The following fields are NOT consumed by 2A but are required by the AuctionContext type.
    // They are set to inert defaults that cannot influence the pipeline.
    totalLots: 0,
    futurePlayers: [],
    futureByRole: {},
    futureOverseasCount: 0,
    futureAvgBasePrice: 0,
    futureMinBasePrice: 0,
    teamPurchasePrices: {},
    lotsCompleted: 0,
    lotsRemaining: 0,
    auctionProgress: 0,
    futureByRoleAndQuality: {},
    futureOverseasByRole: {},
  };

  // 2A: Squad State
  const squadState = buildBotSquadState(team, roster, minimalCtx);

  // 2B: Role Gap
  const roleGapState = buildBotRoleGapState(squadState);

  // 2C: Squad Quality
  const squadQualityState = buildBotSquadQualityState(squadState);

  // 2D: Squad Priority
  const squadPriorityState = buildBotSquadPriorityState(squadState, roleGapState, squadQualityState);

  // 2E: Squad Target
  const squadTargetState = buildBotSquadTargetState(squadState, roleGapState, squadQualityState, squadPriorityState);

  // 2F: Squad Alternative
  const squadAlternativeState = buildBotSquadAlternativeState(
    squadState, roleGapState, squadQualityState, squadPriorityState, squadTargetState
  );

  // 2G: Squad Trade-off
  const squadTradeoffState = buildBotSquadTradeoffState(
    squadState, roleGapState, squadQualityState, squadPriorityState, squadTargetState, squadAlternativeState
  );

  // 2H: Squad Consequence
  const squadConsequenceState = buildBotSquadConsequenceState(squadState, roleGapState, squadTradeoffState);

  // Compose the fingerprint for this context
  const fingerprint = computeStructuralFingerprint(input);

  return {
    teamId: team.id,
    fingerprint,
    squadState,
    roleGapState,
    squadQualityState,
    squadPriorityState,
    squadTargetState,
    squadAlternativeState,
    squadTradeoffState,
    squadConsequenceState,
  };
}

// ============================================================
// DEEP CLONE (IMMUTABILITY BARRIER)
// ============================================================

/**
 * Produce a deep clone of a BotIntelligenceContext.
 *
 * This ensures that the returned context is structurally independent
 * from the cached copy. Consumers cannot accidentally mutate cached state
 * through shared object references.
 *
 * Uses JSON round-trip which is safe because all 2A–2H outputs are
 * plain data objects (no functions, no Date instances, no undefined values,
 * no circular references).
 */
function deepCloneContext(ctx: BotIntelligenceContext): BotIntelligenceContext {
  return JSON.parse(JSON.stringify(ctx)) as BotIntelligenceContext;
}

// ============================================================
// CACHE
// ============================================================

/**
 * In-memory structural intelligence cache.
 *
 * Cache key: team.id
 * Cache value: { fingerprint, context }
 *
 * Cache hit:  fingerprint matches → return deep clone of cached context
 * Cache miss: fingerprint differs → recompute pipeline, store, return deep clone
 *
 * The cache stores the canonical copy. All returned contexts are deep clones.
 */
interface CacheEntry {
  fingerprint: string;
  context: BotIntelligenceContext;
}

const cache: Map<string, CacheEntry> = new Map();

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Get the complete structural intelligence context for a bot.
 *
 * If the cached context has a matching structural fingerprint, returns
 * a deep clone of the cached context (cache hit).
 *
 * If the fingerprint differs or no cache exists, executes the full
 * 2A → 2H pipeline, stores the result, and returns a deep clone (cache miss).
 *
 * The input objects (team, roster) are NOT mutated.
 * The returned context is a structurally independent deep clone.
 * Mutating the returned context does NOT affect the cache.
 *
 * @param input - The bot's structural intelligence input
 * @returns A deep-cloned, immutable BotIntelligenceContext
 */
export function getBotIntelligenceContext(input: BotIntelligenceInput): BotIntelligenceContext {
  const fingerprint = computeStructuralFingerprint(input);
  const teamId = input.team.id;

  const cached = cache.get(teamId);
  if (cached && cached.fingerprint === fingerprint) {
    // Cache hit: structural inputs unchanged
    return deepCloneContext(cached.context);
  }

  // Cache miss: execute the full pipeline
  const context = executePipeline(input);

  // Store canonical copy in cache
  cache.set(teamId, { fingerprint, context });

  // Return deep clone so consumer cannot mutate cached state
  return deepCloneContext(context);
}

/**
 * Invalidate the cached intelligence for a specific team.
 *
 * After invalidation, the next call to getBotIntelligenceContext for this
 * team will unconditionally recompute the full pipeline.
 *
 * @param teamId - The team ID to invalidate
 * @returns true if a cache entry was removed, false if no entry existed
 */
export function invalidateBotIntelligence(teamId: string): boolean {
  return cache.delete(teamId);
}

/**
 * Clear all cached intelligence for all teams.
 *
 * Useful for auction lifecycle management (e.g., auction reset)
 * and testing teardown.
 */
export function clearAllBotIntelligence(): void {
  cache.clear();
}

/**
 * Get the current number of cached intelligence entries.
 *
 * Useful for testing and diagnostics.
 */
export function getCacheSize(): number {
  return cache.size;
}

/**
 * Check whether a cached entry exists for a given team.
 *
 * Does NOT validate fingerprint freshness. Only checks presence.
 * Useful for testing cache lifecycle.
 *
 * @param teamId - The team ID to check
 * @returns true if a cache entry exists (possibly stale)
 */
export function hasCachedIntelligence(teamId: string): boolean {
  return cache.has(teamId);
}

// ============================================================================
// LIVE AUCTION INTELLIGENCE DECISION BRIDGE
// ============================================================================
export interface BotIntelligenceSignal {
  shouldBid: boolean;
  recommendedMaxBid: number;
  confidence: number;
  reason: string;
}

export function computeUnifiedBotSignal(params: {
  humanDecisionAction: 'BID' | 'PASS' | string;
  humanMaxBid: number;
  brainMaxBid?: number;
  brainShouldBid?: boolean;
  strategicCeiling?: number;
  qValue?: number;
  qRecommendedAction?: string;
  tacticalAction?: string;
  tacticalConfidence?: number;
  alignmentScore?: number;
  nextBidAmount: number;
}): BotIntelligenceSignal {
  const ceilings = [params.humanMaxBid];
  if (typeof params.brainMaxBid === 'number' && params.brainMaxBid > 0) ceilings.push(params.brainMaxBid);
  if (typeof params.strategicCeiling === 'number' && params.strategicCeiling > 0) ceilings.push(params.strategicCeiling);
  const effectiveCeiling = Math.min(...ceilings);

  if (params.nextBidAmount > effectiveCeiling) {
    return { shouldBid: false, recommendedMaxBid: effectiveCeiling, confidence: 0.9, reason: 'EXCEEDS_INTELLIGENCE_CEILING' };
  }

  if (params.brainShouldBid === false) {
    return { shouldBid: false, recommendedMaxBid: effectiveCeiling, confidence: 0.85, reason: 'BRAIN_PLAN_PASS' };
  }

  if (params.tacticalAction === 'PASS' && (params.tacticalConfidence ?? 0) >= 0.75) {
    return { shouldBid: false, recommendedMaxBid: effectiveCeiling, confidence: params.tacticalConfidence!, reason: 'TACTICAL_HIGH_CONFIDENCE_PASS' };
  }

  const strongQ = params.qRecommendedAction === 'BID' && (params.qValue ?? 0) >= 0.6;
  const strongAlignment = (params.alignmentScore ?? 0.5) >= 0.55;
  if (strongQ && strongAlignment) {
    return { shouldBid: true, recommendedMaxBid: effectiveCeiling, confidence: 0.85, reason: 'Q_ENGINE_AND_ALIGNMENT_BID' };
  }

  return {
    shouldBid: params.humanDecisionAction === 'BID' || params.humanDecisionAction === 'STRETCH',
    recommendedMaxBid: effectiveCeiling,
    confidence: 0.65,
    reason: 'HEURISTIC_WITH_INTELLIGENCE_BOUNDS'
  };
}
