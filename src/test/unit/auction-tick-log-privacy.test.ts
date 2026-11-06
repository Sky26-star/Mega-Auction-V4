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

const tickSecret = 'test-auction-tick-secret-'.padEnd(48, 'x');
const privateMessage = 'PRIVATE_DATABASE_CONNECTION_DETAILS_DO_NOT_LOG';

const auction = {
  id: 'auction-1',
  room_id: 'room-1',
  status: 'IN_PROGRESS',
  current_lot_id: 'lot-1',
  current_lot_index: 1,
  paused_reason: null,
};

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

function tick() {
  return POST(
    new Request('http://localhost/api/auction/tick', {
      method: 'POST',
      headers: { 'x-auction-tick-secret': tickSecret },
    })
  );
}

describe('auction tick log privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUCTION_TICK_SECRET', tickSecret);

    mocks.createAdminClient.mockImplementation(() => ({
      from: mocks.from,
      rpc: (name: string, ...args: unknown[]) =>
        name === 'auction_scheduler_owner'
          ? Promise.resolve({ data: 'LEGACY', error: null })
          : mocks.rpc(name, ...args),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      scenario: 'resume',
      action: 'RESUME_AUCTION_FAILED',
      httpStatus: 503,
    },
    {
      scenario: 'mini-close',
      action: 'CLOSE_MINI_SELECTION_FAILED',
      httpStatus: 503,
    },
    {
      scenario: 'start',
      action: 'START_BIDDING_FAILED',
      httpStatus: 503,
    },
    {
      scenario: 'finalize',
      action: 'FINALIZE_LOT_FAILED',
      httpStatus: 503,
    },
    {
      scenario: 'route',
      action: 'TICK_FAILED',
      httpStatus: 500,
    },
  ])(
    'hides private errors in $scenario logs and HTTP responses',
    async ({ scenario, action, httpStatus }) => {
      if (scenario === 'resume') {
        mocks.from.mockImplementation((table: string) =>
          queryResult(
            table === 'auctions'
              ? [{
                  ...auction,
                  status: 'PAUSED',
                  paused_reason: JSON.stringify({
                    resume_expires_at: Date.now() - 1000,
                  }),
                }]
              : []
          )
        );
      } else if (scenario === 'mini-close') {
        mocks.from.mockImplementation((table: string) =>
          queryResult(
            table === 'mini_auction_sessions'
              ? [{ auction_id: 'completed-parent' }]
              : []
          )
        );
      } else if (scenario === 'start' || scenario === 'finalize') {
        const isStart = scenario === 'start';

        const lot = {
          id: 'lot-1',
          status: isStart ? 'GET_READY' : 'BIDDING',
          lot_index: 1,
          current_bid: 0,
          base_price: 100,
          highest_bidder_team_id: null,
          timer_expires_at: new Date(
            Date.now() + (isStart ? 60_000 : -60_000)
          ).toISOString(),
          get_ready_expires_at: new Date(
            Date.now() - 60_000
          ).toISOString(),
          player_id: 'player-1',
          players: null,
        };

        mocks.from.mockImplementation((table: string) =>
          queryResult(
            table === 'auctions'
              ? [auction]
              : table === 'mini_auction_sessions'
                ? []
                : lot
          )
        );
      } else {
        mocks.from.mockImplementation(() => {
          throw new Error(privateMessage);
        });
      }

      mocks.rpc.mockResolvedValue({
        data: null,
        error: { message: privateMessage },
      });

      const logSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      try {
        const response = await tick();
        const body = await response.json();

        expect(response.status).toBe(httpStatus);
        expect(body.success).toBe(false);

        expect(body.actions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action,
              status: 'failed',
            }),
          ])
        );

        // Raw database details must never reach the HTTP client.
        expect(JSON.stringify(body)).not.toContain(privateMessage);

        // Raw database details must not reach server logs either.
        const logged = [
          ...logSpy.mock.calls,
          ...errorSpy.mock.calls,
        ]
          .flat()
          .map(value =>
            typeof value === 'string'
              ? value
              : JSON.stringify(value)
          )
          .join('\n');

        expect(logged).not.toContain(privateMessage);
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }
    }
  );
});