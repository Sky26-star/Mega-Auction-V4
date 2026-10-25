import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: { from: vi.fn(), rpc: vi.fn(), updates: vi.fn(), updateFilters: vi.fn() },
  caller: { rpc: vi.fn() },
  evaluateBotTradeResponse: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.admin }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.caller }));
vi.mock('@/lib/trade/bot-trade-evaluator', () => ({
  evaluateBotTradeResponse: mocks.evaluateBotTradeResponse,
}));

import { POST } from '@/app/api/trade/bot-respond/route';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';

const proposer: V3Team = {
  id: 'human-team', name: 'Human', short_name: 'HUM', purse: 1000, initial_purse: 1000,
  players_bought: 1, overseas_count: 0, is_bot: false,
};
const receiver: V3Team = {
  id: 'bot-team', name: 'Bot', short_name: 'BOT', purse: 1000, initial_purse: 1000,
  players_bought: 1, overseas_count: 0, is_bot: true,
};

const offered: V3Player = {
  id: 'offered-player', name: 'Offered', role: 'BATSMAN', category: 'A', base_price: 100,
  is_overseas: false, country: 'India', age: 28, batting_hand: 'RIGHT', image_url: null,
};
const requested: V3Player = {
  id: 'requested-player', name: 'Requested', role: 'BOWLER', category: 'A', base_price: 100,
  is_overseas: false, country: 'India', age: 28, batting_hand: 'RIGHT', image_url: null,
};

function queryResult(data: unknown, table = 'unknown') {
  let isUpdate = false;
  const query: any = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      if (isUpdate) mocks.admin.updateFilters(table, column, value);
      return query;
    },
    in: () => query,
    update: (values: unknown) => {
      isUpdate = true;
      mocks.admin.updates(table, values);
      return query;
    },
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  };
  return query;
}

function trade(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trade-1', auction_id: 'auction-1', room_id: 'room-1',
    proposer_team_id: proposer.id, receiver_team_id: receiver.id,
    proposer_player_ids: [offered.id], receiver_player_ids: [requested.id],
    status: 'PENDING', expires_at: new Date(Date.now() + 60_000).toISOString(),
    proposer_notes: null, ...overrides,
  };
}

function setup({
  currentTrade = trade(),
  roomHostId = 'profile-host-id',
  mappingProfileId = 'profile-host-id',
  participant = null,
  receiverTeam = receiver,
}: {
  currentTrade?: ReturnType<typeof trade>;
  roomHostId?: string;
  mappingProfileId?: string;
  participant?: { id: string; team_id: string } | null;
  receiverTeam?: V3Team;
} = {}) {
  mocks.auth.mockResolvedValue({ userId: 'host-clerk-id' });
  mocks.admin.from.mockImplementation((table: string) => {
    const dataByTable: Record<string, unknown> = {
      clerk_user_mappings: { profile_id: mappingProfileId },
      trades: currentTrade,
      rooms: { id: 'room-1', host_id: roomHostId, settings: {} },
      room_participants: participant,
      teams: [proposer, receiverTeam],
      squad_players: [
        { team_id: proposer.id, player_id: offered.id, player: offered },
        { team_id: receiver.id, player_id: requested.id, player: requested },
      ],
    };
    return queryResult(dataByTable[table], table);
  });
  mocks.admin.rpc.mockResolvedValue({ data: { success: true, status: 'ACCEPTED' }, error: null });
  mocks.caller.rpc.mockResolvedValue({ data: { success: true, status: 'ACCEPTED' }, error: null });
  mocks.evaluateBotTradeResponse.mockReturnValue({ decision: 'ACCEPT', reason: 'Strategically beneficial' });
}

async function respond() {
  return POST(new Request('http://localhost/api/trade/bot-respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tradeId: 'trade-1' }),
  }));
}

describe('bot-respond ACCEPT authorization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets a verified host-proposer process a bot ACCEPT through the server-only RPC', async () => {
    setup({ participant: { id: 'participant-1', team_id: proposer.id } });

    const response = await respond();
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.decision).toBe('ACCEPT');
    expect(mocks.admin.rpc).toHaveBeenCalledWith('v3_respond_bot_trade', expect.objectContaining({
      p_trade_id: 'trade-1', p_host_clerk_user_id: 'host-clerk-id',
    }));
    expect(mocks.caller.rpc).not.toHaveBeenCalled();
  });

  it('does not fall back to the caller RPC if the trusted bot acceptance is rejected', async () => {
    setup({ participant: { id: 'participant-1', team_id: proposer.id } });
    mocks.admin.rpc.mockResolvedValue({
      data: { success: false, error: 'ERR_UNAUTHORIZED_BOT_TRADE_HOST' }, error: null,
    });

    const response = await respond();
    const result = await response.json();

    expect(response.status).toBe(409);
    expect(result.error).toBe('ERR_UNAUTHORIZED_BOT_TRADE_HOST');
    expect(mocks.admin.rpc).toHaveBeenCalledOnce();
    expect(mocks.caller.rpc).not.toHaveBeenCalled();
  });

  it('does not use the service-role RPC when the receiving franchise is not a bot', async () => {
    setup({ receiverTeam: { ...receiver, is_bot: false } });

    const response = await respond();
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.error).toBe('Receiving franchise is not a bot');
    expect(mocks.admin.rpc).not.toHaveBeenCalled();
    expect(mocks.caller.rpc).not.toHaveBeenCalled();
  });

  it('keeps a bot REJECT on the authenticated-user response RPC', async () => {
    setup({ participant: { id: 'participant-1', team_id: proposer.id } });
    mocks.evaluateBotTradeResponse.mockReturnValue({ decision: 'REJECT', reason: 'Roster constraints' });

    const response = await respond();
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.decision).toBe('REJECT');
    expect(mocks.caller.rpc).toHaveBeenCalledWith('v3_respond_trade', expect.objectContaining({
      p_trade_id: 'trade-1', p_action: 'REJECT',
    }));
    expect(mocks.admin.rpc).not.toHaveBeenCalled();
  });

  it('keeps an ordinary non-host participant unauthorized to process the bot response', async () => {
    setup({ roomHostId: 'another-profile', mappingProfileId: 'profile-member-id' });
    mocks.admin.from.mockImplementation((table: string) => {
      if (table === 'room_participants') {
        return queryResult({ id: 'participant-1', team_id: proposer.id });
      }
      const dataByTable: Record<string, unknown> = {
        clerk_user_mappings: { profile_id: 'profile-member-id' },
        trades: trade(),
        rooms: { id: 'room-1', host_id: 'another-profile', settings: {} },
      };
      return queryResult(dataByTable[table], table);
    });

    const response = await respond();

    expect(response.status).toBe(403);
    expect(mocks.caller.rpc).not.toHaveBeenCalled();
    expect(mocks.admin.rpc).not.toHaveBeenCalled();
  });

  it('does not let an unauthorized caller expire a trade through the admin client', async () => {
    setup({
      currentTrade: trade({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
      roomHostId: 'another-profile',
      mappingProfileId: 'profile-member-id',
    });

    const response = await respond();

    expect(response.status).toBe(403);
    expect(mocks.admin.updates).not.toHaveBeenCalled();
    expect(mocks.caller.rpc).not.toHaveBeenCalled();
  });

  it('still expires a stale trade after verifying the room host', async () => {
    setup({ currentTrade: trade({ expires_at: new Date(Date.now() - 60_000).toISOString() }) });

    const response = await respond();
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.error).toBe('Trade proposal has expired');
    expect(mocks.admin.updates).toHaveBeenCalledWith('trades', expect.objectContaining({ status: 'EXPIRED' }));
    expect(mocks.admin.updateFilters).toHaveBeenCalledWith('trades', 'status', 'PENDING');
    expect(mocks.caller.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['transport failure', { data: null, error: { message: 'RPC transport failed' } }],
    ['authorization failure', { data: { success: false, error: 'ERR_UNAUTHORIZED_TO_ACCEPT' }, error: null }],
  ])('does not retry an ACCEPT after an RPC %s', async (_failure, rpcResult) => {
    setup();
    mocks.admin.rpc.mockResolvedValue(rpcResult);

    const response = await respond();

    expect(response.status).toBe(409);
    expect(mocks.admin.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.caller.rpc).not.toHaveBeenCalled();
  });

  it.each(['EXPIRED', 'ACCEPTED'])('does not accept a repeated %s trade', async status => {
    setup({ currentTrade: trade({ status }) });

    const response = await respond();

    expect(response.status).toBe(400);
    expect(mocks.caller.rpc).not.toHaveBeenCalled();
    expect(mocks.admin.rpc).not.toHaveBeenCalled();
  });
});
