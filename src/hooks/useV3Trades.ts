// src/hooks/useV3Trades.ts
// Realtime Hook for Player-to-Player Trade Management

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';
import type {
  TradeRecord,
  TradeProposalInput,
  TradeFairnessResult,
} from '@/lib/trade/trade-types';

export function useV3Trades(auctionId: string | null, currentTeamId?: string | null) {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(auctionId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const mountedRef = useRef(true);
  const fetchSeqRef = useRef(0);

  const fetchTrades = useCallback(async () => {
    if (!auctionId) {
      setTrades([]);
      setLoading(false);
      setError(null);
      return;
    }

    const seq = ++fetchSeqRef.current;
    try {
      setLoading(true);
      setError(null);

      // Fetch trades for this auction
      const { data: tradeRows, error: tradeErr } = await supabase
        .from('trades')
        .select('*')
        .eq('auction_id', auctionId)
        .order('created_at', { ascending: false });

      if (seq !== fetchSeqRef.current) return;
      if (tradeErr) throw tradeErr;

      if (!tradeRows || tradeRows.length === 0) {
        if (mountedRef.current) {
          setTrades([]);
        }
        return;
      }

      // Gather distinct player IDs and team IDs to join rich metadata
      const allPlayerIds = new Set<string>();
      const allTeamIds = new Set<string>();

      tradeRows.forEach((t: any) => {
        allTeamIds.add(t.proposer_team_id);
        allTeamIds.add(t.receiver_team_id);
        (t.proposer_player_ids || []).forEach((id: string) => allPlayerIds.add(id));
        (t.receiver_player_ids || []).forEach((id: string) => allPlayerIds.add(id));
      });

      const [teamsRes, playersRes] = await Promise.all([
        supabase
          .from('teams')
          .select('*')
          .in('id', Array.from(allTeamIds)),
        supabase
          .from('players')
          .select('*')
          .in('id', Array.from(allPlayerIds)),
      ]);

      if (seq !== fetchSeqRef.current) return;

      const teamMap = new Map<string, V3Team>();
      (teamsRes.data || []).forEach((tm: any) => teamMap.set(tm.id, tm));

      const playerMap = new Map<string, V3Player>();
      (playersRes.data || []).forEach((pl: any) => playerMap.set(pl.id, pl));

      const enrichedTrades: TradeRecord[] = tradeRows.map((t: any) => ({
        ...t,
        proposer_team: teamMap.get(t.proposer_team_id),
        receiver_team: teamMap.get(t.receiver_team_id),
        proposer_players: (t.proposer_player_ids || [])
          .map((id: string) => playerMap.get(id))
          .filter(Boolean) as V3Player[],
        receiver_players: (t.receiver_player_ids || [])
          .map((id: string) => playerMap.get(id))
          .filter(Boolean) as V3Player[],
      }));

      if (mountedRef.current) {
        setTrades(enrichedTrades);
      }
    } catch (err: any) {
      if (seq !== fetchSeqRef.current) return;
      console.error('Error fetching trades:', err);
      if (mountedRef.current) {
        setError(err.message || 'Failed to fetch trades');
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
      fetchTrades();
    } else {
      fetchSeqRef.current += 1;
      setTrades([]);
      setLoading(false);
      setError(null);
    }
  }, [auctionId, fetchTrades]);

  // Realtime subscription on trades table
  useEffect(() => {
    if (!auctionId) return;

    let refreshTimeout: NodeJS.Timeout | null = null;
    const triggerRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        if (mountedRef.current) {
          fetchTrades();
        }
      }, 400);
    };

    const channel = supabase
      .channel(`v3_trades_${auctionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trades',
          filter: `auction_id=eq.${auctionId}`,
        },
        () => {
          triggerRefresh();
        }
      )
      .subscribe();

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      supabase.removeChannel(channel);
    };
  }, [auctionId, fetchTrades, supabase]);

  // Propose or Counter a trade
  const proposeTrade = useCallback(
    async (
      input: TradeProposalInput,
      fairnessScore?: TradeFairnessResult
    ): Promise<{ success: boolean; trade_id?: string; error?: string }> => {
      if (!auctionId || !currentTeamId) {
        return { success: false, error: 'Auction ID or Franchise not identified' };
      }

      setSubmitting(true);
      setError(null);

      try {
        const { data, error: rpcErr } = await supabase.rpc('v3_propose_trade', {
          p_auction_id: auctionId,
          p_proposer_team_id: currentTeamId,
          p_receiver_team_id: input.receiverTeamId,
          p_proposer_player_ids: input.proposerPlayerIds,
          p_receiver_player_ids: input.receiverPlayerIds,
          p_notes: input.notes || null,
          p_parent_trade_id: input.parentTradeId || null,
          p_fair_value: fairnessScore || {},
        });

        if (rpcErr) throw rpcErr;
        if (data && !data.success) {
          throw new Error(data.error || 'Failed to propose trade');
        }

        await fetchTrades();
        return { success: true, trade_id: data?.trade_id };
      } catch (err: any) {
        console.error('Error proposing trade:', err);
        const errMsg = err.message || 'Failed to submit proposal';
        setError(errMsg);
        return { success: false, error: errMsg };
      } finally {
        if (mountedRef.current) {
          setSubmitting(false);
        }
      }
    },
    [auctionId, currentTeamId, fetchTrades, supabase]
  );

  // Accept, Reject, or Cancel a trade
  const respondTrade = useCallback(
    async (
      tradeId: string,
      action: 'ACCEPT' | 'REJECT' | 'CANCEL',
      notes?: string
    ): Promise<{ success: boolean; error?: string }> => {
      setSubmitting(true);
      setError(null);

      try {
        const { data, error: rpcErr } = await supabase.rpc('v3_respond_trade', {
          p_trade_id: tradeId,
          p_action: action,
          p_notes: notes || null,
        });

        if (rpcErr) throw rpcErr;
        if (data && !data.success) {
          throw new Error(data.error || `Failed to ${action.toLowerCase()} trade`);
        }

        await fetchTrades();
        return { success: true };
      } catch (err: any) {
        console.error(`Error responding to trade (${action}):`, err);
        const errMsg = err.message || `Failed to ${action.toLowerCase()} trade`;
        setError(errMsg);
        return { success: false, error: errMsg };
      } finally {
        if (mountedRef.current) {
          setSubmitting(false);
        }
      }
    },
    [fetchTrades, supabase]
  );

  // Bot handler: triggers secure server-side bot evaluation & response
  const triggerBotResponse = useCallback(
    async (
      trade: TradeRecord,
      _botRoster?: V3Player[],
      _proposerRoster?: V3Player[]
    ): Promise<{ handled: boolean; decision?: string; reason?: string }> => {
      if (!trade.receiver_team?.is_bot || trade.status !== 'PENDING') {
        return { handled: false };
      }

      setSubmitting(true);
      try {
        const response = await fetch('/api/trade/bot-respond', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tradeId: trade.id }),
        });

        const data = await response.json();
        if (response.ok && data.success) {
          await fetchTrades();
          return {
            handled: true,
            decision: data.decision,
            reason: data.reason,
          };
        } else {
          console.error('Bot response error:', data.error);
          return { handled: false, reason: data.error };
        }
      } catch (err: any) {
        console.error('Failed to trigger bot response:', err);
        return { handled: false, reason: err.message };
      } finally {
        if (mountedRef.current) {
          setSubmitting(false);
        }
      }
    },
    [fetchTrades]
  );

  // Filtered views
  const activeTrades = useMemo(
    () => trades.filter(t => t.status === 'PENDING' || t.status === 'COUNTERED'),
    [trades]
  );

  const completedTrades = useMemo(
    () =>
      trades.filter(
        t =>
          t.status === 'ACCEPTED' ||
          t.status === 'REJECTED' ||
          t.status === 'CANCELLED' ||
          t.status === 'EXPIRED'
      ),
    [trades]
  );

  const receivedOffers = useMemo(
    () => activeTrades.filter(t => t.receiver_team_id === currentTeamId),
    [activeTrades, currentTeamId]
  );

  const sentOffers = useMemo(
    () => activeTrades.filter(t => t.proposer_team_id === currentTeamId),
    [activeTrades, currentTeamId]
  );

  return {
    trades,
    activeTrades,
    completedTrades,
    receivedOffers,
    sentOffers,
    loading,
    submitting,
    error,
    refresh: fetchTrades,
    proposeTrade,
    respondTrade,
    triggerBotResponse,
  };
}
