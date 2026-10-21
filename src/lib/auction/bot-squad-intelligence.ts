// src/lib/auction/bot-squad-intelligence.ts
//
// Phase 2A: Squad State Model
//
// Provides a clean, deterministic, derived read model of a bot's
// current squad composition. This is NOT a database model, NOT a
// replacement for V3Team, and NOT authoritative for auction rules.
//
// It is a strategic snapshot consumed by future phases (2B–2I).
//
// THIS MODULE IS STANDALONE.
// It does NOT modify any existing auction behaviour.
// It does NOT integrate into the live auction tick.
// It does NOT make bidding decisions.
// It does NOT access the database or network.

import { type V3Team, type V3Player } from '../v3-auction-types';
import { getRoleNeed, type AuctionContext, type RoleNeed } from './server-bot-engine';

// ============================================================
// TYPES
// ============================================================

/**
 * Role composition: exact count of players per role in the current roster.
 *
 * Keys are EXACTLY the four IPL auction roles.
 * Invalid/unknown roles in the roster are NOT represented here.
 */
export interface RoleComposition {
  readonly BATSMAN: number;
  readonly BOWLER: number;
  readonly ALL_ROUNDER: number;
  readonly WICKET_KEEPER: number;
}

/**
 * Role needs: the existing getRoleNeed() result for each role.
 *
 * Uses the authoritative getRoleNeed() from server-bot-engine.ts.
 * Phase 2A does NOT define its own role-need algorithm.
 */
export interface RoleNeeds {
  readonly BATSMAN: RoleNeed;
  readonly BOWLER: RoleNeed;
  readonly ALL_ROUNDER: RoleNeed;
  readonly WICKET_KEEPER: RoleNeed;
}

/**
 * BotSquadState: A derived read model of a bot's current squad.
 *
 * Answers structural questions about the squad:
 *   - How many players / slots / overseas slots?
 *   - How much purse spent / remaining?
 *   - What roles are filled?
 *   - What roles are needed?
 *
 * Does NOT answer quality questions (Phase 2C) or
 * strategic questions (Phase 2G+).
 */
export interface BotSquadState {
  readonly teamId: string;

  /** Current number of players in the roster */
  readonly squadSize: number;
  /** Remaining squad slots: max(0, maxSquadSize - squadSize) */
  readonly remainingSlots: number;

  /** Authoritative remaining purse from V3Team.purse */
  readonly purseRemaining: number;
  /** Derived: max(0, initial_purse - purse) */
  readonly amountSpent: number;
  /** Ratio of purse spent: clamp(amountSpent / initial_purse, 0, 1). 0 if initial_purse <= 0 */
  readonly spentRatio: number;

  /** Authoritative overseas count from V3Team.overseas_count */
  readonly overseasCount: number;
  /** Remaining overseas slots: max(0, maxOverseas - overseasCount) */
  readonly overseasSlotsRemaining: number;

  /** Exact count of players per role */
  readonly roleComposition: RoleComposition;

  /** Existing getRoleNeed() result for each role */
  readonly roleNeeds: RoleNeeds;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Build a BotSquadState snapshot from authoritative auction data.
 *
 * - Synchronous
 * - Deterministic (same input → same output)
 * - Pure (no side effects)
 * - Does NOT mutate bot, botRoster, or ctx
 * - Does NOT access the database or network
 * - Does NOT make bidding decisions
 *
 * @param bot        - The bot's V3Team (authoritative for purse/overseas)
 * @param botRoster  - The bot's current purchased players
 * @param ctx        - AuctionContext (authoritative for maxSquadSize/maxOverseas)
 */
export function buildBotSquadState(
  bot: V3Team,
  botRoster: V3Player[],
  ctx: AuctionContext
): BotSquadState {
  // --- Squad size ---
  const squadSize = botRoster.length;
  const remainingSlots = Math.max(0, ctx.maxSquadSize - squadSize);

  // --- Purse ---
  const purseRemaining = bot.purse;
  const amountSpent = Math.max(0, bot.initial_purse - bot.purse);
  const spentRatio = bot.initial_purse > 0
    ? Math.min(1, Math.max(0, amountSpent / bot.initial_purse))
    : 0;

  // --- Overseas ---
  const overseasCount = bot.overseas_count;
  const overseasSlotsRemaining = Math.max(0, ctx.maxOverseas - overseasCount);

  // --- Role composition ---
  // Count only valid roles. Invalid/unknown roles are silently excluded.
  const roleCounts: Record<string, number> = {
    BATSMAN: 0,
    BOWLER: 0,
    ALL_ROUNDER: 0,
    WICKET_KEEPER: 0,
  };
  for (const player of botRoster) {
    if (player.role in roleCounts) {
      roleCounts[player.role]!++;
    }
    // Invalid roles are silently ignored — no arbitrary keys created
  }
  const roleComposition: RoleComposition = {
    BATSMAN: roleCounts['BATSMAN']!,
    BOWLER: roleCounts['BOWLER']!,
    ALL_ROUNDER: roleCounts['ALL_ROUNDER']!,
    WICKET_KEEPER: roleCounts['WICKET_KEEPER']!,
  };

  // --- Role needs ---
  // Reuse the existing getRoleNeed() from server-bot-engine.ts.
  // DO NOT duplicate or override its logic.
  const roleNeeds: RoleNeeds = {
    BATSMAN: getRoleNeed('BATSMAN', roleComposition.BATSMAN, remainingSlots, ctx.maxSquadSize).need,
    BOWLER: getRoleNeed('BOWLER', roleComposition.BOWLER, remainingSlots, ctx.maxSquadSize).need,
    ALL_ROUNDER: getRoleNeed('ALL_ROUNDER', roleComposition.ALL_ROUNDER, remainingSlots, ctx.maxSquadSize).need,
    WICKET_KEEPER: getRoleNeed('WICKET_KEEPER', roleComposition.WICKET_KEEPER, remainingSlots, ctx.maxSquadSize).need,
  };

  return {
    teamId: bot.id,
    squadSize,
    remainingSlots,
    purseRemaining,
    amountSpent,
    spentRatio,
    overseasCount,
    overseasSlotsRemaining,
    roleComposition,
    roleNeeds,
  };
}

export function canBotAffordWithSquadReserve(
  purseRemaining: number,
  currentSquadSize: number,
  currentOverseasCount: number,
  candidateIsOverseas: boolean,
  nextBidAmount: number,
  minBasePrice: number = 20
): { allowed: boolean; spendablePurse: number; reason?: string } {
  if (currentSquadSize >= 25) return { allowed: false, spendablePurse: 0, reason: 'MAX_SQUAD_25_REACHED' };
  if (candidateIsOverseas && currentOverseasCount >= 8) return { allowed: false, spendablePurse: 0, reason: 'MAX_OVERSEAS_8_REACHED' };
  const mandatorySlotsLeft = Math.max(0, 18 - (currentSquadSize + 1));
  const reservedPurse = mandatorySlotsLeft * minBasePrice;
  const spendablePurse = Math.max(0, purseRemaining - reservedPurse);
  if (nextBidAmount > spendablePurse) {
    return { allowed: false, spendablePurse, reason: 'RESERVED_FOR_MIN_18_SQUAD' };
  }
  return { allowed: true, spendablePurse };
}
