import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBotMemory,
  recordBotBidObservation,
  recordRivalBidObservation,
  syncBotMemoryWithState,
  clearAuctionMemory,
  clearBotMemory
} from '@/lib/auction/bot-brain-memory';
import {
  evaluateBotsForLot,
  DEFAULT_CONTEXT,
  type AuctionContext,
  type BotDecisionEvidence
} from '@/lib/auction/server-bot-engine';
import { evaluatePursePacing } from '@/lib/auction/bot-tactical-engine';
import { type V3Player, type V3Team } from '@/lib/v3-auction-types';

describe('Behavior B17-A: Memory Capture & State Update', () => {
  const auctionId = 'auction-b17a';
  const botA = 'bot-team-alpha';
  const botB = 'bot-team-beta';
  const botC = 'bot-team-gamma';

  beforeEach(() => {
    clearAuctionMemory(auctionId);
  });

  const makePlayer = (id: string, overrides: Partial<V3Player> = {}): V3Player => ({
    id,
    name: `Player ${id}`,
    role: 'BATSMAN',
    category: 'B',
    country: 'India',
    age: 26,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
    rating: 85,
    created_at: new Date().toISOString(),
    ...overrides
  });

  const makeBot = (id: string, overrides: Partial<V3Team> = {}): V3Team => ({
    id,
    name: `Team ${id}`,
    short_name: id.slice(0, 4).toUpperCase(),
    is_bot: true,
    purse: 6000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 1,
    ...overrides
  });

  // ============================================================
  // TEST 1 — OWN ACTION CAPTURE
  // ============================================================
  it('TEST 1 — OWN ACTION CAPTURE: Bot performs real bid through server path, capturing observation in memory', () => {
    const candidatePlayer = makePlayer('lot-own-bid-1', { base_price: 100 });
    const serverBot = makeBot(botA, { purse: 6000, initial_purse: 10000 });
    const rival = makeBot(botB, { purse: 8000 });
    const allTeams = [serverBot, rival];
    const teamRosters: Record<string, V3Player[]> = { [serverBot.id]: [], [rival.id]: [] };

    // BEFORE EVENT: No observation exists in bot memory
    const memBefore = getBotMemory(auctionId, serverBot.id);
    expect(memBefore.observedBids[candidatePlayer.id]).toBeUndefined();

    // EVENT: Bot evaluates lot through real server evaluation path
    const evidenceArr: BotDecisionEvidence[] = [];
    const validBids = evaluateBotsForLot(
      [serverBot],
      candidatePlayer,
      200, // On discrete ladder
      100, // base price
      rival.id, // rival is current high bidder
      'Normal',
      allTeams,
      teamRosters,
      { ...DEFAULT_CONTEXT, futurePlayers: [] } as any,
      null,
      evidenceArr,
      auctionId
    );

    // AFTER EVENT: Bot entered, placed next required bid 225, and captured it into memory
    expect(validBids.length).toBe(1);
    expect(validBids[0]!.nextBidAmount).toBe(225);

    const memAfter = getBotMemory(auctionId, serverBot.id);
    const ownObs = memAfter.observedBids[candidatePlayer.id];

    expect(ownObs).toBeDefined();
    expect(ownObs!.highestBid).toBe(225);
    expect(ownObs!.isFinalBid).toBe(false);
    expect(ownObs!.observedAt).toBeGreaterThan(0);
    expect(memAfter.teamId).toBe(serverBot.id);
    expect(memAfter.auctionId).toBe(auctionId);
  });

  // ============================================================
  // TEST 2 — OWN PURCHASE / LOT OUTCOME
  // ============================================================
  it('TEST 2 — OWN PURCHASE / LOT OUTCOME: Authoritative SOLD outcome updates bot memory and resets dry lots', () => {
    const bot = makeBot(botA);

    // BEFORE EVENT: Bot has dry spell of 5 lots and 0 recorded purchases
    const memBefore = getBotMemory(auctionId, bot.id);
    memBefore.lotsSinceLastPurchase = 5;
    expect(memBefore.purchases.length).toBe(0);

    // Initialize baseline tracking
    syncBotMemoryWithState(auctionId, bot.id, 'lot-1', []);

    // EVENT: Lot-1 completes and is SOLD to this bot
    const soldLot = {
      id: 'lot-1',
      status: 'SOLD',
      player_id: 'player-won-1',
      winning_team_id: bot.id,
      winning_bid: 500,
      base_price: 100,
      players: { role: 'BATSMAN' }
    };

    const memAfter = syncBotMemoryWithState(auctionId, bot.id, 'lot-2', [soldLot]);

    // AFTER EVENT: Purchase is recorded, lotsSinceLastPurchase resets to 0
    expect(memAfter.purchases.length).toBe(1);
    expect(memAfter.purchases[0]!.playerId).toBe('player-won-1');
    expect(memAfter.purchases[0]!.amount).toBe(500);
    expect(memAfter.purchases[0]!.role).toBe('BATSMAN');
    expect(memAfter.lotsSinceLastPurchase).toBe(0);
  });

  // ============================================================
  // TEST 3 — RIVAL OBSERVATION
  // ============================================================
  it('TEST 3 — RIVAL OBSERVATION: Real rival bid and purchase events are captured as observations without speculation', () => {
    const candidatePlayer = makePlayer('lot-rival-test', { base_price: 100 });
    const bot = makeBot(botA);
    const rival = makeBot(botB);

    // BEFORE EVENT: No rival observation in botA memory
    const memBefore = getBotMemory(auctionId, bot.id);
    expect(memBefore.observedRivalBids[candidatePlayer.id]).toBeUndefined();

    // EVENT 1: Real rival bid observed through server engine path
    evaluateBotsForLot(
      [bot],
      candidatePlayer,
      350,
      100,
      rival.id, // Rival is highest bidder
      'Normal',
      [bot, rival],
      { [bot.id]: [], [rival.id]: [] },
      { ...DEFAULT_CONTEXT, futurePlayers: [] } as any,
      null,
      [],
      auctionId
    );

    // AFTER EVENT 1: Rival bid observation captured as factual public observation
    const memAfterBid = getBotMemory(auctionId, bot.id);
    const rivalBidObs = memAfterBid.observedRivalBids[candidatePlayer.id];
    expect(rivalBidObs).toBeDefined();
    expect(rivalBidObs!.bidderTeamId).toBe(rival.id);
    expect(rivalBidObs!.highestBid).toBe(350);
    expect(rivalBidObs!.observedAt).toBeGreaterThan(0);

    // EVENT 2: Rival purchase of completed lot
    syncBotMemoryWithState(auctionId, bot.id, 'lot-rival-test', []);
    const rivalSoldLot = {
      id: 'lot-rival-test',
      status: 'SOLD',
      player_id: candidatePlayer.id,
      winning_team_id: rival.id,
      winning_bid: 700,
      players: { role: 'BATSMAN' }
    };

    const memAfterSold = syncBotMemoryWithState(auctionId, bot.id, 'lot-next', [rivalSoldLot]);

    // AFTER EVENT 2: Rival purchase captured
    expect(memAfterSold.rivalPurchases.length).toBe(1);
    expect(memAfterSold.rivalPurchases[0]!.playerId).toBe(candidatePlayer.id);
    expect(memAfterSold.rivalPurchases[0]!.winnerId).toBe(rival.id);
    expect(memAfterSold.rivalPurchases[0]!.amount).toBe(700);
  });

  // ============================================================
  // TEST 4 — NO FALSE MEMORY
  // ============================================================
  it('TEST 4 — NO FALSE MEMORY: Unrelated event does not create false observations for observing bot', () => {
    const unrelatedPlayer = makePlayer('unrelated-player-99');
    const bot = makeBot(botA);

    // BEFORE: Bot memory is clean
    const memBefore = getBotMemory(auctionId, bot.id);
    expect(memBefore.observedBids['unrelated-player-99']).toBeUndefined();
    expect(memBefore.observedRivalBids['unrelated-player-99']).toBeUndefined();

    // EVENT: Actions performed between Bot B and Bot C on unrelated player
    recordBotBidObservation(auctionId, botB, unrelatedPlayer.id, 900);
    recordRivalBidObservation(auctionId, botB, unrelatedPlayer.id, botC, 950);

    // AFTER: Bot A memory remains 100% clean and unpolluted
    const memA = getBotMemory(auctionId, bot.id);
    expect(memA.observedBids['unrelated-player-99']).toBeUndefined();
    expect(memA.observedRivalBids['unrelated-player-99']).toBeUndefined();
    expect(memA.purchases.length).toBe(0);
    expect(memA.rivalPurchases.length).toBe(0);
  });

  // ============================================================
  // TEST 5 — DUPLICATE & IDEMPOTENCY
  // ============================================================
  it('TEST 5 — DUPLICATE / IDEMPOTENCY: Replaying identical or stale events does not double-count or corrupt state', () => {
    const player = makePlayer('player-idem-1');
    const bot = makeBot(botA);

    // 1. Own bid idempotency & staleness
    recordBotBidObservation(auctionId, bot.id, player.id, 500);
    // Duplicate identical bid
    recordBotBidObservation(auctionId, bot.id, player.id, 500);
    expect(getBotMemory(auctionId, bot.id).observedBids[player.id]?.highestBid).toBe(500);
    // Stale lower bid
    recordBotBidObservation(auctionId, bot.id, player.id, 350);
    expect(getBotMemory(auctionId, bot.id).observedBids[player.id]?.highestBid).toBe(500);

    // 2. Rival bid idempotency & staleness
    recordRivalBidObservation(auctionId, bot.id, player.id, botB, 600);
    recordRivalBidObservation(auctionId, bot.id, player.id, botB, 600); // duplicate
    expect(getBotMemory(auctionId, bot.id).observedRivalBids[player.id]?.highestBid).toBe(600);
    recordRivalBidObservation(auctionId, bot.id, player.id, botB, 450); // stale
    expect(getBotMemory(auctionId, bot.id).observedRivalBids[player.id]?.highestBid).toBe(600);

    // 3. Purchase idempotency: replaying same completed lot tick
    syncBotMemoryWithState(auctionId, bot.id, 'lot-idem-init', []);
    const completedLots = [{
      id: 'lot-idem-1',
      status: 'SOLD',
      player_id: player.id,
      winning_team_id: bot.id,
      winning_bid: 600,
      players: { role: 'BATSMAN' }
    }];

    // First processing
    let mem = syncBotMemoryWithState(auctionId, bot.id, 'lot-idem-next', completedLots);
    expect(mem.purchases.length).toBe(1);

    // Replay same tick with identical completed lot
    mem = syncBotMemoryWithState(auctionId, bot.id, 'lot-idem-next', completedLots);
    expect(mem.purchases.length).toBe(1); // Not duplicated!
  });

  // ============================================================
  // TEST 6 — REGRESSION (B13 & B14 COMPATIBILITY)
  // ============================================================
  it('TEST 6 — REGRESSION: B13 isFinalBid and B14 purse-pacing state remain intact across memory updates', () => {
    const lotId = 'lot-regression-check';
    const bot = makeBot(botA, { purse: 5000, initial_purse: 10000 });

    // 1. B13 regression: isFinalBid flag preservation
    recordBotBidObservation(auctionId, bot.id, lotId, 1175, true);
    let mem = getBotMemory(auctionId, bot.id);
    expect(mem.observedBids[lotId]?.isFinalBid).toBe(true);
    expect(mem.observedBids[lotId]?.highestBid).toBe(1175);

    // Subsequent normal bid must NOT overwrite or degrade isFinalBid: true
    recordBotBidObservation(auctionId, bot.id, lotId, 1175, false);
    mem = getBotMemory(auctionId, bot.id);
    expect(mem.observedBids[lotId]?.isFinalBid).toBe(true);

    // 2. B14 regression: purse-pacing state calculation remains intact
    const earlyPacing = evaluatePursePacing({
      purse: bot.purse,
      remainingSlots: 20,
      auctionProgress: 0.0,
      futurePoolCount: 50,
      nextRequiredBid: 775,
      roleNeed: 'NORMAL'
    });
    expect(earlyPacing.pacingState).toBe('EARLY_PRESERVATION');
    expect(earlyPacing.shouldPass).toBe(true);

    const latePacing = evaluatePursePacing({
      purse: bot.purse,
      remainingSlots: 20,
      auctionProgress: 0.85,
      futurePoolCount: 2,
      nextRequiredBid: 775,
      roleNeed: 'NORMAL'
    });
    expect(latePacing.pacingState).toBe('LATE_RELEASE');
    expect(latePacing.shouldPass).toBe(false);
  });
});
