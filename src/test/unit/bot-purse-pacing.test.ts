// src/test/unit/bot-purse-pacing.test.ts
//
// Targeted Validation Suite for Behavior B3: Purse-Pacing Stage
//
// Tests all 4 semantic states:
// 1. EARLY / RESOURCE-PRESERVATION CONTEXT
// 2. LATE / RESOURCE-RELEASE CONTEXT
// 3. RESOURCE-CONSTRAINED STATE
// 4. RESOURCE-HEALTHY STATE
//
// Invariants verified:
// - Q/TV remains the sole economic authority (zero multipliers on TV).
// - Pacing is derived from real auction/team state (purse, remaining slots, future pool, auction progress).
// - Financial feasibility is strictly preserved.
// - Behavior is deterministic and observable through real bot decision path.

import { describe, it, expect } from 'vitest';
import {
  evaluateBotsForLot,
  type AuctionContext,
  DEFAULT_CONTEXT,
  type BotDecisionEvidence,
} from '@/lib/auction/server-bot-engine';
import { evaluateQAndTV } from '@/lib/auction/bot-q-engine';
import {
  evaluateTacticalDecision,
  evaluatePursePacing,
  type TacticalInputContext,
} from '@/lib/auction/bot-tactical-engine';
import type { V3Team, V3Player } from '@/lib/v3-auction-types';

function makeBot(overrides: Partial<V3Team> = {}): V3Team {
  return {
    id: 'bot-b3-test',
    name: 'B3 Test Bot',
    short_name: 'B3T',
    purse: 4000,
    initial_purse: 10000,
    players_bought: 0,
    overseas_count: 0,
    is_bot: true,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<V3Player> = {}): V3Player {
  return {
    id: 'player-b3',
    name: 'Target Player',
    role: 'BATSMAN',
    category: 'A',
    country: 'India',
    age: 27,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
    matches: 120,
    runs: 4000,
    batting_average: 38.0,
    strike_rate: 145.0,
    highest_score: 110,
    boundaries: 500,
    rating: 88,
    ...overrides,
  } as any;
}

function makeCtx(overrides: Partial<AuctionContext> = {}): AuctionContext {
  return {
    ...DEFAULT_CONTEXT,
    totalLots: 100,
    lotsCompleted: 0,
    lotsRemaining: 100,
    auctionProgress: 0,
    futurePlayers: [],
    maxSquadSize: 25,
    maxOverseas: 8,
    ...overrides,
  };
}

describe('Behavior B3: Strategic Purse-Pacing Stage', () => {

  // ════════════════════════════════════════════════════════════════════════
  // 1. EARLY / RESOURCE-PRESERVATION CONTEXT
  // ════════════════════════════════════════════════════════════════════════
  describe('1. Early / Resource-Preservation Context', () => {
    it('declines disproportionate spending on non-critical opportunities early in auction', () => {
      // Bot has 4000L purse and 25 slots remaining (avg ~146L/slot above base reserve)
      const bot = makeBot({ purse: 4000, players_bought: 0 });
      const player = makePlayer();
      // Early auction: 100 future candidates remain
      const futurePlayers = Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? 'BATSMAN' : 'BOWLER',
        category: 'B',
        base_price: 100,
        is_overseas: false,
      }));
      const ctx = makeCtx({
        totalLots: 100,
        lotsCompleted: 0,
        lotsRemaining: 100,
        auctionProgress: 0,
        futurePlayers: futurePlayers as any,
      });

      // Existing team roster already has batsmen, so roleNeed is NORMAL (non-critical)
      const existingRoster = [
        makePlayer({ id: 'existing-bat-1', role: 'BATSMAN', rating: 75 }),
        makePlayer({ id: 'existing-bat-2', role: 'BATSMAN', rating: 75 }),
        makePlayer({ id: 'existing-bat-3', role: 'BATSMAN', rating: 75 }),
        makePlayer({ id: 'existing-bat-4', role: 'BATSMAN', rating: 70 }),
        makePlayer({ id: 'existing-bat-5', role: 'BATSMAN', rating: 70 }),
      ];
      bot.players_bought = 5; // 20 slots remaining

      // Current bid is elevated to 700 (nextRequiredBid = 775), well above avg slot budget (~175L)
      const currentBid = 700;
      const nextRequiredBid = 775;

      const qResult = evaluateQAndTV(
        player as any,
        ctx.futurePlayers as any,
        { purse: bot.purse, playersBought: bot.players_bought, overseasCount: 0, roleCounts: { BATSMAN: 5 } },
        currentBid,
        false
      );

      // Verify TV is high enough that economically the bid is valid
      expect(qResult.tv).toBeGreaterThanOrEqual(nextRequiredBid);

      const evidenceArr: BotDecisionEvidence[] = [];
      const bids = evaluateBotsForLot(
        [bot],
        player,
        currentBid,
        100,
        'other-team',
        'Normal',
        [bot, { id: 'other-team' } as V3Team],
        { [bot.id]: existingRoster },
        ctx,
        null,
        evidenceArr
      );

      // Bot should DROP due to EARLY_RESOURCE_PRESERVATION
      expect(bids.length).toBe(0);
      expect(evidenceArr.length).toBe(1);
      expect(evidenceArr[0]!.decision).toBe('DROP');
      expect(evidenceArr[0]!.actionReason).toBe('EARLY_RESOURCE_PRESERVATION');
      expect(evidenceArr[0]!.pacingState).toBe('EARLY_PRESERVATION');
    });

    it('allows affordable bidding on non-critical opportunities early in auction', () => {
      const bot = makeBot({ purse: 4000, players_bought: 5 });
      const player = makePlayer();
      const ctx = makeCtx({
        totalLots: 100,
        lotsCompleted: 0,
        lotsRemaining: 100,
        auctionProgress: 0,
        futurePlayers: Array.from({ length: 50 }, () => ({ role: 'BATSMAN', category: 'C', base_price: 100, is_overseas: false })) as any,
      });

      // Price is opening base price (100L) -> affordable within avg slot budget
      const currentBid = 0;
      const evidenceArr: BotDecisionEvidence[] = [];
      const bids = evaluateBotsForLot(
        [bot],
        player,
        currentBid,
        100,
        'other-team',
        'Normal',
        [bot, { id: 'other-team' } as V3Team],
        { [bot.id]: [] },
        ctx,
        null,
        evidenceArr
      );

      expect(bids.length).toBe(1);
      expect(evidenceArr[0]!.decision).toBe('ENTER');
      expect(evidenceArr[0]!.actionReason).toBe('TV_FAVORABLE');
    });

    it('allows aggressive spending early when the opportunity is a CRITICAL foundational gap', () => {
      const bot = makeBot({ purse: 4000, players_bought: 0 });
      // Empty squad has BATSMAN as EXACT_PRIMARY_TARGET -> CRITICAL_PURSUIT
      const player = makePlayer({ role: 'BATSMAN' });
      const ctx = makeCtx({
        totalLots: 100,
        lotsCompleted: 0,
        lotsRemaining: 100,
        auctionProgress: 0,
        futurePlayers: Array.from({ length: 50 }, () => ({ role: 'BOWLER', category: 'C', base_price: 100, is_overseas: false })) as any,
      });

      // Even at elevated bid 775L, securing a critical sole WK is strategically justified early
      const currentBid = 700;
      const evidenceArr: BotDecisionEvidence[] = [];
      const bids = evaluateBotsForLot(
        [bot],
        player,
        currentBid,
        100,
        'other-team',
        'Normal',
        [bot, { id: 'other-team' } as V3Team],
        { [bot.id]: [] },
        ctx,
        null,
        evidenceArr
      );

      expect(bids.length).toBe(1);
      expect(evidenceArr[0]!.decision).toBe('ENTER');
      expect(evidenceArr[0]!.actionReason).toBe('TV_FAVORABLE');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. LATE / RESOURCE-RELEASE CONTEXT
  // ════════════════════════════════════════════════════════════════════════
  describe('2. Late / Resource-Release Context', () => {
    it('releases resources for justified opportunities when auction is materially progressed', () => {
      // Same bot purse (4000L) and same elevated bid (775L), but in late auction
      const bot = makeBot({ purse: 4000, players_bought: 22 }); // Only 3 slots remaining
      const player = makePlayer();
      // Late auction: only 2 future players left in pool, auction progress 85%
      const ctx = makeCtx({
        totalLots: 100,
        lotsCompleted: 85,
        lotsRemaining: 2,
        auctionProgress: 0.85,
        futurePlayers: [
          { role: 'BATSMAN', category: 'C', base_price: 100, is_overseas: false },
          { role: 'BOWLER', category: 'C', base_price: 100, is_overseas: false },
        ] as any,
      });

      const currentBid = 700;
      const nextRequiredBid = 775;

      const qResult = evaluateQAndTV(
        player as any,
        ctx.futurePlayers as any,
        { purse: bot.purse, playersBought: bot.players_bought, overseasCount: 0, roleCounts: { BATSMAN: 3 } },
        currentBid,
        false
      );

      expect(qResult.tv).toBeGreaterThanOrEqual(nextRequiredBid);

      const evidenceArr: BotDecisionEvidence[] = [];
      const bids = evaluateBotsForLot(
        [bot],
        player,
        currentBid,
        100,
        'other-team',
        'Normal',
        [bot, { id: 'other-team' } as V3Team],
        { [bot.id]: [] },
        ctx,
        null,
        evidenceArr
      );

      // In late auction, the bot RELEASES resources instead of dropping!
      expect(bids.length).toBe(1);
      expect(evidenceArr.length).toBe(1);
      expect(evidenceArr[0]!.decision).toBe('ENTER');
      expect(evidenceArr[0]!.actionReason).toBe('TV_FAVORABLE');
      expect(evidenceArr[0]!.pacingState).toBe('LATE_RELEASE');
    });

    it('demonstrates causal contrast between B3_EARLY (DROP) and B3_LATE (ENTER) on identical candidate and bid', () => {
      const player = makePlayer();
      const currentBid = 700;
      const nextRequiredBid = 775;

      // Early scenario: 20 slots remaining, 100 future pool candidates
      const botEarly = makeBot({ id: 'bot-early', purse: 4000, players_bought: 5 });
      const ctxEarly = makeCtx({
        totalLots: 100,
        lotsCompleted: 0,
        lotsRemaining: 100,
        auctionProgress: 0,
        futurePlayers: Array.from({ length: 100 }, () => ({ role: 'BATSMAN', category: 'C', base_price: 100, is_overseas: false })) as any,
      });

      // Late scenario: 3 slots remaining, 2 future pool candidates
      const botLate = makeBot({ id: 'bot-late', purse: 4000, players_bought: 22 });
      const ctxLate = makeCtx({
        totalLots: 100,
        lotsCompleted: 95,
        lotsRemaining: 2,
        auctionProgress: 0.95,
        futurePlayers: [
          { role: 'BATSMAN', category: 'C', base_price: 100, is_overseas: false },
          { role: 'BOWLER', category: 'C', base_price: 100, is_overseas: false },
        ] as any,
      });

      // Existing roster satisfies basic role needs so player is not CRITICAL
      const existingRoster = [
        makePlayer({ id: 'b1', role: 'BATSMAN' }),
        makePlayer({ id: 'b2', role: 'BATSMAN' }),
        makePlayer({ id: 'b3', role: 'BATSMAN' }),
      ];

      const evidenceEarly: BotDecisionEvidence[] = [];
      const bidsEarly = evaluateBotsForLot(
        [botEarly], player, currentBid, 100, 'other', 'Normal',
        [botEarly, { id: 'other' } as V3Team],
        { [botEarly.id]: existingRoster },
        ctxEarly, null, evidenceEarly
      );

      const evidenceLate: BotDecisionEvidence[] = [];
      const bidsLate = evaluateBotsForLot(
        [botLate], player, currentBid, 100, 'other', 'Normal',
        [botLate, { id: 'other' } as V3Team],
        { [botLate.id]: existingRoster },
        ctxLate, null, evidenceLate
      );

      // Causal divergence proven:
      // Early bot preserves purse (DROP)
      expect(bidsEarly.length).toBe(0);
      expect(evidenceEarly[0]!.decision).toBe('DROP');
      expect(evidenceEarly[0]!.pacingState).toBe('EARLY_PRESERVATION');

      // Late bot releases purse (ENTER)
      expect(bidsLate.length).toBe(1);
      expect(evidenceLate[0]!.decision).toBe('ENTER');
      expect(evidenceLate[0]!.pacingState).toBe('LATE_RELEASE');

      // Valuation authority intact: both evaluated against same economic engine
      expect(evidenceEarly[0]!.tv).toBeGreaterThanOrEqual(nextRequiredBid);
      expect(evidenceLate[0]!.tv).toBeGreaterThanOrEqual(nextRequiredBid);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. RESOURCE-CONSTRAINED STATE
  // ════════════════════════════════════════════════════════════════════════
  describe('3. Resource-Constrained State', () => {
    it('strictly preserves mandatory squad reserve (PURSE_INSOLVENCY)', () => {
      // Bot has 300L purse and 15 slots remaining
      // Mandatory reserve for remaining 14 slots = 14 * 20L = 280L
      // Max solvent bid = 300 - 280 = 20L
      const bot = makeBot({ purse: 300, players_bought: 10 });
      const player = makePlayer();
      const ctx = makeCtx({ futurePlayers: [player as any] });

      // Bid of 50L would leave only 250L < 280L reserve
      const pacing = evaluatePursePacing({
        purse: bot.purse,
        remainingSlots: 15,
        nextRequiredBid: 50,
        roleNeed: 'NORMAL',
      });

      expect(pacing.pacingState).toBe('RESOURCE_CONSTRAINED');
      expect(pacing.shouldPass).toBe(true);
      expect(pacing.reason).toBe('PURSE_INSOLVENCY');
    });

    it('declines non-critical bids that would dangerously deplete tight discretionary budget', () => {
      // Bot has 500L purse and 15 slots remaining
      // Mandatory reserve = 14 * 20L = 280L. Discretionary = 220L (avg 15.7L/slot)
      const pacing = evaluatePursePacing({
        purse: 500,
        remainingSlots: 15,
        nextRequiredBid: 100, // 100L takes ~45% of discretionary budget on non-critical player
        roleNeed: 'NORMAL',
      });

      expect(pacing.pacingState).toBe('RESOURCE_CONSTRAINED');
      expect(pacing.shouldPass).toBe(true);
      expect(pacing.reason).toBe('RESOURCE_CONSTRAINED_RESERVATION');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. RESOURCE-HEALTHY STATE
  // ════════════════════════════════════════════════════════════════════════
  describe('4. Resource-Healthy State', () => {
    it('does not restrict valid economic opportunities when purse is healthy', () => {
      // Bot has 10000L purse and 15 slots remaining (ample capital)
      const pacing = evaluatePursePacing({
        purse: 10000,
        remainingSlots: 15,
        nextRequiredBid: 775,
        roleNeed: 'NORMAL',
        auctionProgress: 0.50, // Mid auction
        futurePoolCount: 20,
      });

      expect(pacing.pacingState).toBe('RESOURCE_HEALTHY');
      expect(pacing.shouldPass).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. ARCHITECTURAL INVARIANTS
  // ════════════════════════════════════════════════════════════════════════
  describe('5. Architectural Invariants', () => {
    it('preserves Q/TV as sole economic authority without arbitrary multipliers', () => {
      const player = makePlayer();
      const bot = makeBot({ purse: 6000, players_bought: 5 });

      // Direct Q evaluation
      const qResult = evaluateQAndTV(
        player as any,
        [],
        { purse: bot.purse, playersBought: bot.players_bought, overseasCount: 0, roleCounts: {} },
        100,
        false
      );

      // Verify tactical decision strictly references qResult.tv without modifying it
      const tactical = evaluateTacticalDecision({
        teamId: bot.id,
        auctionId: 'test-auction',
        lotId: player.id,
        personality: 'BALANCED',
        qResult,
        roleNeed: 'NORMAL',
        remainingSlots: 20,
        purse: bot.purse,
        remainingTimerMs: 15000,
        auctionProgress: 0.1,
        futurePoolCount: 50,
      });

      expect(tactical.tv).toBe(qResult.tv);
    });
  });
});
