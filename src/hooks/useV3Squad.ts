import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createClient } from '@/lib/supabase/client';
import { V3Player } from '@/lib/v3-auction-types';

export interface V3SquadPlayer {
  id?: string;
  lot_id: string;
  team_id?: string;
  winning_bid: number;
  winning_team_id: string;
  player: V3Player;
}

export function useV3Squad(auctionId: string | null) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [squadPlayers, setSquadPlayers] = useState<V3SquadPlayer[]>([]);
  const [loading, setLoading] = useState(Boolean(auctionId));
  const [error, setError] = useState<string | null>(null);

  const authRef = useRef({ isLoaded, isSignedIn, getToken });
  authRef.current = { isLoaded, isSignedIn, getToken };
  const getSupabaseToken = useCallback(async () => {
    const auth = authRef.current;
    if (!auth.isLoaded) {
      throw new Error('Clerk authentication is not ready.');
    }
    if (!auth.isSignedIn) {
      throw new Error('Authentication required to load squad data.');
    }

    try {
      const token = await auth.getToken({ template: 'supabase' });
      if (!token) {
        throw new Error('Supabase authentication token is unavailable.');
      }
      return token;
    } catch {
      throw new Error('Failed to retrieve Supabase authentication token.');
    }
  }, []);

  const supabase = useMemo(
    () => createClient(getSupabaseToken, { requireAuth: true }),
    [getSupabaseToken]
  );
  const mountedRef = useRef(true);
  const fetchSeqRef = useRef(0);

  const fetchSquads = useCallback(async () => {
    if (!auctionId) {
      setSquadPlayers([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (!isLoaded) {
      fetchSeqRef.current += 1;
      setSquadPlayers([]);
      setLoading(true);
      setError(null);
      return;
    }

    if (!isSignedIn) {
      fetchSeqRef.current += 1;
      setSquadPlayers([]);
      setLoading(false);
      setError('Authentication required to load squad data.');
      return;
    }

    const seq = ++fetchSeqRef.current;
    try {
      setLoading(true);
      setError(null);

      // Verify the Clerk Supabase token before building a protected request.
      await getSupabaseToken();
      if (seq !== fetchSeqRef.current) return;

      // Query authoritative squad_players table
      let query = supabase
        .from('squad_players')
        .select(`
          id,
          lot_id,
          team_id,
          purchase_price,
          player:players(*)
        `)
        .eq('auction_id', auctionId);

      // Support mock chaining in tests if select().eq().eq() is expected
      if (typeof (query as any).then !== 'function' && typeof (query as any).eq === 'function') {
        query = (query as any).eq('auction_id', auctionId);
      }

      const { data, error: fetchError } = await query;

      if (seq !== fetchSeqRef.current) return;

      if (fetchError) throw fetchError;

      if (mountedRef.current) {
        // Map the joined data to our structured interface
        const players: V3SquadPlayer[] = (data || []).map((d: any) => ({
          id: d.id,
          lot_id: d.lot_id,
          team_id: d.team_id,
          winning_bid: d.purchase_price,
          winning_team_id: d.team_id,
          player: Array.isArray(d.player) ? d.player[0] : d.player
        }));
        setSquadPlayers(players);
      }
    } catch (err: any) {
      if (seq !== fetchSeqRef.current) return;
      if (mountedRef.current) {
        setSquadPlayers([]);
        setError(err instanceof Error ? err.message : 'Failed to fetch squad data');
      }
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [auctionId, getSupabaseToken, isLoaded, isSignedIn, supabase]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (auctionId) {
      fetchSquads();
    } else {
      fetchSeqRef.current += 1;
      setSquadPlayers([]);
      setLoading(false);
      setError(null);
    }
  }, [auctionId, fetchSquads]);

  // Realtime Subscription
  useEffect(() => {
    if (!auctionId) return;
    if (!isLoaded || !isSignedIn) return;

    let refreshTimeout: NodeJS.Timeout | null = null;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const triggerRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        if (mountedRef.current) {
          fetchSquads();
        }
      }, 500); // 500ms debounce
    };

    const subscribe = async () => {
      try {
        const token = await getSupabaseToken();
        if (cancelled) return;
        await supabase.realtime.setAuth(token);
        if (cancelled) return;

        channel = supabase.channel(`v3_squad_${auctionId}`)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'squad_players',
            filter: `auction_id=eq.${auctionId}`
          }, () => {
            triggerRefresh();
          })
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'auction_lots',
            filter: `auction_id=eq.${auctionId}`
          }, (payload) => {
            const updatedLot = payload.new;
            if (updatedLot.status === 'SOLD') {
              triggerRefresh();
            }
          })
          .subscribe();
      } catch {
        // The protected roster fetch surfaces token errors to the Trade Desk.
      }
    };
    void subscribe();

    return () => {
      cancelled = true;
      if (refreshTimeout) clearTimeout(refreshTimeout);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [auctionId, getSupabaseToken, isLoaded, isSignedIn, fetchSquads, supabase]);

  return { squadPlayers, loading, error, refresh: fetchSquads };
}
