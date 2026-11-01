import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@clerk/nextjs';
import * as clientModule from '@/lib/supabase/client';
import { useV3AuctionState } from '@/hooks/useV3AuctionState';

vi.mock('@clerk/nextjs', () => ({ useAuth: vi.fn() }));

const auction = {
  id: 'auction-1',
  room_id: 'room-1',
  status: 'IN_PROGRESS',
  current_lot_id: 'lot-2',
  current_lot_index: 2,
  is_unsold_round: false,
  created_at: '2026-10-25T10:00:00.000Z',
};

const currentLot = {
  id: 'lot-2',
  auction_id: 'auction-1',
  player_id: 'player-2',
  lot_index: 2,
  status: 'BIDDING',
  base_price: 200,
  current_bid: 250,
  highest_bidder_team_id: 'team-1',
  winning_team_id: null,
  winning_bid: null,
  get_ready_expires_at: null,
  timer_expires_at: '2026-10-25T10:01:00.000Z',
  is_mini_round: false,
};

const olderLot = {
  ...currentLot,
  id: 'lot-1',
  player_id: 'player-1',
  lot_index: 1,
  status: 'SOLD',
  winning_team_id: 'team-2',
  winning_bid: 300,
};

const player = (id: string) => ({
  id,
  name: `Player ${id}`,
  role: 'BATSMAN',
  base_price: 200,
  is_overseas: false,
});

function queryResult(table: string, filters: Record<string, unknown>) {
  if (table === 'auctions') return { data: [auction], error: null };
  if (table === 'teams') return { data: [], error: null };
  if (table === 'auction_lots') {
    const lot = filters.id === currentLot.id ? currentLot : olderLot;
    return { data: lot, error: null };
  }
  if (table === 'players') return { data: player(String(filters.id)), error: null };
  if (table === 'mini_auction_sessions') return { data: null, error: null };
  return { data: null, error: null };
}

function makeQuery(table: string) {
  const filters: Record<string, unknown> = {};
  const result = {
    select: vi.fn(() => result),
    eq: vi.fn((column: string, value: unknown) => {
      filters[column] = value;
      return result;
    }),
    order: vi.fn(() => result),
    single: vi.fn(async () => queryResult(table, filters)),
    maybeSingle: vi.fn(async () => queryResult(table, filters)),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(queryResult(table, filters)).then(resolve, reject),
  };
  return result;
}

describe('useV3AuctionState Realtime reconciliation', () => {
  let lotUpdateHandler: ((payload: { new: typeof olderLot }) => void) | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    lotUpdateHandler = undefined;
    vi.mocked(useAuth).mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue('test-token'),
    } as any);

    const channel = {
      on: vi.fn((event: string, filter: { table?: string }, callback: (payload: any) => void) => {
        if (event === 'postgres_changes' && filter.table === 'auction_lots') lotUpdateHandler = callback;
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      from: vi.fn((table: string) => makeQuery(table)),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    };
    vi.spyOn(clientModule, 'createClient').mockReturnValue(supabase as any);
  });

  it('ignores a delayed terminal event for a previous lot', async () => {
    const { result, unmount } = renderHook(() => useV3AuctionState('room-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.state.currentLot?.id).toBe('lot-2');
    expect(lotUpdateHandler).toBeTypeOf('function');

    act(() => lotUpdateHandler!({ new: olderLot }));

    expect(result.current.state.currentLot?.id).toBe('lot-2');
    expect(result.current.state.currentLot?.status).toBe('BIDDING');
    unmount();
  });
});
