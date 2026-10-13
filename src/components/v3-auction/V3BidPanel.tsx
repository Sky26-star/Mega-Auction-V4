import React, { useState, useEffect } from 'react';
import { V3AuctionLot, V3Team } from '@/lib/v3-auction-types';
import { createClient } from '@/lib/supabase/client';
import { Loader2, AlertCircle } from 'lucide-react';

interface V3BidPanelProps {
  auctionId: string;
  lot: V3AuctionLot | null;
  teams: V3Team[];
  myTeamId?: string;
  isHost: boolean;
}

export function V3BidPanel({ auctionId, lot, teams, myTeamId, isHost }: V3BidPanelProps) {
  const [isBidding, setIsBidding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date().getTime());

  // Visual countdown timer
  useEffect(() => {
    if (!lot?.timer_expires_at) return;
    const interval = setInterval(() => {
      setNow(new Date().getTime());
    }, 100);
    return () => clearInterval(interval);
  }, [lot?.timer_expires_at]);

  if (!lot) return null;

  const highestBidder = lot.highest_bidder_team_id
    ? teams.find(t => t.id === lot.highest_bidder_team_id)
    : null;

  let remainingSeconds = 0;
  if (lot.timer_expires_at) {
    remainingSeconds = Math.max(0, Math.ceil((new Date(lot.timer_expires_at).getTime() - now) / 1000));
  }

  const handleBid = async () => {
    if (!myTeamId) return;
    setIsBidding(true);
    setError(null);
    try {
      const supabase = createClient();
      const requestId = crypto.randomUUID();
      const { data, error: rpcError } = await supabase.rpc('v3_place_bid', {
        p_auction_id: auctionId,
        p_lot_id: lot.id,
        p_team_id: myTeamId,
        p_request_id: requestId,
        p_is_bot: false
      });

      if (rpcError) throw rpcError;
      if (data && !data.success) {
        setError(data.error || 'Bid failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to place bid');
    } finally {
      setIsBidding(false);
    }
  };

  const isHighestBidder = lot.highest_bidder_team_id === myTeamId;
  const canBid = lot.status === 'BIDDING' && !!myTeamId && !isHighestBidder && remainingSeconds > 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">

      {/* Current Bid Display */}
      <div className="text-center mb-8">
        <p className="text-slate-400 font-semibold uppercase tracking-widest text-sm mb-2">Current Bid</p>
        <h3 className="text-6xl font-black text-white tabular-nums tracking-tight">
          ₹{lot.current_bid.toLocaleString()}L
        </h3>

        <div className="mt-4 h-8 flex items-center justify-center">
          {highestBidder ? (
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-slate-800 rounded-full border border-slate-700">
              <span className="text-slate-400 text-sm">Bidder:</span>
              <span className="text-white font-bold">{highestBidder.name}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-slate-800/50 rounded-full border border-slate-800">
              <span className="text-slate-500 text-sm italic">Awaiting opening bid...</span>
            </div>
          )}
        </div>
      </div>

      {/* Visual Timer */}
      {lot.status === 'BIDDING' && lot.timer_expires_at && (
        <div className="mb-8">
          <div className="flex justify-between items-end mb-2">
            <span className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Time Remaining</span>
            <span className={`text-3xl font-black tabular-nums ${remainingSeconds <= 5 ? 'text-red-500 animate-pulse' : 'text-blue-400'}`}>
              {remainingSeconds}s
            </span>
          </div>
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-100 ease-linear ${remainingSeconds <= 5 ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(100, (remainingSeconds / 15) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}

      {/* Action Area */}
      {lot.status === 'BIDDING' && (
        <div className="mt-4">
          <button
            onClick={handleBid}
            disabled={!canBid || isBidding}
            className={`w-full py-5 rounded-xl font-black text-xl tracking-wider uppercase transition-all
              ${isHighestBidder
                ? 'bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 cursor-not-allowed'
                : !canBid
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-900/50 hover:shadow-blue-900/80 active:scale-[0.98]'
              }
            `}
          >
            {isBidding ? (
              <span className="flex items-center justify-center gap-2"><Loader2 className="w-6 h-6 animate-spin" /> BIDDING...</span>
            ) : isHighestBidder ? (
              'Highest Bidder'
            ) : myTeamId ? (
              'Place Bid'
            ) : (
              'Spectating'
            )}
          </button>
        </div>
      )}

      {lot.status === 'GET_READY' && (
        <div className="text-center p-6 bg-slate-800/50 rounded-xl border border-slate-700/50">
          <p className="text-slate-300 font-medium animate-pulse">Get ready to bid...</p>
        </div>
      )}
    </div>
  );
}
