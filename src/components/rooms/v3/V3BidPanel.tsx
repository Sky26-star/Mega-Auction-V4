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
}

export function V3BidPanel({ lot, teams, myTeam, auctionId, onBidSuccess }: V3BidPanelProps) {
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
    <div className="flex flex-col gap-3 h-full">

      {/* CURRENT BID */}
      <div className="bg-[#0F1410] border border-[#2A312D] rounded-xl p-4">
        <p className="text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-[0.2em] mb-1.5">
          {lot.status === 'GET_READY' ? 'STARTING BID' : 'CURRENT BID'}
        </p>
        <div className="text-4xl sm:text-5xl font-mono-numbers font-black text-[#E4B93F] leading-none tabular-nums">
          ₹{lot.current_bid.toLocaleString()}
          <span className="text-xl text-[#E4B93F]/60 ml-1">L</span>
        </div>
      </div>

      {/* LEADING TEAM */}
      <div className="bg-[#0F1410] border border-[#2A312D] rounded-xl p-4">
        <p className="text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-[0.2em] mb-1.5">
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
      <div className="bg-[#141917] border border-[#2A312D]/50 rounded-xl p-3 flex justify-between items-center">
        <span className="text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-[0.2em]">
          Next Min Bid
        </span>
        <span className="font-mono-numbers font-bold text-lg text-[#F3F4F1]">
          ₹{nextBidLakhs.toLocaleString()}L
        </span>
      </div>

      {/* BID ACTION */}
      <div className="mt-auto">
        {myTeam ? (
          lot.status === 'BIDDING' ? (
            <button
              onClick={handleBid}
              disabled={isBidding || isMyBid}
              className={`w-full py-4 rounded-xl font-mono font-black text-lg uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-lg
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
            <div className="w-full py-4 rounded-xl font-mono font-black text-lg uppercase tracking-wider bg-[#1E2522] text-[#9CA6A0] border-2 border-[#2A312D] text-center flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>GET READY...</span>
            </div>
          ) : (
            <div className="w-full py-4 rounded-xl font-mono font-black text-lg uppercase tracking-wider bg-[#1E2522] text-[#9CA6A0] border-2 border-[#2A312D] text-center">
              AUCTION PAUSED
            </div>
          )
        ) : (
          <div className="w-full py-4 rounded-xl font-mono text-sm uppercase tracking-wider bg-[#1E2522] text-[#9CA6A0] border border-dashed border-[#2A312D] text-center">
            Viewing as observer
          </div>
        )}
      </div>
    </div>
  );
}
