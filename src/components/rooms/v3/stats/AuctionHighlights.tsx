import React from 'react';
import { V3StatsData, V3StatsLot } from '@/hooks/useV3Stats';
import { V3Team } from '@/lib/v3-auction-types';

interface AuctionHighlightsProps {
  stats: V3StatsData;
}

export function AuctionHighlights({ stats }: AuctionHighlightsProps) {
  const getTeamName = (teamId: string | null) => {
    if (!teamId) return 'Unknown';
    const team = stats.teamsSummary.find(t => t.id === teamId);
    return team?.name || 'Unknown';
  };

  return (
    <div className="mb-16 animate-in slide-in-from-bottom-4 fade-in duration-700 delay-500 fill-mode-both">
      <h2 className="text-sm font-mono font-bold text-[#C9A227] uppercase tracking-widest mb-6 border-b border-[#2A312D] pb-3">
        Auction Highlights
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        <HighlightCard
          title="Fiercest Battle"
          lot={stats.mostBidsLot}
          metric={`${stats.mostBidsLot?.bid_count || 0} Bids`}
          teamName={getTeamName(stats.mostBidsLot?.winning_team_id || null)}
        />
        <HighlightCard
          title="Longest Standoff"
          lot={stats.longestBattleLot}
          metric={`${stats.longestBattleLot?.battle_duration_seconds.toFixed(0) || 0} Seconds`}
          teamName={getTeamName(stats.longestBattleLot?.winning_team_id || null)}
        />
        <HighlightCard
          title="Biggest Price Jump"
          lot={stats.biggestPriceJumpLot}
          metric={`₹${stats.biggestPriceJumpLot?.max_increment.toFixed(2) || 0} Cr Jump`}
          teamName={getTeamName(stats.biggestPriceJumpLot?.winning_team_id || null)}
        />
      </div>
    </div>
  );
}

function HighlightCard({ title, lot, metric, teamName }: { title: string, lot: V3StatsLot | null, metric: string, teamName: string }) {
  if (!lot) {
    return (
      <div className="p-6 rounded-2xl border border-[#2A312D] bg-[#141917] opacity-50">
        <p className="text-[10px] sm:text-xs font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-3">
          {title}
        </p>
        <p className="text-[#F3F4F1] font-mono text-sm">Not enough data</p>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-2xl border border-[#2A312D] bg-[#141917] hover:border-[#C9A227]/30 transition-colors group">
      <p className="text-[10px] sm:text-xs font-mono font-bold text-[#C9A227] uppercase tracking-widest mb-3">
        {title}
      </p>
      <div className="mb-4">
        <h3 className="text-xl sm:text-2xl font-black font-display text-[#F3F4F1] uppercase tracking-tight mb-1 group-hover:text-[#E4B93F] transition-colors">
          {lot.player.name}
        </h3>
        <p className="text-xs font-mono font-bold text-[#9CA6A0] uppercase tracking-widest">
          {lot.player.role} • {lot.player.is_overseas ? lot.player.country : 'INDIA'}
        </p>
      </div>
      <div className="flex justify-between items-end">
        <div>
          <p className="text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">Winning Bid</p>
          <p className="font-mono-numbers font-black text-lg text-[#F3F4F1]">
            ₹{lot.winning_bid?.toFixed(2)} <span className="text-xs text-[#9CA6A0]">Cr</span>
          </p>
        </div>
        <div className="text-right">
           <p className="text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">{teamName}</p>
           <p className="font-mono-numbers font-black text-[#C9A227]">
            {metric}
           </p>
        </div>
      </div>
    </div>
  );
}
