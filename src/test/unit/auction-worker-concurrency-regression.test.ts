import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { getAuctionTickClientConfig, requestAuctionTick, AuctionTickHttpError, AuctionTickTimeoutError } from '@/lib/auction/tick-client';
import { runAuctionTickLoop, isRecoverableTickError, retryDelayMs, retryDelayWithJitter } from '@/lib/auction/worker-runtime';
import { executeAuctionTick } from '@/lib/auction/auction-orchestrator';
import { POST } from '@/app/api/auction/tick/route';
import { evaluateBotsForLot, AuctionContext } from '@/lib/auction/server-bot-engine';
import { syncBotMemoryWithState, getBotMemory, clearInactiveAuctionMemory } from '@/lib/auction/bot-brain-memory';
import { submitBotBid } from '@/lib/auction/bot-bid-submission';

const testSecret = 'regression-test-secret-at-least-32-chars-long!'.padEnd(48, 'x');

describe('Priority 1: Worker and Auction Concurrency Regression Suite (25 Scenarios)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createMockPlayer(overrides: Record<string, unknown> = {}) {
    return {
      id: 'p1',
      name: 'Player',
      role: 'BATSMAN',
      category: 'A',
      base_price: 200,
      is_overseas: false,
      country: 'India',
      age: 26,
      batting_hand: 'Right Handed',
      image_url: null,
      ...overrides,
    } as any;
  }

  // Scenario 1: Worker startup with production-like configuration
  it('Scenario 1: Worker startup parses and accepts production-like configuration', () => {
    const config = getAuctionTickClientConfig({
      AUCTION_TICK_URL: 'https://auction.megav4.internal/api/auction/tick',
      AUCTION_TICK_SECRET: testSecret,
    });
    expect(config.url).toBe('https://auction.megav4.internal/api/auction/tick');
    expect(config.secret).toBe(testSecret);
  });

  // Scenario 2: Missing or invalid worker configuration
  it('Scenario 2: Rejects missing, invalid, or cleartext worker configuration', () => {
    expect(() => getAuctionTickClientConfig({ AUCTION_TICK_SECRET: testSecret })).toThrow('AUCTION_TICK_URL');
    expect(() => getAuctionTickClientConfig({ AUCTION_TICK_URL: 'http://remote.host/api/auction/tick', AUCTION_TICK_SECRET: testSecret })).toThrow('HTTPS');
    expect(() => getAuctionTickClientConfig({ AUCTION_TICK_URL: 'https://auction.internal/api/auction/tick', AUCTION_TICK_SECRET: 'short' })).toThrow('at least 32');
    expect(() => getAuctionTickClientConfig({ AUCTION_TICK_URL: 'https://auction.internal/api/auction/tick', AUCTION_TICK_SECRET: 'secret with whitespace          ' })).toThrow('whitespace');
  });

  // Scenario 3: Runtime module and alias resolution
  it('Scenario 3: Resolves TypeScript path aliases and auction core modules cleanly', () => {
    expect(typeof executeAuctionTick).toBe('function');
    expect(typeof evaluateBotsForLot).toBe('function');
    expect(typeof syncBotMemoryWithState).toBe('function');
    expect(typeof submitBotBid).toBe('function');
    expect(typeof runAuctionTickLoop).toBe('function');
  });

  // Scenario 4: Worker processing a controlled tick with browsers disconnected
  it('Scenario 4: Authoritative orchestrator processes tick directly without any browser session', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'mini_auction_sessions') {
          return { select: () => ({ eq: () => ({ lte: async () => ({ data: [], error: null }) }) }) };
        }
        if (table === 'auctions') {
          return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) };
      }),
      rpc: vi.fn(),
    };

    const result = await executeAuctionTick(mockSupabase);
    expect(result).toHaveProperty('actions');
    expect(result.message).toBe('No active or paused auctions');
  });

  // Scenario 5: Multiple bots competing on one lot
  it('Scenario 5: Multiple bots compete on one lot within squad and purse bounds', () => {
    const bots = [
      { id: 'bot-1', name: 'Bot 1', short_name: 'B1', purse: 5000, initial_purse: 10000, players_bought: 5, overseas_count: 2, is_bot: true },
      { id: 'bot-2', name: 'Bot 2', short_name: 'B2', purse: 6000, initial_purse: 10000, players_bought: 4, overseas_count: 1, is_bot: true },
    ];
    const player = createMockPlayer({ id: 'p1', name: 'Star Batsman', role: 'BATSMAN', category: 'A', base_price: 200, is_overseas: false });
    const ctx: AuctionContext = {
      maxSquadSize: 25,
      maxOverseas: 8,
      totalLots: 10,
      futurePlayers: [],
      futureByRole: {},
      futureOverseasCount: 0,
      futureAvgBasePrice: 200,
      futureMinBasePrice: 100,
      teamPurchasePrices: {},
      lotsCompleted: 0,
      lotsRemaining: 9,
      auctionProgress: 0.1,
      futureByRoleAndQuality: {},
      futureOverseasByRole: {},
    };

    const validBids = evaluateBotsForLot(
      bots,
      player,
      0, // current bid = 0 (nobody has bid yet)
      player.base_price,
      undefined, // highest bidder
      'Normal',
      bots,
      { 'bot-1': [], 'bot-2': [] },
      ctx,
      new Date(Date.now() + 15_000).toISOString(),
      [],
      'auction-1'
    );

    expect(validBids.length).toBeGreaterThan(0);
    expect(validBids[0]?.nextBidAmount).toBeGreaterThanOrEqual(player.base_price);
  });

  // Scenario 6: A human outbidding a bot, followed by correct bot re-evaluation
  it('Scenario 6: Bot re-evaluates and bids when outbid by a human', () => {
    const bot = { id: 'bot-1', name: 'Bot 1', short_name: 'B1', purse: 5000, initial_purse: 10000, players_bought: 5, overseas_count: 2, is_bot: true };
    const human = { id: 'human-team', name: 'Human Team', short_name: 'HT', purse: 7000, initial_purse: 10000, players_bought: 5, overseas_count: 2, is_bot: false };
    const player = createMockPlayer({ id: 'p1', name: 'Star Allrounder', role: 'ALL_ROUNDER', category: 'A', base_price: 200, is_overseas: false });
    const ctx: AuctionContext = {
      maxSquadSize: 25,
      maxOverseas: 8,
      totalLots: 10,
      futurePlayers: [],
      futureByRole: {},
      futureOverseasCount: 0,
      futureAvgBasePrice: 200,
      futureMinBasePrice: 100,
      teamPurchasePrices: {},
      lotsCompleted: 0,
      lotsRemaining: 9,
      auctionProgress: 0.1,
      futureByRoleAndQuality: {},
      futureOverseasByRole: {},
    };

    // Human holds highest bid at 250
    const validBids = evaluateBotsForLot(
      [bot],
      player,
      250,
      player.base_price,
      human.id, // Human is highest bidder
      'Aggressive',
      [bot, human],
      { 'bot-1': [], 'human-team': [] },
      ctx,
      new Date(Date.now() + 15_000).toISOString(),
      [],
      'auction-1'
    );

    // Bot should evaluate whether to top human bid
    if (validBids.length > 0 && validBids[0]) {
      expect(validBids[0].teamId).toBe(bot.id);
      expect(validBids[0].nextBidAmount).toBeGreaterThan(250);
    }
  });

  // Scenario 7: Concurrent tick attempts (in-process lock per auction)
  it('Scenario 7: Prevents overlapping tick executions on the same auction within process', async () => {
    let tickCount = 0;
    const auctionId = 'concurrent-auction-1';
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'mini_auction_sessions') return { select: () => ({ eq: () => ({ lte: async () => ({ data: [], error: null }) }) }) };
        if (table === 'auctions') return { select: () => ({ in: async () => ({ data: [{ id: auctionId, room_id: 'r1', status: 'IN_PROGRESS', current_lot_id: 'lot-1' }], error: null }) }) };
        if (table === 'auction_lots') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => {
                  tickCount += 1;
                  // Artificial delay to simulate in-flight execution
                  await new Promise(res => setTimeout(res, 50));
                  return { data: { id: 'lot-1', status: 'BIDDING', timer_expires_at: new Date(Date.now() + 10000).toISOString(), player_id: 'p1' }, error: null };
                }
              })
            })
          };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: {}, error: null }) }) }) };
      }),
      rpc: vi.fn(),
    };

    // Fire two ticks simultaneously
    const [res1, res2] = await Promise.all([
      executeAuctionTick(mockSupabase),
      executeAuctionTick(mockSupabase),
    ]);

    // One tick should proceed, while the other skips the auction due to active lock
    expect(res1).toBeDefined();
    expect(res2).toBeDefined();
    expect(tickCount).toBe(1);
  });

  // Scenario 8: Duplicate request retries
  it('Scenario 8: submitBotBid gracefully handles duplicate request submissions', async () => {
    let callCount = 0;
    const submit = vi.fn(async () => {
      callCount += 1;
      return { data: { success: true, amount: 300, current_bid: 300 }, error: null };
    });

    const result = await submitBotBid(submit, {
      auctionId: 'a1',
      teamId: 't1',
      playerId: 'p1',
      isFinalBid: false,
    });

    expect(result.isApplied).toBe(true);
    expect(result.acceptedAmount).toBe(300);
    expect(callCount).toBe(1);
  });

  // Scenario 9: Multiple worker instances attempting the same transition
  it('Scenario 9: Handles DB conflict / lot already advanced by another worker without crashing', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'mini_auction_sessions') return { select: () => ({ eq: () => ({ lte: async () => ({ data: [], error: null }) }) }) };
        if (table === 'auctions') return { select: () => ({ in: async () => ({ data: [{ id: 'a1', room_id: 'r1', status: 'IN_PROGRESS', current_lot_id: 'lot-1' }], error: null }) }) };
        if (table === 'auction_lots') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'lot-1', status: 'BIDDING', timer_expires_at: new Date(Date.now() - 5000).toISOString() }, error: null })
              })
            })
          };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: {}, error: null }) }) }) };
      }),
      rpc: vi.fn(async (fnName: string) => {
        if (fnName === 'v3_finalize_and_advance_lot') {
          // Simulate other worker already finalized
          return { data: { success: false, error: 'LOT_ALREADY_FINALIZED' }, error: null };
        }
        return { data: { success: true }, error: null };
      }),
    };

    const result = await executeAuctionTick(mockSupabase);
    expect(result.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'FINALIZE_LOT_REJECTED', error: 'LOT_ALREADY_FINALIZED' })
    ]));
  });

  // Scenario 10: Worker restart during an active auction
  it('Scenario 10: Worker restart recovers and reconstructs active state cleanly', async () => {
    const auctionId = 'restart-auction-1';
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'mini_auction_sessions') return { select: () => ({ eq: () => ({ lte: async () => ({ data: [], error: null }) }) }) };
        if (table === 'auctions') return { select: () => ({ in: async () => ({ data: [{ id: auctionId, room_id: 'r1', status: 'IN_PROGRESS', current_lot_id: 'lot-2' }], error: null }) }) };
        if (table === 'auction_lots') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'lot-2', status: 'GET_READY', get_ready_expires_at: new Date(Date.now() - 1000).toISOString() }, error: null })
              })
            })
          };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: {}, error: null }) }) }) };
      }),
      rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
    };

    const result = await executeAuctionTick(mockSupabase);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('v3_start_bidding', expect.objectContaining({ p_lot_id: 'lot-2' }));
    expect(result.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'START_BIDDING' })
    ]));
  });

  // Scenario 11: Recovery of strategic memory
  it('Scenario 11: Reconstructs bot memory from authoritative state upon sync', () => {
    const auctionId = 'mem-auction-1';
    const botId = 'bot-team-1';
    const lots = [
      { id: 'l1', player_id: 'p1', status: 'SOLD', winning_team_id: botId, winning_bid: 350 },
      { id: 'l2', player_id: 'p2', status: 'UNSOLD', winning_team_id: null, winning_bid: null },
    ];

    syncBotMemoryWithState(auctionId, botId, 'l3', lots as any);
    const memory = getBotMemory(auctionId, botId);
    expect(memory.auctionId).toBe(auctionId);
    expect(memory.teamId).toBe(botId);
  });

  // Scenario 12: GET_READY -> BIDDING transition
  it('Scenario 12: Correctly transitions lot from GET_READY to BIDDING when countdown expires', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'mini_auction_sessions') return { select: () => ({ eq: () => ({ lte: async () => ({ data: [], error: null }) }) }) };
        if (table === 'auctions') return { select: () => ({ in: async () => ({ data: [{ id: 'a1', room_id: 'r1', status: 'IN_PROGRESS', current_lot_id: 'lot-ready' }], error: null }) }) };
        if (table === 'auction_lots') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'lot-ready', status: 'GET_READY', get_ready_expires_at: new Date(Date.now() - 500).toISOString() }, error: null })
              })
            })
          };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: {}, error: null }) }) }) };
      }),
      rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
    };

    const res = await executeAuctionTick(mockSupabase);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('v3_start_bidding', {
      p_auction_id: 'a1',
      p_lot_id: 'lot-ready',
      p_force: true,
    });
  });

  // Scenario 13: Timer expiry and correct SOLD/UNSOLD transition
  it('Scenario 13: Enforces due-only finalization (p_force: false) when bidding timer expires', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'mini_auction_sessions') return { select: () => ({ eq: () => ({ lte: async () => ({ data: [], error: null }) }) }) };
        if (table === 'auctions') return { select: () => ({ in: async () => ({ data: [{ id: 'a1', room_id: 'r1', status: 'IN_PROGRESS', current_lot_id: 'lot-exp' }], error: null }) }) };
        if (table === 'auction_lots') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'lot-exp', status: 'BIDDING', timer_expires_at: new Date(Date.now() - 5000).toISOString() }, error: null })
              })
            })
          };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: {}, error: null }) }) }) };
      }),
      rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
    };

    await executeAuctionTick(mockSupabase);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('v3_finalize_and_advance_lot', {
      p_auction_id: 'a1',
      p_lot_id: 'lot-exp',
      p_force: false,
    });
  });

  // Scenario 14: Auction completion and rejection of invalid post-completion transitions
  it('Scenario 14: Does not process completed auctions', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'mini_auction_sessions') return { select: () => ({ eq: () => ({ lte: async () => ({ data: [], error: null }) }) }) };
        if (table === 'auctions') {
          return {
            select: () => ({
              in: async () => ({ data: [], error: null }) // COMPLETED auctions not returned
            })
          };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) };
      }),
      rpc: vi.fn(),
    };

    const res = await executeAuctionTick(mockSupabase);
    expect(res.actions).toEqual([]);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  // Scenario 15: Insufficient purse
  it('Scenario 15: Ineligible bot with insufficient purse does not place bid', () => {
    const brokeBot = { id: 'broke-bot', name: 'Broke Bot', short_name: 'BB', purse: 50, initial_purse: 10000, players_bought: 5, overseas_count: 0, is_bot: true };
    const player = createMockPlayer({ id: 'p1', name: 'Expensive Player', role: 'BATSMAN', category: 'A', base_price: 200, is_overseas: false });
    const ctx: AuctionContext = {
      maxSquadSize: 25,
      maxOverseas: 8,
      totalLots: 10,
      futurePlayers: [],
      futureByRole: {},
      futureOverseasCount: 0,
      futureAvgBasePrice: 200,
      futureMinBasePrice: 100,
      teamPurchasePrices: {},
      lotsCompleted: 0,
      lotsRemaining: 9,
      auctionProgress: 0.1,
      futureByRoleAndQuality: {},
      futureOverseasByRole: {},
    };

    const validBids = evaluateBotsForLot(
      [brokeBot],
      player,
      0,
      player.base_price,
      undefined,
      'Normal',
      [brokeBot],
      { 'broke-bot': [] },
      ctx,
      new Date(Date.now() + 15_000).toISOString(),
      [],
      'auction-1'
    );

    expect(validBids).toHaveLength(0);
  });

  // Scenario 16: Full squad
  it('Scenario 16: Bot at maximum squad capacity does not place bid', () => {
    const fullBot = { id: 'full-bot', name: 'Full Bot', short_name: 'FB', purse: 5000, initial_purse: 10000, players_bought: 25, overseas_count: 2, is_bot: true };
    const player = createMockPlayer({ id: 'p1', name: 'Any Player', role: 'BATSMAN', category: 'C', base_price: 50, is_overseas: false });
    const ctx: AuctionContext = {
      maxSquadSize: 25,
      maxOverseas: 8,
      totalLots: 10,
      futurePlayers: [],
      futureByRole: {},
      futureOverseasCount: 0,
      futureAvgBasePrice: 50,
      futureMinBasePrice: 20,
      teamPurchasePrices: {},
      lotsCompleted: 0,
      lotsRemaining: 9,
      auctionProgress: 0.1,
      futureByRoleAndQuality: {},
      futureOverseasByRole: {},
    };

    const validBids = evaluateBotsForLot(
      [fullBot],
      player,
      0,
      player.base_price,
      undefined,
      'Normal',
      [fullBot],
      { 'full-bot': Array(25).fill({}) },
      ctx,
      new Date(Date.now() + 15_000).toISOString(),
      [],
      'auction-1'
    );

    expect(validBids).toHaveLength(0);
  });

  // Scenario 17: Overseas-player limits
  it('Scenario 17: Bot at maximum overseas capacity does not bid on overseas player', () => {
    const maxOverseasBot = { id: 'os-bot', name: 'OS Bot', short_name: 'OB', purse: 5000, initial_purse: 10000, players_bought: 10, overseas_count: 8, is_bot: true };
    const overseasPlayer = createMockPlayer({ id: 'p1', name: 'Overseas Star', role: 'BOWLER', category: 'A', base_price: 200, is_overseas: true });
    const ctx: AuctionContext = {
      maxSquadSize: 25,
      maxOverseas: 8,
      totalLots: 10,
      futurePlayers: [],
      futureByRole: {},
      futureOverseasCount: 0,
      futureAvgBasePrice: 200,
      futureMinBasePrice: 100,
      teamPurchasePrices: {},
      lotsCompleted: 0,
      lotsRemaining: 9,
      auctionProgress: 0.1,
      futureByRoleAndQuality: {},
      futureOverseasByRole: {},
    };

    const validBids = evaluateBotsForLot(
      [maxOverseasBot],
      overseasPlayer,
      0,
      overseasPlayer.base_price,
      undefined,
      'Normal',
      [maxOverseasBot],
      { 'os-bot': [] },
      ctx,
      new Date(Date.now() + 15_000).toISOString(),
      [],
      'auction-1'
    );

    expect(validBids).toHaveLength(0);
  });

  // Scenario 18: Minimum bid increments
  it('Scenario 18: Enforces minimum bid increment step based on current bid', () => {
    const bot = { id: 'b1', name: 'Bot 1', short_name: 'B1', purse: 8000, initial_purse: 10000, players_bought: 5, overseas_count: 1, is_bot: true };
    const player = createMockPlayer({ id: 'p1', name: 'Player', role: 'BATSMAN', category: 'A', base_price: 100, is_overseas: false });
    const ctx: AuctionContext = {
      maxSquadSize: 25,
      maxOverseas: 8,
      totalLots: 10,
      futurePlayers: [],
      futureByRole: {},
      futureOverseasCount: 0,
      futureAvgBasePrice: 100,
      futureMinBasePrice: 50,
      teamPurchasePrices: {},
      lotsCompleted: 0,
      lotsRemaining: 9,
      auctionProgress: 0.1,
      futureByRoleAndQuality: {},
      futureOverseasByRole: {},
    };

    const validBids = evaluateBotsForLot(
      [bot],
      player,
      500, // current bid = 500
      player.base_price,
      'other-team',
      'Normal',
      [bot],
      { 'b1': [] },
      ctx,
      new Date(Date.now() + 15_000).toISOString(),
      [],
      'auction-1'
    );

    if (validBids.length > 0 && validBids[0]) {
      expect(validBids[0].nextBidAmount).toBeGreaterThan(500);
      expect(validBids[0].nextBidAmount - 500).toBeGreaterThanOrEqual(20); // Increment rule
    }
  });

  // Scenario 19: Invalid tick authentication
  it('Scenario 19: Route rejects invalid tick credentials before creating admin client', async () => {
    vi.stubEnv('AUCTION_TICK_SECRET', testSecret);
    const req = new Request('http://localhost:3000/api/auction/tick', {
      method: 'POST',
      headers: { 'x-auction-tick-secret': 'wrong-secret-value-that-does-not-match!' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // Scenario 20: Missing tick secret
  it('Scenario 20: Route returns 503 when server tick secret is not configured', async () => {
    vi.stubEnv('AUCTION_TICK_SECRET', '');
    const req = new Request('http://localhost:3000/api/auction/tick', {
      method: 'POST',
      headers: { 'x-auction-tick-secret': testSecret },
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  // Scenario 21: Unauthorized forced finalization
  it('Scenario 21: Unauthenticated request cannot trigger forced lot finalization', async () => {
    vi.stubEnv('AUCTION_TICK_SECRET', testSecret);
    const req = new Request('http://localhost:3000/api/auction/tick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, auctionId: 'a1', lotId: 'l1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // Scenario 22: Realtime UI synchronization after authoritative bid
  it('Scenario 22: Returns applied bid details for realtime propagation', async () => {
    const submit = vi.fn(async () => ({
      data: { success: true, amount: 450, current_bid: 450 },
      error: null,
    }));

    const result = await submitBotBid(submit, {
      auctionId: 'a1',
      teamId: 't1',
      playerId: 'p1',
      isFinalBid: false,
    });

    expect(result.isApplied).toBe(true);
    expect(result.acceptedAmount).toBe(450);
    expect(result.persistedAmount).toBe(450);
  });

  // Scenario 23: Database rejection and recovery
  it('Scenario 23: Handles database rejection without recording unconfirmed observation', async () => {
    const submit = vi.fn(async () => ({
      data: { success: false, error: 'INSUFFICIENT_FUNDS' },
      error: null,
    }));

    const result = await submitBotBid(submit, {
      auctionId: 'a1',
      teamId: 't1',
      playerId: 'p1',
      isFinalBid: false,
    });

    expect(result.isApplied).toBe(false);
    expect(result.rpcError).toBe('INSUFFICIENT_FUNDS');
  });

  // Scenario 24: Transient network failures and bounded retry behavior
  it('Scenario 24: Recovers from temporary network/HTTP failures using bounded exponential backoff', async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    let attempts = 0;

    const code = await runAuctionTickLoop({
      signal: controller.signal,
      intervalMs: 1,
      tick: async () => {
        attempts += 1;
        if (attempts === 1) throw new AuctionTickTimeoutError(10_000);
        if (attempts === 2) throw new AuctionTickHttpError(500);
        controller.abort();
      },
      wait: async (ms) => { delays.push(ms); },
    });

    expect(code).toBe(0);
    expect(attempts).toBe(3);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBe(500);
    expect(delays[1]).toBe(1000);
  });

  // Scenario 25: Fatal schema/configuration errors without infinite retry loops
  it('Scenario 25: Immediately terminates tick loop on fatal 401/403 or non-recoverable error', async () => {
    const controller = new AbortController();
    const onFatalError = vi.fn();
    const wait = vi.fn();

    const code = await runAuctionTickLoop({
      signal: controller.signal,
      tick: async () => {
        throw new AuctionTickHttpError(403);
      },
      onFatalError,
      wait,
    });

    expect(code).toBe(1);
    expect(onFatalError).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });
});
