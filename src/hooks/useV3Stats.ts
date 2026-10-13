import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { V3Player, V3Team } from '@/lib/v3-auction-types';

export interface V3StatsLot {
  lot_id: string;
  player: V3Player;
  winning_bid: number | null;
  winning_team_id: string | null;
  status: 'SOLD' | 'UNSOLD';
  bid_count: number;
  battle_duration_seconds: number;
  max_increment: number;
}

export interface V3StatsData {
  auctionId: string;
  totalLotsAuctioned: number;
  totalSold: number;
  totalUnsold: number;
  capitalDeployed: number;
  averageSoldPrice: number;
  highestBidLot: V3StatsLot | null;
  mostBidsLot: V3StatsLot | null;
  longestBattleLot: V3StatsLot | null;
  biggestPriceJumpLot: V3StatsLot | null;
  mostExpensive: V3StatsLot[];
  teamsSummary: V3Team[];
}

export function useV3Stats(auctionId: string | null) {
  const [stats, setStats] = useState<V3StatsData | null>(null);
  const [loading, setLoading] = useState(Boolean(auctionId));
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const mountedRef = useRef(true);
  const fetchSeqRef = useRef(0);

  const fetchStats = useCallback(async () => {
    if (!auctionId) {
      setStats(null);
      setLoading(false);
      setError(null);
      return;
    }
    const seq = ++fetchSeqRef.current;
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch lots (SOLD and UNSOLD)
      const { data: lotsData, error: lotsError } = await supabase
        .from('auction_lots')
        .select(`
          id,
          status,
          winning_bid,
          winning_team_id,
          player:players(*)
        `)
        .eq('auction_id', auctionId)
        .in('status', ['SOLD', 'UNSOLD']);

      if (seq !== fetchSeqRef.current) return;
      if (lotsError) throw lotsError;

      // 2. Fetch teams
      const { data: teamsData, error: teamsError } = await supabase
        .from('teams')
        .select('*')
        .eq('auction_id', auctionId);

      if (seq !== fetchSeqRef.current) return;
      if (teamsError) throw teamsError;

      // 3. Fetch valid bids
      const { data: bidsData, error: bidsError } = await supabase
        .from('bids')
        .select('lot_id, amount, created_at')
        .eq('auction_id', auctionId)
        .eq('is_valid', true)
        .order('created_at', { ascending: true });

      if (seq !== fetchSeqRef.current) return;
      if (bidsError) throw bidsError;

      if (!mountedRef.current) return;

      // Process Bids to calculate lot stats
      const lotBidStats = new Map<string, { count: number; firstBidAt: Date; lastBidAt: Date; maxIncrement: number; prevAmount: number }>();

      bidsData?.forEach((b: any) => {
        const lotId = b.lot_id;
        const currentAmount = b.amount;
        const createdAt = new Date(b.created_at);

        if (!lotBidStats.has(lotId)) {
          lotBidStats.set(lotId, { count: 1, firstBidAt: createdAt, lastBidAt: createdAt, maxIncrement: 0, prevAmount: currentAmount });
        } else {
          const stats = lotBidStats.get(lotId)!;
          stats.count += 1;
          stats.lastBidAt = createdAt;
          const increment = currentAmount - stats.prevAmount;
          if (increment > stats.maxIncrement) {
            stats.maxIncrement = increment;
          }
          stats.prevAmount = currentAmount;
        }
      });

      const processedLots: V3StatsLot[] = (lotsData || []).map((d: any) => {
        const bidStat = lotBidStats.get(d.id);
        let durationSeconds = 0;
        if (bidStat && bidStat.count > 1) {
          durationSeconds = (bidStat.lastBidAt.getTime() - bidStat.firstBidAt.getTime()) / 1000;
        }

        return {
          lot_id: d.id,
          player: Array.isArray(d.player) ? d.player[0] : d.player,
          winning_bid: d.winning_bid,
          winning_team_id: d.winning_team_id,
          status: d.status,
          bid_count: bidStat?.count || 0,
          battle_duration_seconds: durationSeconds,
          max_increment: bidStat?.maxIncrement || 0
        };
      });

      const soldLots = processedLots.filter(l => l.status === 'SOLD');
      const unsoldLots = processedLots.filter(l => l.status === 'UNSOLD');

      const totalLotsAuctioned = soldLots.length + unsoldLots.length;
      const capitalDeployed = soldLots.reduce((sum, l) => sum + (l.winning_bid || 0), 0);
      const averageSoldPrice = soldLots.length > 0 ? capitalDeployed / soldLots.length : 0;

      // Sorts
      const byPriceDesc = [...soldLots].sort((a, b) => (b.winning_bid || 0) - (a.winning_bid || 0));
      const byBidsDesc = [...soldLots].sort((a, b) => b.bid_count - a.bid_count);
      const byDurationDesc = [...soldLots].sort((a, b) => b.battle_duration_seconds - a.battle_duration_seconds);
      const byJumpDesc = [...soldLots].sort((a, b) => b.max_increment - a.max_increment);

      const highestBidLot = byPriceDesc.length > 0 ? byPriceDesc[0] || null : null;
      const mostBidsLot = byBidsDesc.length > 0 && (byBidsDesc[0]?.bid_count ?? 0) > 0 ? byBidsDesc[0] || null : null;
      const longestBattleLot = byDurationDesc.length > 0 && (byDurationDesc[0]?.battle_duration_seconds ?? 0) > 0 ? byDurationDesc[0] || null : null;
      const biggestPriceJumpLot = byJumpDesc.length > 0 && (byJumpDesc[0]?.max_increment ?? 0) > 0 ? byJumpDesc[0] || null : null;

      const mostExpensive = byPriceDesc.slice(0, 5);

      // Teams Summary
      const teamsSummary: V3Team[] = (teamsData || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        short_name: t.short_name,
        purse: t.purse,
        initial_purse: t.initial_purse,
        players_bought: t.players_bought,
        overseas_count: t.overseas_count,
        is_bot: t.is_bot
      })).sort((a, b) => {
        // Sort by capital deployed desc
        const aSpent = a.initial_purse - a.purse;
        const bSpent = b.initial_purse - b.purse;
        return bSpent - aSpent;
      });

      const statsData: V3StatsData = {
        auctionId,
        totalLotsAuctioned,
        totalSold: soldLots.length,
        totalUnsold: unsoldLots.length,
        capitalDeployed,
        averageSoldPrice,
        highestBidLot,
        mostBidsLot,
        longestBattleLot,
        biggestPriceJumpLot,
        mostExpensive,
        teamsSummary
      };

      if (seq !== fetchSeqRef.current) return;
      setStats(statsData);

    } catch (err: any) {
      if (seq !== fetchSeqRef.current) return;
      console.error('Error fetching stats data:', err);
      if (mountedRef.current) {
        setError(err.message || 'Failed to fetch stats data');
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
      fetchStats();
    } else {
      fetchSeqRef.current += 1;
      setStats(null);
      setLoading(false);
      setError(null);
    }
  }, [auctionId, fetchStats]);

  // Realtime Subscription
  useEffect(() => {
    if (!auctionId) return;

    let refreshTimeout: NodeJS.Timeout | null = null;
    const triggerRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        if (mountedRef.current) {
          fetchStats();
        }
      }, 2000); // 2s debounce to avoid thrashing during rapid consecutive bid updates or SOLD changes
    };

    // We can listen to auction_lots changing to SOLD or UNSOLD
    const channel = supabase.channel(`v3_stats_${auctionId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'auction_lots',
        filter: `auction_id=eq.${auctionId}`
      }, (payload) => {
        const updatedLot = payload.new;
        if (updatedLot.status === 'SOLD' || updatedLot.status === 'UNSOLD') {
          triggerRefresh();
        }
      })
      .subscribe();

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      supabase.removeChannel(channel);
    };
  }, [auctionId, fetchStats, supabase]);

  return { stats, loading, error, refresh: fetchStats };
}
