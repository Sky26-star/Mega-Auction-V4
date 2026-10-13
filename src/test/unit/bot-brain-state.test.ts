import { describe, it, expect, beforeEach } from 'vitest';
import {
  updateBotBrainState,
  getBotBrainState,
  clearBrainStateCache,
  clearInactiveBrainStateCache,
  type BotBrainStateInput,
  type BotBeliefs,
  type BotPlan,
} from '../../lib/auction/bot-brain-state';
import { clearAuctionMemory, clearInactiveAuctionMemory, getBotMemory, recordBotBidObservation, syncBotMemoryWithState } from '../../lib/auction/bot-brain-memory';
import { DEFAULT_CONTEXT, type AuctionContext, evaluateBotsForLot } from '../../lib/auction/server-bot-engine';
import { type V3Team, type V3Player } from '../../lib/v3-auction-types';

// ============================================================
// HELPERS
// ============================================================

function makeBot(overrides: Partial<V3Team> = {}): V3Team {
  return {
    id: 'bot-1',
    name: 'Test Bot',
    short_name: 'TB',
    purse: 10000,
    initial_purse: 10000,
    players_bought: 0,
    overseas_count: 0,
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
    batting_hand: 'Right',
    base_price: 200,
    is_overseas: false,
    image_url: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<BotBrainStateInput> = {}): BotBrainStateInput {
  const bot = makeBot();
  return {
    auctionId: 'auction-1',
    teamId: 'bot-1',
    bot,
    botRoster: [],
    currentBid: 0,
    basePrice: 200,
    playerRole: 'BATSMAN',
    playerIsOverseas: false,
    allTeams: [bot],
    teamRosters: {},
    ctx: { ...DEFAULT_CONTEXT },
    ...overrides,
  };
}

// ============================================================
// TESTS
// ============================================================

describe('Bot Brain State', () => {
  beforeEach(() => {
    clearAuctionMemory('auction-1');
    clearAuctionMemory('auction-2');
  });

  // ---- TEST 1: neutral beliefs with minimal information ----
  it('1. produces neutral beliefs with minimal information', () => {
    const input = makeInput();
    const state = updateBotBrainState(input);

    expect(state.beliefs.marketInflation).toBe(0.0); // no current bid
    // roleScarcityPanic depends on getRoleNeed for empty roster
    expect(state.beliefs.roleScarcityPanic).toBeGreaterThanOrEqual(0.0);
    expect(state.beliefs.roleScarcityPanic).toBeLessThanOrEqual(1.0);
    expect(state.beliefs.rivalAggression).toBeGreaterThanOrEqual(0.0);
    expect(state.beliefs.rivalAggression).toBeLessThanOrEqual(1.0);
    expect(state.beliefs.estimatedSquadQuality).toBe(0.0); // empty roster
  });

  // ---- TEST 2: high current bid produces higher market-pressure belief ----
  it('2. high current bid produces higher marketInflation', () => {
    const lowBid = updateBotBrainState(makeInput({ currentBid: 200, basePrice: 200 }));
    const highBid = updateBotBrainState(makeInput({ currentBid: 1200, basePrice: 200 }));

    expect(highBid.beliefs.marketInflation).toBeGreaterThan(lowBid.beliefs.marketInflation);
    expect(lowBid.beliefs.marketInflation).toBe(0.0); // at base price, ratio=1, (1-1)/5=0
    expect(highBid.beliefs.marketInflation).toBeGreaterThan(0.0);
    expect(highBid.beliefs.marketInflation).toBeLessThanOrEqual(2.0);
  });

  // ---- TEST 3: role scarcity increases when bot lacks that role ----
  it('3. roleScarcityPanic increases when bot lacks that role', () => {
    // Bot with no batsmen
    const noBatsmen = updateBotBrainState(makeInput({
      botRoster: [],
      playerRole: 'BATSMAN',
    }));

    // Bot with several batsmen already
    const manyBatsmen = updateBotBrainState(makeInput({
      botRoster: [
        makePlayer({ id: 'p1', role: 'BATSMAN' }),
        makePlayer({ id: 'p2', role: 'BATSMAN' }),
        makePlayer({ id: 'p3', role: 'BATSMAN' }),
        makePlayer({ id: 'p4', role: 'BATSMAN' }),
        makePlayer({ id: 'p5', role: 'BATSMAN' }),
        makePlayer({ id: 'p6', role: 'BATSMAN' }),
        makePlayer({ id: 'p7', role: 'BATSMAN' }),
        makePlayer({ id: 'p8', role: 'BATSMAN' }),
      ],
      bot: makeBot({ players_bought: 8 }),
      playerRole: 'BATSMAN',
    }));

    expect(noBatsmen.beliefs.roleScarcityPanic).toBeGreaterThan(manyBatsmen.beliefs.roleScarcityPanic);
  });

  // ---- TEST 4: rival pressure changes rivalAggression ----
  it('4. rivalAggression changes with competing teams', () => {
    const bot = makeBot({ id: 'bot-1' });
    const rival1 = makeBot({ id: 'rival-1', purse: 8000, is_bot: false });
    const rival2 = makeBot({ id: 'rival-2', purse: 8000, is_bot: false });

    // No rivals
    const noRivals = updateBotBrainState(makeInput({
      allTeams: [bot],
      teamRosters: {},
    }));

    // Two rivals who need batsmen (empty rosters â†’ CRITICAL need)
    const withRivals = updateBotBrainState(makeInput({
      allTeams: [bot, rival1, rival2],
      teamRosters: {},
      currentBid: 400,
      basePrice: 200,
    }));

    expect(withRivals.beliefs.rivalAggression).toBeGreaterThan(noRivals.beliefs.rivalAggression);
  });

  // ---- TEST 5: squad quality uses existing rating proxy ----
  it('5. estimatedSquadQuality reflects roster category quality', () => {
    const lowQuality = updateBotBrainState(makeInput({
      botRoster: [
        makePlayer({ id: 'p1', category: 'D' }),
        makePlayer({ id: 'p2', category: 'D' }),
      ],
      bot: makeBot({ players_bought: 2 }),
    }));

    const highQuality = updateBotBrainState(makeInput({
      botRoster: [
        makePlayer({ id: 'p1', category: 'MARQUEE' }),
        makePlayer({ id: 'p2', category: 'A' }),
      ],
      bot: makeBot({ players_bought: 2 }),
    }));

    expect(highQuality.beliefs.estimatedSquadQuality).toBeGreaterThan(
      lowQuality.beliefs.estimatedSquadQuality
    );
    expect(lowQuality.beliefs.estimatedSquadQuality).toBeGreaterThan(0.0);
    expect(highQuality.beliefs.estimatedSquadQuality).toBeLessThanOrEqual(1.0);
  });

  // ---- TEST 6: BotPlan is deterministic ----
  it('6. BotPlan is deterministic â€” identical inputs yield identical output', () => {
    const input = makeInput({ currentBid: 300, basePrice: 200 });
    const state1 = updateBotBrainState(input);
    const state2 = updateBotBrainState(input);

    expect(state1.beliefs).toEqual(state2.beliefs);
    expect(state1.plan.urgency).toBe(state2.plan.urgency);
    expect(state1.plan.strategicFocus).toBe(state2.plan.strategicFocus);
    expect(state1.plan.willSacrificeOverseasForQuality).toBe(state2.plan.willSacrificeOverseasForQuality);
    expect(state1.plan.budgetAllocation.totalRemaining).toBe(state2.plan.budgetAllocation.totalRemaining);
    expect(state1.plan.budgetAllocation.discretionaryBudget).toBe(state2.plan.budgetAllocation.discretionaryBudget);
  });

  // ---- TEST 7: strategicFocus changes logically with state ----
  it('7. strategicFocus changes with auction progress', () => {
    // Early auction with well-staffed roster â†’ BUILD_CORE or TARGET_VALUE
    const early = updateBotBrainState(makeInput({
      bot: makeBot({ players_bought: 15 }),
      playerRole: 'BATSMAN',
      botRoster: [
        ...Array.from({ length: 5 }, (_, i) => makePlayer({ id: `bat${i}`, role: 'BATSMAN' })),
        ...Array.from({ length: 6 }, (_, i) => makePlayer({ id: `bowl${i}`, role: 'BOWLER' })),
        ...Array.from({ length: 2 }, (_, i) => makePlayer({ id: `ar${i}`, role: 'ALL_ROUNDER' })),
        ...Array.from({ length: 2 }, (_, i) => makePlayer({ id: `wk${i}`, role: 'WICKET_KEEPER' })),
      ],
      ctx: { ...DEFAULT_CONTEXT, auctionProgress: 0.1, lotsCompleted: 5, lotsRemaining: 45 },
    }));
    expect(['BUILD_CORE', 'TARGET_VALUE']).toContain(early.plan.strategicFocus);

    // Late auction â†’ LATE_AUCTION
    const late = updateBotBrainState(makeInput({
      ctx: { ...DEFAULT_CONTEXT, auctionProgress: 0.85, lotsCompleted: 42, lotsRemaining: 8 },
    }));
    expect(late.plan.strategicFocus).toBe('LATE_AUCTION');
  });

  // ---- TEST 8: budgetAllocation never changes authoritative purse ----
  it('8. budgetAllocation does not change authoritative purse', () => {
    const bot = makeBot({ purse: 5000 });
    const input = makeInput({ bot, teamId: bot.id });
    const state = updateBotBrainState(input);

    expect(state.plan.budgetAllocation.totalRemaining).toBe(5000);
    expect(bot.purse).toBe(5000); // Bot object was not mutated
  });

  // ---- TEST 9: overseas sacrifice flag is deterministic ----
  it('9. willSacrificeOverseasForQuality is deterministic', () => {
    // Plenty of overseas room, low quality â†’ true
    const lotsOfRoom = updateBotBrainState(makeInput({
      bot: makeBot({ overseas_count: 0 }),
      botRoster: [],
      ctx: { ...DEFAULT_CONTEXT, maxOverseas: 8 },
    }));
    expect(lotsOfRoom.plan.willSacrificeOverseasForQuality).toBe(true);

    // Almost full overseas slots â†’ false
    const noRoom = updateBotBrainState(makeInput({
      bot: makeBot({ overseas_count: 6 }),
      botRoster: [
        makePlayer({ id: 'p1', category: 'MARQUEE' }),
        makePlayer({ id: 'p2', category: 'MARQUEE' }),
      ],
      ctx: { ...DEFAULT_CONTEXT, maxOverseas: 8 },
    }));
    expect(noRoom.plan.willSacrificeOverseasForQuality).toBe(false);
  });

  // ---- TEST 10: repeated calculation with identical input returns identical output ----
  it('10. repeated calls with same input are stable', () => {
    const input = makeInput({
      currentBid: 500,
      basePrice: 100,
      botRoster: [makePlayer({ id: 'p1', category: 'A' })],
      bot: makeBot({ players_bought: 1 }),
    });

    const results = Array.from({ length: 5 }, () => updateBotBrainState(input));

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.beliefs).toEqual(results[0]!.beliefs);
      expect(results[i]!.plan.urgency).toBe(results[0]!.plan.urgency);
      expect(results[i]!.plan.strategicFocus).toBe(results[0]!.plan.strategicFocus);
    }
  });

  // ---- TEST 11: no external/network calls ----
  it('11. updateBotBrainState is synchronous and returns immediately', () => {
    const input = makeInput();
    const start = Date.now();
    const state = updateBotBrainState(input);
    const elapsed = Date.now() - start;

    expect(state).toBeDefined();
    expect(state.beliefs).toBeDefined();
    expect(state.plan).toBeDefined();
    expect(elapsed).toBeLessThan(50); // Must complete in well under 50ms
  });

  // ---- TEST 12: no mutation of BotMemory ----
  it('12. does not mutate BotMemory', () => {
    // Initialize memory with some state
    syncBotMemoryWithState('auction-1', 'bot-1', 'lot-1', []);
    recordBotBidObservation('auction-1', 'bot-1', 'player-A', 300);
    const memBefore = getBotMemory('auction-1', 'bot-1');
    const purchasesBefore = memBefore.purchases.length;
    const failedBefore = memBefore.failedTargets.length;
    const lotsBefore = memBefore.lotsSinceLastPurchase;
    const observedBidsBefore = { ...memBefore.observedBids };

    updateBotBrainState(makeInput());

    const memAfter = getBotMemory('auction-1', 'bot-1');
    expect(memAfter.purchases.length).toBe(purchasesBefore);
    expect(memAfter.failedTargets.length).toBe(failedBefore);
    expect(memAfter.lotsSinceLastPurchase).toBe(lotsBefore);
    expect(memAfter.observedBids).toEqual(observedBidsBefore);
  });

  // ---- TEST 13: empty squad handled safely ----
  it('13. handles empty squad safely', () => {
    const state = updateBotBrainState(makeInput({
      botRoster: [],
      bot: makeBot({ players_bought: 0 }),
    }));

    expect(state.beliefs.estimatedSquadQuality).toBe(0.0);
    expect(state.plan.urgency).toBeGreaterThanOrEqual(0.0);
    expect(state.plan.budgetAllocation.totalRemaining).toBe(10000);
  });

  // ---- TEST 14: empty/partial auction context handled safely ----
  it('14. handles partial auction context safely', () => {
    const state = updateBotBrainState(makeInput({
      ctx: {
        ...DEFAULT_CONTEXT,
        futurePlayers: [],
        futureByRole: {},
        futureByRoleAndQuality: {},
        futureOverseasByRole: {},
        totalLots: 0,
        lotsCompleted: 0,
        lotsRemaining: 0,
        auctionProgress: 0,
      },
    }));

    expect(state.beliefs).toBeDefined();
    expect(state.plan).toBeDefined();
    expect(state.plan.strategicFocus).toBeDefined();
  });

  // ---- TEST: PROTECT_PURSE focus ----
  it('strategicFocus becomes PROTECT_PURSE when heavily spent and not urgent', () => {
    const state = updateBotBrainState(makeInput({
      bot: makeBot({ purse: 2000, initial_purse: 10000, players_bought: 15 }),
      botRoster: Array.from({ length: 15 }, (_, i) => makePlayer({ id: `p${i}`, role: i < 5 ? 'BATSMAN' : i < 10 ? 'BOWLER' : i < 13 ? 'ALL_ROUNDER' : 'WICKET_KEEPER' })),
      ctx: { ...DEFAULT_CONTEXT, auctionProgress: 0.5, lotsCompleted: 25, lotsRemaining: 25 },
    }));
    expect(state.plan.strategicFocus).toBe('PROTECT_PURSE');
  });

  // ---- TEST: beliefs are within documented ranges ----
  it('all belief values are within documented ranges', () => {
    // Extreme scenario
    const state = updateBotBrainState(makeInput({
      currentBid: 5000,
      basePrice: 100,
      bot: makeBot({ purse: 500, initial_purse: 10000, players_bought: 20, overseas_count: 7 }),
      botRoster: Array.from({ length: 20 }, (_, i) => makePlayer({ id: `p${i}`, category: 'D' })),
      allTeams: [
        makeBot({ id: 'bot-1', purse: 500 }),
        makeBot({ id: 'r1', purse: 8000, is_bot: false }),
        makeBot({ id: 'r2', purse: 8000, is_bot: false }),
        makeBot({ id: 'r3', purse: 8000, is_bot: false }),
      ],
      teamRosters: {},
      ctx: { ...DEFAULT_CONTEXT, auctionProgress: 0.9 },
    }));

    expect(state.beliefs.marketInflation).toBeGreaterThanOrEqual(0.0);
    expect(state.beliefs.marketInflation).toBeLessThanOrEqual(2.0);
    expect(state.beliefs.roleScarcityPanic).toBeGreaterThanOrEqual(0.0);
    expect(state.beliefs.roleScarcityPanic).toBeLessThanOrEqual(1.0);
    expect(state.beliefs.rivalAggression).toBeGreaterThanOrEqual(0.0);
    expect(state.beliefs.rivalAggression).toBeLessThanOrEqual(1.0);
    expect(state.beliefs.estimatedSquadQuality).toBeGreaterThanOrEqual(0.0);
    expect(state.beliefs.estimatedSquadQuality).toBeLessThanOrEqual(1.0);
    expect(state.plan.urgency).toBeGreaterThanOrEqual(0.0);
    expect(state.plan.urgency).toBeLessThanOrEqual(1.0);
  });

  // ---- TEST: FILL_GAPS focus when roleScarcityPanic is high ----
  it('strategicFocus becomes FILL_GAPS when roleScarcityPanic is high and not late auction', () => {
    // Bot with 0 wicketkeepers â†’ CRITICAL need for WICKET_KEEPER
    const state = updateBotBrainState(makeInput({
      playerRole: 'WICKET_KEEPER',
      botRoster: [],
      ctx: { ...DEFAULT_CONTEXT, auctionProgress: 0.4, lotsCompleted: 20, lotsRemaining: 30 },
    }));
    expect(state.plan.strategicFocus).toBe('FILL_GAPS');
  });
});

// ============================================================
// PHASE 1D: LIFECYCLE INTEGRATION & REGRESSION TESTS
// ============================================================
describe('Phase 1D: Lifecycle Integration & Regression', () => {
  const AUCTION_ID_LIVE = 'auction-live-1';
  const AUCTION_ID_ISO = 'auction-iso';
  const AUCTION_ID_REGRESS = 'auction-regress';

  beforeEach(() => {
    clearBrainStateCache();
    clearAuctionMemory(AUCTION_ID_LIVE);
    clearAuctionMemory(AUCTION_ID_ISO);
    clearAuctionMemory(AUCTION_ID_REGRESS);
  });

  it('1. Calculates BotBrainState without mutating BotMemory', () => {
    const auctionId = AUCTION_ID_LIVE;
    const bot = makeBot({ id: 'bot-live', purse: 5000, players_bought: 10 });
    const input = makeInput({ auctionId, teamId: bot.id, bot });

    // Step 1: Sync memory
    syncBotMemoryWithState(auctionId, bot.id, 'lot-1', []);
    const memoryBefore = getBotMemory(auctionId, bot.id);
    const purchasesBefore = memoryBefore.purchases.length;
    const observedBefore = Object.keys(memoryBefore.observedBids).length;

    // Step 2: Update brain state
    const state = updateBotBrainState(input);

    // Assertions
    expect(state.beliefs).toBeDefined();
    expect(state.plan).toBeDefined();
    expect(state.memory).toBeDefined();

    // Memory should NOT be mutated
    const memoryAfter = getBotMemory(auctionId, bot.id);
    expect(memoryAfter.purchases.length).toBe(purchasesBefore);
    expect(Object.keys(memoryAfter.observedBids).length).toBe(observedBefore);
    expect(memoryAfter.lastSeenLotId).toBe(memoryBefore.lastSeenLotId);
  });

  it('2. Maintains isolation between different bots in the same auction', () => {
    const auctionId = AUCTION_ID_ISO;
    const bot1 = makeBot({ id: 'bot-1', purse: 5000, players_bought: 10 });
    const bot2 = makeBot({ id: 'bot-2', purse: 1000, players_bought: 20 });

    syncBotMemoryWithState(auctionId, bot1.id, 'lot-1', []);
    syncBotMemoryWithState(auctionId, bot2.id, 'lot-1', []);

    const state1 = updateBotBrainState(makeInput({ auctionId, teamId: bot1.id, bot: bot1 }));
    const state2 = updateBotBrainState(makeInput({ auctionId, teamId: bot2.id, bot: bot2 }));

    expect(state1.plan.budgetAllocation.totalRemaining).toBe(5000);
    expect(state2.plan.budgetAllocation.totalRemaining).toBe(1000);
    expect(state1.plan.strategicFocus).not.toBe(state2.plan.strategicFocus); // Likely different due to spentRatio/urgency
  });

  it('3. REGRESSION: evaluateBotsForLot behaves EXACTLY the same with or without Brain update', () => {
    const auctionId = AUCTION_ID_REGRESS;
    const bot = makeBot({ id: 'bot-1', purse: 8000, players_bought: 5 });
    const allTeams = [bot];
    const player = makePlayer({ base_price: 200, category: 'A', role: 'BATSMAN' });

    // Scenario A: Without BotBrain update (Phase 0/1A/1B behaviour)
    clearAuctionMemory(auctionId);
    syncBotMemoryWithState(auctionId, bot.id, 'lot-1', []);

    const validBidsWithoutBrain = evaluateBotsForLot(
      allTeams,
      player,
      200, // currentBid
      200, // basePrice
      'some-other-team',
      'Normal',
      allTeams,
      { 'bot-1': [] },
      DEFAULT_CONTEXT,
      null
    );

    // Scenario B: With BotBrain update (Phase 1D behaviour)
    clearAuctionMemory(auctionId);
    syncBotMemoryWithState(auctionId, bot.id, 'lot-1', []);

    // This is the new integration point!
    const state = updateBotBrainState(makeInput({
      auctionId,
      teamId: bot.id,
      bot,
      currentBid: 200,
      basePrice: 200,
      playerRole: player.role,
      playerIsOverseas: player.is_overseas,
      allTeams,
      teamRosters: { 'bot-1': [] },
      ctx: DEFAULT_CONTEXT
    }));

    const validBidsWithBrain = evaluateBotsForLot(
      allTeams,
      player,
      200, // currentBid
      200, // basePrice
      'some-other-team',
      'Normal',
      allTeams,
      { 'bot-1': [] },
      DEFAULT_CONTEXT,
      null
    );

    // Verify brain calculated something reasonable
    expect(state.beliefs.roleScarcityPanic).toBe(1.0); // 0 batsmen, CRITICAL need

    // The ultimate regression check: evaluateBotsForLot must yield identical results (ignoring delayMs which uses Math.random)
    expect(validBidsWithBrain.length).toBe(validBidsWithoutBrain.length);
    if (validBidsWithBrain.length > 0) {
      expect(validBidsWithBrain[0]!.teamId).toBe(validBidsWithoutBrain[0]!.teamId);
      expect(validBidsWithBrain[0]!.nextBidAmount).toBe(validBidsWithoutBrain[0]!.nextBidAmount);
    }

    // We expect it to bid since it's a good player, it has money, and it needs a batsman
    expect(validBidsWithBrain.length).toBeGreaterThan(0);
    expect(validBidsWithBrain[0]!.teamId).toBe('bot-1');
  });
});

// ============================================================
// PHASE 1D CORRECTION: BOT BRAIN STATE CACHE TESTS
// ============================================================
describe('Phase 1D: BotBrainState Cache', () => {
  const AUCTION_A = 'cache-auction-a';
  const AUCTION_B = 'cache-auction-b';

  beforeEach(() => {
    clearBrainStateCache();
    clearAuctionMemory(AUCTION_A);
    clearAuctionMemory(AUCTION_B);
  });

  it('4. updateBotBrainState caches the latest snapshot retrievable via getBotBrainState', () => {
    const bot = makeBot({ id: 'bot-c1' });
    syncBotMemoryWithState(AUCTION_A, bot.id, 'lot-1', []);
    const returned = updateBotBrainState(makeInput({ auctionId: AUCTION_A, teamId: bot.id, bot }));

    const cached = getBotBrainState(AUCTION_A, bot.id);
    expect(cached).toBeDefined();
    expect(cached).toBe(returned); // Same frozen reference
    expect(cached!.beliefs.marketInflation).toBe(returned.beliefs.marketInflation);
    expect(cached!.plan.strategicFocus).toBe(returned.plan.strategicFocus);
  });

  it('5. Cache uses REPLACEMENT semantics â€” second update replaces first', () => {
    const bot = makeBot({ id: 'bot-c2' });
    syncBotMemoryWithState(AUCTION_A, bot.id, 'lot-1', []);

    const state1 = updateBotBrainState(makeInput({
      auctionId: AUCTION_A, teamId: bot.id, bot, currentBid: 100, basePrice: 100,
    }));

    const state2 = updateBotBrainState(makeInput({
      auctionId: AUCTION_A, teamId: bot.id, bot, currentBid: 500, basePrice: 100,
    }));

    const cached = getBotBrainState(AUCTION_A, bot.id);
    expect(cached).toBe(state2); // Points to second, not first
    expect(cached).not.toBe(state1);
    expect(cached!.beliefs.marketInflation).toBeGreaterThan(state1.beliefs.marketInflation);
  });

  it('6. getBotBrainState returns undefined for uncalculated bot', () => {
    expect(getBotBrainState(AUCTION_A, 'nonexistent')).toBeUndefined();
  });

  it('7. Cached state is deeply frozen â€” callers cannot mutate beliefs or plan', () => {
    const bot = makeBot({ id: 'bot-c3' });
    syncBotMemoryWithState(AUCTION_A, bot.id, 'lot-1', []);
    updateBotBrainState(makeInput({ auctionId: AUCTION_A, teamId: bot.id, bot }));

    const cached = getBotBrainState(AUCTION_A, bot.id)!;

    // Outer object frozen
    expect(Object.isFrozen(cached)).toBe(true);
    // Nested strategic objects frozen
    expect(Object.isFrozen(cached.beliefs)).toBe(true);
    expect(Object.isFrozen(cached.plan)).toBe(true);
    expect(Object.isFrozen(cached.plan.budgetAllocation)).toBe(true);

    // BotMemory must NOT be frozen (owned by Phase 1B)
    expect(Object.isFrozen(cached.memory)).toBe(false);

    // Verify mutation is rejected in strict mode
    expect(() => { (cached.beliefs as any).marketInflation = 999; }).toThrow();
    expect(() => { (cached.plan as any).urgency = 999; }).toThrow();
    expect(() => { (cached.plan.budgetAllocation as any).totalRemaining = 999; }).toThrow();
  });

  it('8. clearInactiveBrainStateCache removes only inactive auctions', () => {
    const botA = makeBot({ id: 'bot-a' });
    const botB = makeBot({ id: 'bot-b' });
    syncBotMemoryWithState(AUCTION_A, botA.id, 'lot-1', []);
    syncBotMemoryWithState(AUCTION_B, botB.id, 'lot-1', []);
    updateBotBrainState(makeInput({ auctionId: AUCTION_A, teamId: botA.id, bot: botA }));
    updateBotBrainState(makeInput({ auctionId: AUCTION_B, teamId: botB.id, bot: botB }));

    // Only AUCTION_A remains active
    clearInactiveBrainStateCache(new Set([AUCTION_A]));

    expect(getBotBrainState(AUCTION_A, botA.id)).toBeDefined();
    expect(getBotBrainState(AUCTION_B, botB.id)).toBeUndefined(); // Cleaned up
  });

  it('9. Different bots in same auction have separate cached states', () => {
    const bot1 = makeBot({ id: 'bot-iso-1', purse: 9000 });
    const bot2 = makeBot({ id: 'bot-iso-2', purse: 2000 });
    syncBotMemoryWithState(AUCTION_A, bot1.id, 'lot-1', []);
    syncBotMemoryWithState(AUCTION_A, bot2.id, 'lot-1', []);
    updateBotBrainState(makeInput({ auctionId: AUCTION_A, teamId: bot1.id, bot: bot1 }));
    updateBotBrainState(makeInput({ auctionId: AUCTION_A, teamId: bot2.id, bot: bot2 }));

    const s1 = getBotBrainState(AUCTION_A, bot1.id);
    const s2 = getBotBrainState(AUCTION_A, bot2.id);
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect(s1!.plan.budgetAllocation.totalRemaining).toBe(9000);
    expect(s2!.plan.budgetAllocation.totalRemaining).toBe(2000);
  });

  it('10. clearBrainStateCache clears everything', () => {
    const bot = makeBot({ id: 'bot-clear' });
    syncBotMemoryWithState(AUCTION_A, bot.id, 'lot-1', []);
    updateBotBrainState(makeInput({ auctionId: AUCTION_A, teamId: bot.id, bot }));
    expect(getBotBrainState(AUCTION_A, bot.id)).toBeDefined();

    clearBrainStateCache();
    expect(getBotBrainState(AUCTION_A, bot.id)).toBeUndefined();
  });
});
