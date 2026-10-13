"use strict";
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateCategoryRating = estimateCategoryRating;
exports.compareCandidatesDeterministic = compareCandidatesDeterministic;
exports.sortCandidatesDeterministic = sortCandidatesDeterministic;
/**
 * Estimates quality rating from category for future candidates behind the info firewall.
 */
function estimateCategoryRating(category) {
    var cat = (category || '').toUpperCase().trim();
    if (cat === 'MARQUEE' || cat === 'ICON')
        return 88;
    if (cat === 'A' || cat === 'ELITE')
        return 85;
    if (cat === 'B' || cat === 'PREMIER')
        return 82;
    if (cat === 'C' || cat === 'CORE')
        return 79;
    if (cat === 'D' || cat === 'RISING')
        return 76;
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
function compareCandidatesDeterministic(a, b) {
    // 1. role ASC
    var roleA = (a.role || '').toUpperCase().trim();
    var roleB = (b.role || '').toUpperCase().trim();
    if (roleA !== roleB) {
        return roleA.localeCompare(roleB);
    }
    // 2. rating DESC
    var ratingA = a.rating != null ? a.rating : estimateCategoryRating(a.category);
    var ratingB = b.rating != null ? b.rating : estimateCategoryRating(b.category);
    if (ratingA !== ratingB) {
        return ratingB - ratingA; // higher rating first
    }
    // 3. player_id ASC (Canonical tie-break)
    var idA = a.player_id || '';
    var idB = b.player_id || '';
    return idA.localeCompare(idB);
}
/**
 * Sorts an array of candidates into canonical deterministic order.
 * Returns a new sorted array without mutating input.
 */
function sortCandidatesDeterministic(candidates) {
    return __spreadArray([], candidates, true).sort(compareCandidatesDeterministic);
}
