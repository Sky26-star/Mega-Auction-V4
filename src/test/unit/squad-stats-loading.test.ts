import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuth } from '@clerk/nextjs';
import { useV3Squad } from '@/hooks/useV3Squad';
import { useV3Stats } from '@/hooks/useV3Stats';
import * as clientModule from '@/lib/supabase/client';

vi.mock('@clerk/nextjs', () => ({
  useAuth: vi.fn(),
}));

describe('Phase 3 Regression Tests: useV3Squad and useV3Stats Loading & Race Handling', () => {
  let mockChannel: any;
  let mockSupabase: any;
  let authState: { isLoaded: boolean; isSignedIn: boolean; getToken: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.restoreAllMocks();

    authState = {
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue('test-supabase-token'),
    };
    vi.mocked(useAuth).mockImplementation(() => authState as any);

    mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };

    mockSupabase = {
      from: vi.fn(),
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn(),
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    };

    vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // useV3Squad Tests
  // =========================================================================
  describe('useV3Squad', () => {
    it('Null auction ID: loading settles immediately to false without fetching', async () => {
      const { result } = renderHook(() => useV3Squad(null));

      expect(result.current.loading).toBe(false);
      expect(result.current.squadPlayers).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(mockSupabase.from).not.toHaveBeenCalled();
      expect(mockSupabase.channel).not.toHaveBeenCalled();
    });

    it('Clerk not loaded: waits without requesting protected squad data', async () => {
      authState.isLoaded = false;
      const { result, rerender } = renderHook(() => useV3Squad('auc-1'));

      expect(result.current.loading).toBe(true);
      expect(result.current.squadPlayers).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
      expect(mockSupabase.channel).not.toHaveBeenCalled();

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });
      authState = { ...authState, isLoaded: true };
      rerender();

      await waitFor(() => expect(mockSupabase.from).toHaveBeenCalledWith('squad_players'));
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('Signed out: does not request protected squad data', async () => {
      authState.isSignedIn = false;
      const { result } = renderHook(() => useV3Squad('auc-1'));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.squadPlayers).toEqual([]);
      expect(result.current.error).toMatch(/authentication required/i);
      expect(mockSupabase.from).not.toHaveBeenCalled();
      expect(mockSupabase.channel).not.toHaveBeenCalled();
    });

    it('Token retrieval failure: surfaces an auth error rather than an empty success', async () => {
      authState.getToken.mockRejectedValue(new Error('provider failure with sensitive details'));
      const { result } = renderHook(() => useV3Squad('auc-1'));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.squadPlayers).toEqual([]);
      expect(result.current.error).toMatch(/supabase authentication token/i);
      expect(result.current.error).not.toContain('sensitive details');
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('Waits for the Clerk token before starting the protected squad query', async () => {
      let resolveToken!: (token: string) => void;
      authState.getToken.mockReturnValue(new Promise((resolve) => {
        resolveToken = resolve;
      }));
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      renderHook(() => useV3Squad('auc-1'));

      await waitFor(() => expect(authState.getToken).toHaveBeenCalledWith({ template: 'supabase' }));
      expect(mockSupabase.from).not.toHaveBeenCalled();

      await act(async () => resolveToken('test-supabase-token'));
      await waitFor(() => expect(mockSupabase.from).toHaveBeenCalledWith('squad_players'));
    });

    it('Valid ID: successful fetch and loading transition', async () => {
      const mockLots = [
        {
          id: 'squad-player-1',
          lot_id: 'lot-1',
          team_id: 'team-1',
          purchase_price: 5000000,
          player: { id: 'p1', name: 'Virat Kohli', role: 'BATSMAN' },
        },
      ];

      const squadSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: mockLots, error: null }),
        }),
      });

      mockSupabase.from.mockReturnValue({
        select: squadSelect,
      });

      const { result } = renderHook(() => useV3Squad('auc-1'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.squadPlayers).toHaveLength(1);
      expect(result.current.squadPlayers[0]?.lot_id).toBe('lot-1');
      expect(result.current.squadPlayers[0]?.winning_bid).toBe(5000000);
      expect(result.current.squadPlayers[0]?.player.name).toBe('Virat Kohli');
      expect(squadSelect.mock.calls[0]?.[0]).toContain('purchase_price');
      expect(squadSelect.mock.calls[0]?.[0]).not.toMatch(/\bwinning_bid\b|\bwinning_team_id\b/);
      expect(result.current.error).toBeNull();
    });

    it('Empty results: loading settles to false and squadPlayers is empty array', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useV3Squad('auc-empty'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.squadPlayers).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(authState.getToken).toHaveBeenCalledWith({ template: 'supabase' });
    });

    it('Fetch errors: sets error state and settles loading to false', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: new Error('Database connection failed'),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useV3Squad('auc-err'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toContain('Database connection failed');
      expect(result.current.squadPlayers).toEqual([]);
    });

    it('Auction ID changes while previous request pending: stale response does not overwrite newer auction', async () => {
      let resolveFirst: (val: any) => void;
      const firstPromise = new Promise((res) => {
        resolveFirst = res;
      });

      const secondLots = [
        {
          id: 'squad-player-2',
          lot_id: 'lot-2',
          team_id: 'team-2',
          purchase_price: 7500000,
          player: { id: 'p2', name: 'Jasprit Bumrah', role: 'BOWLER' },
        },
      ];

      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((col: string, val: string) => ({
            eq: vi.fn().mockImplementation(() => {
              if (val === 'auc-slow') {
                return firstPromise;
              }
              return Promise.resolve({ data: secondLots, error: null });
            }),
          })),
        }),
      }));

      const { result, rerender } = renderHook(({ id }) => useV3Squad(id), {
        initialProps: { id: 'auc-slow' as string | null },
      });

      // Switch to auc-fast before auc-slow resolves
      act(() => {
        rerender({ id: 'auc-fast' });
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.squadPlayers).toHaveLength(1);
        expect(result.current.squadPlayers[0]?.lot_id).toBe('lot-2');
      });

      // Now resolve the slow, stale request
      await act(async () => {
        resolveFirst!({
          data: [
            {
              id: 'squad-player-stale',
              lot_id: 'lot-stale',
              team_id: 'team-stale',
              purchase_price: 1000000,
              player: { id: 'p-stale', name: 'Stale Player', role: 'BATSMAN' },
            },
          ],
          error: null,
        });
      });

      // Expect auc-fast data to remain untouched
      expect(result.current.squadPlayers).toHaveLength(1);
      expect(result.current.squadPlayers[0]?.lot_id).toBe('lot-2');
      expect(result.current.squadPlayers[0]?.player.name).toBe('Jasprit Bumrah');
    });

    it('ID changes to null: immediately resets squad data and settles loading without showing stale data', async () => {
      let resolveSlow: (val: any) => void;
      const slowPromise = new Promise((res) => {
        resolveSlow = res;
      });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => slowPromise),
          }),
        }),
      });

      const { result, rerender } = renderHook(({ id }) => useV3Squad(id), {
        initialProps: { id: 'auc-1' as string | null },
      });

      // Change ID to null while request is in flight
      act(() => {
        rerender({ id: null });
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.squadPlayers).toEqual([]);

      // Late resolution of old auction
      await act(async () => {
        resolveSlow!({
          data: [
            {
              id: 'squad-player-old',
              lot_id: 'lot-old',
              team_id: 'team-old',
              purchase_price: 2000000,
              player: { id: 'p-old', name: 'Old Player', role: 'BATSMAN' },
            },
          ],
          error: null,
        });
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.squadPlayers).toEqual([]);
    });

    it('Unmount safety: unmounting during active fetch does not throw or trigger errors', async () => {
      let resolveSlow: (val: any) => void;
      const slowPromise = new Promise((res) => {
        resolveSlow = res;
      });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => slowPromise),
          }),
        }),
      });

      const { unmount } = renderHook(() => useV3Squad('auc-unmount'));

      unmount();

      await act(async () => {
        resolveSlow!({ data: [], error: null });
      });

      // No unhandled rejection or state warning
      expect(true).toBe(true);
    });

    it('Realtime cleanup: removes channel subscription on unmount or auctionId change', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const { unmount } = renderHook(() => useV3Squad('auc-sub'));

      await waitFor(() => {
        expect(mockSupabase.channel).toHaveBeenCalledWith('v3_squad_auc-sub');
        expect(mockChannel.subscribe).toHaveBeenCalled();
      });

      unmount();

      expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
    });
  });

  // =========================================================================
  // useV3Stats Tests
  // =========================================================================
  describe('useV3Stats', () => {
    it('Null auction ID: loading settles immediately to false, stats is null without querying', async () => {
      const { result } = renderHook(() => useV3Stats(null));

      expect(result.current.loading).toBe(false);
      expect(result.current.stats).toBeNull();
      expect(result.current.error).toBeNull();
      expect(mockSupabase.from).not.toHaveBeenCalled();
      expect(mockSupabase.channel).not.toHaveBeenCalled();
    });

    it('Valid ID: successful fetch and stats computation with loading transition', async () => {
      const mockLots = [
        {
          id: 'lot-s1',
          status: 'SOLD',
          winning_bid: 10000000,
          winning_team_id: 't1',
          player: { id: 'p1', name: 'Player One', role: 'BATSMAN' },
        },
        {
          id: 'lot-u1',
          status: 'UNSOLD',
          winning_bid: null,
          winning_team_id: null,
          player: { id: 'p2', name: 'Player Two', role: 'BOWLER' },
        },
      ];

      const mockTeams = [
        {
          id: 't1',
          name: 'Team Alpha',
          short_name: 'TA',
          purse: 90000000,
          initial_purse: 100000000,
          players_bought: 1,
          overseas_count: 0,
          is_bot: false,
        },
      ];

      const mockBids = [
        {
          lot_id: 'lot-s1',
          amount: 2000000,
          created_at: new Date('2026-01-01T10:00:00Z').toISOString(),
        },
        {
          lot_id: 'lot-s1',
          amount: 10000000,
          created_at: new Date('2026-01-01T10:00:30Z').toISOString(),
        },
      ];

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'auction_lots') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: mockLots, error: null }),
              }),
            }),
          };
        }
        if (table === 'teams') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockTeams, error: null }),
            }),
          };
        }
        if (table === 'bids') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: mockBids, error: null }),
                }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const { result } = renderHook(() => useV3Stats('auc-stats-1'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.stats).not.toBeNull();
      expect(result.current.stats?.totalLotsAuctioned).toBe(2);
      expect(result.current.stats?.totalSold).toBe(1);
      expect(result.current.stats?.totalUnsold).toBe(1);
      expect(result.current.stats?.capitalDeployed).toBe(10000000);
      expect(result.current.stats?.averageSoldPrice).toBe(10000000);
      expect(result.current.stats?.highestBidLot?.lot_id).toBe('lot-s1');
      expect(result.current.stats?.teamsSummary).toHaveLength(1);
      expect(result.current.error).toBeNull();
    });

    it('Empty results: computes default empty stats and loading settles to false', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'auction_lots') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'teams') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        if (table === 'bids') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const { result } = renderHook(() => useV3Stats('auc-empty-stats'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.stats).not.toBeNull();
      expect(result.current.stats?.totalLotsAuctioned).toBe(0);
      expect(result.current.stats?.totalSold).toBe(0);
      expect(result.current.stats?.totalUnsold).toBe(0);
      expect(result.current.stats?.capitalDeployed).toBe(0);
      expect(result.current.stats?.averageSoldPrice).toBe(0);
      expect(result.current.stats?.highestBidLot).toBeNull();
      expect(result.current.stats?.teamsSummary).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('Fetch errors: query failure sets error message and settles loading', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: null,
              error: new Error('Failed to query lots table'),
            }),
          }),
        }),
      }));

      const { result } = renderHook(() => useV3Stats('auc-err-stats'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toContain('Failed to query lots table');
      expect(result.current.stats).toBeNull();
    });

    it('Auction ID changes while request pending: stale stats response is ignored', async () => {
      let resolveOldLots: (val: any) => void;
      const oldLotsPromise = new Promise((res) => {
        resolveOldLots = res;
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'auction_lots') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((_col: string, val: string) => ({
                in: vi.fn().mockImplementation(() => {
                  if (val === 'auc-old') {
                    return oldLotsPromise;
                  }
                  return Promise.resolve({
                    data: [
                      {
                        id: 'lot-new',
                        status: 'SOLD',
                        winning_bid: 3000000,
                        winning_team_id: 't-new',
                        player: { id: 'pn', name: 'New Player', role: 'BATSMAN' },
                      },
                    ],
                    error: null,
                  });
                }),
              })),
            }),
          };
        }
        if (table === 'teams') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        if (table === 'bids') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const { result, rerender } = renderHook(({ id }) => useV3Stats(id), {
        initialProps: { id: 'auc-old' as string | null },
      });

      // Switch to auc-new
      act(() => {
        rerender({ id: 'auc-new' });
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.stats?.auctionId).toBe('auc-new');
        expect(result.current.stats?.capitalDeployed).toBe(3000000);
      });

      // Now resolve the old slow query
      await act(async () => {
        resolveOldLots!({
          data: [
            {
              id: 'lot-stale',
              status: 'SOLD',
              winning_bid: 99000000,
              winning_team_id: 't-stale',
              player: { id: 'ps', name: 'Stale Player', role: 'BATSMAN' },
            },
          ],
          error: null,
        });
      });

      // Should still be auc-new
      expect(result.current.stats?.auctionId).toBe('auc-new');
      expect(result.current.stats?.capitalDeployed).toBe(3000000);
    });

    it('ID changes to null: resets stats to null and settles loading', async () => {
      let resolveSlow: (val: any) => void;
      const slowPromise = new Promise((res) => {
        resolveSlow = res;
      });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockImplementation(() => slowPromise),
          }),
        }),
      });

      const { result, rerender } = renderHook(({ id }) => useV3Stats(id), {
        initialProps: { id: 'auc-1' as string | null },
      });

      act(() => {
        rerender({ id: null });
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.stats).toBeNull();

      // Resolve stale
      await act(async () => {
        resolveSlow!({ data: [], error: null });
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.stats).toBeNull();
    });

    it('Unmount safety: unmounting during multi-step async queries does not throw', async () => {
      let resolveSlow: (val: any) => void;
      const slowPromise = new Promise((res) => {
        resolveSlow = res;
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'auction_lots') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockImplementation(() => slowPromise),
              }),
            }),
          };
        }
        if (table === 'teams') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        if (table === 'bids') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const { unmount } = renderHook(() => useV3Stats('auc-unmount-stats'));

      unmount();

      await act(async () => {
        resolveSlow!({ data: [], error: null });
      });

      expect(true).toBe(true);
    });

    it('Realtime cleanup: removes channel subscription on unmount', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }));

      const { unmount } = renderHook(() => useV3Stats('auc-sub-stats'));

      expect(mockSupabase.channel).toHaveBeenCalledWith('v3_stats_auc-sub-stats');
      expect(mockChannel.subscribe).toHaveBeenCalled();

      unmount();

      expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
    });
  });
});
