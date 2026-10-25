import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: { from: vi.fn(), rpc: vi.fn() },
  caller: { rpc: vi.fn() },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.admin }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.caller }));

import { POST } from '@/app/api/trade/bot-cycle/route';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';

const team = (id: string, isBot: boolean, count: number): V3Team => ({
  id,
  name: id,
  short_name: id,
  purse: 1000,
  initial_purse: 1000,
  players_bought: count,
  overseas_count: 0,
  is_bot: isBot,
});

const player = (id: string, role: V3Player['role']): V3Player => ({
  id,
  name: id,
  role,
  category: 'A',
  base_price: 100,
  is_overseas: false,
  country: 'India',
  age: 28,
  batting_hand: 'RIGHT',
  image_url: null,
});

function queryResult(data: unknown) {
  const query: any = {
    select: () => query,
    eq: () => query,
    order: () => query,
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  };
  return query;
}

function squadRows(teamId: string, players: V3Player[]) {
  return players.map(playerRecord => ({ team_id: teamId, player: playerRecord }));
}

function pendingTrade(proposer: V3Team, receiver: V3Team, proposerPlayerIds: string[], receiverPlayerIds: string[]) {
  return {
    id: 'parent-trade',
    proposer_team_id: proposer.id,
    receiver_team_id: receiver.id,
    proposer_player_ids: proposerPlayerIds,
    receiver_player_ids: receiverPlayerIds,
    status: 'PENDING',
    parent_trade_id: null,
    created_at: new Date().toISOString(),
  };
}

function setup({
  teams,
  squads,
  trades = [],
  userId = 'host-clerk-id',
  profileId = 'profile-host-id',
}: { teams: V3Team[]; squads: unknown[]; trades?: unknown[]; userId?: string; profileId?: string }) {
  mocks.auth.mockResolvedValue({ userId });
  mocks.admin.from.mockImplementation((table: string) => {
    const dataByTable: Record<string, unknown> = {
      auctions: { id: 'auction-cycle-test', room_id: 'room-test', status: 'COMPLETED' },
      rooms: { id: 'room-test', host_id: 'profile-host-id', settings: {} },
      clerk_user_mappings: { profile_id: profileId },
      mini_auction_sessions: null,
      teams,
      squad_players: squads,
      trades,
    };
    return queryResult(dataByTable[table]);
  });
  mocks.admin.rpc.mockResolvedValue({ data: { success: true, status: 'ACCEPTED' }, error: null });
  mocks.caller.rpc.mockResolvedValue({ data: { success: true, trade_id: 'new-trade' }, error: null });
}

async function runCycle() {
  return POST(new Request('http://localhost/api/trade/bot-cycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auctionId: 'auction-cycle-test' }),
  }));
}

describe('bot-cycle route integration without persistent database writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a legal bot-to-human proactive offer through v3_propose_trade', async () => {
    const bot = team('bot-a', true, 5);
    const human = team('human', false, 6);
    setup({
      teams: [bot, human],
      squads: [
        ...squadRows(bot.id, Array.from({ length: 5 }, (_, i) => player(`bat-${i}`, 'BATSMAN'))),
        ...squadRows(human.id, Array.from({ length: 6 }, (_, i) => player(`bowl-${i}`, 'BOWLER'))),
      ],
    });

    const response = await runCycle();
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.action).toBe('PROPOSED');
    expect(mocks.caller.rpc).toHaveBeenCalledWith('v3_propose_trade', expect.objectContaining({
      p_proposer_team_id: bot.id,
      p_receiver_team_id: human.id,
      p_parent_trade_id: null,
    }));
  });

  it('creates a bot-to-bot proposal and links a bot counteroffer to its parent', async () => {
    const proposer = team('bot-a', true, 5);
    const receiver = team('bot-b', true, 3);
    const proposerRoster = Array.from({ length: 5 }, (_, i) => player(`bat-${i}`, 'BATSMAN'));
    const receiverRoster = Array.from({ length: 6 }, (_, i) => player(`bowl-${i}`, 'BOWLER'));
    setup({ teams: [proposer, receiver], squads: [
      ...squadRows(proposer.id, proposerRoster),
      ...squadRows(receiver.id, receiverRoster),
    ] });

    const proposalResponse = await runCycle();
    const proposalResult = await proposalResponse.json();
    expect(proposalResult.action).toBe('PROPOSED');
    expect(mocks.caller.rpc).toHaveBeenCalledWith('v3_propose_trade', expect.objectContaining({
      p_proposer_team_id: proposer.id,
      p_receiver_team_id: receiver.id,
      p_parent_trade_id: null,
    }));

    const incoming = player('incoming-batter', 'BATSMAN');
    const extra = player('counter-extra', 'ALL_ROUNDER');
    const outgoing = player('outgoing-bowler', 'BOWLER');
    mocks.caller.rpc.mockClear();
    mocks.admin.from.mockImplementation((table: string) => {
      const dataByTable: Record<string, unknown> = {
        auctions: { id: 'auction-cycle-test', room_id: 'room-test', status: 'COMPLETED' },
        rooms: { id: 'room-test', host_id: 'profile-host-id', settings: {} },
        clerk_user_mappings: { profile_id: 'profile-host-id' },
        mini_auction_sessions: null,
        teams: [proposer, receiver],
        squad_players: [
          ...squadRows(proposer.id, [incoming, extra]),
          ...squadRows(receiver.id, [outgoing, player('second-bowler', 'BOWLER'), player('bot-batter', 'BATSMAN')]),
        ],
        trades: [pendingTrade(proposer, receiver, [incoming.id], [outgoing.id])],
      };
      return queryResult(dataByTable[table]);
    });
    mocks.caller.rpc.mockResolvedValue({ data: { success: true, trade_id: 'counter-trade' }, error: null });

    const counterResponse = await runCycle();
    const counterResult = await counterResponse.json();
    expect(counterResult.action).toBe('COUNTER');
    expect(mocks.caller.rpc).toHaveBeenCalledWith('v3_propose_trade', expect.objectContaining({
      p_proposer_team_id: receiver.id,
      p_receiver_team_id: proposer.id,
      p_parent_trade_id: 'parent-trade',
    }));
  });

  it('processes a pending human-to-bot offer through the trade response RPC', async () => {
    const human = team('human', false, 6);
    const bot = team('bot-a', true, 3);
    const offered = player('offered-batter', 'BATSMAN');
    const requested = player('requested-bowler', 'BOWLER');
    const proposerRoster = [offered, ...Array.from({ length: 5 }, (_, i) => player(`human-bowler-${i}`, 'BOWLER'))];
    const botRoster = [requested, player('bot-bowler-backup', 'BOWLER'), player('bot-batter', 'BATSMAN')];
    setup({
      teams: [human, bot],
      squads: [...squadRows(human.id, proposerRoster), ...squadRows(bot.id, botRoster)],
      trades: [pendingTrade(human, bot, [offered.id], [requested.id])],
    });
    mocks.caller.rpc.mockResolvedValue({ data: { success: true, status: 'ACCEPTED' }, error: null });

    const response = await runCycle();
    const result = await response.json();

    expect(result.action).toBe('ACCEPT');
    expect(mocks.admin.rpc).toHaveBeenCalledWith('v3_respond_bot_trade', expect.objectContaining({
      p_trade_id: 'parent-trade',
      p_host_clerk_user_id: 'host-clerk-id',
    }));
    expect(mocks.caller.rpc).not.toHaveBeenCalledWith('v3_respond_trade', expect.objectContaining({ p_action: 'ACCEPT' }));
  });

  it('uses the server-only acceptance path when the verified host proposed to a bot receiver', async () => {
    const human = team('human', false, 6);
    const bot = team('bot-a', true, 3);
    const offered = player('offered-batter', 'BATSMAN');
    const requested = player('requested-bowler', 'BOWLER');
    setup({
      teams: [human, bot],
      squads: [
        ...squadRows(human.id, [offered, ...Array.from({ length: 5 }, (_, i) => player(`human-bowler-${i}`, 'BOWLER'))]),
        ...squadRows(bot.id, [requested, player('bot-bowler-backup', 'BOWLER'), player('bot-batter', 'BATSMAN')]),
      ],
      trades: [pendingTrade(human, bot, [offered.id], [requested.id])],
    });
    const response = await runCycle();
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.action).toBe('ACCEPT');
    expect(mocks.admin.rpc).toHaveBeenCalledWith('v3_respond_bot_trade', expect.objectContaining({
      p_trade_id: 'parent-trade', p_host_clerk_user_id: 'host-clerk-id',
    }));
    expect(mocks.caller.rpc).not.toHaveBeenCalledWith('v3_respond_trade', expect.objectContaining({ p_action: 'ACCEPT' }));
  });

  it('does not retry a failed trusted acceptance through the caller RPC', async () => {
    const human = team('human', false, 6);
    const bot = team('bot-a', true, 3);
    const offered = player('offered-batter', 'BATSMAN');
    const requested = player('requested-bowler', 'BOWLER');
    setup({
      teams: [human, bot],
      squads: [
        ...squadRows(human.id, [offered, ...Array.from({ length: 5 }, (_, i) => player(`human-bowler-${i}`, 'BOWLER'))]),
        ...squadRows(bot.id, [requested, player('bot-bowler-backup', 'BOWLER'), player('bot-batter', 'BATSMAN')]),
      ],
      trades: [pendingTrade(human, bot, [offered.id], [requested.id])],
    });
    mocks.admin.rpc.mockResolvedValue({ data: { success: false, error: 'ERR_TRADE_NOT_ACTIVE' }, error: null });

    const response = await runCycle();
    const result = await response.json();

    expect(response.status).toBe(409);
    expect(result.error).toBe('ERR_TRADE_NOT_ACTIVE');
    expect(mocks.admin.rpc).toHaveBeenCalledWith('v3_respond_bot_trade', expect.objectContaining({ p_host_clerk_user_id: 'host-clerk-id' }));
    expect(mocks.caller.rpc).not.toHaveBeenCalledWith('v3_respond_trade', expect.objectContaining({ p_action: 'ACCEPT' }));
  });

  it('does not retry a failed trusted ACCEPT through the caller RPC', async () => {
    const human = team('human', false, 6);
    const bot = team('bot-a', true, 3);
    const offered = player('offered-batter', 'BATSMAN');
    const requested = player('requested-bowler', 'BOWLER');
    setup({
      teams: [human, bot],
      squads: [
        ...squadRows(human.id, [offered, ...Array.from({ length: 5 }, (_, i) => player(`human-bowler-${i}`, 'BOWLER'))]),
        ...squadRows(bot.id, [requested, player('bot-bowler-backup', 'BOWLER'), player('bot-batter', 'BATSMAN')]),
      ],
      trades: [pendingTrade(human, bot, [offered.id], [requested.id])],
    });
    mocks.admin.rpc.mockResolvedValue({ data: null, error: { message: 'RPC transport failed' } });

    const response = await runCycle();
    const result = await response.json();

    expect(response.status).toBe(409);
    expect(result.error).toBe('RPC transport failed');
    expect(mocks.admin.rpc).toHaveBeenCalledWith('v3_respond_bot_trade', expect.objectContaining({ p_host_clerk_user_id: 'host-clerk-id' }));
    expect(mocks.caller.rpc).not.toHaveBeenCalledWith('v3_respond_trade', expect.objectContaining({ p_action: 'ACCEPT' }));
  });

  it('rejects a non-host participant before invoking the response RPC', async () => {
    const human = team('human', false, 6);
    const bot = team('bot-a', true, 3);
    setup({ teams: [human, bot], squads: [], userId: 'participant-clerk-id', profileId: 'other-profile-id' });

    const response = await runCycle();
    const result = await response.json();

    expect(response.status).toBe(403);
    expect(result.error).toBe('Only the room host can run bot trading');
    expect(mocks.caller.rpc).not.toHaveBeenCalled();
    expect(mocks.admin.rpc).not.toHaveBeenCalled();
  });

  it.each(['EXPIRED', 'ACCEPTED'])('does not process a repeated or %s bot receiver trade', async status => {
    const human = team('human', false, 6);
    const bot = team('bot-a', true, 3);
    const staleTrade = { ...pendingTrade(human, bot, ['offered-batter'], ['requested-bowler']), status };
    setup({ teams: [human, bot], squads: [], trades: [staleTrade] });

    const response = await runCycle();

    expect(response.status).toBe(200);
    expect(mocks.caller.rpc).not.toHaveBeenCalledWith('v3_respond_trade', expect.anything());
    expect(mocks.admin.rpc).not.toHaveBeenCalled();
  });

  it('records a bot receiver rejection when the offer would remove its only keeper', async () => {
    const proposer = team('bot-a', true, 3);
    const receiver = team('bot-b', true, 3);
    const offered = player('offered-batter', 'BATSMAN');
    const keeper = player('sole-keeper', 'WICKET_KEEPER');
    setup({
      teams: [proposer, receiver],
      squads: [
        ...squadRows(proposer.id, [offered]),
        ...squadRows(receiver.id, [keeper, player('bot-batter', 'BATSMAN')]),
      ],
      trades: [pendingTrade(proposer, receiver, [offered.id], [keeper.id])],
    });
    mocks.caller.rpc.mockResolvedValue({ data: { success: true, status: 'REJECTED' }, error: null });

    const response = await runCycle();
    const result = await response.json();

    expect(result.action).toBe('REJECT');
    expect(mocks.caller.rpc).toHaveBeenCalledWith('v3_respond_trade', expect.objectContaining({
      p_trade_id: 'parent-trade',
      p_action: 'REJECT',
    }));
  });
});
