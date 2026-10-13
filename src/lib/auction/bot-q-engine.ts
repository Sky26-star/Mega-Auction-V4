// src/lib/auction/bot-q-engine.ts
//
// Authoritative Foundation Q & True Value (TV) Engine
//
// MATHEMATICAL CONTRACT (Locked Foundation):
// 1. Q() is the authoritative exact roster optimization mechanism.
// 2. Q_buy(B) is strictly monotonic non-increasing over legal bid ladder values.
// 3. TV is the maximum discrete legal bid B on the authoritative ladder satisfying:
//      Q_buy(B) >= Q_skip
// 4. Decision Rule:
//      Q_buy(B_req) > Q_skip  => BID
//      Q_buy(B_req) <= Q_skip => PASS / DROP (or bounded STRETCH)
// 5. Zero arbitrary rating-to-money continuous power curves.
// 6. Zero independent opportunity-cost multipliers (inherently captured in Q_skip).
// 7. Hard legality constraints (purse, squad slots, overseas) are strictly enforced.

import { type V3Player, type V3Team } from '../v3-auction-types';
import { type CandidateSortable, sortCandidatesDeterministic, estimateCategoryRating } from './bot-candidate-ordering';
import { getNextBidAmount } from './server-bot-engine';

// ============================================================
// TYPES
// ============================================================

export interface TeamRosterState {
  purse: number; // in Lakhs
  playersBought: number;
  overseasCount: number;
  roleCounts: Record<string, number>;
}

export interface QEvaluationResult {
  currentBid: number;
  nextRequiredBid: number;
  tv: number;
  qSkip: number;
  qBuyAtRequiredBid: number;
  decision: 'BID' | 'PASS';
  isLegal: boolean;
  legalityReason?: string;
  ladderEvaluated: number[];
}

export interface AuctionRuleBounds {
  maxSquadSize: number;
  maxOverseas: number;
}

// ============================================================
// BID LADDER GENERATION
// ============================================================

/**
 * Generates the discrete legal bid ladder starting from startingBid up to maxPurse.
 * Uses the exact authoritative Mega Auction bid increment tiers.
 */
export function generateDiscreteBidLadder(
  currentBid: number,
  basePrice: number,
  maxPurse: number
): number[] {
  const ladder: number[] = [];
  let runner = getNextBidAmount(currentBid, basePrice);

  while (runner <= maxPurse) {
    ladder.push(runner);
    const next = getNextBidAmount(runner, basePrice);
    if (next <= runner) break; // Safety against infinite loop
    runner = next;
  }

  return ladder;
}

// ============================================================
// MARGINAL ROSTER UTILITY FUNCTION (U_roster)
// ============================================================

/**
 * Target composition by role for an IPL squad of 25 players (scaled linearly for other sizes).
 */
export function getRoleTargetBounds(maxSquadSize: number = 25): Record<string, { min: number; ideal: number }> {
  const scale = Math.max(0.5, maxSquadSize / 25);
  return {
    WICKET_KEEPER: { min: Math.max(1, Math.round(2 * scale)), ideal: Math.max(2, Math.round(3 * scale)) },
    BATSMAN:       { min: Math.max(2, Math.round(5 * scale)), ideal: Math.max(3, Math.round(7 * scale)) },
    ALL_ROUNDER:   { min: Math.max(2, Math.round(3 * scale)), ideal: Math.max(3, Math.round(5 * scale)) },
    BOWLER:        { min: Math.max(2, Math.round(6 * scale)), ideal: Math.max(3, Math.round(8 * scale)) },
  };
}

/**
 * Calculates the marginal utility of adding a candidate to the current roster state.
 *
 * U(candidate | state) = PlayerQuality * RoleNeedWeight
 * - If role count is 0 and min >= 1: Critical urgency (weight 1.50)
 * - If role count < min: High urgency (weight 1.25)
 * - If role count <= ideal: Normal utility (weight 1.00)
 * - If role count > ideal: Diminishing returns (weight 0.40)
 * - If squad is full: 0
 */
export function computeMarginalUtility(
  candidateRole: string,
  candidateRating: number,
  roleCounts: Record<string, number>,
  remainingSlots: number,
  maxSquadSize: number = 25
): number {
  if (remainingSlots <= 0) return 0;

  const currentCount = roleCounts[candidateRole] || 0;
  const targets = getRoleTargetBounds(maxSquadSize);
  const target = targets[candidateRole] || { min: 2, ideal: 5 };

  let roleWeight = 1.0;
  if (currentCount === 0 && target.min >= 1) {
    roleWeight = candidateRole === 'WICKET_KEEPER' ? 1.55 : 1.40;
  } else if (currentCount < target.min) {
    roleWeight = 1.20;
  } else if (currentCount <= target.ideal) {
    roleWeight = 1.00;
  } else {
    // Redundant or excess depth
    roleWeight = Math.max(0.1, 0.40 - ((currentCount - target.ideal) * 0.15));
  }

  // Base utility normalized around quality range (74 - 98)
  const baseUtility = Math.max(10, candidateRating - 60);

  return baseUtility * roleWeight;
}

// ============================================================
// CORE Q RECURRENCE & TRUE VALUE EVALUATION
// ============================================================

/**
 * Recursive dynamic programming formulation for forward auction expectation Q.
 *
 * Evaluates the deterministic top future candidates to determine Q_skip
 * and Q_buy(B) over the legal bid ladder.
 */
export function evaluateQAndTV(
  currentCandidate: CandidateSortable,
  futureCandidates: CandidateSortable[],
  teamState: TeamRosterState,
  currentBid: number,
  isHighestBidder: boolean,
  bounds: AuctionRuleBounds = { maxSquadSize: 25, maxOverseas: 8 },
  isPreSorted: boolean = false
): QEvaluationResult {
  const basePrice = currentCandidate.base_price || 20;
  const nextRequiredBid = getNextBidAmount(currentBid, basePrice);
  const remainingSlots = Math.max(0, bounds.maxSquadSize - teamState.playersBought);
  const remainingOS = Math.max(0, bounds.maxOverseas - teamState.overseasCount);

  // 1. HARD LEGALITY CHECKS
  if (isHighestBidder) {
    return {
      currentBid,
      nextRequiredBid,
      tv: 0,
      qSkip: 0,
      qBuyAtRequiredBid: 0,
      decision: 'PASS',
      isLegal: false,
      legalityReason: 'ERR_ALREADY_HIGHEST_BIDDER',
      ladderEvaluated: []
    };
  }

  if (remainingSlots <= 0) {
    return {
      currentBid,
      nextRequiredBid,
      tv: 0,
      qSkip: 0,
      qBuyAtRequiredBid: 0,
      decision: 'PASS',
      isLegal: false,
      legalityReason: 'ERR_SQUAD_LIMIT_REACHED',
      ladderEvaluated: []
    };
  }

  if (currentCandidate.is_overseas && remainingOS <= 0) {
    return {
      currentBid,
      nextRequiredBid,
      tv: 0,
      qSkip: 0,
      qBuyAtRequiredBid: 0,
      decision: 'PASS',
      isLegal: false,
      legalityReason: 'ERR_OVERSEAS_LIMIT',
      ladderEvaluated: []
    };
  }

  const remainingSlotsAfterBuy = Math.max(0, remainingSlots - 1);
  const minRequiredReserve = remainingSlotsAfterBuy * 20;
  const maxSolventPurse = teamState.purse - minRequiredReserve;

  // Hard engine legality check: does the team have enough purse for next required bid?
  if (teamState.purse < nextRequiredBid) {
    return {
      currentBid,
      nextRequiredBid,
      tv: 0,
      qSkip: 0,
      qBuyAtRequiredBid: 0,
      decision: 'PASS',
      isLegal: false,
      legalityReason: 'ERR_INSUFFICIENT_PURSE',
      ladderEvaluated: []
    };
  }

  // Strategic reserve defense: preserve 20L per remaining unfilled squad slot
  if (maxSolventPurse < nextRequiredBid) {
    return {
      currentBid,
      nextRequiredBid,
      tv: 0,
      qSkip: 0,
      qBuyAtRequiredBid: 0,
      decision: 'PASS',
      isLegal: true, // Legally valid in auction engine, strategically declined by bot
      legalityReason: 'STRATEGIC_PURSE_INSOLVENCY',
      ladderEvaluated: []
    };
  }

  // 2. SORT FUTURE CANDIDATES DETERMINISTICALLY (Reuses pre-sorted pool if available)
  const sortedPool = isPreSorted ? futureCandidates : sortCandidatesDeterministic(futureCandidates);
  // Filter for top relevant candidates to bound DP state space (O(K) where K <= 8)
  const poolSubset = selectTopRelevantCandidates(sortedPool, remainingSlots);

  const memo = new Map<any, number>();

  // 3. COMPUTE Q_SKIP (Utility of skipping current player and continuing optimally)
  const qSkip = computeForwardQ(
    0,
    poolSubset,
    teamState.purse,
    remainingSlots,
    remainingOS,
    { ...teamState.roleCounts },
    bounds.maxSquadSize,
    memo
  );

  // 4. DISCRETE BID LADDER SEARCH FOR TV
  // Ladder contains all valid bids from basePrice up to max solvent purse to find absolute TV
  const fullLadder = generateDiscreteBidLadder(0, basePrice, maxSolventPurse);
  const candidateRating = currentCandidate.rating != null
    ? currentCandidate.rating
    : estimateCategoryRating(currentCandidate.category);

  const immediateUtility = computeMarginalUtility(
    currentCandidate.role,
    candidateRating,
    teamState.roleCounts,
    remainingSlots,
    bounds.maxSquadSize
  );

  let tv = 0;
  let qBuyAtRequired = 0;
  const ladderEvaluated: number[] = [];

  for (let idx = 0; idx < fullLadder.length; idx++) {
    const bid = fullLadder[idx]!;
    ladderEvaluated.push(bid);

    // Q_buy(B) = MarginalUtility(Current) + Q_forward(Purse - B, Slots - 1)
    const newRoleCounts = { ...teamState.roleCounts };
    newRoleCounts[currentCandidate.role] = (newRoleCounts[currentCandidate.role] || 0) + 1;
    const newOS = currentCandidate.is_overseas ? remainingOS - 1 : remainingOS;

    const futureValAfterBuy = computeForwardQ(
      0,
      poolSubset,
      teamState.purse - bid,
      remainingSlots - 1,
      newOS,
      newRoleCounts,
      bounds.maxSquadSize,
      memo
    );

    const qBuy = immediateUtility + futureValAfterBuy;

    if (bid === nextRequiredBid) {
      qBuyAtRequired = qBuy;
    } else if (idx === 0 && bid > nextRequiredBid) {
      // Should not happen since we start from 0, but just in case
      qBuyAtRequired = qBuy;
    }

    // Monotonic stopping rule:
    // As bid increases, remaining purse decreases, so futureValAfterBuy strictly decreases.
    // As soon as Q_buy(B) < Q_skip, stop.
    if (qBuy >= qSkip) {
      tv = bid;
    } else {
      // Monotonic early stop
      break;
    }
  }

  // 5. CANONICAL DECISION
  // Q_buy(nextRequiredBid) > Q_skip => BID
  // Q_buy(nextRequiredBid) <= Q_skip => PASS/DROP
  const decision: 'BID' | 'PASS' = (nextRequiredBid <= tv && qBuyAtRequired > qSkip) ? 'BID' : 'PASS';

  return {
    currentBid,
    nextRequiredBid,
    tv,
    qSkip,
    qBuyAtRequiredBid: qBuyAtRequired,
    decision,
    isLegal: true,
    ladderEvaluated
  };
}

// ============================================================
// HELPER FORWARD Q FOR DP EVALUATION
// ============================================================

/**
 * Marginal utility of unspent purse capital (exchange rate: 0.025 util per Lakh = 1 util per 40 Lakhs).
 * Governs the terminal value of retained liquidity when future pools are exhausted.
 */
export const CAPITAL_UTILITY_RATE = 0.025;

/**
 * Computes forward expected utility Q over the top future candidates.
 * Memoized per step with bounded pool using zero-allocation numeric keys.
 */
function computeForwardQ(
  index: number,
  pool: CandidateSortable[],
  purse: number,
  slotsRemaining: number,
  osRemaining: number,
  roleCounts: Record<string, number>,
  maxSquadSize: number,
  memo?: Map<any, number>
): number {
  if (purse <= 0) {
    return 0;
  }
  if (slotsRemaining <= 0 || index >= pool.length) {
    // Residual utility of unspent purse capital
    return purse * CAPITAL_UTILITY_RATE;
  }

  // Fast numeric key (using exact purse since it can be large, string key is safer)
  // We need to include role counts for the subset of roles that matter, but since max depth is small,
  // we can just use a string key.
  const memoKey = memo
    ? `${index}-${purse}-${slotsRemaining}-${osRemaining}-${roleCounts['BATSMAN'] || 0}-${roleCounts['BOWLER'] || 0}-${roleCounts['ALL_ROUNDER'] || 0}-${roleCounts['WICKET_KEEPER'] || 0}`
    : null;

  if (memo && memoKey !== null) {
    const cached = memo.get(memoKey as any); // Using map with string keys now
    if (cached !== undefined) return cached;
  }

  const candidate = pool[index]!;
  const expectedPrice = candidate.base_price || 20;

  // Path 1: SKIP candidate
  const valSkip = computeForwardQ(
    index + 1,
    pool,
    purse,
    slotsRemaining,
    osRemaining,
    roleCounts,
    maxSquadSize,
    memo
  );

  // Path 2: BUY candidate (if legal)
  const isOS = candidate.is_overseas || false;
  if (purse >= expectedPrice && (!isOS || osRemaining > 0)) {
    const rating = candidate.rating != null ? candidate.rating : estimateCategoryRating(candidate.category);
    const marginalU = computeMarginalUtility(candidate.role, rating, roleCounts, slotsRemaining, maxSquadSize);

    const nextRoleCounts = { ...roleCounts };
    nextRoleCounts[candidate.role] = (nextRoleCounts[candidate.role] || 0) + 1;

    const valBuy = marginalU + computeForwardQ(
      index + 1,
      pool,
      purse - expectedPrice,
      slotsRemaining - 1,
      isOS ? osRemaining - 1 : osRemaining,
      nextRoleCounts,
      maxSquadSize,
      memo
    );

    const result = Math.max(valSkip, valBuy);
    if (memo && memoKey !== null) memo.set(memoKey, result);
    return result;
  }

  if (memo && memoKey !== null) memo.set(memoKey, valSkip);
  return valSkip;
}

/**
 * Selects the top relevant candidates from the deterministically sorted pool.
 * Takes the top candidates across each needed role up to bounded limit (top 2 per role, <= 8 total).
 */
function selectTopRelevantCandidates(
  sortedPool: CandidateSortable[],
  slotsRemaining: number
): CandidateSortable[] {
  const selected: CandidateSortable[] = [];
  const perRoleCount: Record<string, number> = {};
  const maxPerRole = 2;

  for (const c of sortedPool) {
    const count = perRoleCount[c.role] || 0;
    if (count < maxPerRole) {
      selected.push(c);
      perRoleCount[c.role] = count + 1;
    }
    if (selected.length >= 8) break;
  }

  return selected;
}
