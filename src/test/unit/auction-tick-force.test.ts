import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { POST } from '@/app/api/auction/tick/route';

const auction = {
  id: 'auction-1',
  room_id: 'room-1',
  status: 'IN_PROGRESS',
  current_lot_id: 'lot-1',
  current_lot_index: 1,
  paused_reason: null,
};
const tickSecret = 'test-auction-tick-secret-'.padEnd(48, 'x');

function queryResult(data: unknown) {
  const query: any = {
    select: () => query,
    in: () => query,
    eq: () => query,
    single: async () => ({ data, error: null }),
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  };
  return query;
}

function setup(lotStatus: string, timerExpiresAt: string) {
  mocks.from.mockImplementation((table: string) => queryResult(
    table === 'auctions'
      ? [auction]
      : {
          id: 'lot-1',
          status: lotStatus,
          lot_index: 1,
          current_bid: 0,
          base_price: 100,
          highest_bidder_team_id: null,
          timer_expires_at: timerExpiresAt,
          get_ready_expires_at: new Date(Date.now() + 60_000).toISOString(),
          player_id: 'player-1',
          players: null,
        }
  ));
  mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
}

function tick(body?: unknown, withCredential = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withCredential) headers['x-auction-tick-secret'] = tickSecret;

  return POST(new Request('http://localhost/api/auction/tick', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

describe('auction tick finalization is due-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUCTION_TICK_SECRET', tickSecret);
    mocks.createAdminClient.mockImplementation(() => ({ from: mocks.from, rpc: mocks.rpc }));
  });

  afterEach(() => vi.unstubAllEnvs());

  it('rejects an unauthenticated force attempt before creating an admin client', async () => {
    const response = await tick({ force: true, auctionId: auction.id, lotId: 'lot-1' }, false);

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects an invalid credential before any privileged database operation', async () => {
    const response = await POST(new Request('http://localhost/api/auction/tick', {
      method: 'POST',
      headers: { 'x-auction-tick-secret': 'invalid-auction-tick-secret-value' },
    }));

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the server secret is missing', async () => {
    vi.stubEnv('AUCTION_TICK_SECRET', '');

    const response = await tick();

    expect(response.status).toBe(503);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the server secret is too short', async () => {
    vi.stubEnv('AUCTION_TICK_SECRET', 'short');

    const response = await tick();

    expect(response.status).toBe(503);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('ignores a crafted force request for a lot whose timer has not expired', async () => {
    setup('GET_READY', new Date(Date.now() + 60_000).toISOString());

    const response = await tick({ force: true, auctionId: auction.id, lotId: 'lot-1' });

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalledWith('v3_finalize_and_advance_lot', expect.anything());
  });

  it('keeps normal expired-lot finalization due-only at the RPC boundary', async () => {
    setup('BIDDING', new Date(Date.now() - 60_000).toISOString());

    const response = await tick();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('v3_finalize_and_advance_lot', {
      p_auction_id: auction.id,
      p_lot_id: 'lot-1',
      p_force: false,
    });
  });

  it('accepts the configured server credential for an authorized normal tick', async () => {
    setup('GET_READY', new Date(Date.now() + 60_000).toISOString());

    const response = await tick();

    expect(response.status).toBe(200);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('auctions');
  });
});
