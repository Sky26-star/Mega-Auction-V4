// src/lib/auction/bot-candidate-ordering.ts
//
// Canonical Deterministic Candidate Ordering Engine
//
// Locked Foundation Specification:
//   1. role ASC (alphabetical: ALL_ROUNDER < BATSMAN < BOWLER < WICKET_KEEPER)
//   2. rating DESC (numerical rating descending)
//   3. player_id ASC (lexicographical UUID ascending tie-break)
//
// Zero dependency on DB return order or JS insertion order.
// Zero Math.random(). 100% deterministic across all runs.

export interface CandidateSortable {
  player_id?: string;
  role: string;
  rating?: number | null;
  category?: string;
  base_price?: number;
  is_overseas?: boolean;
}

/**
 * Estimates quality rating from category for future candidates behind the info firewall.
 */
export function estimateCategoryRating(category?: string): number {
  const cat = (category || '').toUpperCase().trim();
  if (cat === 'MARQUEE' || cat === 'ICON') return 88;
  if (cat === 'A' || cat === 'ELITE') return 85;
  if (cat === 'B' || cat === 'PREMIER') return 82;
  if (cat === 'C' || cat === 'CORE') return 79;
  if (cat === 'D' || cat === 'RISING') return 76;
  return 74;
}

/**
 * Canonical deterministic comparator for candidates.
 *
 * Sorts:
 *   1. role ASC
 *   2. rating DESC
 *   3. player_id ASC
 */
export function compareCandidatesDeterministic(
  a: CandidateSortable,
  b: CandidateSortable
): number {
  // 1. role ASC
  const roleA = (a.role || '').toUpperCase().trim();
  const roleB = (b.role || '').toUpperCase().trim();
  if (roleA !== roleB) {
    return roleA.localeCompare(roleB);
  }

  // 2. rating DESC
  const ratingA = a.rating != null ? a.rating : estimateCategoryRating(a.category);
  const ratingB = b.rating != null ? b.rating : estimateCategoryRating(b.category);
  if (ratingA !== ratingB) {
    return ratingB - ratingA; // higher rating first
  }

  // 3. player_id ASC (Canonical tie-break)
  const idA = a.player_id || '';
  const idB = b.player_id || '';
  return idA.localeCompare(idB);
}

/**
 * Sorts an array of candidates into canonical deterministic order.
 * Returns a new sorted array without mutating input.
 */
export function sortCandidatesDeterministic<T extends CandidateSortable>(
  candidates: T[]
): T[] {
  return [...candidates].sort(compareCandidatesDeterministic);
}
