// src/lib/auction/bot-brain-state.ts
//
// Phase 1C: Bot Brain State Updater
//
// Sits ABOVE BotMemory, BELOW future strategic integration.
// Produces BotBeliefs + BotPlan from authoritative auction state + BotMemory.
//
// THIS LAYER IS OBSERVATIONAL/PLANNING-ONLY.
// It does NOT modify evaluateBotsForLot() behaviour.
// It does NOT modify BotMemory.
// It does NOT make network calls or write to the database.

import { getBotMemory, type BotMemory } from './bot-brain-memory';
import { getRoleNeed, type AuctionContext, type RoleNeed } from './server-bot-engine';
import { type V3Team, type V3Player } from '../v3-auction-types';

// ============================================================
// TYPES
// ============================================================

/**
 * BotBeliefs: The bot's derived understanding of the current auction environment.
 * All values are deterministic given the same inputs.
 */
export interface BotBeliefs {
  /**
   * Current-lot market price pressure / premium relative to base price.
   *
   * NOTE: Despite the field name, this is NOT a historical market inflation
   * rate. It is a proxy for how much the CURRENT lot's price has been bid
   * up relative to its base price. The field name is retained for Phase 1C
   * API stability; future phases may rename it if needed.
   *
   * Range: 0.0 â†’ 2.0
   *   0.0 = at or below base price (no premium)
   *   0.4 = ~3Ã— base price (moderate premium)
   *   1.0 = ~6Ã— base price (high premium)
   *   2.0 = â‰¥11Ã— base price (extreme premium, capped)
   * Neutral: 0.0 (when no current bid exists or bid â‰¤ base price)
   *
   * Uses ONLY the current lot's currentBid and basePrice.
   * Does NOT use historical sold-price data or external market data.
   */
  marketInflation: number;

  /**
   * How urgently this bot needs the current player's role.
   * Range: 0.0 â†’ 1.0
   *   0.0 = role is fully staffed or redundant
   *   0.5 = normal need
   *   1.0 = critical need (zero players in this role)
   * Neutral: 0.3
   */
  roleScarcityPanic: number;

  /**
   * Estimated opponent bidding pressure on the current lot.
   * Range: 0.0 â†’ 1.0
   *   0.0 = no rival pressure
   *   0.5 = moderate
   *   1.0 = extreme multi-rival contention
   * Neutral: 0.2
   */
  rivalAggression: number;

  /**
   * Estimate of the bot's current squad quality from its roster.
   * Range: 0.0 â†’ 1.0
   *   0.0 = empty squad or all minimum-rated players
   *   0.5 = average quality
   *   1.0 = all elite-rated players
   * Neutral: 0.0 (empty squad)
   */
  estimatedSquadQuality: number;
}

/**
 * Strategic focus categories for BotPlan.
 */
export type StrategicFocus =
  | 'BUILD_CORE'      // Early auction, building foundational squad
  | 'FILL_GAPS'       // Mid auction, addressing role deficiencies
  | 'TARGET_VALUE'    // Hunting underpriced players
  | 'PROTECT_PURSE'   // Conserving budget for future needs
  | 'LATE_AUCTION';   // Endgame bargain hunting

/**
 * Strategic reservation estimate â€” what the bot THINKS it should preserve
 * for critical future role needs.
 *
 * THIS IS NOT AUTHORITATIVE PURSE ACCOUNTING.
 *
 * It is a first-step strategic signal only. It MUST NEVER override:
 *   - actual purse validation (V3Team.purse)
 *   - minimum bid rules
 *   - bid increment rules
 *   - squad size limits
 *   - overseas limits
 *   - existing valuation hard clamps in server-bot-engine.ts
 *   - auction settlement rules
 *
 * Future Bot Brain phases may introduce more sophisticated budget planning
 * (target-specific reservations, cross-set budgeting, portfolio allocation).
 * Those belong to later phases, NOT Phase 1C.
 */
export interface BudgetAllocation {
  /** Total remaining purse (mirrors authoritative V3Team.purse â€” read-only) */
  readonly totalRemaining: number;
  /** Estimated strategic reserve for remaining critical/high role needs */
  readonly reserveForCriticalNeeds: number;
  /** Estimated discretionary budget (purse minus strategic reserve) */
  readonly discretionaryBudget: number;
  /** Ratio of purse already spent (0.0 â†’ 1.0) */
  readonly spentRatio: number;
}

/**
 * BotPlan: The bot's strategic intentions derived from beliefs + state.
 * THIS IS ADVISORY ONLY â€” it does not override the tactical engine.
 */
export interface BotPlan {
  /**
   * Overall urgency to acquire players.
   * Range: 0.0 â†’ 1.0
   *   0.0 = no urgency, comfortable position
   *   0.5 = moderate
   *   1.0 = desperate, must buy soon
   */
  urgency: number;

  /** Read-only strategic budget guidance */
  budgetAllocation: BudgetAllocation;

  /** Current strategic focus */
  strategicFocus: StrategicFocus;

  /**
   * Whether the bot would sacrifice an overseas slot for a high-quality player.
   * Deterministic based on overseas headroom and squad quality.
   */
  willSacrificeOverseasForQuality: boolean;
}

/**
 * Combined bot brain state returned by the updater.
 */
export interface BotBrainState {
  memory: BotMemory;
  beliefs: BotBeliefs;
  plan: BotPlan;
}

// ============================================================
// BELIEF CALCULATIONS
// ============================================================

/**
 * Compute current-lot market price pressure (see BotBeliefs.marketInflation).
 *
 * This measures the CURRENT lot's price premium relative to its base price.
 * It is NOT a historical market inflation rate â€” it uses only the current
 * lot's currentBid and basePrice, which are observable right now.
 *
 * Formula:
 *   ratio = currentBid / basePrice
 *   pressure = clamp((ratio - 1) / 5, 0, 2)
 *
 * At base price (ratio=1): pressure = 0.0
 * At 3Ã— base  (ratio=3):  pressure = 0.4
 * At 6Ã— base  (ratio=6):  pressure = 1.0
 * At 11Ã— base (ratio=11): pressure = 2.0 (capped)
 *
 * Returns neutral 0.0 when no current bid exists or bid â‰¤ base price.
 */
function computeMarketInflation(currentBid: number, basePrice: number): number {
  if (basePrice <= 0 || currentBid <= 0) return 0.0;
  const ratio = currentBid / basePrice;
  return Math.min(2.0, Math.max(0.0, (ratio - 1) / 5));
}

/**
 * Compute role scarcity panic for the bot regarding the current player's role.
 * Uses the existing getRoleNeed() from server-bot-engine as the authority on role needs.
 *
 * Mapping from RoleNeed to panic:
 *   CRITICAL  â†’ 1.0
 *   HIGH      â†’ 0.7
 *   NORMAL    â†’ 0.3
 *   LOW       â†’ 0.1
 *   REDUNDANT â†’ 0.0
 */
function computeRoleScarcityPanic(
  playerRole: string,
  botRoster: V3Player[],
  maxSquadSize: number,
  playersBought: number
): number {
  const roleCount = botRoster.filter(p => p.role === playerRole).length;
  const remainingSlots = Math.max(0, maxSquadSize - playersBought);
  const { need } = getRoleNeed(playerRole, roleCount, remainingSlots, maxSquadSize);

  return roleNeedToPanic(need);
}

function roleNeedToPanic(need: RoleNeed): number {
  switch (need) {
    case 'CRITICAL':  return 1.0;
    case 'HIGH':      return 0.7;
    case 'NORMAL':    return 0.3;
    case 'LOW':       return 0.1;
    case 'REDUNDANT': return 0.0;
    default:          return 0.3;
  }
}

/**
 * Compute rival aggression estimate.
 * Uses currently visible information only:
 *   - How many other eligible teams can afford the next bid
 *   - Whether those teams also need this role
 *   - Current bid pressure (bid vs base price)
 *
 * Formula:
 *   eligibleRivals = teams that can afford the next bid, have squad/overseas room
 *   thirstyRivals  = eligible rivals with CRITICAL or HIGH need for this role
 *   rivalPressure  = clamp(thirstyRivals / 3, 0, 0.6) + clamp(bidPressure, 0, 0.4)
 *   where bidPressure = min(0.4, (currentBid / basePrice - 1) / 10)
 */
function computeRivalAggression(
  bot: V3Team,
  currentBid: number,
  basePrice: number,
  nextBidAmount: number,
  playerRole: string,
  playerIsOverseas: boolean,
  allTeams: V3Team[],
  teamRosters: Record<string, V3Player[]>,
  maxSquadSize: number,
  maxOverseas: number
): number {
  let thirstyRivals = 0;

  for (const team of allTeams) {
    if (team.id === bot.id) continue;
    if (team.purse < nextBidAmount) continue;
    if (team.players_bought >= maxSquadSize) continue;
    if (playerIsOverseas && team.overseas_count >= maxOverseas) continue;

    const roster = teamRosters[team.id] || [];
    const roleCount = roster.filter(p => p.role === playerRole).length;
    const remainingSlots = Math.max(0, maxSquadSize - team.players_bought);
    const { need } = getRoleNeed(playerRole, roleCount, remainingSlots, maxSquadSize);

    if (need === 'CRITICAL' || need === 'HIGH') {
      thirstyRivals++;
    }
  }

  const rivalComponent = Math.min(0.6, thirstyRivals / 3);

  const bidPressure = basePrice > 0 && currentBid > 0
    ? Math.min(0.4, (currentBid / basePrice - 1) / 10)
    : 0;

  return Math.min(1.0, Math.max(0.0, rivalComponent + bidPressure));
}

/**
 * Compute estimated squad quality from the bot's current roster.
 * Uses computePlayerRating indirectly via a simple heuristic:
 *   average the category-based quality estimate for owned players.
 *
 * We do NOT call computePlayerRating here to avoid importing player-rating.ts
 * and to keep this lightweight. Instead we use the same categoryâ†’quality mapping
 * that the existing bot engine uses (estimateQualityFromCategory).
 *
 * Quality is normalized: (avgRating - 74) / 24  â†’  0.0 to 1.0
 * where 74 is the rating floor and 98 is the ceiling per player-rating.ts.
 *
 * Empty roster â†’ 0.0
 */
function computeEstimatedSquadQuality(botRoster: V3Player[]): number {
  if (botRoster.length === 0) return 0.0;

  let totalEst = 0;
  for (const p of botRoster) {
    totalEst += estimateQualityFromCategoryLocal(p.category);
  }
  const avgRating = totalEst / botRoster.length;

  // Normalize to 0.0â€“1.0 range (rating system bounds: 74â€“98)
  return Math.min(1.0, Math.max(0.0, (avgRating - 74) / 24));
}

/**
 * Local copy of the categoryâ†’quality mapping from server-bot-engine.ts.
 * We duplicate this small lookup to avoid adding a dependency on a function
 * that the instructions say not to import from (keeping server-bot-engine untouched).
 */
function estimateQualityFromCategoryLocal(category: string): number {
  const cat = (category || '').toUpperCase();
  if (cat === 'MARQUEE' || cat === 'ICON') return 88;
  if (cat === 'A' || cat === 'ELITE') return 85;
  if (cat === 'B' || cat === 'PREMIER') return 82;
  if (cat === 'C' || cat === 'CORE') return 79;
  if (cat === 'D' || cat === 'RISING') return 76;
  return 78;
}

// ============================================================
// PLAN CALCULATIONS
// ============================================================

/**
 * Compute urgency from memory, beliefs, and squad state.
 *
 * Factors:
 *   - lotsSinceLastPurchase: more lots without buying â†’ more urgent
 *   - remaining squad slots vs auction progress
 *   - roleScarcityPanic: critical needs amplify urgency
 *   - failedTargets count: losing targets increases desperation
 *
 * Formula:
 *   base = clamp(lotsSinceLastPurchase / 8, 0, 0.4)
 *   slotPressure = clamp((1 - slotsFilledRatio) * auctionProgress * 0.8, 0, 0.3)
 *   rolePanic = roleScarcityPanic * 0.2
 *   failedPenalty = clamp(failedTargets.length / 10, 0, 0.1)
 *   urgency = clamp(base + slotPressure + rolePanic + failedPenalty, 0, 1)
 */
function computeUrgency(
  memory: BotMemory,
  beliefs: BotBeliefs,
  playersBought: number,
  maxSquadSize: number,
  auctionProgress: number
): number {
  const lotsDry = Math.min(0.4, memory.lotsSinceLastPurchase / 8);

  const slotsFilledRatio = maxSquadSize > 0 ? playersBought / maxSquadSize : 0;
  const slotPressure = Math.min(0.3, (1 - slotsFilledRatio) * auctionProgress * 0.8);

  const rolePanic = beliefs.roleScarcityPanic * 0.2;

  const failedPenalty = Math.min(0.1, memory.failedTargets.length / 10);

  return Math.min(1.0, Math.max(0.0, lotsDry + slotPressure + rolePanic + failedPenalty));
}

/**
 * Compute strategic reservation estimate (see BudgetAllocation).
 *
 * This is a FIRST-STEP strategic signal only. It estimates how much purse
 * the bot should conceptually preserve for remaining critical/high role needs.
 *
 * reserveForCriticalNeeds:
 *   Estimated minimum cost to fill unfilled critical/high roles.
 *   Uses futureMinBasePrice as a conservative floor per needed slot.
 *   This is a rough heuristic â€” NOT a full budget planner.
 *
 * discretionaryBudget:
 *   purse minus the strategic reserve estimate.
 *
 * IMPORTANT â€” NON-AUTHORITATIVE:
 * This calculation is purely advisory. It MUST NEVER override:
 *   - actual purse validation (V3Team.purse is authoritative)
 *   - minimum bid or bid increment rules
 *   - squad size or overseas limits
 *   - hard valuation clamps in server-bot-engine.ts
 *   - auction settlement rules
 *
 * Future phases may add target-specific reservations, cross-set budgeting,
 * or portfolio allocation. Those are NOT part of Phase 1C.
 */
function computeBudgetAllocation(
  bot: V3Team,
  botRoster: V3Player[],
  maxSquadSize: number,
  ctx: AuctionContext
): BudgetAllocation {
  const spentRatio = bot.initial_purse > 0
    ? (bot.initial_purse - bot.purse) / bot.initial_purse
    : 0;

  // Estimate how many critical/high-need role slots remain unfilled
  const roleCounts: Record<string, number> = {};
  for (const p of botRoster) {
    roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
  }

  const roles = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];
  let criticalSlots = 0;
  const remainingSlots = Math.max(0, maxSquadSize - bot.players_bought);

  for (const role of roles) {
    const count = roleCounts[role] || 0;
    const { need } = getRoleNeed(role, count, remainingSlots, maxSquadSize);
    if (need === 'CRITICAL') criticalSlots += 2;
    else if (need === 'HIGH') criticalSlots += 1;
  }

  const reserveForCriticalNeeds = criticalSlots * Math.max(ctx.futureMinBasePrice, 20);
  const discretionaryBudget = Math.max(0, bot.purse - reserveForCriticalNeeds);

  return Object.freeze({
    totalRemaining: bot.purse,
    reserveForCriticalNeeds,
    discretionaryBudget,
    spentRatio,
  });
}

/**
 * Determine strategic focus from auction state and beliefs.
 *
 * Logic (deterministic, checked in order):
 *   1. auctionProgress > 0.80               â†’ LATE_AUCTION
 *   2. spentRatio > 0.70 and urgency < 0.5  â†’ PROTECT_PURSE
 *   3. roleScarcityPanic >= 0.7             â†’ FILL_GAPS
 *   4. marketInflation < 0.2 and urgency < 0.4 â†’ TARGET_VALUE
 *   5. default                               â†’ BUILD_CORE
 */
function computeStrategicFocus(
  beliefs: BotBeliefs,
  urgency: number,
  spentRatio: number,
  auctionProgress: number
): StrategicFocus {
  if (auctionProgress > 0.80) return 'LATE_AUCTION';
  if (spentRatio > 0.70 && urgency < 0.5) return 'PROTECT_PURSE';
  if (beliefs.roleScarcityPanic >= 0.7) return 'FILL_GAPS';
  if (beliefs.marketInflation < 0.2 && urgency < 0.4) return 'TARGET_VALUE';
  return 'BUILD_CORE';
}

/**
 * Determine whether the bot would sacrifice an overseas slot for quality.
 *
 * Deterministic rule:
 *   true if overseas headroom is >= 3 AND squad quality is below 0.4
 *   (meaning the bot has plenty of overseas room and needs quality upgrades)
 */
function computeWillSacrificeOverseas(
  overseasCount: number,
  maxOverseas: number,
  squadQuality: number
): boolean {
  const headroom = maxOverseas - overseasCount;
  return headroom >= 3 && squadQuality < 0.4;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Input context required by the state updater.
 * Composed from data already available in tick/route.ts.
 */
export interface BotBrainStateInput {
  auctionId: string;
  teamId: string;
  bot: V3Team;
  botRoster: V3Player[];
  currentBid: number;
  basePrice: number;
  playerRole: string;
  playerIsOverseas: boolean;
  allTeams: V3Team[];
  teamRosters: Record<string, V3Player[]>;
  ctx: AuctionContext;
}

// ============================================================
// BOT BRAIN STATE CACHE
// ============================================================
//
// Authoritative in-memory cache for the LATEST BotBrainState snapshot
// per auction + team. This is NOT a history system â€” each update
// REPLACES the previous snapshot entirely.
//
// State ownership:
//   PAST EVENTS        â†’ BotMemory (bot-brain-memory.ts)
//   CURRENT BELIEFS    â†’ BotBrainState.beliefs (this cache)
//   CURRENT PLAN       â†’ BotBrainState.plan (this cache)
//
// Do NOT copy BotMemory arrays into this cache.
// Do NOT create separate caches for beliefs, plans, purchases, etc.
//
// Cleanup uses the same auction lifecycle boundary as BotMemory.
// ============================================================

/** Cache key: "auctionId_teamId" â†’ latest frozen BotBrainState */
const globalForBotBrainState = globalThis as unknown as {
  __BOT_BRAIN_STATE_CACHE__: Map<string, Readonly<BotBrainState>>;
};
const brainStateCache = globalForBotBrainState.__BOT_BRAIN_STATE_CACHE__ || new Map<string, Readonly<BotBrainState>>();
if (!globalForBotBrainState.__BOT_BRAIN_STATE_CACHE__) {
  globalForBotBrainState.__BOT_BRAIN_STATE_CACHE__ = brainStateCache;
}

function brainStateCacheKey(auctionId: string, teamId: string): string {
  return `${auctionId}_${teamId}`;
}

/**
 * Retrieve the latest cached BotBrainState snapshot for a given bot.
 *
 * Returns a frozen (read-only) object, or undefined if no state has
 * been calculated yet for this auction + team combination.
 *
 * Callers MUST NOT use the returned state to influence
 * evaluateBotsForLot() in Phase 1D. The state is observational only.
 */
export function getBotBrainState(auctionId: string, teamId: string): Readonly<BotBrainState> | undefined {
  return brainStateCache.get(brainStateCacheKey(auctionId, teamId));
}

/**
 * Clear cached BotBrainState entries for auctions that are no longer active.
 *
 * Uses the same cleanup boundary as clearInactiveAuctionMemory() in
 * bot-brain-memory.ts â€” any auction NOT in the provided activeAuctionIds
 * set has its cached state removed.
 *
 * This ensures the BotBrainState cache does not leak memory for
 * completed/cancelled auctions and shares the same lifecycle as BotMemory.
 */
export function clearInactiveBrainStateCache(activeAuctionIds: Set<string>): void {
  for (const key of Array.from(brainStateCache.keys())) {
    const auctionId = key.split('_')[0] as string;
    if (auctionId && !activeAuctionIds.has(auctionId)) {
      brainStateCache.delete(key);
    }
  }
}

/**
 * Clear ALL cached BotBrainState entries. Used by tests.
 */
export function clearBrainStateCache(): void {
  brainStateCache.clear();
}

/**
 * Compute the full BotBrainState (memory + beliefs + plan) and cache it.
 *
 * - Synchronous
 * - No network calls
 * - No database writes
 * - Does NOT mutate BotMemory
 * - Deterministic given same inputs
 * - REPLACES the previous cached snapshot for this auction + team
 */
export function updateBotBrainState(input: BotBrainStateInput): BotBrainState {
  const {
    auctionId, teamId, bot, botRoster,
    currentBid, basePrice, playerRole, playerIsOverseas,
    allTeams, teamRosters, ctx
  } = input;

  // 1. Obtain existing memory (read-only consumption)
  const memory = getBotMemory(auctionId, teamId);

  // 2. Compute next bid amount for rival analysis
  //
  // TODO: TEMPORARY TECHNICAL DEBT â€” Local bid-increment duplication.
  // The authoritative bid-increment logic lives in getNextBidAmount()
  // in server-bot-engine.ts. This is a local copy used ONLY for rival
  // eligibility estimation within BotBeliefs. It is NOT an auction-rule
  // authority and MUST NEVER control actual bidding.
  //
  // This duplication exists because server-bot-engine.ts must not be
  // modified in Phase 1C. It should be consolidated when a safe
  // read-only shared helper is available (e.g. a shared utils module
  // or when Phase 1E integration exposes it).
  let nextBidAmount: number;
  if (currentBid === 0) {
    nextBidAmount = basePrice;
  } else {
    let inc = 200;
    if (currentBid <= 300) inc = 25;
    else if (currentBid <= 600) inc = 50;
    else if (currentBid <= 1000) inc = 75;
    else if (currentBid <= 1500) inc = 100;
    else if (currentBid <= 2000) inc = 150;
    else if (currentBid <= 2500) inc = 175;
    nextBidAmount = currentBid + inc;
  }

  // 3. Calculate BotBeliefs
  const beliefs: BotBeliefs = {
    marketInflation: computeMarketInflation(currentBid, basePrice),
    roleScarcityPanic: computeRoleScarcityPanic(
      playerRole, botRoster, ctx.maxSquadSize, bot.players_bought
    ),
    rivalAggression: computeRivalAggression(
      bot, currentBid, basePrice, nextBidAmount,
      playerRole, playerIsOverseas,
      allTeams, teamRosters, ctx.maxSquadSize, ctx.maxOverseas
    ),
    estimatedSquadQuality: computeEstimatedSquadQuality(botRoster),
  };

  // 4. Calculate BotPlan
  const budgetAllocation = computeBudgetAllocation(bot, botRoster, ctx.maxSquadSize, ctx);
  const urgency = computeUrgency(
    memory, beliefs, bot.players_bought, ctx.maxSquadSize, ctx.auctionProgress
  );
  const strategicFocus = computeStrategicFocus(
    beliefs, urgency, budgetAllocation.spentRatio, ctx.auctionProgress
  );
  const willSacrificeOverseasForQuality = computeWillSacrificeOverseas(
    bot.overseas_count, ctx.maxOverseas, beliefs.estimatedSquadQuality
  );

  const plan: BotPlan = {
    urgency,
    budgetAllocation,
    strategicFocus,
    willSacrificeOverseasForQuality,
  };

  const state: BotBrainState = { memory, beliefs, plan };

  // 5. Cache the latest snapshot (REPLACEMENT, not accumulation).
  //    Freeze beliefs and plan (including nested budgetAllocation) so
  //    callers of getBotBrainState() cannot mutate cached strategic state.
  //    NOTE: BotMemory is NOT frozen â€” it is owned by Phase 1B and must
  //    remain mutable through its existing memory-management functions.
  Object.freeze(beliefs);
  // budgetAllocation is already frozen via Object.freeze() in computeBudgetAllocation,
  // but freeze it explicitly here for defense-in-depth.
  Object.freeze(plan.budgetAllocation);
  Object.freeze(plan);
  const frozenState = Object.freeze(state);
  brainStateCache.set(brainStateCacheKey(auctionId, teamId), frozenState);

  return frozenState;
}

/**
 * Re-evaluates and replans the bot's strategic brain state (beliefs + plan)
 * incorporating the latest factual BotMemory observations.
 * Semantic alias for updateBotBrainState representing the B17-B replanning phase.
 */
export const replanBotState = updateBotBrainState;

