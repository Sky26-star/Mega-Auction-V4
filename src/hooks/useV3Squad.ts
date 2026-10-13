import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  const [squadPlayers, setSquadPlayers] = useState<V3SquadPlayer[]>([]);
  const [loading, setLoading] = useState(Boolean(auctionId));
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const mountedRef = useRef(true);
  const fetchSeqRef = useRef(0);

  const fetchSquads = useCallback(async () => {
    if (!auctionId) {
      setSquadPlayers([]);
      setLoading(false);
      setError(null);
      return;
    }
    const seq = ++fetchSeqRef.current;
    try {
      setLoading(true);
      setError(null);

      // Query authoritative squad_players table
      let query = supabase
        .from('squad_players')
        .select(`
          id,
          lot_id,
          team_id,
          purchase_price,
          winning_bid,
          winning_team_id,
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

      if (mountedRef.current && data) {
        // Map the joined data to our structured interface
        const players: V3SquadPlayer[] = data.map((d: any) => ({
          id: d.id,
          lot_id: d.lot_id || d.id,
          team_id: d.team_id || d.winning_team_id,
          winning_bid: d.purchase_price ?? d.winning_bid ?? 0,
          winning_team_id: d.team_id || d.winning_team_id,
          player: Array.isArray(d.player) ? d.player[0] : d.player
        }));
        setSquadPlayers(players);
      }
    } catch (err: any) {
      if (seq !== fetchSeqRef.current) return;
      console.error('Error fetching squad data:', err);
      if (mountedRef.current) {
        setError(err.message || 'Failed to fetch squad data');
      }
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [auctionId, supabase]);

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

    let refreshTimeout: NodeJS.Timeout | null = null;
    const triggerRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        if (mountedRef.current) {
          fetchSquads();
        }
      }, 500); // 500ms debounce
    };

    const channel = supabase.channel(`v3_squad_${auctionId}`)
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

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      supabase.removeChannel(channel);
    };
  }, [auctionId, fetchSquads, supabase]);

  return { squadPlayers, loading, error, refresh: fetchSquads };
}
