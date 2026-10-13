'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useV3AuctionContext } from '@/components/rooms/v3/V3AuctionStateProvider';
import { useV3Squad } from '@/hooks/useV3Squad';
import { SquadMetrics } from '@/components/rooms/v3/SquadMetrics';
import { SquadRoleSection } from '@/components/rooms/v3/SquadRoleSection';
import { Navbar } from '@/components/layout/navbar';
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';

export default function SquadManagementPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;

  const { state, loading: stateLoading, error: stateError } = useV3AuctionContext();
  const auctionId = state.auction?.id || null;
  const { squadPlayers, loading: squadLoading, error: squadError } = useV3Squad(auctionId);

  const [selectedTeamIndex, setSelectedTeamIndex] = useState(0);

  const loading = stateLoading || squadLoading;
  const error = stateError || squadError;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col items-center justify-center p-12 space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#C9A227]" />
        <p className="text-sm font-mono-numbers text-[#9CA6A0] uppercase tracking-widest">
          LOADING FRANCHISE DATA...
        </p>
      </div>
    );
  }

  if (error || !state.auction) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#B8322E]/10 border-2 border-[#B8322E]/40 p-6 rounded-2xl flex flex-col items-center text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-[#B8322E]" />
          <div>
            <h2 className="text-xl font-bold text-[#F3F4F1] mb-2 uppercase">Command Center Error</h2>
            <p className="text-[#B8322E] font-mono text-sm">{error || 'Auction not found'}</p>
          </div>
          <button
            onClick={() => router.push(`/rooms/${roomId}`)}
            className="px-6 py-2 bg-[#141917] border border-[#2A312D] text-[#F3F4F1] rounded-xl hover:bg-[#1E2522] transition-colors"
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  const teams = state.teams || [];

  if (teams.length === 0) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <p className="text-[#9CA6A0] font-mono uppercase tracking-widest mb-4">No franchises found in this auction.</p>
          <button
            onClick={() => router.push(`/rooms/${roomId}/auction`)}
            className="flex items-center space-x-2 text-xs font-mono text-[#F3F4F1] bg-[#141917] border border-[#2A312D] px-4 py-2 rounded-lg hover:bg-[#1E2522]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>BACK TO AUCTION</span>
          </button>
        </div>
      </div>
    );
  }

  const selectedTeam = teams[selectedTeamIndex];

  if (!selectedTeam) return null;

  const currentTeamSquad = squadPlayers.filter(p => p.winning_team_id === selectedTeam.id);

  const handleNextTeam = () => setSelectedTeamIndex(prev => (prev + 1) % teams.length);
  const handlePrevTeam = () => setSelectedTeamIndex(prev => (prev - 1 + teams.length) % teams.length);

  return (
    <div className="min-h-screen bg-[#0B0F0D] flex flex-col text-[#F3F4F1] selection:bg-[#C9A227]/30">
      <Navbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex flex-col animate-in fade-in duration-500">

        {/* Navigation & Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10">
          <div>
            <button
              onClick={() => router.push(`/rooms/${roomId}/auction`)}
              className="group flex items-center space-x-2 text-xs font-mono text-[#9CA6A0] hover:text-[#C9A227] transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              <span>RETURN TO LIVE AUCTION</span>
            </button>
            <h1 className="text-[10px] sm:text-xs font-mono font-bold text-[#C9A227] uppercase tracking-[0.2em] mb-2">
              FRANCHISE SQUAD
            </h1>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase text-[#F3F4F1] font-display tracking-tight leading-none">
              BUILD YOUR DYNASTY
            </h2>
          </div>

          {/* Franchise Selector */}
          <div className="flex items-center space-x-4 bg-[#141917] border border-[#2A312D] rounded-2xl p-2 shrink-0">
            <button
              onClick={handlePrevTeam}
              className="p-2 sm:p-3 rounded-xl hover:bg-[#1E2522] text-[#9CA6A0] hover:text-[#F3F4F1] transition-colors"
            >
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <div className="flex flex-col items-center min-w-[200px] sm:min-w-[280px]">
              <p className="text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">COMMAND CENTER</p>
              <p className="text-lg sm:text-xl font-black text-[#F3F4F1] font-display tracking-wider uppercase text-center truncate w-full">
                {selectedTeam.name}
              </p>
            </div>
            <button
              onClick={handleNextTeam}
              className="p-2 sm:p-3 rounded-xl hover:bg-[#1E2522] text-[#9CA6A0] hover:text-[#F3F4F1] transition-colors"
            >
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>

        {/* Dynamic Team Content */}
        <div
          key={selectedTeam.id} // Forces re-render/animation on team change
          className="animate-in slide-in-from-right-4 fade-in duration-500 flex flex-col space-y-12"
        >
          {/* Metrics */}
          <SquadMetrics team={selectedTeam} />

          {/* Squad Roster */}
          {currentTeamSquad.length === 0 ? (
            <div className="w-full py-24 border border-dashed border-[#2A312D] rounded-3xl bg-[#141917]/30 flex flex-col items-center justify-center space-y-4">
              <h3 className="text-2xl font-black text-[#F3F4F1] font-display tracking-tight uppercase">BUILD YOUR SQUAD</h3>
              <p className="text-sm font-mono text-[#9CA6A0] tracking-widest text-center max-w-md">
                No acquisitions yet.<br/>Your auction journey starts here.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              <SquadRoleSection title="BATTERS" players={currentTeamSquad} roleFilter={['BATSMAN']} />
              <SquadRoleSection title="ALL-ROUNDERS" players={currentTeamSquad} roleFilter={['ALL_ROUNDER']} />
              <SquadRoleSection title="KEEPERS" players={currentTeamSquad} roleFilter={['WICKET_KEEPER']} />
              <SquadRoleSection title="BOWLERS" players={currentTeamSquad} roleFilter={['BOWLER']} />
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
