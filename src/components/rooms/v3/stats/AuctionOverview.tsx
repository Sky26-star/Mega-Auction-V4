import React from 'react';
import { V3StatsData } from '@/hooks/useV3Stats';

interface AuctionOverviewProps {
  stats: V3StatsData;
}

export function AuctionOverview({ stats }: AuctionOverviewProps) {
  return (
    <div className="mb-16 animate-in slide-in-from-bottom-4 fade-in duration-700 delay-150 fill-mode-both">
      <h2 className="text-sm font-mono font-bold text-[#C9A227] uppercase tracking-widest mb-6 border-b border-[#2A312D] pb-3">
        Auction Overview
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        <MetricCard label="Players Auctioned" value={stats.totalLotsAuctioned.toString()} />
        <MetricCard label="Sold" value={stats.totalSold.toString()} highlight />
        <MetricCard label="Unsold" value={stats.totalUnsold.toString()} />
        <MetricCard label="Capital Deployed" value={`₹${stats.capitalDeployed.toFixed(2)}`} subtext="Cr" highlight />
        <MetricCard label="Average Sold Price" value={`₹${stats.averageSoldPrice.toFixed(2)}`} subtext="Cr" />
        <MetricCard label="Highest Bid" value={`₹${(stats.highestBidLot?.winning_bid || 0).toFixed(2)}`} subtext="Cr" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, subtext, highlight = false }: { label: string, value: string, subtext?: string, highlight?: boolean }) {
  return (
    <div className={`p-6 rounded-2xl border ${highlight ? 'border-[#C9A227]/40 bg-[#181E1A] shadow-lg shadow-[#C9A227]/5' : 'border-[#2A312D] bg-[#141917]'} transition-all duration-500`}>
      <p className="text-[10px] sm:text-xs font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-3">
        {label}
      </p>
      <div className="flex items-baseline space-x-1">
        {/* We can use CSS to animate these numbers from 0 on first load in a full implementation, but for now we just show them directly to avoid continuous animation loop */}
        <span className={`text-2xl sm:text-4xl font-black font-display tracking-tight ${highlight ? 'text-[#C9A227]' : 'text-[#F3F4F1]'}`}>
          {value}
        </span>
        {subtext && (
          <span className="text-sm font-bold text-[#9CA6A0]">{subtext}</span>
        )}
      </div>
    </div>
  );
}
