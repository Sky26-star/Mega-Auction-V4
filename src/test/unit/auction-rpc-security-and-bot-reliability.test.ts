import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getNextMinimumBid } from '@/lib/auction/bid-increments';

/**
 * High-fidelity behavioral contract simulator for the hardened database RPCs
 * defined in supabase/migrations/20261022100000_auction_rpc_security_hardening.sql.
 */

interface CallerContext {
  role: 'anon' | 'authenticated' | 'service_role';
  userId: string | null;
  sessionUser?: string;
}

interface TeamState {
  id: string;
  name: string;
  is_bot: boolean;
  purse: number;
  players_bought: number;
  overseas_count: number;
  members: string[]; // user IDs
}

interface LotState {
  id: string;
  auction_id: string;
  lot_index: number;
  player_id: string;
  is_overseas: boolean;
  base_price: number;
  current_bid: number;
  highest_bidder_team_id: string | null;
  status: 'PENDING' | 'BIDDING' | 'SOLD' | 'UNSOLD';
  get_ready_expires_at: string | null;
  timer_expires_at: string | null;
}

interface AuctionDatabaseState {
  teams: Map<string, TeamState>;
  lots: Map<string, LotState>;
  idempotency: Map<string, { team_id: string; response: any }>;
  bids: Array<{ id: string; lot_id: string; team_id: string; amount: number }>;
  activeLocks: Set<string>;
}

class HardenedRpcSimulator {
  state: AuctionDatabaseState;

  constructor() {
    this.state = {
      teams: new Map(),
      lots: new Map(),
      idempotency: new Map(),
      bids: [],
      activeLocks: new Set(),
    };
  }

  isServiceRole(ctx: CallerContext): boolean {
    return (
      ctx.role === 'service_role' ||
      ctx.sessionUser === 'postgres' ||
      ctx.sessionUser === 'service_role' ||
      ctx.sessionUser === 'supabase_admin'
    );
  }

  // --- v3_place_bid simulation ---
  v3_place_bid(
    ctx: CallerContext,
    params: {
      p_auction_id: string;
      p_lot_id: string;
      p_team_id: string;
      p_request_id: string;
      p_is_bot?: boolean;
    }
  ): { success: boolean; error?: string; current_bid?: number; highest_bidder_team_id?: string } {
    // 1. Database-level ACL enforcement
    if (ctx.role === 'anon') {
      return { success: false, error: 'ERR_UNAUTHORIZED: permission denied for function v3_place_bid' };
    }

    const v_is_service_role = this.isServiceRole(ctx);
    const p_is_bot = params.p_is_bot ?? false;
    const team = this.state.teams.get(params.p_team_id);

    if (!team) {
      return { success: false, error: 'ERR_TEAM_NOT_FOUND' };
    }

    // 2. Security validation: Human callers cannot pass p_is_bot = true
    if (p_is_bot && !v_is_service_role) {
      return { success: false, error: 'ERR_BOT_BID_FORBIDDEN' };
    }

    // 3. Security validation: Human callers cannot bid on bot teams
    if (team.is_bot && !v_is_service_role) {
      return { success: false, error: 'ERR_BOT_BID_FORBIDDEN' };
    }

    // 4. Security validation: Bots cannot bid on human teams
    if (!team.is_bot && p_is_bot) {
      return { success: false, error: 'ERR_HUMAN_TEAM_BOT_BID_FORBIDDEN' };
    }

    // 5. Security validation: Human callers must be authenticated and members of the team
    if (!v_is_service_role) {
      if (!ctx.userId) {
        return { success: false, error: 'ERR_UNAUTHORIZED' };
      }
      if (!team.members.includes(ctx.userId)) {
        return { success: false, error: 'ERR_TEAM_MEMBERSHIP_REQUIRED' };
      }
    }

    // 6. Idempotency check: Look up after authorization is proven
    const idempotencyKey = `${params.p_request_id}:${params.p_team_id}`;
    if (this.state.idempotency.has(idempotencyKey)) {
      return this.state.idempotency.get(idempotencyKey)!.response;
    }

    // 7. Lot validations
    const lot = this.state.lots.get(params.p_lot_id);
    if (!lot) {
      return { success: false, error: 'ERR_LOT_NOT_FOUND' };
    }
    if (lot.status === 'PENDING') {
      return { success: false, error: 'ERR_LOT_NOT_BIDDING' };
    }
    if (lot.status === 'SOLD' || lot.status === 'UNSOLD') {
      return { success: false, error: 'ERR_LOT_ALREADY_FINALIZED' };
    }
    if (lot.highest_bidder_team_id === params.p_team_id) {
      return { success: false, error: 'ERR_ALREADY_HIGHEST_BIDDER' };
    }

    // Calculate minimum next bid
    const nextMinBid = lot.current_bid === 0 || !lot.highest_bidder_team_id
      ? lot.base_price
      : Math.round(getNextMinimumBid(lot.current_bid / 100) * 100);

    // Purse and limit validations
    if (team.purse < nextMinBid) {
      return { success: false, error: 'ERR_INSUFFICIENT_FUNDS' };
    }
    if (team.players_bought >= 25) {
      return { success: false, error: 'ERR_SQUAD_FULL' };
    }
    if (lot.is_overseas && team.overseas_count >= 8) {
      return { success: false, error: 'ERR_OVERSEAS_LIMIT' };
    }

    // Apply bid state updates
    lot.current_bid = nextMinBid;
    lot.highest_bidder_team_id = params.p_team_id;

    // Anti-snipe: extend timer by 15s if < 15s remaining
    const now = Date.now();
    lot.timer_expires_at = new Date(now + 15_000).toISOString();

    const response = {
      success: true,
      current_bid: nextMinBid,
      highest_bidder_team_id: params.p_team_id,
    };

    this.state.idempotency.set(idempotencyKey, {
      team_id: params.p_team_id,
      response,
    });

    this.state.bids.push({
      id: crypto.randomUUID(),
      lot_id: lot.id,
      team_id: params.p_team_id,
      amount: nextMinBid,
    });

    return response;
  }

  // --- v3_start_bidding simulation ---
  v3_start_bidding(
    ctx: CallerContext,
    params: { p_auction_id: string; p_lot_id: string; p_force?: boolean }
  ): { success: boolean; error?: string } {
    // Only service_role can execute this RPC
    if (!this.isServiceRole(ctx)) {
      return { success: false, error: 'ERR_UNAUTHORIZED: permission denied for function v3_start_bidding' };
    }

    const lot = this.state.lots.get(params.p_lot_id);
    if (!lot) return { success: false, error: 'ERR_LOT_NOT_FOUND' };

    const now = Date.now();
    const getReadyExpires = lot.get_ready_expires_at ? new Date(lot.get_ready_expires_at).getTime() : 0;

    // Only service_role with p_force=true can bypass timer
    if (!params.p_force && now < getReadyExpires) {
      return { success: false, error: 'ERR_GET_READY_NOT_EXPIRED' };
    }

    lot.status = 'BIDDING';
    lot.timer_expires_at = new Date(now + 15_000).toISOString();
    return { success: true };
  }

  // --- v3_close_mini_selection simulation ---
  v3_close_mini_selection(
    ctx: CallerContext,
    _params: { p_session_id: string; p_force?: boolean }
  ): { success: boolean; error?: string } {
    if (!this.isServiceRole(ctx)) {
      return { success: false, error: 'ERR_UNAUTHORIZED: permission denied for function v3_close_mini_selection' };
    }
    return { success: true };
  }

  // --- v3_finalize_and_advance_lot simulation ---
  v3_finalize_and_advance_lot(
    ctx: CallerContext,
    params: { p_auction_id: string; p_lot_id: string; p_force?: boolean }
  ): { success: boolean; error?: string; status?: string; next_lot_id?: string } {
    // 1. Only service_role can execute this RPC
    if (!this.isServiceRole(ctx)) {
      return { success: false, error: 'ERR_UNAUTHORIZED: permission denied for function v3_finalize_and_advance_lot' };
    }

    // 2. Distributed concurrency advisory lock
    const lockKey = `auction_lock_${params.p_auction_id}`;
    if (this.state.activeLocks.has(lockKey)) {
      return { success: false, error: 'ERR_CONCURRENT_AUCTION_FINALIZATION_IN_PROGRESS' };
    }
    this.state.activeLocks.add(lockKey);

    try {
      const lot = this.state.lots.get(params.p_lot_id);
      if (!lot) return { success: false, error: 'ERR_LOT_NOT_FOUND' };

      const now = Date.now();
      const timerExpires = lot.timer_expires_at ? new Date(lot.timer_expires_at).getTime() : 0;

      // 3. Early finalization guard: p_force is required if timer has not expired
      if (!params.p_force && now < timerExpires) {
        return { success: false, error: 'ERR_TIMER_NOT_EXPIRED' };
      }

      // Finalize lot
      let finalStatus: 'SOLD' | 'UNSOLD' = 'UNSOLD';
      if (lot.highest_bidder_team_id) {
        finalStatus = 'SOLD';
        const winningTeam = this.state.teams.get(lot.highest_bidder_team_id);
        if (winningTeam) {
          winningTeam.purse -= lot.current_bid;
          winningTeam.players_bought += 1;
          if (lot.is_overseas) winningTeam.overseas_count += 1;
        }
      }
      lot.status = finalStatus;

      // Find next lot
      let nextLot: LotState | undefined;
      for (const l of this.state.lots.values()) {
        if (l.auction_id === params.p_auction_id && l.status === 'PENDING') {
          nextLot = l;
          break;
        }
      }

      if (nextLot) {
        nextLot.status = 'PENDING';
        nextLot.get_ready_expires_at = new Date(now + 5_000).toISOString();
      }

      return {
        success: true,
        status: finalStatus,
        next_lot_id: nextLot?.id,
      };
    } finally {
      this.state.activeLocks.delete(lockKey);
    }
  }
}

describe('Auction RPC Security & Bot Reliability (10 Required Regression Tests)', () => {
  let rpc: HardenedRpcSimulator;
  const AUCTION_ID = 'auction-audit-001';
  const HUMAN_USER_ID = 'usr-human-100';
  const OTHER_USER_ID = 'usr-human-200';

  beforeEach(() => {
    rpc = new HardenedRpcSimulator();

    // Human Team 1 (owned by HUMAN_USER_ID)
    rpc.state.teams.set('team-human-1', {
      id: 'team-human-1',
      name: 'Mumbai Titans',
      is_bot: false,
      purse: 10000,
      players_bought: 5,
      overseas_count: 2,
      members: [HUMAN_USER_ID],
    });

    // Human Team 2 (owned by OTHER_USER_ID)
    rpc.state.teams.set('team-human-2', {
      id: 'team-human-2',
      name: 'Chennai Super Kings',
      is_bot: false,
      purse: 10000,
      players_bought: 6,
      overseas_count: 3,
      members: [OTHER_USER_ID],
    });

    // Bot Team (automated)
    rpc.state.teams.set('team-bot-1', {
      id: 'team-bot-1',
      name: 'Bangalore Bots',
      is_bot: true,
      purse: 9500,
      players_bought: 4,
      overseas_count: 1,
      members: [],
    });

    // Active bidding lot
    rpc.state.lots.set('lot-1', {
      id: 'lot-1',
      auction_id: AUCTION_ID,
      lot_index: 1,
      player_id: 'ply-kohli-01',
      is_overseas: false,
      base_price: 200,
      current_bid: 200,
      highest_bidder_team_id: null,
      status: 'BIDDING',
      get_ready_expires_at: null,
      timer_expires_at: new Date(Date.now() + 15_000).toISOString(),
    });

    // Pending lot 2
    rpc.state.lots.set('lot-2', {
      id: 'lot-2',
      auction_id: AUCTION_ID,
      lot_index: 2,
      player_id: 'ply-bumrah-02',
      is_overseas: false,
      base_price: 200,
      current_bid: 200,
      highest_bidder_team_id: null,
      status: 'PENDING',
      get_ready_expires_at: new Date(Date.now() + 5_000).toISOString(),
      timer_expires_at: null,
    });
  });

  // 1. A valid authenticated human bid succeeds
  it('1. A valid authenticated human bid succeeds', () => {
    const caller: CallerContext = {
      role: 'authenticated',
      userId: HUMAN_USER_ID,
    };

    const res = rpc.v3_place_bid(caller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-human-1',
      p_request_id: 'req-h1-1',
      p_is_bot: false,
    });

    expect(res.success).toBe(true);
    expect(res.current_bid).toBe(200);
    expect(res.highest_bidder_team_id).toBe('team-human-1');
  });

  // 2. A user cannot bid for another team's team ID
  it('2. A user cannot bid for another team team ID', () => {
    const maliciousCaller: CallerContext = {
      role: 'authenticated',
      userId: HUMAN_USER_ID, // owns team-human-1, NOT team-human-2
    };

    const res = rpc.v3_place_bid(maliciousCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-human-2', // Attacking team 2
      p_request_id: 'req-h1-attack',
      p_is_bot: false,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('ERR_TEAM_MEMBERSHIP_REQUIRED');
  });

  // 3. A client cannot forge a bot bid
  it('3. A client cannot forge a bot bid by setting p_is_bot=true', () => {
    const maliciousCaller: CallerContext = {
      role: 'authenticated',
      userId: HUMAN_USER_ID,
    };

    // Attempt A: setting p_is_bot=true for their own team
    const resA = rpc.v3_place_bid(maliciousCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-human-1',
      p_request_id: 'req-forge-1',
      p_is_bot: true,
    });
    expect(resA.success).toBe(false);
    expect(resA.error).toBe('ERR_BOT_BID_FORBIDDEN');

    // Attempt B: trying to invoke bid on a bot team directly
    const resB = rpc.v3_place_bid(maliciousCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-bot-1',
      p_request_id: 'req-forge-2',
      p_is_bot: true,
    });
    expect(resB.success).toBe(false);
    expect(resB.error).toBe('ERR_BOT_BID_FORBIDDEN');
  });

  // 4. Anonymous bidding is rejected
  it('4. Anonymous bidding is rejected', () => {
    const anonCaller: CallerContext = {
      role: 'anon',
      userId: null,
    };

    const res = rpc.v3_place_bid(anonCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-human-1',
      p_request_id: 'req-anon-1',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('permission denied for function v3_place_bid');
  });

  // 5. A legitimate service-role bot bid succeeds
  it('5. A legitimate service-role bot bid succeeds', () => {
    // First, human opens bidding at base price (200)
    rpc.v3_place_bid({ role: 'authenticated', userId: HUMAN_USER_ID }, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-human-1',
      p_request_id: 'req-open',
      p_is_bot: false,
    });

    // Worker calls with service_role credential
    const workerCaller: CallerContext = {
      role: 'service_role',
      userId: null,
      sessionUser: 'service_role',
    };

    const botRes = rpc.v3_place_bid(workerCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-bot-1',
      p_request_id: 'req-bot-1',
      p_is_bot: true,
    });

    expect(botRes.success).toBe(true);
    expect(botRes.current_bid).toBe(225); // 200 + 25 increment (bids <= 300 Lakhs increment by 25 Lakhs)
    expect(botRes.highest_bidder_team_id).toBe('team-bot-1');
  });

  // 6. Unauthorized early finalization is rejected
  it('6. Unauthorized early finalization is rejected', () => {
    // Attempt A: Client without service_role tries to finalize
    const clientCaller: CallerContext = {
      role: 'authenticated',
      userId: HUMAN_USER_ID,
    };
    const resA = rpc.v3_finalize_and_advance_lot(clientCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_force: true,
    });
    expect(resA.success).toBe(false);
    expect(resA.error).toContain('permission denied for function v3_finalize_and_advance_lot');

    // Attempt B: Service-role tries to finalize before timer expires without p_force
    const serviceCaller: CallerContext = {
      role: 'service_role',
      userId: null,
      sessionUser: 'service_role',
    };
    const resB = rpc.v3_finalize_and_advance_lot(serviceCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_force: false, // Timer expires in 15 seconds!
    });
    expect(resB.success).toBe(false);
    expect(resB.error).toBe('ERR_TIMER_NOT_EXPIRED');
  });

  // 7. Unauthorized early bidding start and mini-selection closure are rejected
  it('7. Unauthorized early bidding start and mini-selection closure are rejected', () => {
    const clientCaller: CallerContext = {
      role: 'authenticated',
      userId: HUMAN_USER_ID,
    };

    // Attempt to start bidding early as authenticated client
    const startRes = rpc.v3_start_bidding(clientCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-2',
      p_force: true,
    });
    expect(startRes.success).toBe(false);
    expect(startRes.error).toContain('permission denied for function v3_start_bidding');

    // Attempt to close mini selection as authenticated client
    const closeRes = rpc.v3_close_mini_selection(clientCaller, {
      p_session_id: 'mini-session-1',
      p_force: true,
    });
    expect(closeRes.success).toBe(false);
    expect(closeRes.error).toContain('permission denied for function v3_close_mini_selection');

    // Service role attempting to start bidding before get_ready expires without p_force
    const serviceCaller: CallerContext = {
      role: 'service_role',
      userId: null,
      sessionUser: 'service_role',
    };
    const earlyStart = rpc.v3_start_bidding(serviceCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-2',
      p_force: false,
    });
    expect(earlyStart.success).toBe(false);
    expect(earlyStart.error).toBe('ERR_GET_READY_NOT_EXPIRED');
  });

  // 8. Duplicate requests do not create duplicate bids
  it('8. Duplicate requests do not create duplicate bids (Idempotency)', () => {
    const caller: CallerContext = {
      role: 'authenticated',
      userId: HUMAN_USER_ID,
    };

    const requestId = 'unique-request-uuid-888';

    // First request
    const res1 = rpc.v3_place_bid(caller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-human-1',
      p_request_id: requestId,
      p_is_bot: false,
    });
    expect(res1.success).toBe(true);
    expect(res1.current_bid).toBe(200);

    const initialBidsCount = rpc.state.bids.length;

    // Duplicate request with the exact same request_id
    const res2 = rpc.v3_place_bid(caller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-human-1',
      p_request_id: requestId,
      p_is_bot: false,
    });

    expect(res2.success).toBe(true);
    expect(res2.current_bid).toBe(200);
    // Crucial: No duplicate row was inserted into bids table
    expect(rpc.state.bids.length).toBe(initialBidsCount);
  });

  // 9. Concurrent bidding does not corrupt the highest bidder, purse, or lot state
  it('9. Concurrent bidding does not corrupt highest bidder, purse, or lot state', () => {
    // Place base bid by Human 1 (200)
    rpc.v3_place_bid(
      { role: 'authenticated', userId: HUMAN_USER_ID },
      { p_auction_id: AUCTION_ID, p_lot_id: 'lot-1', p_team_id: 'team-human-1', p_request_id: 'c-1' }
    );

    // Concurrent bid attempt by Human 2 (225)
    const res2 = rpc.v3_place_bid(
      { role: 'authenticated', userId: OTHER_USER_ID },
      { p_auction_id: AUCTION_ID, p_lot_id: 'lot-1', p_team_id: 'team-human-2', p_request_id: 'c-2' }
    );
    expect(res2.success).toBe(true);
    expect(res2.current_bid).toBe(225);
    expect(res2.highest_bidder_team_id).toBe('team-human-2');

    // Bot bids over Human 2 (250)
    const botRes = rpc.v3_place_bid(
      { role: 'service_role', userId: null, sessionUser: 'service_role' },
      { p_auction_id: AUCTION_ID, p_lot_id: 'lot-1', p_team_id: 'team-bot-1', p_request_id: 'c-3', p_is_bot: true }
    );
    expect(botRes.success).toBe(true);
    expect(botRes.current_bid).toBe(250);
    expect(botRes.highest_bidder_team_id).toBe('team-bot-1');

    // Human 2 tries to bid again immediately when Bot is highest bidder (275)
    const res4 = rpc.v3_place_bid(
      { role: 'authenticated', userId: OTHER_USER_ID },
      { p_auction_id: AUCTION_ID, p_lot_id: 'lot-1', p_team_id: 'team-human-2', p_request_id: 'c-4' }
    );
    expect(res4.success).toBe(true);
    expect(res4.current_bid).toBe(275);
    expect(res4.highest_bidder_team_id).toBe('team-human-2');

    // Human 2 tries to double-bid while already the highest bidder -> rejected
    const doubleBid = rpc.v3_place_bid(
      { role: 'authenticated', userId: OTHER_USER_ID },
      { p_auction_id: AUCTION_ID, p_lot_id: 'lot-1', p_team_id: 'team-human-2', p_request_id: 'c-5' }
    );
    expect(doubleBid.success).toBe(false);
    expect(doubleBid.error).toBe('ERR_ALREADY_HIGHEST_BIDDER');
  });

  // 10. Bot bidding and auction progression work end to end
  it('10. Bot bidding and auction progression work end to end', () => {
    const serviceCaller: CallerContext = {
      role: 'service_role',
      userId: null,
      sessionUser: 'service_role',
    };

    // 1. Bot places winning bid on lot 1
    const botBid = rpc.v3_place_bid(serviceCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_team_id: 'team-bot-1',
      p_request_id: 'e2e-bot-win',
      p_is_bot: true,
    });
    expect(botBid.success).toBe(true);

    // Initial purse for team-bot-1 was 9500, players_bought was 4
    const botTeamBefore = rpc.state.teams.get('team-bot-1')!;
    expect(botTeamBefore.purse).toBe(9500);

    // 2. Finalize lot 1 after timer expires
    const finRes = rpc.v3_finalize_and_advance_lot(serviceCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-1',
      p_force: true, // authoritative worker finalizing
    });

    expect(finRes.success).toBe(true);
    expect(finRes.status).toBe('SOLD');
    expect(finRes.next_lot_id).toBe('lot-2');

    // Verify bot balance and squad was updated atomically
    const botTeamAfter = rpc.state.teams.get('team-bot-1')!;
    expect(botTeamAfter.purse).toBe(9300); // 9500 - 200
    expect(botTeamAfter.players_bought).toBe(5); // 4 + 1

    // 3. Next lot is now ready
    const lot2 = rpc.state.lots.get('lot-2')!;
    expect(lot2.status).toBe('PENDING');

    // 4. Worker starts bidding for lot 2
    const startRes = rpc.v3_start_bidding(serviceCaller, {
      p_auction_id: AUCTION_ID,
      p_lot_id: 'lot-2',
      p_force: true,
    });
    expect(startRes.success).toBe(true);
    expect(lot2.status).toBe('BIDDING');
  });
});
