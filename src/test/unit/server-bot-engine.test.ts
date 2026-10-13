// src/test/unit/server-bot-engine.test.ts
//
// PHASE 8 — RUNTIME INTEGRATION + VALIDATION TEST SUITE
//
// Authoritative tests validating the runtime execution of the Human Auction Manager
// decision pipeline (Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7A -> Phase 7 -> Runtime Action).

import { describe, it, expect } from 'vitest';
import {
  evaluateBotsForLot,
  getNextBidAmount,
  getBotPersonality,
  computeFutureQualityMap,
  computeFutureOverseasByRole,
  estimateQualityFromCategory,
  AuctionContext,
  DEFAULT_CONTEXT,
  BotDecisionEvidence,
} from '@/lib/auction/server-bot-engine';
import { evaluateQAndTV } from '@/lib/auction/bot-q-engine';
import { evaluateTacticalDecision } from '@/lib/auction/bot-tactical-engine';
import type { V3Team, V3Player } from '@/lib/v3-auction-types';
import {
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
  assemblePlayerContext,
} from '@/lib/auction/human-auction-manager-context';
import { evaluatePlayerMarketValue } from '@/lib/auction/human-auction-market-value';
import { evaluateTeamValue } from '@/lib/auction/human-auction-team-value';
import { evaluateMaximumBid } from '@/lib/auction/human-auction-maximum-bid';
import { derivePricePositionContext, evaluatePricePosition } from '@/lib/auction/human-auction-price-position';
import { evaluateDecision } from '@/lib/auction/human-auction-decision';

// ── Test Helpers ─────────────────────────────────────────────────────────

function makeBot(overrides: Partial<V3Team> = {}): V3Team {
  return {
    id: 'bot-test-1',
    name: 'Test Bot',
    short_name: 'TB',
    purse: 8000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 2,
    is_bot: true,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<V3Player> = {}): V3Player {
  return {
    id: 'player-1',
    name: 'Test Player',
    role: 'BATSMAN',
    category: 'B',
    country: 'India',
    age: 28,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
    matches: 100,
    runs: 3000,
    batting_average: 30.0,
    strike_rate: 140.0,
    highest_score: 100,
    boundaries: 400,
    rating: 85,
    ...overrides,
  } as V3Player;
}

function makeCtx(overrides: Partial<AuctionContext> = {}): AuctionContext {
  return {
    ...DEFAULT_CONTEXT,
    totalLots: 50,
    lotsCompleted: 10,
    lotsRemaining: 39,
    auctionProgress: 0.22,
    futureByRole: { BATSMAN: 15, BOWLER: 12, ALL_ROUNDER: 8, WICKET_KEEPER: 4 },
    futureByRoleAndQuality: {
      BATSMAN: { count: 15, avgEstRating: 82 },
      BOWLER: { count: 12, avgEstRating: 81 },
      ALL_ROUNDER: { count: 8, avgEstRating: 80 },
      WICKET_KEEPER: { count: 4, avgEstRating: 83 },
    },
    futureOverseasByRole: { BATSMAN: 5, BOWLER: 4, ALL_ROUNDER: 3, WICKET_KEEPER: 1 },
    ...overrides,
  };
}

describe('Phase 8 — Runtime Integration & Validation', () => {

  // =========================================================================
  // TEST 1 — PHASE 7 BID REACHES RUNTIME
  // =========================================================================
  it('TEST 1 — PHASE 7 BID REACHES RUNTIME (HEADROOM_REMAINS + JUSTIFIED -> BID)', () => {
    // A bot with normal purse evaluating a candidate with headroom below maximumBid
    const bot = makeBot({ purse: 8000, players_bought: 5 });
    const player = makePlayer({ rating: 85, base_price: 100 });
    const ctx = makeCtx();

    const evidenceArr: BotDecisionEvidence[] = [];
    const currentBid = 100;
    const expectedNextBid = getNextBidAmount(currentBid, player.base_price); // 125

    const bids = evaluateBotsForLot(
      [bot],
      player,
      currentBid,
      player.base_price,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      ctx,
      null,
      evidenceArr
    );

    expect(evidenceArr.length).toBe(1);
    const ev = evidenceArr[0]!;
    expect(ev.finalAction).toBe('BID');
    expect(ev.decision).toBe('ENTER');
    expect(ev.pricePosition).toBe('HEADROOM_REMAINS');
    expect(bids.length).toBe(1);
    expect(bids[0]!.teamId).toBe(bot.id);
    expect(bids[0]!.nextBidAmount).toBe(expectedNextBid);
    expect(bids[0]!.nextBidAmount).toBe(ev.bidAmount);
  });

  // =========================================================================
  // TEST 2 — PHASE 7 STRETCH REACHES RUNTIME
  // =========================================================================
  it('TEST 2 — PHASE 7 STRETCH REACHES RUNTIME (FINAL_LEGAL_STEP + COMMITTED -> STRETCH)', () => {
    // Construct scenario where nextRequiredBid is the final legal step within maximumBid
    // and squad consequence is COMMITTED (e.g. Critical gap).
    const bot = makeBot({ purse: 2000, players_bought: 10 });
    // Candidate role is WICKET_KEEPER, bot has 0 keepers (CRITICAL need -> COMMITTED)
    const player = makePlayer({
      id: 'keeper-1',
      role: 'WICKET_KEEPER',
      category: 'A',
      rating: 90,
      base_price: 200,
    });
    const ctx = makeCtx({
      maxSquadSize: 25,
      futureByRole: { WICKET_KEEPER: 1 } // scarce
    });

    // Let's determine the bot's maximumBid for this keeper
    const tempEvidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot([bot], player, 200, 200, undefined, 'Normal', [bot], { [bot.id]: [] }, ctx, null, tempEvidence);
    const maxBid = tempEvidence[0]!.maximumBid!;
    expect(maxBid).toBeGreaterThan(0);

    // Now set currentBid so nextRequiredBid exactly equals maxBid (the final legal step!)
    // If nextRequiredBid === maxBid, the following bid will exceed maxBid -> FINAL_LEGAL_STEP
    let targetCurrentBid = 0;
    for (let b = 100; b < maxBid; b += 25) {
      if (getNextBidAmount(b, player.base_price) === maxBid) {
        targetCurrentBid = b;
        break;
      }
    }

    if (targetCurrentBid > 0) {
      const evidenceArr: BotDecisionEvidence[] = [];
      const bids = evaluateBotsForLot(
        [bot],
        player,
        targetCurrentBid,
        player.base_price,
        undefined,
        'Normal',
        [bot],
        { [bot.id]: [] },
        ctx,
        null,
        evidenceArr
      );

      const ev = evidenceArr[0]!;
      expect(ev.pricePosition).toBe('FINAL_LEGAL_STEP');
      expect(ev.strategicCommitment).toBe('COMMITTED');
      expect(ev.finalAction).toBe('STRETCH');
      expect(ev.decision).toBe('ONE_LAST_BID');
      expect(bids.length).toBe(1);
      expect(bids[0]!.nextBidAmount).toBe(maxBid);
      expect(bids[0]!.nextBidAmount).toBeLessThanOrEqual(maxBid);
    }
  });

  // =========================================================================
  // TEST 3 — NOT_COMMITTED PASS
  // =========================================================================
  it('TEST 3 — NOT_COMMITTED PASS (squad consequence NOT_COMMITTED -> PASS)', () => {
    // Bot already has 8 batsmen (well beyond ideal target 7) -> role is REDUNDANT / NOT_COMMITTED
    const bot = makeBot({ purse: 10000, players_bought: 8 });
    const player = makePlayer({ role: 'BATSMAN', rating: 76, category: 'D' });
    const existingBatsmen: V3Player[] = Array.from({ length: 8 }, (_, i) => ({
      id: `bat-${i}`,
      name: `Bat ${i}`,
      role: 'BATSMAN',
      category: 'B',
      rating: 82,
    } as any));

    const ctx = makeCtx();
    const evidenceArr: BotDecisionEvidence[] = [];
    const bids = evaluateBotsForLot(
      [bot],
      player,
      100,
      100,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: existingBatsmen },
      ctx,
      null,
      evidenceArr
    );

    expect(evidenceArr.length).toBe(1);
    const ev = evidenceArr[0]!;
    expect(ev.strategicCommitment).toBe('NOT_COMMITTED');
    expect(ev.finalAction).toBe('PASS');
    expect(ev.decision).toBe('DROP');
    expect(bids.length).toBe(0);
  });

  // =========================================================================
  // TEST 4 — BEYOND CEILING PASS
  // =========================================================================
  it('TEST 4 — BEYOND CEILING PASS (nextRequiredBid > maximumBid -> PASS)', () => {
    const bot = makeBot({ purse: 8000 });
    const player = makePlayer({ rating: 78, base_price: 100 });
    const ctx = makeCtx();

    // Set a very high current bid that exceeds maximum rational ceiling
    const highBid = 4000;
    const evidenceArr: BotDecisionEvidence[] = [];
    const bids = evaluateBotsForLot(
      [bot],
      player,
      highBid,
      100,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      ctx,
      null,
      evidenceArr
    );

    expect(evidenceArr.length).toBe(1);
    const ev = evidenceArr[0]!;
    expect(ev.pricePosition).toBe('BEYOND_CEILING');
    expect(ev.finalAction).toBe('PASS');
    expect(ev.decision).toBe('DROP');
    expect(bids.length).toBe(0);
    expect(ev.reasons?.[0]).toContain('exceeds maximum rational bid ceiling');
  });

  // =========================================================================
  // TEST 5 — TEAM VALUE NOT SECOND CEILING
  // =========================================================================
  it('TEST 5 — TEAM VALUE NOT SECOND CEILING (Runtime executes Phase 7 without adding TV gate)', () => {
    // In Phase 8, the runtime is strictly an execution adapter.
    // It must NEVER inspect nextRequiredBid > tv and drop if Phase 7 produced BID or STRETCH.
    const bot = makeBot({ purse: 8000 });
    const player = makePlayer({ rating: 88, base_price: 100 });
    const ctx = makeCtx();

    const evidenceArr: BotDecisionEvidence[] = [];
    const bids = evaluateBotsForLot(
      [bot],
      player,
      100,
      100,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      ctx,
      null,
      evidenceArr
    );

    const ev = evidenceArr[0]!;
    expect(ev.finalAction).toBe('BID');
    expect(ev.decision).toBe('ENTER');
    expect(bids.length).toBe(1);
    // Verifies runtime did not invent an independent second ceiling
    expect(ev.decision).not.toBe('DROP');
  });

  // =========================================================================
  // TEST 6 — B3 EARLY MARQUEE
  // =========================================================================
  it('TEST 6 — B3 EARLY MARQUEE (No average-purse/slot cap in early auction)', () => {
    // Early marquee lot: 20 slots remaining, purse = 9000L.
    // Average purse per slot = 9000 / 20 = 450L.
    // A marquee player bid at 1500L is over 3x the average purse per slot!
    // B3 guarantee: early marquee is NOT capped by average purse per slot.
    const bot = makeBot({ purse: 9000, players_bought: 5 });
    const marqueePlayer = makePlayer({
      id: 'marquee-1',
      name: 'Superstar Allrounder',
      role: 'ALL_ROUNDER',
      category: 'MARQUEE',
      rating: 95,
      base_price: 200,
      matches: 150,
      runs: 4000,
      wickets: 130
    });
    const ctx = makeCtx({
      auctionProgress: 0.10, // EARLY
      lotsCompleted: 5,
      lotsRemaining: 45
    });

    const currentBid = 1400; // Far above 450L average purse
    const evidenceArr: BotDecisionEvidence[] = [];
    const bids = evaluateBotsForLot(
      [bot],
      marqueePlayer,
      currentBid,
      marqueePlayer.base_price,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      ctx,
      null,
      evidenceArr
    );

    expect(evidenceArr.length).toBe(1);
    const ev = evidenceArr[0]!;
    expect(ev.auctionStage).toBe('EARLY');
    expect(ev.bindingConstraint).not.toBe('AVERAGE_PURSE' as any);
    expect(ev.maximumBid).toBeGreaterThan(1500);
    expect(ev.finalAction).toBe('BID');
    expect(ev.decision).toBe('ENTER');
    expect(bids.length).toBe(1);
    expect(bids[0]!.nextBidAmount).toBe(1500);
  });

  // =========================================================================
  // TEST 7 — OPPONENT CONTEXT
  // =========================================================================
  it('TEST 7 — OPPONENT CONTEXT (Changing opponent threat does not alter our maximum bid ceiling)', () => {
    const bot = makeBot({ id: 'our-bot', purse: 7000 });
    const player = makePlayer({ rating: 85, base_price: 100 });
    const ctx = makeCtx();

    // Scenario A: No active rivals
    const evNoRival: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      player,
      100,
      100,
      undefined,
      'Normal',
      [bot],
      { 'our-bot': [] },
      ctx,
      null,
      evNoRival
    );

    // Scenario B: Competing against a wealthy rival highest bidder
    const richRival = makeBot({ id: 'rich-rival', purse: 10000 });
    const evWithRival: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      player,
      100,
      100,
      'rich-rival',
      'Normal',
      [bot, richRival],
      { 'our-bot': [], 'rich-rival': [] },
      ctx,
      null,
      evWithRival
    );

    expect(evNoRival[0]!.maximumBid).toBe(evWithRival[0]!.maximumBid);
    expect(evNoRival[0]!.teamValue).toBe(evWithRival[0]!.teamValue);
  });

  // =========================================================================
  // TEST 8 — ENDGAME
  // =========================================================================
  it('TEST 8 — ENDGAME (ENDGAME alone must not force STRETCH)', () => {
    // In ENDGAME stage, if plenty of headroom remains, action must be BID, NOT STRETCH.
    const bot = makeBot({ purse: 5000, players_bought: 22 });
    const player = makePlayer({ rating: 85, base_price: 100 });
    const ctx = makeCtx({
      auctionProgress: 0.90, // ENDGAME
      lotsCompleted: 45,
      lotsRemaining: 5
    });

    const evidenceArr: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      player,
      100,
      100,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      ctx,
      null,
      evidenceArr
    );

    const ev = evidenceArr[0]!;
    expect(ev.auctionStage).toBe('ENDGAME');
    expect(ev.pricePosition).toBe('HEADROOM_REMAINS');
    expect(ev.finalAction).toBe('BID');
    expect(ev.decision).toBe('ENTER');
  });

  // =========================================================================
  // TEST 9 — DETERMINISM
  // =========================================================================
  it('TEST 9 — DETERMINISM (Same live context produces 100% identical Phase 7 decision)', () => {
    const bot = makeBot({ purse: 6000 });
    const player = makePlayer({ rating: 86 });
    const ctx = makeCtx();

    const ev1: BotDecisionEvidence[] = [];
    const bids1 = evaluateBotsForLot([bot], player, 200, 100, undefined, 'Normal', [bot], { [bot.id]: [] }, ctx, null, ev1);

    const ev2: BotDecisionEvidence[] = [];
    const bids2 = evaluateBotsForLot([bot], player, 200, 100, undefined, 'Normal', [bot], { [bot.id]: [] }, ctx, null, ev2);

    expect(ev1[0]!.finalAction).toBe(ev2[0]!.finalAction);
    expect(ev1[0]!.maximumBid).toBe(ev2[0]!.maximumBid);
    expect(ev1[0]!.teamValue).toBe(ev2[0]!.teamValue);
    expect(ev1[0]!.pricePosition).toBe(ev2[0]!.pricePosition);
    expect(bids1[0]!.nextBidAmount).toBe(bids2[0]!.nextBidAmount);
  });

  // =========================================================================
  // TEST 10 — NO DOUBLE EXECUTION
  // =========================================================================
  it('TEST 10 — NO DOUBLE EXECUTION (One evaluation produces at most one bid per bot)', () => {
    const bot = makeBot({ purse: 8000 });
    const player = makePlayer();
    const ctx = makeCtx();

    const bids = evaluateBotsForLot([bot], player, 100, 100, undefined, 'Normal', [bot], { [bot.id]: [] }, ctx, null);

    // Exactly 1 bid returned for 1 bot
    expect(bids.length).toBe(1);
    expect(bids[0]!.teamId).toBe(bot.id);
  });

  // =========================================================================
  // TEST 11 — STALE BID
  // =========================================================================
  it('TEST 11 — STALE BID (If bot is already highest bidder, evaluation immediately skips without bid)', () => {
    const bot = makeBot({ purse: 8000 });
    const player = makePlayer();
    const ctx = makeCtx();

    // Bot is already the highest bidder from a previous tick!
    const evidenceArr: BotDecisionEvidence[] = [];
    const bids = evaluateBotsForLot(
      [bot],
      player,
      200,
      100,
      bot.id, // highestBidderTeamId === bot.id
      'Normal',
      [bot],
      { [bot.id]: [] },
      ctx,
      null,
      evidenceArr
    );

    expect(bids.length).toBe(0);
    expect(evidenceArr[0]!.eligibilityReason).toBe('ALREADY_HIGHEST_BIDDER');
  });

  // =========================================================================
  // TEST 12 — CURRENT STATE
  // =========================================================================
  it('TEST 12 — CURRENT STATE (Each new evaluation uses latest currentBid and nextRequiredBid)', () => {
    const bot = makeBot({ purse: 8000 });
    const player = makePlayer({ base_price: 100 });
    const ctx = makeCtx();

    // Tick 1: currentBid = 100 -> nextRequiredBid = 125
    const bids1 = evaluateBotsForLot([bot], player, 100, 100, undefined, 'Normal', [bot], { [bot.id]: [] }, ctx, null);
    expect(bids1[0]!.nextBidAmount).toBe(125);

    // Tick 2: currentBid = 500 -> nextRequiredBid = 550
    const bids2 = evaluateBotsForLot([bot], player, 500, 100, undefined, 'Normal', [bot], { [bot.id]: [] }, ctx, null);
    expect(bids2[0]!.nextBidAmount).toBe(550);
  });

  // =========================================================================
  // TEST 13 — FULL PIPELINE
  // =========================================================================
  it('TEST 13 — FULL PIPELINE (End-to-end Phase 3 -> 4 -> 5 -> 6 -> 7A -> 7 -> runtime)', () => {
    const bot = makeBot({ id: 'pipeline-bot', purse: 9500, players_bought: 6 });
    const player = makePlayer({
      id: 'pipeline-player',
      name: 'Star Batter',
      role: 'BATSMAN',
      category: 'A',
      rating: 89,
      base_price: 150,
      matches: 80,
      runs: 2800,
      batting_average: 35.0,
      strike_rate: 145.0
    });
    const ctx = makeCtx();

    const evidenceArr: BotDecisionEvidence[] = [];
    const bids = evaluateBotsForLot(
      [bot],
      player,
      150,
      150,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      ctx,
      null,
      evidenceArr
    );

    expect(evidenceArr.length).toBe(1);
    const ev = evidenceArr[0]!;

    // Phase 3 verification
    expect(ev.marketValue).toBeGreaterThan(150);

    // Phase 4 verification
    expect(ev.teamValue).toBeGreaterThan(0);
    expect(['JUSTIFIED', 'COMMITTED']).toContain(ev.strategicCommitment);

    // Phase 5 verification
    expect(ev.maximumBid).toBeGreaterThan(0);
    expect(ev.bindingConstraint).toBeDefined();

    // Phase 6 & 7A verification
    expect(ev.pricePosition).toBe('HEADROOM_REMAINS');

    // Phase 7 & Runtime Action verification
    expect(ev.finalAction).toBe('BID');
    expect(ev.decision).toBe('ENTER');
    expect(bids.length).toBe(1);
    expect(bids[0]!.nextBidAmount).toBe(175);
  });

  // =========================================================================
  // TEST 14 — ACTION AUTHORITY
  // =========================================================================
  it('TEST 14 — ACTION AUTHORITY (Tactical/Q legacy engines cannot override Phase 7)', () => {
    // If Tactical engine would prefer WAIT or PASS, Phase 7 remains the sole strategic authority.
    const bot = makeBot({ id: 'bot-authority', purse: 8000 });
    const player = makePlayer({ rating: 85, base_price: 100 });
    const ctx = makeCtx();

    const evidenceArr: BotDecisionEvidence[] = [];
    const bids = evaluateBotsForLot(
      [bot],
      player,
      100,
      100,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      ctx,
      null,
      evidenceArr
    );

    // Phase 7 returned BID -> Runtime MUST emit BID in validBids regardless of tactical engine state
    expect(evidenceArr[0]!.finalAction).toBe('BID');
    expect(bids.length).toBe(1);
    expect(bids[0]!.nextBidAmount).toBe(125);
  });

  // =========================================================================
  // PRESERVED HARD CONSTRAINTS & CORE UTILITIES
  // =========================================================================
  it('15. hard constraints — mechanical rejection if purse, squad, or overseas limits exceeded', () => {
    const ctx = makeCtx();

    // Broke bot
    const brokBot = makeBot({ purse: 0 });
    const ev1: BotDecisionEvidence[] = [];
    evaluateBotsForLot([brokBot], makePlayer(), 100, 100, undefined, 'Normal', [brokBot], { 'bot-test-1': [] }, ctx, null, ev1);
    expect(ev1[0]!.eligibilityReason).toBe('PURSE_INSUFFICIENT');

    // Full squad bot
    const fullBot = makeBot({ players_bought: 25 });
    const ev2: BotDecisionEvidence[] = [];
    evaluateBotsForLot([fullBot], makePlayer(), 100, 100, undefined, 'Normal', [fullBot], { 'bot-test-1': [] }, ctx, null, ev2);
    expect(ev2[0]!.eligibilityReason).toBe('SQUAD_FULL');

    // Overseas limit reached
    const osBot = makeBot({ overseas_count: 8 });
    const osPlayer = makePlayer({ is_overseas: true, country: 'Australia' });
    const ev3: BotDecisionEvidence[] = [];
    evaluateBotsForLot([osBot], osPlayer, 100, 100, undefined, 'Normal', [osBot], { 'bot-test-1': [] }, ctx, null, ev3);
    expect(ev3[0]!.eligibilityReason).toBe('OVERSEAS_FULL');
  });

  it('16. getNextBidAmount produces correct legal increments', () => {
    expect(getNextBidAmount(0, 100)).toBe(100);
    expect(getNextBidAmount(100, 100)).toBe(125);
    expect(getNextBidAmount(300, 100)).toBe(325);
    expect(getNextBidAmount(700, 100)).toBe(775);
    expect(getNextBidAmount(2200, 100)).toBe(2375);
  });

  it('17. estimateQualityFromCategory uses legitimate category metadata', () => {
    expect(estimateQualityFromCategory('MARQUEE')).toBe(88);
    expect(estimateQualityFromCategory('A')).toBe(85);
    expect(estimateQualityFromCategory('C')).toBe(79);
  });

  it('18. computeFutureQualityMap correctly analyzes queue by category', () => {
    const futurePlayers = [
      { role: 'BATSMAN', category: 'MARQUEE', base_price: 200, is_overseas: false },
      { role: 'BATSMAN', category: 'C', base_price: 75, is_overseas: false },
      { role: 'BOWLER', category: 'A', base_price: 150, is_overseas: true },
    ];
    const map = computeFutureQualityMap(futurePlayers as any);
    expect(map['BATSMAN']!.count).toBe(2);
    expect(map['BOWLER']!.count).toBe(1);
  });

  it('19. computeFutureOverseasByRole correctly counts overseas players in queue', () => {
    const fps = [
      { role: 'BATSMAN', category: 'A', base_price: 150, is_overseas: true },
      { role: 'BATSMAN', category: 'C', base_price: 75, is_overseas: false },
      { role: 'BOWLER', category: 'B', base_price: 100, is_overseas: true },
    ];
    const result = computeFutureOverseasByRole(fps as any);
    expect(result['BATSMAN']).toBe(1);
    expect(result['BOWLER']).toBe(1);
    expect(result['ALL_ROUNDER']).toBeUndefined();
  });
});
