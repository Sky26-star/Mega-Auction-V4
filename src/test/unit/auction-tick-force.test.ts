
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

function queryResult(data: unknown, error: unknown = null) {
  const query: any = {
    select: () => query,
    in: () => query,
    eq: () => query,
    single: async () => ({ data, error }),
    maybeSingle: async () => ({ data, error }),
    then: (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve({ data, error }).then(resolve, reject),
  };

  return query;
}

function setup(
  lotStatus: string,
  timerExpiresAt: string,
  getReadyExpiresAt = new Date(Date.now() + 60_000).toISOString()
) {
  mocks.from.mockImplementation((table: string) =>
    queryResult(
      table === 'auctions'
        ? [auction]
        : table === 'mini_auction_sessions'
          ? []
          : {
            id: 'lot-1',
            status: lotStatus,
            lot_index: 1,
            current_bid: 0,
            base_price: 100,
            highest_bidder_team_id: null,
            timer_expires_at: timerExpiresAt,
            get_ready_expires_at: getReadyExpiresAt,
            player_id: 'player-1',
            players: null,
          }
    )
  );

  mocks.rpc.mockResolvedValue({
    data: { success: true },
    error: null,
  });
}

function tick(body?: unknown, withCredential = true) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (withCredential) {
    headers['x-auction-tick-secret'] = tickSecret;
  }

  return POST(
    new Request('http://localhost/api/auction/tick', {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

describe('auction tick finalization is due-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUCTION_TICK_SECRET', tickSecret);

    mocks.createAdminClient.mockImplementation(() => ({
      from: mocks.from,
      rpc: (name: string, ...args: unknown[]) =>
        name === 'auction_scheduler_owner'
          ? Promise.resolve({
            data: 'LEGACY',
            error: null,
          })
          : mocks.rpc(name, ...args),
    }));
  });

  afterEach(() => vi.unstubAllEnvs());

  it('fences legacy HTTP ticks once the database owns scheduling', async () => {
    mocks.createAdminClient.mockReturnValue({
      from: mocks.from,
      rpc: vi.fn().mockResolvedValue({
        data: 'DATABASE',
        error: null,
      }),
    });

    expect((await tick()).status).toBe(409);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('fails closed when scheduler ownership cannot be verified', async () => {
    mocks.createAdminClient.mockReturnValue({
      from: mocks.from,
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'XX000' },
      }),
    });

    expect((await tick()).status).toBe(503);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not treat a missing ownership RPC as permission for legacy execution', async () => {
    mocks.createAdminClient.mockReturnValue({
      from: mocks.from,
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202' },
      }),
    });

    expect((await tick()).status).toBe(503);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('closes expired mini selection without bypassing host pool review', async () => {
    let miniReads = 0;

    mocks.from.mockImplementation((table: string) => {
      if (table === 'auctions') {
        return queryResult([
          { ...auction, status: 'MINI_AUCTION' },
        ]);
      }

      if (table === 'mini_auction_sessions') {
        miniReads++;

        return queryResult(
          miniReads === 1
            ? []
            : {
              id: 'mini-1',
              status: 'SELECTION_OPEN',
              selection_expires_at: new Date(0).toISOString(),
            }
        );
      }

      return queryResult(null);
    });

    mocks.rpc.mockResolvedValue({
      data: { success: true, total_lots: 2 },
      error: null,
    });

    const response = await tick();

    expect(response.status).toBe(200);

    expect(mocks.rpc).toHaveBeenCalledWith(
      'v3_close_mini_selection',
      expect.objectContaining({
        p_auction_id: auction.id,
      })
    );

    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'v3_start_mini_auction',
      expect.anything()
    );
  });

  it('rejects an unauthenticated force attempt before creating an admin client', async () => {
    const response = await tick(
      {
        force: true,
        auctionId: auction.id,
        lotId: 'lot-1',
      },
      false
    );

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects an invalid credential before any privileged database operation', async () => {
    const response = await POST(
      new Request('http://localhost/api/auction/tick', {
        method: 'POST',
        headers: {
          'x-auction-tick-secret': 'invalid-auction-tick-secret-value',
        },
      })
    );

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
    setup(
      'GET_READY',
      new Date(Date.now() + 60_000).toISOString()
    );

    const response = await tick({
      force: true,
      auctionId: auction.id,
      lotId: 'lot-1',
    });

    expect(response.status).toBe(200);

    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'v3_finalize_and_advance_lot',
      expect.anything()
    );
  });

  it('keeps normal expired-lot finalization due-only at the RPC boundary', async () => {
    setup(
      'BIDDING',
      new Date(Date.now() - 60_000).toISOString()
    );

    const response = await tick();

    expect(response.status).toBe(200);

    expect(mocks.rpc).toHaveBeenCalledWith(
      'v3_finalize_and_advance_lot',
      {
        p_auction_id: auction.id,
        p_lot_id: 'lot-1',
        p_force: false,
      }
    );
  });

  it('does not report GET_READY transition as applied when RPC returns no result', async () => {
    setup(
      'GET_READY',
      new Date(Date.now() + 60_000).toISOString(),
      new Date(Date.now() - 1_000).toISOString()
    );

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const response = await tick();
    const body = await response.json();

    expect(response.status).toBe(503);

    expect(body.actions).toContainEqual(
      expect.objectContaining({
        action: 'START_BIDDING_FAILED',
        status: 'failed',
      })
    );

    expect(body.actions).not.toContainEqual(
      expect.objectContaining({
        action: 'START_BIDDING',
      })
    );

    expect(JSON.stringify(body)).not.toContain(
      'RPC returned no successful result.'
    );
  });

  it('does not report finalization as applied when the RPC returns a transport error', async () => {
    setup(
      'BIDDING',
      new Date(Date.now() - 60_000).toISOString()
    );

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'database unavailable',
      },
    });

    const response = await tick();
    const body = await response.json();

    expect(response.status).toBe(503);

    expect(body.actions).toContainEqual(
      expect.objectContaining({
        action: 'FINALIZE_LOT_FAILED',
        status: 'failed',
      })
    );

    expect(body.actions).not.toContainEqual(
      expect.objectContaining({
        action: 'FINALIZE_LOT',
      })
    );

    expect(JSON.stringify(body)).not.toContain(
      'database unavailable'
    );
  });

  it('accepts the configured server credential for an authorized normal tick', async () => {
    setup(
      'GET_READY',
      new Date(Date.now() + 60_000).toISOString()
    );

    const response = await tick();

    expect(response.status).toBe(200);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('auctions');
  });

  it.each([
    null,
    { success: false, error: 'ERR_UNAUTHORIZED' },
  ])(
    'reports failed/null resume RPCs instead of healthy success: %j',
    async data => {
      mocks.from.mockImplementation(table =>
        queryResult(
          table === 'auctions'
            ? [
              {
                ...auction,
                status: 'PAUSED',
                paused_reason: JSON.stringify({
                  resume_expires_at: Date.now() - 1000,
                }),
              },
            ]
            : []
        )
      );

      mocks.rpc.mockResolvedValue({
        data,
        error: null,
      });

      const response = await tick();

      expect(response.status).toBe(503);

      expect(await response.json()).toMatchObject({
        schemaVersion: 1,
        success: false,
        failureCount: 1,
        actions: [
          expect.objectContaining({
            action: 'RESUME_AUCTION_FAILED',
            status: 'failed',
          }),
        ],
      });
    }
  );

  it('reports a rejected mini query even when there are no active auctions', async () => {
    mocks.from.mockImplementation(table =>
      table === 'mini_auction_sessions'
        ? queryResult(null, {
          message: 'read unavailable',
        })
        : queryResult([])
    );

    const response = await tick();

    expect(response.status).toBe(503);

    expect(await response.json()).toMatchObject({
      success: false,
      failureCount: 1,
    });
  });

  it('includes completed-parent mini close failures in the response', async () => {
    mocks.from.mockImplementation(table =>
      queryResult(
        table === 'mini_auction_sessions'
          ? [{ auction_id: 'completed-parent' }]
          : []
      )
    );

    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'close failed',
      },
    });

    const response = await tick();

    expect(response.status).toBe(503);

    expect(await response.json()).toMatchObject({
      failureCount: 1,
      actions: [
        expect.objectContaining({
          action: 'CLOSE_MINI_SELECTION_FAILED',
          status: 'failed',
        }),
      ],
    });
  });

  it('preserves committed successes when another auction throws and releases its process lock', async () => {
    mocks.from.mockImplementation(table =>
      queryResult(
        table === 'auctions'
          ? [
            {
              ...auction,
              status: 'PAUSED',
              paused_reason: JSON.stringify({
                resume_expires_at: 1,
              }),
            },
            {
              ...auction,
              id: 'auction-2',
              status: 'PAUSED',
              paused_reason: JSON.stringify({
                resume_expires_at: 1,
              }),
            },
          ]
          : []
      )
    );

    mocks.rpc
      .mockRejectedValueOnce(new Error('rpc transport'))
      .mockResolvedValue({
        data: { success: true },
        error: null,
      });

    const response = await tick();

    expect(response.status).toBe(503);

    expect(await response.json()).toMatchObject({
      failureCount: 1,
      actions: [
        expect.objectContaining({ status: 'failed' }),
        expect.objectContaining({ status: 'succeeded' }),
      ],
    });

    expect((await tick()).status).toBe(200);
  });

  it('counts authoritative expiry races as skips, but authorization rejection as failure', async () => {
    setup(
      'BIDDING',
      new Date(Date.now() - 60_000).toISOString()
    );

    mocks.rpc.mockResolvedValue({
      data: {
        success: false,
        error: 'ERR_TIMER_NOT_EXPIRED',
      },
      error: null,
    });

    const skipped = await tick();

    expect(skipped.status).toBe(200);

    expect(await skipped.json()).toMatchObject({
      success: true,
      failureCount: 0,
      actions: [
        expect.objectContaining({
          status: 'skipped',
        }),
      ],
    });

    mocks.rpc.mockResolvedValue({
      data: {
        success: false,
        error: 'ERR_UNAUTHORIZED',
      },
      error: null,
    });

    expect((await tick()).status).toBe(503);
  });

  it('does not expose unexpected exception details in a failed top-level tick', async () => {
    mocks.from.mockImplementation(() => {
      throw new Error('private connection details');
    });

    const response = await tick();

    expect(response.status).toBe(500);

    const body = await response.json();

    expect(body).toMatchObject({
      success: false,
      failureCount: 1,
    });

    expect(JSON.stringify(body)).not.toContain(
      'private connection details'
    );
  });

  // FIX 2: Prevent raw RPC errors from leaking in HTTP responses.
  it('does not expose private RPC errors in tick responses', async () => {
    const privateError = 'private database connection details';

    mocks.from.mockImplementation(table =>
      queryResult(
        table === 'auctions'
          ? [
            {
              ...auction,
              status: 'PAUSED',
              paused_reason: JSON.stringify({
                resume_expires_at: Date.now() - 1000,
              }),
            },
          ]
          : []
      )
    );

    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: privateError,
      },
    });

    const response = await tick();
    const body = await response.json();

    expect(response.status).toBe(503);

    expect(body).toMatchObject({
      schemaVersion: 1,
      success: false,
      failureCount: 1,
      actions: [
        expect.objectContaining({
          action: 'RESUME_AUCTION_FAILED',
          status: 'failed',
        }),
      ],
    });

    expect(JSON.stringify(body)).not.toContain(privateError);
  });
});
