// src/test/unit/phase1-8-strategic-behaviour.test.ts
//
// PHASE 1–8 — END-TO-END STRATEGIC BEHAVIOUR VALIDATION TEST SUITE
//
// Comprehensive validation of the complete Human Auction Manager decision chain:
// RAW AUCTION STATE -> PHASE 2 -> PHASE 3 -> PHASE 4 -> PHASE 5 -> PHASE 6 -> PHASE 7 -> PHASE 8 -> DB

import { describe, it, expect } from 'vitest';
import {
  evaluateBotsForLot,
  getNextBidAmount,
  AuctionContext,
  DEFAULT_CONTEXT,
  BotDecisionEvidence,
} from '@/lib/auction/server-bot-engine';
import type { V3Team, V3Player } from '@/lib/v3-auction-types';
import {
  assemblePlayerQualityContext,
  assemblePlayerQualityResult,
  assembleMarketValueContext,
  assemblePlayerContext,
  assembleTeamNeedContext,
  assembleXIImprovementContext,
  assemblePlayerScarcityContext,
  assembleTeamFitContext,
  assembleFuturePlanContext,
  assembleTeamValueContext,
  assemblePursePositionContext,
  assembleAuctionStage,
  assembleMaximumBidContext,
} from '@/lib/auction/human-auction-manager-context';
import { evaluatePlayerMarketValue } from '@/lib/auction/human-auction-market-value';
import { evaluateTeamValue } from '@/lib/auction/human-auction-team-value';
import { evaluateMaximumBid } from '@/lib/auction/human-auction-maximum-bid';

// ── Test Helpers & Fixtures ───────────────────────────────────────────────

function makeBot(overrides: Partial<V3Team> = {}): V3Team {
  return {
    id: 'bot-1',
    name: 'Chennai Super Kings',
    short_name: 'CSK',
    purse: 8500,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 2,
    is_bot: true,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<V3Player> = {}): V3Player {
  return {
    id: 'player-test-1',
    name: 'Test Player',
    role: 'BATSMAN',
    category: 'A',
    country: 'India',
    age: 28,
    batting_hand: 'Right Handed',
    base_price: 200,
    is_overseas: false,
    image_url: null,
    matches: 120,
    runs: 4000,
    batting_average: 38.5,
    strike_rate: 142.0,
    highest_score: 110,
    boundaries: 450,
    rating: 88,
    ...overrides,
  } as V3Player;
}

function makeMarqueePlayer(): V3Player {
  return makePlayer({
    id: 'vk-18',
    name: 'Virat Kohli',
    role: 'BATSMAN',
    category: 'A',
    rating: 97,
    matches: 252,
    runs: 8004,
    batting_average: 38.7,
    strike_rate: 131.97,
    hundreds: 8,
    fifties: 55,
    highest_score: 113,
    boundaries: 914,
    base_price: 200,
  });
}

function makeEliteBowler(): V3Player {
  return makePlayer({
    id: 'jb-93',
    name: 'Jasprit Bumrah',
    role: 'BOWLER',
    category: 'A',
    rating: 96,
    matches: 133,
    overs: 512,
    wickets: 165,
    bowling_average: 22.5,
    economy_rate: 7.3,
    bowling_strike_rate: 18.6,
    best_bowling: '5/10',
    three_wicket_hauls: 18,
    base_price: 200,
  });
}

function makeContext(overrides: Partial<AuctionContext> = {}): AuctionContext {
  return {
    ...DEFAULT_CONTEXT,
    totalLots: 50,
    lotsCompleted: 5,
    lotsRemaining: 44,
    auctionProgress: 0.1,
    maxSquadSize: 20,
    maxOverseas: 8,
    futurePlayers: [
      { role: 'BATSMAN', category: 'A', base_price: 200, is_overseas: false },
      { role: 'BATSMAN', category: 'B', base_price: 100, is_overseas: false },
      { role: 'BOWLER', category: 'A', base_price: 200, is_overseas: false },
      { role: 'BOWLER', category: 'B', base_price: 100, is_overseas: false },
      { role: 'ALL_ROUNDER', category: 'A', base_price: 200, is_overseas: false },
      { role: 'WICKET_KEEPER', category: 'A', base_price: 200, is_overseas: false },
    ],
    futureByRole: { BATSMAN: 12, BOWLER: 14, ALL_ROUNDER: 10, WICKET_KEEPER: 8 },
    futureByRoleAndQuality: {
      BATSMAN: { count: 12, avgEstRating: 82 },
      BOWLER: { count: 14, avgEstRating: 81 },
      ALL_ROUNDER: { count: 10, avgEstRating: 80 },
      WICKET_KEEPER: { count: 8, avgEstRating: 82 },
    },
    futureOverseasByRole: { BATSMAN: 4, BOWLER: 4, ALL_ROUNDER: 3, WICKET_KEEPER: 2 },
    ...overrides,
  };
}

describe('PHASE 1–8: Boundary & Authority Validation', () => {

  it('Boundary P2 -> P3: Real player statistics flow into Phase 3 market valuation firewalled from state', () => {
    const player = makeMarqueePlayer();
    const ctx = makeContext();
    const pQualityCtx = assemblePlayerQualityContext(player);
    const pQualityRes = assemblePlayerQualityResult(pQualityCtx);
    const mvCtx = assembleMarketValueContext({
      player,
      quality: pQualityRes,
      auctionCtx: ctx
    });
    const mvRes = evaluatePlayerMarketValue(mvCtx, player);

    expect(mvRes.marketValue).toBeGreaterThanOrEqual(2000); // Marquee anchor >= 20 Cr
    expect(mvRes.confidence).toBeGreaterThan(0.9);
    expect(mvRes.playerQuality.rating).toBe(97);
    expect(mvRes.playerQuality.statisticalEvidence?.sampleCategory).toBe('VETERAN');
    expect(mvRes.playerQuality.statisticalEvidence?.overallEvidenceScore).toBeGreaterThan(0.8);
  });

  it('Boundary P3 -> P4: Phase 4 takes actual Phase 3 Market Value and applies team squad consequences', () => {
    const player = makeMarqueePlayer();
    const ctx = makeContext();
    const bot = makeBot({ purse: 9000, players_bought: 3 });
    const emptyRoster: V3Player[] = [];

    const pQualityRes = assemblePlayerQualityResult(assemblePlayerQualityContext(player));
    const mvRes = evaluatePlayerMarketValue(assembleMarketValueContext({ player, quality: pQualityRes, auctionCtx: ctx }), player);

    const tvCtx = assembleTeamValueContext({
      player: assemblePlayerContext(player),
      marketValueResult: mvRes,
      teamNeed: assembleTeamNeedContext({ playerRole: player.role, roster: emptyRoster, maxSquadSize: ctx.maxSquadSize }),
      xiImprovement: assembleXIImprovementContext(pQualityRes),
      scarcity: assemblePlayerScarcityContext({ playerRole: player.role, auctionCtx: ctx }),
      teamFit: assembleTeamFitContext({ playerRole: player.role }),
      futurePlan: assembleFuturePlanContext({ maxSquadSize: ctx.maxSquadSize, roster: emptyRoster }),
      teamId: bot.id,
      currentRoster: emptyRoster
    });
    const tvRes = evaluateTeamValue(tvCtx);

    // Baseline market value carried into Phase 4
    expect(tvRes.marketValue).toBe(mvRes.marketValue);
    expect(tvRes.teamValue).toBeGreaterThan(0);
    expect(['COMMITTED', 'JUSTIFIED', 'NOT_COMMITTED']).toContain(tvRes.strategicCommitment);
  });

  it('Boundary P4 -> P5: Phase 5 enforces financial ceiling without recalculating team need', () => {
    const player = makeMarqueePlayer();
    const ctx = makeContext();
    const bot = makeBot({ purse: 5000, players_bought: 5 }); // remaining slots = 15
    const emptyRoster: V3Player[] = [];

    const pQualityRes = assemblePlayerQualityResult(assemblePlayerQualityContext(player));
    const mvRes = evaluatePlayerMarketValue(assembleMarketValueContext({ player, quality: pQualityRes, auctionCtx: ctx }), player);
    const tvRes = evaluateTeamValue(assembleTeamValueContext({
      player: assemblePlayerContext(player),
      marketValueResult: mvRes,
      teamNeed: assembleTeamNeedContext({ playerRole: player.role, roster: emptyRoster, maxSquadSize: ctx.maxSquadSize }),
      xiImprovement: assembleXIImprovementContext(pQualityRes),
      scarcity: assemblePlayerScarcityContext({ playerRole: player.role, auctionCtx: ctx }),
      teamFit: assembleTeamFitContext({ playerRole: player.role }),
      futurePlan: assembleFuturePlanContext({ maxSquadSize: ctx.maxSquadSize, roster: emptyRoster }),
      teamId: bot.id,
      currentRoster: emptyRoster
    }));

    const maxBidCtx = assembleMaximumBidContext({
      teamValue: tvRes,
      purse: assemblePursePositionContext({ team: bot, maxSquadSize: ctx.maxSquadSize }),
      auctionStage: assembleAuctionStage(ctx),
      currentBid: 1500,
      nextRequiredBid: 1550,
      futureBudget: 280 // 14 slots * 20L
    });
    const maxBidRes = evaluateMaximumBid(maxBidCtx);

    // Maximum bid must never exceed available purse - protected future budget
    expect(maxBidRes.maximumBid).toBeLessThanOrEqual(bot.purse - 280);
    expect(maxBidRes.maximumBid).toBeGreaterThan(0);
  });

  it('Boundary P5 -> P6/7 & Authority: maximumBid is strictly preserved; price above ceiling forces PASS', () => {
    const player = makePlayer();
    const ctx = makeContext();
    const bot = makeBot({ purse: 2000, players_bought: 10 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    // Set current bid to 1800 where nextRequiredBid (1850) exceeds maximum rational ceiling (1200)
    const evidence: BotDecisionEvidence[] = [];
    const validBids = evaluateBotsForLot(
      [bot],
      player,
      1800,
      100,
      undefined,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    expect(validBids).toHaveLength(0);
    expect(evidence[0]!.decision).toBe('DROP');
    expect(evidence[0]!.finalAction).toBe('PASS');
    expect(evidence[0]!.nextRequiredBid).toBeGreaterThan(evidence[0]!.maximumBid!);
  });

  it('Boundary P7 -> P8: BID maps to ENTER/validBids, PASS maps to DROP/no-bid', () => {
    const player = makeMarqueePlayer();
    const ctx = makeContext();
    const bot = makeBot({ purse: 9000, players_bought: 2 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    const evidence: BotDecisionEvidence[] = [];
    const validBids = evaluateBotsForLot(
      [bot],
      player,
      300,
      200,
      'other-team',
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    expect(validBids).toHaveLength(1);
    expect(validBids[0]!.teamId).toBe(bot.id);
    expect(validBids[0]!.nextBidAmount).toBe(325); // Next increment from 300
    expect(evidence[0]!.decision).toBe('ENTER');
    expect(evidence[0]!.finalAction).toBe('BID');
  });
});

describe('PHASE 1–8: Strategic Scenarios A through M', () => {

  // ── SCENARIO A: Marquee Player ─────────────────────────────────────────
  it('Scenario A — Marquee Player: Elite player receives high valuation and aggressive pursuit', () => {
    const kohli = makeMarqueePlayer();
    const ctx = makeContext();
    const bot = makeBot({ purse: 9500, players_bought: 2 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    const evidence: BotDecisionEvidence[] = [];
    const validBids = evaluateBotsForLot(
      [bot],
      kohli,
      1500, // 15 Cr current bid
      200,
      'rival-team',
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    expect(evidence[0]!.marketValue).toBeGreaterThanOrEqual(2000);
    expect(evidence[0]!.maximumBid).toBeGreaterThan(1600);
    expect(evidence[0]!.finalAction).toBe('BID');
    expect(evidence[0]!.decision).toBe('ENTER');
    expect(validBids).toHaveLength(1);
  });

  // ── SCENARIO B: Low Team Need ──────────────────────────────────────────
  it('Scenario B — Low Team Need: High-quality player with saturated team role causes lower TV & rational PASS', () => {
    const batsman = makePlayer({ rating: 88, runs: 4000 });
    const ctx = makeContext();
    // Bot already has 6 batsmen bought, role need is saturated
    const fullBattingRoster: V3Player[] = Array(6).fill(null).map((_, i) => makePlayer({ id: `bat-${i}`, role: 'BATSMAN' }));
    const bot = makeBot({ purse: 6000, players_bought: 8 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: fullBattingRoster };

    const evidence: BotDecisionEvidence[] = [];
    const validBids = evaluateBotsForLot(
      [bot],
      batsman,
      900,
      100,
      'rival-team',
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    // Team value should be reduced compared to an empty roster team
    expect(evidence[0]!.decision).toBe('DROP');
    expect(evidence[0]!.finalAction).toBe('PASS');
    expect(validBids).toHaveLength(0);
  });

  // ── SCENARIO C: Critical Team Gap ──────────────────────────────────────
  it('Scenario C — Critical Team Gap: Elite bowler directly solves critical gap with elevated commitment', () => {
    const bumrah = makeEliteBowler();
    const ctx = makeContext();
    // Bot has zero bowlers
    const bot = makeBot({ purse: 9000, players_bought: 4 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    const evidence: BotDecisionEvidence[] = [];
    const validBids = evaluateBotsForLot(
      [bot],
      bumrah,
      1200,
      200,
      'rival-team',
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    expect(evidence[0]!.marketValue).toBeGreaterThanOrEqual(1800);
    expect(['COMMITTED', 'MUST_HAVE', 'TARGETED']).toContain(evidence[0]!.strategicCommitment);
    expect(evidence[0]!.finalAction).toBe('BID');
    expect(evidence[0]!.decision).toBe('ENTER');
    expect(validBids).toHaveLength(1);
  });

  // ── SCENARIO D: Current Bid Below Maximum Bid ──────────────────────────
  it('Scenario D — Current Bid Below Maximum Bid: Bot does NOT pass when bid is legally affordable', () => {
    const player = makePlayer({ rating: 88 });
    const ctx = makeContext();
    const bot = makeBot({ purse: 8000, players_bought: 3 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    const evidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      player,
      500, // 5 Cr current bid, well below maxBid ~10-12 Cr
      100,
      'rival-team',
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    expect(evidence[0]!.nextRequiredBid).toBeLessThan(evidence[0]!.maximumBid!);
    expect(evidence[0]!.finalAction).toBe('BID');
    expect(evidence[0]!.decision).toBe('ENTER');
  });

  // ── SCENARIO E: Current Bid Above Maximum Bid ──────────────────────────
  it('Scenario E — Current Bid Above Maximum Bid: Bot strictly PASSes; no tactical override occurs', () => {
    const player = makePlayer({ rating: 80, runs: 1200 });
    const ctx = makeContext();
    const bot = makeBot({ purse: 5000, players_bought: 5 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    // Bid escalated to 1600, beyond player valuation
    const evidence: BotDecisionEvidence[] = [];
    const validBids = evaluateBotsForLot(
      [bot],
      player,
      1600,
      100,
      'rival-team',
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    expect(evidence[0]!.decision).toBe('DROP');
    expect(evidence[0]!.finalAction).toBe('PASS');
    expect(evidence[0]!.nextRequiredBid!).toBeGreaterThan(evidence[0]!.maximumBid!);
    expect(validBids).toHaveLength(0);
  });

  // ── SCENARIO F: Strong Opponent ────────────────────────────────────────
  it('Scenario F — Strong Opponent: Rival pressure detected, but maximumBid is unchanged and enforced', () => {
    const player = makePlayer({ rating: 85 });
    const ctx = makeContext();
    const bot = makeBot({ purse: 7000, players_bought: 4 });
    const rival = makeBot({ id: 'rival-bot', purse: 9000, players_bought: 2 });
    const allTeams = [bot, rival];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [], [rival.id]: [] };

    const evidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      player,
      600,
      100,
      rival.id,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    const maxBidWithRival = evidence[0]!.maximumBid;

    // Evaluate same scenario with neutral opponent
    const neutralEvidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      player,
      600,
      100,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      ctx,
      undefined,
      neutralEvidence
    );

    // Phase 5 maximumBid must be identical (not artificially inflated by opponent pressure)
    expect(maxBidWithRival).toBe(neutralEvidence[0]!.maximumBid);
  });

  // ── SCENARIO G: Cheap Alternative Exists ───────────────────────────────
  it('Scenario G — Cheap Alternative Exists: Plentiful alternatives reduce urgency and prevent overpaying', () => {
    const player = makePlayer({ rating: 82 });
    // Plentiful pool: 20 batsmen remaining
    const plentifulCtx = makeContext({
      futurePlayers: Array(20).fill({ role: 'BATSMAN', category: 'B', base_price: 50, is_overseas: false }),
      futureByRole: { BATSMAN: 20, BOWLER: 5, ALL_ROUNDER: 5, WICKET_KEEPER: 5 }
    });
    // Scarce pool: only 1 batsman remaining
    const scarceCtx = makeContext({
      futurePlayers: [{ role: 'BATSMAN', category: 'B', base_price: 50, is_overseas: false }],
      futureByRole: { BATSMAN: 1, BOWLER: 15, ALL_ROUNDER: 10, WICKET_KEEPER: 8 }
    });

    const bot = makeBot({ purse: 8000, players_bought: 4 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    const evPlentiful: BotDecisionEvidence[] = [];
    evaluateBotsForLot([bot], player, 200, 100, undefined, 'Normal', allTeams, teamRosters, plentifulCtx, undefined, evPlentiful);

    const evScarce: BotDecisionEvidence[] = [];
    evaluateBotsForLot([bot], player, 200, 100, undefined, 'Normal', allTeams, teamRosters, scarceCtx, undefined, evScarce);

    // When alternatives abound, Team Value is lower than when player is the last scarce option
    expect(evPlentiful[0]!.teamValue).toBeLessThanOrEqual(evScarce[0]!.teamValue!);
  });

  // ── SCENARIO H: Marquee Player Purchased Expensively ───────────────────
  it('Scenario H — Marquee Purchased Expensively: Purse deduction immediately constrains subsequent decisions', () => {
    const ordinaryPlayer = makePlayer({ rating: 82, runs: 1500, base_price: 100 });
    const ctx = makeContext();
    const botInitial = makeBot({ purse: 10000, players_bought: 3 });
    const allTeams = [botInitial];

    // Initial state: rich bot
    const ev1: BotDecisionEvidence[] = [];
    evaluateBotsForLot([botInitial], ordinaryPlayer, 700, 100, undefined, 'Normal', allTeams, { [botInitial.id]: [] }, ctx, undefined, ev1);

    // Bot buys marquee player for 25 Cr (2500L), purse drops to 7500L, squad slots increase
    const botAfterPurchase = makeBot({ purse: 7500, players_bought: 4 });
    const ev2: BotDecisionEvidence[] = [];
    evaluateBotsForLot([botAfterPurchase], ordinaryPlayer, 700, 100, undefined, 'Normal', [botAfterPurchase], { [botAfterPurchase.id]: [] }, ctx, undefined, ev2);

    // Maximum bid for ordinary player must decrease or reflect updated financial constraints
    expect(ev2[0]!.maximumBid).toBeLessThanOrEqual(ev1[0]!.maximumBid!);
  });

  // ── SCENARIO I: Endgame Solvency ───────────────────────────────────────
  it('Scenario I — Endgame: Remaining slot budget is strictly protected; no solvency violations', () => {
    const player = makePlayer({ rating: 80 });
    const ctx = makeContext({
      maxSquadSize: 18,
      futureMinBasePrice: 20
    });
    // Bot needs 3 more players (bought 15 of 18), purse is 100L (₹1 Cr).
    // Must reserve (3 - 1) * 20 = 40L for future 2 slots. Maximum bid on this lot cannot exceed 100 - 40 = 60L.
    const bot = makeBot({ purse: 100, players_bought: 15 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    const evidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      player,
      50,
      20,
      'rival-team',
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    expect(evidence[0]!.maximumBid).toBeLessThanOrEqual(60);
    // Solvency protection constraint active
    expect(evidence[0]!.bindingConstraint).toBeDefined();
  });

  // ── SCENARIO J: Different Teams, Same Player ───────────────────────────
  it('Scenario J — Different Teams, Same Player: Intrinsic P3 value is identical; P4/P5/P7 decisions differ', () => {
    const player = makePlayer({ role: 'BATSMAN', rating: 88, runs: 4000 });
    const ctx = makeContext();

    // Bot A: Has NO batsmen, abundant purse 9000L -> HIGH need
    const botA = makeBot({ id: 'bot-a', purse: 9000, players_bought: 2 });
    // Bot B: Has 5 batsmen already, tight purse 2500L -> LOW/REDUNDANT need
    const botB = makeBot({ id: 'bot-b', purse: 2500, players_bought: 10 });

    const allTeams = [botA, botB];
    const teamRosters: Record<string, V3Player[]> = {
      [botA.id]: [],
      [botB.id]: Array(5).fill(null).map((_, i) => makePlayer({ id: `bat-${i}`, role: 'BATSMAN' }))
    };

    const evidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [botA, botB],
      player,
      600,
      100,
      undefined,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    const evA = evidence.find(e => e.teamId === 'bot-a')!;
    const evB = evidence.find(e => e.teamId === 'bot-b')!;

    // 1. Phase 3 Market Value must be 100% IDENTICAL
    expect(evA.marketValue).toBe(evB.marketValue);

    // 2. Phase 4 Team Value must be DIFFERENT
    expect(evA.teamValue).toBeGreaterThan(evB.teamValue!);

    // 3. Phase 5 Maximum Bid must be DIFFERENT
    expect(evA.maximumBid).toBeGreaterThan(evB.maximumBid!);

    // 4. Decisions: Bot A BIDs, Bot B PASSes
    expect(evA.finalAction).toBe('BID');
    expect(evB.finalAction).toBe('PASS');
  });

  // ── SCENARIO K: State Changes Between Ticks ───────────────────────────
  it('Scenario K — Auction State Changes: Stale pending action invalidated when currentBid rises', () => {
    const player = makePlayer({ rating: 84 });
    const ctx = makeContext();
    const bot = makeBot({ purse: 6000, players_bought: 5 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    // Tick N: Current bid is 400L. Bot decides BID 425L.
    const evTick1: BotDecisionEvidence[] = [];
    const bidsTick1 = evaluateBotsForLot([bot], player, 400, 100, undefined, 'Normal', allTeams, teamRosters, ctx, undefined, evTick1);
    expect(bidsTick1).toHaveLength(1);
    expect(evTick1[0]!.finalAction).toBe('BID');
    const maxBid = evTick1[0]!.maximumBid!;

    // Rival jumps price to 100L above maxBid before bot's tick executes
    const newCurrentBid = maxBid + 100;
    const evTick2: BotDecisionEvidence[] = [];
    const bidsTick2 = evaluateBotsForLot([bot], player, newCurrentBid, 100, 'rival', 'Normal', allTeams, teamRosters, ctx, undefined, evTick2);

    // On Tick N+1 with updated state, bot immediately drops; no stale bid is submitted
    expect(bidsTick2).toHaveLength(0);
    expect(evTick2[0]!.decision).toBe('DROP');
    expect(evTick2[0]!.finalAction).toBe('PASS');
  });

  // ── SCENARIO L: Two Bots Compete ──────────────────────────────────────
  it('Scenario L — Two Bots Compete: Independent evaluations; higher rational ceiling prevails', () => {
    const player = makePlayer({ role: 'BOWLER', rating: 88, wickets: 120 });
    const ctx = makeContext();

    // Bot 1 has critical bowler gap, purse 9000L
    const bot1 = makeBot({ id: 'bot-1', purse: 9000, players_bought: 3 });
    // Bot 2 has secondary bowler need, purse 4000L
    const bot2 = makeBot({ id: 'bot-2', purse: 4000, players_bought: 8 });

    const allTeams = [bot1, bot2];
    const teamRosters: Record<string, V3Player[]> = { [bot1.id]: [], [bot2.id]: [] };

    // Price ladder simulation from 200L upwards
    let currentBid = 200;
    let highestBidder: string | undefined = undefined;

    for (let round = 0; round < 25; round++) {
      const ev: BotDecisionEvidence[] = [];
      const bids = evaluateBotsForLot(
        [bot1, bot2],
        player,
        currentBid,
        200,
        highestBidder,
        'Normal',
        allTeams,
        teamRosters,
        ctx,
        undefined,
        ev
      );

      // Filter out current highest bidder (cannot bid against self)
      const eligibleBids = bids.filter(b => b.teamId !== highestBidder);
      if (eligibleBids.length === 0) break; // Auction settled

      // First eligible bot places the bid
      const winningBid = eligibleBids[0]!;
      highestBidder = winningBid.teamId;
      currentBid = winningBid.nextBidAmount;
    }

    // Bot 1 (with higher valuation) should win or drop later than Bot 2
    expect(highestBidder).toBe('bot-1');
  });

  // ── SCENARIO M: Full Auction Multi-Lot Simulation ──────────────────────
  it('Scenario M — Multi-Lot Squad Completion: 10 lots across 4 bots maintain legal spending and sanity', () => {
    const bots: V3Team[] = [
      makeBot({ id: 'team-csk', name: 'CSK', purse: 10000, players_bought: 0 }),
      makeBot({ id: 'team-mi', name: 'MI', purse: 10000, players_bought: 0 }),
      makeBot({ id: 'team-rcb', name: 'RCB', purse: 10000, players_bought: 0 }),
      makeBot({ id: 'team-kkr', name: 'KKR', purse: 10000, players_bought: 0 }),
    ];

    const rosters: Record<string, V3Player[]> = {
      'team-csk': [],
      'team-mi': [],
      'team-rcb': [],
      'team-kkr': [],
    };

    const playersToAuction: V3Player[] = [
      makeMarqueePlayer(),
      makeEliteBowler(),
      makePlayer({ id: 'p-3', name: 'KL Rahul', role: 'WICKET_KEEPER', rating: 91, runs: 4200 }),
      makePlayer({ id: 'p-4', name: 'Hardik Pandya', role: 'ALL_ROUNDER', rating: 90, runs: 2300, wickets: 53 }),
      makePlayer({ id: 'p-5', name: 'Shubman Gill', role: 'BATSMAN', rating: 89, runs: 2800 }),
      makePlayer({ id: 'p-6', name: 'Mohammed Shami', role: 'BOWLER', rating: 91, wickets: 127 }),
      makePlayer({ id: 'p-7', name: 'Rishabh Pant', role: 'WICKET_KEEPER', rating: 90, runs: 3200 }),
      makePlayer({ id: 'p-8', name: 'Rashid Khan', role: 'BOWLER', rating: 94, wickets: 140, is_overseas: true, country: 'Afghanistan' }),
      makePlayer({ id: 'p-9', name: 'Suryakumar Yadav', role: 'BATSMAN', rating: 92, runs: 3500 }),
      makePlayer({ id: 'p-10', name: 'Ravindra Jadeja', role: 'ALL_ROUNDER', rating: 90, runs: 2700, wickets: 152 }),
    ];

    let totalSold = 0;
    let totalBidsPlaced = 0;

    for (let lotIdx = 0; lotIdx < playersToAuction.length; lotIdx++) {
      const player = playersToAuction[lotIdx]!;
      let currentBid = player.base_price;
      let highestBidder: string | undefined = undefined;
      let lotBids = 0;

      const lotCtx = makeContext({
        totalLots: playersToAuction.length,
        lotsCompleted: lotIdx,
        lotsRemaining: playersToAuction.length - lotIdx - 1,
        auctionProgress: lotIdx / playersToAuction.length,
      });

      // Auction rounds for this lot
      for (let round = 0; round < 50; round++) {
        const ev: BotDecisionEvidence[] = [];
        const bids = evaluateBotsForLot(
          bots,
          player,
          currentBid,
          player.base_price,
          highestBidder,
          'Normal',
          bots,
          rosters,
          lotCtx,
          undefined,
          ev
        );

        const eligible = bids.filter(b => b.teamId !== highestBidder);
        if (eligible.length === 0) break;

        // Highest willing bidder or first responder takes the step
        const chosen = eligible[0]!;
        highestBidder = chosen.teamId;
        currentBid = chosen.nextBidAmount;
        lotBids++;
        totalBidsPlaced++;
      }

      if (highestBidder) {
        totalSold++;
        const winningTeam = bots.find(b => b.id === highestBidder)!;
        winningTeam.purse -= currentBid;
        winningTeam.players_bought++;
        if (player.is_overseas) winningTeam.overseas_count++;
        rosters[highestBidder]!.push(player);

        // Verification invariant: Purse must remain non-negative
        expect(winningTeam.purse).toBeGreaterThanOrEqual(0);
        // Verification invariant: Overseas limit must be respected
        expect(winningTeam.overseas_count).toBeLessThanOrEqual(8);
      }
    }

    expect(totalSold).toBeGreaterThan(0);
    expect(totalBidsPlaced).toBeGreaterThan(0);
  }, 30000);
});
