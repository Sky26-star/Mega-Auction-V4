'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useV3Stats } from '@/hooks/useV3Stats';
import { useV3AuctionContext } from '@/components/rooms/v3/V3AuctionStateProvider';
import { ArrowLeft } from 'lucide-react';
import { StatsHero } from '@/components/rooms/v3/stats/StatsHero';
import { AuctionOverview } from '@/components/rooms/v3/stats/AuctionOverview';
import { LeagueComparison } from '@/components/rooms/v3/stats/LeagueComparison';
import { AuctionHighlights } from '@/components/rooms/v3/stats/AuctionHighlights';
import { MostExpensiveAcquisitions } from '@/components/rooms/v3/stats/MostExpensiveAcquisitions';
import { Navbar } from '@/components/layout/navbar';

export default function StatsPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;

  const { state, loading: stateLoading, error: stateError } = useV3AuctionContext();
  const auctionId = state.auction?.id || null;
  const { stats, loading: statsLoading, error: statsError } = useV3Stats(auctionId);

  const loading = stateLoading || statsLoading;
  const error = stateError || statsError;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0D0B] text-[#F3F4F1] font-sans flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-8 h-8 border-2 border-[#C9A227] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-mono font-bold text-[#C9A227] uppercase tracking-widest animate-pulse">
              Aggregating Intelligence...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="min-h-screen bg-[#0A0D0B] text-[#F3F4F1] font-sans flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#141917] border border-red-500/20 p-8 rounded-2xl text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-red-500 text-2xl">!</span>
            </div>
            <h3 className="text-xl font-display font-black uppercase text-[#F3F4F1] mb-2">Error Loading Stats</h3>
            <p className="text-[#9CA6A0] text-sm mb-6">{error || (!state.auction ? 'Auction not found' : 'Unknown error occurred')}</p>
            <button
              onClick={() => router.push(`/rooms/${roomId}`)}
              className="px-6 py-2 bg-[#141917] border border-[#2A312D] text-[#F3F4F1] rounded-xl hover:bg-[#1E2522] transition-colors text-sm font-mono"
            >
              Return to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0D0B] text-[#F3F4F1] font-sans flex flex-col">
      <Navbar />

      <main className="flex-1 overflow-y-auto">
        <div className="relative">
          <div className="absolute top-6 left-4 sm:left-6 lg:left-8 z-20">
            <button
              onClick={() => router.push(`/rooms/${roomId}/auction`)}
              className="group flex items-center space-x-2 text-xs font-mono text-[#9CA6A0] hover:text-[#C9A227] transition-colors bg-[#0A0D0B]/50 px-3 py-1.5 rounded-lg border border-transparent hover:border-[#2A312D]"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              <span>RETURN TO AUCTION</span>
            </button>
          </div>
          <StatsHero />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
          <AuctionOverview stats={stats} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 lg:gap-12">
            <LeagueComparison teams={stats.teamsSummary} />
            <div className="flex flex-col">
              <AuctionHighlights stats={stats} />
              <MostExpensiveAcquisitions lots={stats.mostExpensive} teams={stats.teamsSummary} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
