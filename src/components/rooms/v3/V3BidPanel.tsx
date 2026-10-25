import React, { useState } from 'react';
import { V3AuctionLot, V3Team } from '@/lib/v3-auction-types';
import { getNextMinimumBid } from '@/lib/auction/bid-increments';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

interface V3BidPanelProps {
  lot: V3AuctionLot;
  teams: V3Team[];
  myTeam: V3Team | null;
  auctionId: string;
  onBidSuccess?: () => void;
  timer?: React.ReactNode;
  responsive?: boolean;
}

export function V3BidPanel({ lot, teams, myTeam, auctionId, onBidSuccess, timer, responsive = false }: V3BidPanelProps) {
  const [isBidding, setIsBidding] = useState(false);

  const highestBidder = teams.find((t) => t.id === lot.highest_bidder_team_id);
  const isMyBid = myTeam?.id === lot.highest_bidder_team_id;

  // ---- Existing bid action — UNCHANGED ----
  const handleBid = async () => {
    if (!myTeam || isBidding) return;

    setIsBidding(true);
    try {
      const supabase = createClient();
      const requestId = crypto.randomUUID();

      const { data, error } = await supabase.rpc('v3_place_bid', {
        p_auction_id: auctionId,
        p_lot_id: lot.id,
        p_team_id: myTeam.id,
        p_request_id: requestId
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.error || 'Failed to place bid');
      }

      onBidSuccess?.();
    } catch (err: any) {
      console.error('Bid error:', err);
      alert(err.message || 'Failed to place bid');
    } finally {
      setIsBidding(false);
    }
  };
  // ---- END existing bid action ----

  // Determine Next Minimum Bid using the exact existing shared logic
  const nextBidLakhs = !lot.highest_bidder_team_id || lot.current_bid === 0 
    ? lot.base_price 
    : Math.round(getNextMinimumBid(lot.current_bid / 100) * 100);

  return (
    <div className={responsive ? 'flex h-full min-w-0 flex-col gap-3' : 'flex h-full flex-col gap-3'}>

      {/* One compact mobile status strip; the same timer and bid values remain in use. */}
      <div className={responsive ? 'sticky top-16 z-30 -mx-1 flex min-w-0 items-stretch gap-2 rounded-2xl border border-[#2A312D] bg-[#0B0F0D]/95 p-2 shadow-xl backdrop-blur sm:static sm:mx-0 sm:flex-col sm:gap-4 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0' : ''}>
        {responsive && timer}
        <div className={responsive ? 'flex min-w-0 flex-1 flex-col justify-center rounded-xl border border-[#2A312D] bg-[#0F1410] p-2.5 sm:flex-none sm:p-4' : 'rounded-xl border border-[#2A312D] bg-[#0F1410] p-4'}>
          <p className={responsive ? 'mb-1 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#9CA6A0] sm:mb-1.5 sm:text-[9px] sm:tracking-[0.2em]' : 'mb-1.5 text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-[#9CA6A0]'}>
          {lot.status === 'GET_READY' ? 'STARTING BID' : 'CURRENT BID'}
          </p>
          <div className={responsive ? 'whitespace-nowrap text-[clamp(1.25rem,6vw,2rem)] font-mono-numbers font-black leading-none tabular-nums text-[#E4B93F] sm:text-4xl lg:text-5xl' : 'text-4xl font-mono-numbers font-black leading-none tabular-nums text-[#E4B93F] sm:text-5xl'}>
            ₹{lot.current_bid.toLocaleString()}
            <span className={responsive ? 'ml-1 text-base text-[#E4B93F]/60 sm:text-xl' : 'ml-1 text-xl text-[#E4B93F]/60'}>L</span>
          </div>
        </div>
      </div>

      {/* LEADING TEAM */}
      <div className="bg-[#0F1410] border border-[#2A312D] rounded-xl p-4">
        <p className={responsive ? 'mb-1.5 text-xs font-mono font-bold uppercase tracking-[0.12em] text-[#9CA6A0] sm:text-[9px] sm:tracking-[0.2em]' : 'mb-1.5 text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-[#9CA6A0]'}>
          Leading Team
        </p>
        {highestBidder ? (
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isMyBid ? 'bg-[#10B981]' : 'bg-[#C9A227]'}`} />
            <span className={`font-display font-bold text-base uppercase truncate ${isMyBid ? 'text-[#10B981]' : 'text-[#F3F4F1]'}`}>
              {highestBidder.name}
            </span>
            {isMyBid && (
              <span className="px-1.5 py-0.5 rounded bg-[#10B981]/20 text-[#10B981] text-[9px] font-mono font-bold flex-shrink-0">
                YOU
              </span>
            )}
          </div>
        ) : (
          <span className="text-sm font-mono text-[#8B938E] italic">No bids yet</span>
        )}
      </div>

      {/* NEXT MINIMUM BID */}
      <div className={responsive ? 'flex items-center justify-between rounded-xl border border-[#2A312D]/50 bg-[#141917] p-3' : 'flex items-center justify-between rounded-xl border border-[#2A312D]/50 bg-[#141917] p-3'}>
        <span className={responsive ? 'text-xs font-mono font-bold uppercase tracking-[0.12em] text-[#9CA6A0] sm:text-[9px] sm:tracking-[0.2em]' : 'text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-[#9CA6A0]'}>
          Next Min Bid
        </span>
        <span className="font-mono-numbers font-bold text-lg text-[#F3F4F1]">
          ₹{nextBidLakhs.toLocaleString()}L
        </span>
      </div>

      {/* BID ACTION */}
      <div className={responsive ? 'fixed inset-x-0 bottom-0 z-40 border-t border-[#2A312D] bg-[#0B0F0D]/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-12px_30px_rgba(0,0,0,0.35)] backdrop-blur sm:static sm:mt-auto sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:pb-0 sm:shadow-none sm:backdrop-blur-0' : 'mt-auto'}>
        {myTeam ? (
          lot.status === 'BIDDING' ? (
            <button
              onClick={handleBid}
              disabled={isBidding || isMyBid}
              className={`${responsive ? 'mx-auto flex min-h-11 w-full max-w-7xl items-center justify-center gap-2 rounded-xl py-3.5 font-mono text-lg font-black uppercase tracking-wider shadow-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3F4F1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F0D] motion-reduce:transition-none sm:py-4' : 'flex w-full items-center justify-center gap-2 rounded-xl py-4 font-mono text-lg font-black uppercase tracking-wider shadow-lg transition-all duration-200'}
                ${isMyBid
                  ? 'bg-[#10B981]/20 border-2 border-[#10B981]/40 text-[#10B981] cursor-not-allowed'
                  : isBidding
                    ? 'bg-[#E4B93F]/50 border-2 border-[#E4B93F] text-white cursor-not-allowed'
                    : 'bg-[#E4B93F] hover:bg-[#C9A227] active:scale-[0.97] text-[#0B0F0D] border-2 border-[#E4B93F] hover:shadow-[0_0_20px_rgba(201,162,39,0.3)]'
                }`}
            >
              {isBidding ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>PLACING BID...</span>
                </>
              ) : isMyBid ? (
                <span>YOU ARE LEADING</span>
              ) : (
                <span>PLACE BID</span>
              )}
            </button>
          ) : lot.status === 'GET_READY' ? (
            <div className={responsive ? 'mx-auto flex min-h-11 w-full max-w-7xl items-center justify-center gap-2 rounded-xl border-2 border-[#2A312D] bg-[#1E2522] py-3.5 text-center font-mono text-base font-black uppercase tracking-wider text-[#9CA6A0] sm:py-4 sm:text-lg' : 'flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#2A312D] bg-[#1E2522] py-4 text-center font-mono text-lg font-black uppercase tracking-wider text-[#9CA6A0]'}>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>GET READY...</span>
            </div>
          ) : (
            <div className={responsive ? 'mx-auto flex min-h-11 w-full max-w-7xl items-center justify-center rounded-xl border border-dashed border-[#2A312D] bg-[#1E2522] py-3.5 text-center font-mono text-sm uppercase tracking-wider text-[#9CA6A0] sm:py-4' : 'w-full rounded-xl border-2 border-[#2A312D] bg-[#1E2522] py-4 text-center font-mono text-lg font-black uppercase tracking-wider text-[#9CA6A0]'}>
              AUCTION PAUSED
            </div>
          )
        ) : (
          <div className={responsive ? 'mx-auto flex min-h-11 w-full max-w-7xl items-center justify-center rounded-xl border border-dashed border-[#2A312D] bg-[#1E2522] py-3.5 text-center font-mono text-sm uppercase tracking-wider text-[#9CA6A0] sm:py-4' : 'w-full rounded-xl border border-dashed border-[#2A312D] bg-[#1E2522] py-4 text-center font-mono text-sm uppercase tracking-wider text-[#9CA6A0]'}>
            Viewing as observer
          </div>
        )}
      </div>
    </div>
  );
}
