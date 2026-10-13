// src/hooks/useV3MiniSelections.ts
// Authoritative Hook for Mini Auction Selection Micro-State (Phase 16C)

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { V3MiniSelection, V3MiniTeamStatus } from '@/lib/v3-auction-types';

export interface UseV3MiniSelectionsProps {
  auctionId: string | null;
  myTeamId?: string | null;
}

export function useV3MiniSelections({ auctionId, myTeamId }: UseV3MiniSelectionsProps) {
  const [selections, setSelections] = useState<V3MiniSelection[]>([]);
  const [teamStatuses, setTeamStatuses] = useState<V3MiniTeamStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-player toggle mutation pending state (prevents concurrent toggles on same player)
  const [pendingPlayerIds, setPendingPlayerIds] = useState<Set<string>>(new Set());

  // Team confirmation pending state
  const [isConfirming, setIsConfirming] = useState(false);

  const supabase = useMemo(() => createClient(), []);
  const mountedRef = useRef(true);

  // Initial Fetch: Query both mini_auction_selections and mini_auction_team_status
  const fetchSelectionsData = useCallback(async () => {
    if (!auctionId) return;
    try {
      setError(null);

      const [selRes, statusRes] = await Promise.all([
        supabase
          .from('mini_auction_selections')
          .select('id, auction_id, team_id, player_id, created_at')
          .eq('auction_id', auctionId),
        supabase
          .from('mini_auction_team_status')
          .select('id, auction_id, team_id, has_confirmed, confirmed_at, created_at, updated_at')
          .eq('auction_id', auctionId)
      ]);

      if (selRes.error) throw selRes.error;
      if (statusRes.error) throw statusRes.error;

      if (mountedRef.current) {
        setSelections(selRes.data || []);
        setTeamStatuses(statusRes.data || []);
      }
    } catch (err: any) {
      console.error('Error fetching mini selections state:', err);
      if (mountedRef.current) {
        setError(err.message || 'Failed to fetch mini selections');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [auctionId, supabase]);

  // Initial mount trigger
  useEffect(() => {
    mountedRef.current = true;
    if (auctionId) {
      fetchSelectionsData();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [auctionId, fetchSelectionsData]);

  // Dedicated Selection Realtime Channel
  useEffect(() => {
    if (!auctionId) return;

    const channelName = `mini_selections_${auctionId}`;
    const channel = supabase.channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mini_auction_selections',
        filter: `auction_id=eq.${auctionId}`
      }, (payload) => {
        if (!mountedRef.current) return;
        const { eventType, new: newRow, old: oldRow } = payload;

        setSelections(prev => {
          if (eventType === 'INSERT') {
            const exists = prev.some(s => s.id === (newRow as V3MiniSelection).id);
            if (exists) return prev;
            return [...prev, newRow as V3MiniSelection];
          }
          if (eventType === 'DELETE') {
            return prev.filter(s => s.id !== (oldRow as any).id);
          }
          if (eventType === 'UPDATE') {
            return prev.map(s => s.id === (newRow as V3MiniSelection).id ? (newRow as V3MiniSelection) : s);
          }
          return prev;
        });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mini_auction_team_status',
        filter: `auction_id=eq.${auctionId}`
      }, (payload) => {
        if (!mountedRef.current) return;
        const { eventType, new: newRow, old: oldRow } = payload;

        setTeamStatuses(prev => {
          if (eventType === 'INSERT') {
            const exists = prev.some(ts => ts.id === (newRow as V3MiniTeamStatus).id);
            if (exists) return prev;
            return [...prev, newRow as V3MiniTeamStatus];
          }
          if (eventType === 'DELETE') {
            return prev.filter(ts => ts.id !== (oldRow as any).id);
          }
          if (eventType === 'UPDATE') {
            return prev.map(ts => ts.id === (newRow as V3MiniTeamStatus).id ? (newRow as V3MiniTeamStatus) : ts);
          }
          return prev;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [auctionId, supabase]);

  // Desired-state toggle RPC caller
  const toggleSelection = useCallback(async (playerId: string, desiredState: boolean): Promise<boolean> => {
    if (!auctionId) {
      setError('No active auction ID');
      return false;
    }

    // Set player pending
    setPendingPlayerIds(prev => new Set(prev).add(playerId));
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('v3_toggle_mini_selection', {
        p_auction_id: auctionId,
        p_player_id: playerId,
        p_desired_state: desiredState
      });

      if (rpcError) throw rpcError;
      if (data && !data.success) {
        throw new Error(data.error || 'Failed to toggle selection');
      }

      // Realtime subscription will propagate the server truth, but we also reconcile locally on success
      if (data.selected === false) {
        setSelections(prev => prev.filter(s => !(s.player_id === playerId && s.team_id === myTeamId)));
      } else if (data.selected === true) {
        setSelections(prev => {
          if (prev.some(s => s.player_id === playerId && s.team_id === myTeamId)) return prev;
          return [...prev, {
            id: 'temp-' + Date.now(),
            auction_id: auctionId!,
            team_id: myTeamId!,
            player_id: playerId,
            created_at: new Date().toISOString()
          }];
        });
      }

      return true;
    } catch (err: any) {
      console.error('Toggle selection error:', err);
      if (mountedRef.current) {
        setError(err.message || 'Toggle selection failed');
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setPendingPlayerIds(prev => {
          const next = new Set(prev);
          next.delete(playerId);
          return next;
        });
      }
    }
  }, [auctionId, myTeamId, supabase]);

  // Team confirmation RPC caller
  const confirmSelections = useCallback(async (): Promise<boolean> => {
    if (!auctionId) {
      setError('No active auction ID');
      return false;
    }

    setIsConfirming(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('v3_confirm_mini_selections', {
        p_auction_id: auctionId
      });

      if (rpcError) throw rpcError;
      if (data && !data.success) {
        throw new Error(data.error || 'Failed to confirm selections');
      }

      // Reconcile status
      if (mountedRef.current && myTeamId) {
        setTeamStatuses(prev => {
          const existing = prev.find(ts => ts.team_id === myTeamId);
          if (existing) {
            return prev.map(ts => ts.team_id === myTeamId ? { ...ts, has_confirmed: true } : ts);
          }
          return [
            ...prev,
            {
              id: 'temp-' + Date.now(),
              auction_id: auctionId,
              team_id: myTeamId,
              has_confirmed: true,
              confirmed_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          ];
        });
      }

      return true;
    } catch (err: any) {
      console.error('Confirm selections error:', err);
      if (mountedRef.current) {
        setError(err.message || 'Confirmation failed');
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setIsConfirming(false);
      }
    }
  }, [auctionId, myTeamId, supabase]);

  // Derived state
  const isConfirmed = useMemo(() => {
    if (!myTeamId) return false;
    const status = teamStatuses.find(ts => ts.team_id === myTeamId);
    return Boolean(status?.has_confirmed);
  }, [teamStatuses, myTeamId]);

  const mySelectedPlayerIds = useMemo(() => {
    if (!myTeamId) return new Set<string>();
    return new Set(selections.filter(s => s.team_id === myTeamId).map(s => s.player_id));
  }, [selections, myTeamId]);

  const mySelections = useMemo(() => {
    if (!myTeamId) return [];
    return selections.filter(s => s.team_id === myTeamId);
  }, [selections, myTeamId]);

  return {
    selections,
    teamStatuses,
    loading,
    error,
    pendingPlayerIds,
    isConfirming,
    isConfirmed,
    mySelectedPlayerIds,
    mySelections,
    toggleSelection,
    confirmSelections,
    refresh: fetchSelectionsData
  };
}
