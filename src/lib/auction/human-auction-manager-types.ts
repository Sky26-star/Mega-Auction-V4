// src/lib/auction/human-auction-manager-types.ts
//
// Human Auction Manager — Phase 1: CONTRACTS ONLY
//
// PURPOSE:
//   Defines the data contracts for the future centralized Human Auction Manager
//   decision pipeline:
//
//     PlayerContext
//       → PlayerQualityResult          "How good is he?"
//       → PlayerMarketValueResult      "What is he generally worth?"
//       → TeamValueResult              "What is he worth to MY team?"
//       → MaximumBidResult             "What is the most I can rationally pay?"
//       → HumanAuctionDecision         "What should I do right now?"
//
// PHASE 1 BOUNDARY:
//   - Types only. No runtime logic, no formulas, no thresholds, no ₹ values.
//   - NOT wired into server-bot-engine / bot-q-engine / bot-tactical-engine.
//   - All imports are `import type` → erased at compile time, so this module
//     adds zero runtime dependencies and cannot create import cycles.
//
// MONETARY UNIT:
//   All monetary fields are in LAKHS (₹ L), matching V3Team.purse,
//   V3Player.base_price and the existing bid ladder (e.g. 1400 = ₹14 Cr).
//
// STAGE ISOLATION RULES (enforced structurally by the stage contexts below):
//   - Market Value never sees team need, purse, opponents or future targets.
//   - Team Value never sees purse limits or opponents.
//   - Maximum Bid never sees opponents.
//   - Opponent information only enters at the Decision stage. It changes how
//     the bot behaves AROUND its valuation, never the valuation itself.

import type { V3Player, V3PlayerCategory, V3PlayerRole } from '../v3-auction-types';
import type { RoleNeed } from './server-bot-engine';
import type { StructuralFitCategory } from './bot-candidate-alignment';
import type { AlternativeAvailability } from './bot-squad-alternative-intelligence';
import type { PriorityLevel } from './bot-squad-priority-intelligence';
import type { RivalPurchaseEvent } from './bot-brain-memory';

// ============================================================
// SHARED PRIMITIVES
// ============================================================

/** Monetary amount in Lakhs (repository-wide convention). */
export type Lakhs = number;

/** Normalised confidence in the range 0.0 → 1.0. */
export type ConfidenceScore = number;

/** Human-readable explanation lines attached to every stage result. */
export type ReasonList = readonly string[];

// ============================================================
// 1. PLAYER CONTEXT (raw player facts — "Who is this player?")
// ============================================================

/**
 * Subset of V3Player required by the manager. Derived from V3Player via Pick
 * so the player shape is never duplicated. Contains NO team-specific data.
 */
export type PlayerContext = Readonly<
  Pick<V3Player, 'id' | 'name' | 'role' | 'category' | 'base_price' | 'is_overseas' | 'rating'>
>;

// ============================================================
// 2. PLAYER QUALITY ("How good is he?")
// ============================================================

/**
 * Where the rating value came from. Mirrors the existing runtime fallback
 * `candidate.rating ?? estimateCategoryRating(candidate.category)`.
 */
export type PlayerRatingSource =
  | 'STORED_RATING'       // V3Player.rating (immutable, from player-rating.ts engine)
  | 'CATEGORY_ESTIMATE';  // Fallback from public auction category metadata

/** Input to the Player Quality stage. */
export interface PlayerQualityContext {
  readonly player: PlayerContext;
}

export interface PlayerStatisticalEvidence {
  readonly productionScore: number;
  readonly efficiencyScore: number;
  readonly peakScore: number;
  readonly experienceScore: number;
  readonly overallEvidenceScore: number;
  readonly sampleCategory: 'INSUFFICIENT' | 'LIMITED' | 'REGULAR' | 'ESTABLISHED' | 'VETERAN';
  readonly sampleWeight?: number;
  readonly isDualThreat?: boolean;
}

/** Output of the Player Quality stage. Knows nothing about any team. */
export interface PlayerQualityResult {
  readonly playerId: string;
  readonly role: V3PlayerRole;
  /** Rating on the existing 74–98 scale. */
  readonly rating: number;
  readonly ratingSource: PlayerRatingSource;
  /**
   * Existing auction category (MARQUEE/A/B/C/D). No separate quality-tier
   * classification exists in the codebase yet; this field carries the
   * established public tier rather than inventing a new one.
   */
  readonly tier: V3PlayerCategory;
  readonly confidence?: ConfidenceScore;
  readonly statisticalEvidence?: PlayerStatisticalEvidence;
}

// ============================================================
// 3. MARKET VALUE ("What is he generally worth in this auction?")
// ============================================================

/**
 * Input to the Market Value stage.
 * Deliberately has NO team, purse, opponent or future-plan fields.
 * Market-level signals are optional until a market model exists.
 */
export interface MarketValueContext {
  readonly player: PlayerContext;
  readonly quality: PlayerQualityResult;
  readonly market?: {
    /** Completed sale prices observed so far in this auction (public). */
    readonly observedSalePrices?: readonly Lakhs[];
    /** Remaining unsold players of the same role (public queue). */
    readonly remainingRolePoolCount?: number;
  };
}

/** Output of the Market Value stage. Team-agnostic by construction. */
export interface PlayerMarketValueResult {
  readonly playerId: string;
  readonly marketValue: Lakhs;
  readonly confidence: ConfidenceScore;
  /** The quality input that produced this value (for explainability). */
  readonly playerQuality: PlayerQualityResult;
  readonly reasons: ReasonList;
}

/** Short alias used in the boundary spec. */
export type MarketValueResult = PlayerMarketValueResult;

// ============================================================
// 4. TEAM-SPECIFIC FACTORS
// ============================================================

/** Human-manager need scale for the player's role. */
export type TeamNeedLevel = 'NOT_NEEDED' | 'OPTIONAL' | 'USEFUL' | 'IMPORTANT' | 'CRITICAL';

export interface TeamNeedContext {
  readonly role: V3PlayerRole;
  readonly level: TeamNeedLevel;
  readonly currentRoleCount: number;
  /** Minimum required count for this role (existing role target bounds). */
  readonly requiredRoleCount: number;
  readonly idealRoleCount?: number;
  readonly remainingSquadSlots: number;
  /** Best-XI requirement for this role. No best-XI model exists yet → null. */
  readonly bestXIRequirement?: number | null;
  /** Traceability back to existing intelligence (not authoritative). */
  readonly legacyRoleNeed?: RoleNeed;
  readonly rolePriority?: PriorityLevel;
}

export type XIImprovementLevel =
  | 'NONE'
  | 'DEPTH'
  | 'USEFUL_STARTER'
  | 'MAJOR_UPGRADE'
  | 'TRANSFORMATIVE';

export interface XIImprovementContext {
  readonly level: XIImprovementLevel;
  readonly reasons?: ReasonList;
}

export type ScarcityLevel = 'ABUNDANT' | 'NORMAL' | 'SCARCE' | 'VERY_SCARCE';

export interface PlayerScarcityContext {
  readonly level: ScarcityLevel;
  /** Count of meaningful equivalent alternatives still in the pool. */
  readonly meaningfulAlternativesRemaining: number;
  /** Existing 2F alternative-intelligence classification, if available. */
  readonly alternativeAvailability?: AlternativeAvailability;
  readonly rolePoolRemaining?: number;
  readonly categoryPoolRemaining?: number;
}

export type TeamFitLevel = 'POOR' | 'NEUTRAL' | 'GOOD' | 'EXCELLENT';

export interface TeamFitContext {
  readonly level: TeamFitLevel;
  /** Existing structural fit from bot-candidate-alignment, if available. */
  readonly structuralFit?: StructuralFitCategory;
}

export type FuturePlanPriority = 'MUST_HAVE' | 'SHOULD_HAVE' | 'OPTIONAL';

export interface FutureRoleRequirement {
  readonly role: V3PlayerRole;
  readonly count: number;
}

export interface FuturePlanContext {
  readonly priority: FuturePlanPriority;
  readonly futureRequiredRoles: readonly FutureRoleRequirement[];
  /** Budget the team expects to protect for future requirements. */
  readonly protectedFutureBudget: Lakhs;
  readonly remainingCriticalTargets: number;
}

// ============================================================
// 5. PURSE POSITION
// ============================================================

export type PurseHealth = 'SAFE' | 'TIGHT' | 'DANGEROUS';

export interface PursePositionContext {
  readonly currentPurse: Lakhs;
  readonly initialPurse?: Lakhs;
  readonly remainingSquadSlots: number;
  /** Minimum spend required to legally complete the squad (base-price floor). */
  readonly minimumRequiredFutureSpend: Lakhs;
  /** Strategic reserve for future needs, if available (not authoritative). */
  readonly protectedFutureBudget?: Lakhs;
  readonly health: PurseHealth;
}

// ============================================================
// 6. AUCTION STAGE
// ============================================================

export type AuctionStage = 'EARLY' | 'MID' | 'LATE' | 'ENDGAME';

// ============================================================
// 7. OPPONENT CONTEXT (enters ONLY at Decision stage)
// ============================================================

export type OpponentThreatLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface OpponentRoleCount {
  readonly role: V3PlayerRole;
  readonly count: number;
}

/** Public, structured facts about one opponent. No psychology model. */
export interface OpponentTeamContext {
  readonly teamId: string;
  readonly purse: Lakhs;
  readonly remainingSlots: number;
  readonly roleCounts: readonly OpponentRoleCount[];
  readonly missingRoles: readonly V3PlayerRole[];
  readonly relevantPurchases: readonly RivalPurchaseEvent[];
  readonly threat: OpponentThreatLevel;
}

export interface OpponentContext {
  readonly opponents: readonly OpponentTeamContext[];
  /** Current highest bidder on the lot, or null if no bid yet. */
  readonly highestBidderTeamId: string | null;
}

// ============================================================
// 8. TEAM VALUE ("What is he worth to MY team?")
// ============================================================

export interface TeamValueFactors {
  readonly need: TeamNeedContext;
  readonly xiImprovement: XIImprovementContext;
  readonly scarcity: PlayerScarcityContext;
  readonly teamFit: TeamFitContext;
  readonly futurePlan: FuturePlanContext;
}

/** Input to the Team Value stage. No purse limits, no opponents. */
export interface TeamValueContext extends TeamValueFactors {
  readonly teamId: string;
  readonly player: PlayerContext;
  readonly marketValue: PlayerMarketValueResult;
  readonly currentRoster: readonly V3Player[];
}

/**
 * Strategic commitment classification: how strongly the existing squad context
 * justifies committing the team's remaining legal bidding capacity to this player.
 * Owned by Phase 4 consequence semantics.
 */
export type StrategicCommitment =
  | 'NOT_COMMITTED'
  | 'JUSTIFIED'
  | 'COMMITTED';

/**
 * Output of the Team Value stage.
 * Team Value is NOT Maximum Bid — affordability is applied later.
 */
export interface TeamValueResult {
  readonly teamId: string;
  readonly playerId: string;
  readonly marketValue: Lakhs;
  readonly teamValue: Lakhs;
  readonly factors: TeamValueFactors;
  readonly strategicCommitment: StrategicCommitment;
  readonly reasons: ReasonList;
}

// ============================================================
// 9. MAXIMUM BID ("What is the most I can rationally pay?")
// ============================================================

/** Input to the Maximum Bid stage. No opponents. */
export interface MaximumBidContext {
  readonly teamValue: TeamValueResult;
  readonly purse: PursePositionContext;
  readonly auctionStage: AuctionStage;
  readonly currentBid: Lakhs;
  readonly nextRequiredBid: Lakhs;
  /**
   * Protected future budget that must remain available for remaining critical/future squad requirements.
   * Headroom available for this bid = `currentPurse - futureBudget`.
   */
  readonly futureBudget: Lakhs;
}

export interface MaximumBidConstraints {
  /** Hard ceiling from current purse. */
  readonly purseLimit: Lakhs;
  /** Ceiling after protecting the planned future budget. */
  readonly futureBudgetLimit: Lakhs;
  /** Ceiling that still allows legal squad completion. */
  readonly solvencyLimit: Lakhs;
}

/** Which limit actually determined maximumBid. */
export type BindingConstraint = 'TEAM_VALUE' | 'PURSE' | 'FUTURE_BUDGET' | 'SOLVENCY';

export interface MaximumBidResult {
  readonly teamValue: Lakhs;
  readonly maximumBid: Lakhs;
  readonly constraints: MaximumBidConstraints;
  readonly bindingConstraint: BindingConstraint;
  /** All constraints tied at the minimum raw ceiling (if multiple financial ceilings are equal). */
  readonly tiedConstraints?: readonly BindingConstraint[];
  readonly auctionStage: AuctionStage;
  readonly reasons: ReasonList;
}

// ============================================================
// 10. DECISION ("What should I do right now?")
// ============================================================

/** Input to the Decision stage — the first stage that sees opponents. */
export interface DecisionContext {
  readonly player: PlayerContext;
  readonly marketValue: PlayerMarketValueResult;
  readonly teamValue: TeamValueResult;
  readonly maximumBid: MaximumBidResult;
  readonly opponent: OpponentContext;
  readonly currentBid: Lakhs;
  readonly nextRequiredBid: Lakhs;
  readonly auctionStage: AuctionStage;
}

// ============================================================
// 10A. PRICE POSITION (Phase 7A — descriptive commitment semantics)
// ============================================================
//
// Answers ONLY: "Where does the current legal next bid sit relative to the
// Phase 5 maximum-bid ceiling, according to the auction's legal bid ladder?"
//
// - Derived from the existing bid ladder (getNextBidAmount), not from any
//   percentage, CR band, or bid-count threshold.
// - Never modifies maximumBid / teamValue / marketValue.
// - Never returns BID / STRETCH / PASS (Phase 7 owns actions).

/**
 * HEADROOM_REMAINS — nextRequiredBid <= maximumBid AND the following legal
 *   ladder bid after nextRequiredBid is also <= maximumBid. The team could
 *   bid now and still legally respond to one more raise.
 * FINAL_LEGAL_STEP — nextRequiredBid <= maximumBid BUT the following legal
 *   ladder bid exceeds maximumBid. This is the last bid the team can make on
 *   this lot within its ceiling (the repository's "one-last-bid" concept).
 * BEYOND_CEILING — nextRequiredBid > maximumBid. No legal continuation.
 */
export type PricePositionState = 'HEADROOM_REMAINS' | 'FINAL_LEGAL_STEP' | 'BEYOND_CEILING';

/** Narrow input: only the auction-mechanical facts needed. */
export interface PricePositionContext {
  readonly nextRequiredBid: Lakhs;
  /** Exactly MaximumBidResult.maximumBid from Phase 5. */
  readonly maximumBid: Lakhs;
  /** Player base price — the only extra input the legal ladder accepts. */
  readonly basePrice: Lakhs;
}

export interface PricePositionResult {
  readonly state: PricePositionState;
  readonly nextRequiredBid: Lakhs;
  /** Echo of the Phase 5 ceiling, unmodified. */
  readonly maximumBid: Lakhs;
  /** Ladder bid after nextRequiredBid; null when BEYOND_CEILING. */
  readonly followingLegalBid: Lakhs | null;
  /** nextRequiredBid === maximumBid (descriptive; always a FINAL_LEGAL_STEP). */
  readonly isExactlyAtCeiling: boolean;
  readonly reasons: ReasonList;
}

export type HumanAuctionAction = 'BID' | 'STRETCH' | 'PASS';

export type HumanDecisionFactorKind =
  | 'TEAM_NEED'
  | 'XI_IMPROVEMENT'
  | 'SCARCITY'
  | 'TEAM_FIT'
  | 'FUTURE_PLAN'
  | 'PURSE'
  | 'OPPONENT'
  | 'AUCTION_STAGE'
  | 'PRICE_VS_MAXIMUM';

export interface HumanDecisionFactor {
  readonly kind: HumanDecisionFactorKind;
  readonly detail: string;
}

interface HumanAuctionDecisionBase {
  readonly playerId: string;
  readonly teamId: string;
  readonly maximumBid: Lakhs;
  readonly teamValue: Lakhs;
  readonly marketValue: Lakhs;
  readonly reason: string;
  readonly factors: readonly HumanDecisionFactor[];
  readonly confidence?: ConfidenceScore;
}

export interface HumanBidDecision extends HumanAuctionDecisionBase {
  readonly action: 'BID';
  readonly bidAmount: Lakhs;
}

export interface HumanStretchDecision extends HumanAuctionDecisionBase {
  readonly action: 'STRETCH';
  readonly bidAmount: Lakhs;
}

export interface HumanPassDecision extends HumanAuctionDecisionBase {
  readonly action: 'PASS';
}

/** The only output that should eventually control the bot action. */
export type HumanAuctionDecision = HumanBidDecision | HumanStretchDecision | HumanPassDecision;

// ============================================================
// 11. MASTER CONTEXT (assembled envelope)
// ============================================================

/**
 * Single assembled envelope of every manager input, for orchestration and
 * logging. Stages must NOT consume this whole object: each stage receives
 * only its narrow context (MarketValueContext, TeamValueContext,
 * MaximumBidContext, DecisionContext) built from these fields.
 */
export interface HumanAuctionManagerContext {
  readonly teamId: string;
  readonly player: PlayerContext;
  readonly playerQuality: PlayerQualityResult;
  readonly marketValue: PlayerMarketValueResult;
  readonly teamNeed: TeamNeedContext;
  readonly xiImprovement: XIImprovementContext;
  readonly scarcity: PlayerScarcityContext;
  readonly teamFit: TeamFitContext;
  readonly futurePlan: FuturePlanContext;
  readonly purse: PursePositionContext;
  readonly opponent: OpponentContext;
  readonly auctionStage: AuctionStage;
  readonly currentBid: Lakhs;
  readonly nextRequiredBid: Lakhs;
}

// ============================================================
// 12. FUTURE PIPELINE SIGNATURES (type-level only, NOT implemented)
// ============================================================

export type PlayerQualityStage = (ctx: PlayerQualityContext) => PlayerQualityResult;
export type MarketValueStage = (ctx: MarketValueContext) => PlayerMarketValueResult;
export type TeamValueStage = (ctx: TeamValueContext) => TeamValueResult;
export type MaximumBidStage = (ctx: MaximumBidContext) => MaximumBidResult;
export type PricePositionStage = (ctx: PricePositionContext) => PricePositionResult;
export type DecisionStage = (ctx: DecisionContext) => HumanAuctionDecision;
