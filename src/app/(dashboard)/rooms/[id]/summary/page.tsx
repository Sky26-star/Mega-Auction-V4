'use client';

export const dynamic = 'force-dynamic';

// src/app/(dashboard)/rooms/[id]/summary/page.tsx
// Dedicated Authoritative Post-Auction Summary & Roster Analysis Page

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/navbar';
import { loadAuctionSummaryData, type AuctionSummaryData } from '@/lib/summary/loader';
import { AuctionOverviewCards } from '@/components/summary/auction-overview-cards';
import { TeamPurseMatrix } from '@/components/summary/team-purse-matrix';
import { SquadRosterTab } from '@/components/summary/squad-roster-tab';
import { AuctionLeaderboards } from '@/components/summary/auction-leaderboards';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Trophy,
  Share2,
  CheckCircle2,
  RefreshCw,
  Home,
  Sparkles,
  ArrowLeftRight,
} from 'lucide-react';

import { SpendingAnalytics } from '@/components/summary/spending-analytics';
import { PlayerHistoryModal } from '@/components/history/player-history-modal';

export default function PostAuctionSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.id;
  const router = useRouter();

  const [summaryData, setSummaryData] = useState<AuctionSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(undefined);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedPlayerName, setSelectedPlayerName] = useState<string | undefined>(undefined);

  // Mini Auction Hand-off State
  const [isInitiating, setIsInitiating] = useState(false);
  const [initiateError, setInitiateError] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    const { data, error: err } = await loadAuctionSummaryData(roomId);
    if (err) {
      setError(err);
    } else if (data) {
      setSummaryData(data);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (roomId) {
      fetchData();
    }
  }, [roomId]);

  const isMiniActive = Boolean(
    summaryData?.miniSession && summaryData.miniSession.status !== 'COMPLETED'
  );
  const isMiniCompleted = Boolean(
    summaryData?.miniSession && summaryData.miniSession.status === 'COMPLETED'
  );
  const canStartMini = Boolean(
    !summaryData?.miniSession && (summaryData?.unsoldLots?.length ?? 0) > 0
  );
  const isMiniNotApplicable = Boolean(
    !summaryData?.miniSession && (!summaryData?.unsoldLots || summaryData.unsoldLots.length === 0)
  );
  const isTradeUnlocked = Boolean(
    summaryData?.auctionStatus === 'COMPLETED' && (!summaryData?.miniSession || summaryData.miniSession.status === 'COMPLETED')
  );

  const handleStartMiniAuction = async () => {
    if (!summaryData?.auctionId) return;
    setIsInitiating(true);
    setInitiateError(null);

    try {
      if (isMiniActive) {
        // Active session exists, navigate directly
        router.push(`/rooms/${roomId}/mini-auction`);
        return;
      }

      if (isMiniCompleted) {
        // Completed mini auction cannot be restarted
        setIsInitiating(false);
        return;
      }

      const res = await fetch('/api/auction/initiate-mini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId: summaryData.auctionId }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setInitiateError(data.error || 'Failed to start mini auction');
        setIsInitiating(false);
        return;
      }

      router.push(`/rooms/${roomId}/mini-auction`);
    } catch (err: any) {
      setInitiateError(err.message || 'Network error initiating mini auction');
      setIsInitiating(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col font-sans selection:bg-[#C9A227]/30 selection:text-[#E4B93F]"
      data-testid="auction-summary"
    >
      <Navbar />

      <div className="max-w-6xl mx-auto w-full px-4 py-6 flex-1 space-y-6">
        {/* Navigation & Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2A312D] pb-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/rooms/${roomId}`}
              className="p-2.5 rounded-xl bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/50 text-[#9CA6A0] hover:text-[#E4B93F] transition-all shadow-md"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-[#0B0F0D] border border-[#C9A227]/40 text-[#E4B93F] font-mono text-[10px] font-bold px-2 py-0.5 rounded-full">
                  ROOM #{summaryData?.overview.roomCode || '---'}
                </span>
                <span className="bg-[#141917] border border-[#2A312D] text-[#E4B93F] font-mono text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> AUCTION {summaryData?.overview.status || 'COMPLETED'}
                </span>
              </div>
              <h1 className="text-xl md:text-2xl font-black text-[#F3F4F1] font-mono tracking-tight mt-1 flex items-center gap-2">
                <Trophy className="w-6 h-6 text-[#C9A227]" />
                POST-AUCTION SUMMARY & SQUAD ROSTER ANALYSIS
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Host Mini Auction Trigger Button / Lifecycle Status */}
            {summaryData && summaryData.auctionStatus === 'COMPLETED' && summaryData.isHost && (
              isMiniActive ? (
                <button
                  data-testid="mini-auction-continue"
                  onClick={handleStartMiniAuction}
                  disabled={isInitiating}
                  className="px-4 py-2.5 rounded-xl bg-[#C9A227] hover:bg-[#E4B93F] text-[#0B0F0D] font-mono text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg hover:shadow-[#C9A227]/20 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isInitiating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  CONTINUE MINI AUCTION
                </button>
              ) : canStartMini ? (
                <button
                  data-testid="mini-auction-start"
                  onClick={handleStartMiniAuction}
                  disabled={isInitiating}
                  className="px-4 py-2.5 rounded-xl bg-[#C9A227] hover:bg-[#E4B93F] text-[#0B0F0D] font-mono text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg hover:shadow-[#C9A227]/20 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isInitiating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  START MINI AUCTION
                </button>
              ) : isMiniCompleted ? (
                <span
                  data-testid="mini-auction-completed-badge"
                  className="px-3 py-2 rounded-xl bg-[#141917] border border-[#10B981]/30 text-[#10B981] font-mono text-xs font-bold uppercase flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                  MINI AUCTION COMPLETED
                </span>
              ) : isMiniNotApplicable ? (
                <span
                  data-testid="mini-auction-na-badge"
                  className="px-3 py-2 rounded-xl bg-[#141917] border border-[#2A312D] text-[#9CA6A0] font-mono text-xs font-bold uppercase"
                  title="No unsold players available for Mini Auction"
                >
                  MINI AUCTION N/A
                </span>
              ) : null
            )}

            {/* Non-host Mini Auction View Link / Status */}
            {summaryData && summaryData.auctionStatus === 'COMPLETED' && !summaryData.isHost && (
              isMiniActive ? (
                <Link
                  href={`/rooms/${roomId}/mini-auction`}
                  className="px-4 py-2.5 rounded-xl bg-[#141917] border border-[#C9A227]/40 text-[#E4B93F] hover:bg-[#1B211D] font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all"
                >
                  <Sparkles className="w-4 h-4" /> VIEW MINI AUCTION
                </Link>
              ) : isMiniCompleted ? (
                <span
                  data-testid="mini-auction-completed-badge"
                  className="px-3 py-2 rounded-xl bg-[#141917] border border-[#10B981]/30 text-[#10B981] font-mono text-xs font-bold uppercase flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                  MINI AUCTION COMPLETED
                </span>
              ) : null
            )}

            {/* Trade Center Access Button (Visible when unlocked after Mega & Mini auctions conclude) */}
            {isTradeUnlocked && (
              <Link
                href={`/rooms/${roomId}/trades`}
                data-testid="trade-center-entry"
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#10B981] to-[#059669] hover:from-[#0ea571] hover:to-[#047857] text-[#0B0F0D] font-mono text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg hover:shadow-[#10B981]/25 transition-all"
              >
                <ArrowLeftRight className="w-4 h-4" /> TRADE CENTER
              </Link>
            )}

            <button
              onClick={fetchData}
              className="p-2.5 rounded-xl bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/50 text-[#9CA6A0] hover:text-[#E4B93F] transition-all shadow-md"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <Link
              href="/dashboard"
              className="px-4 py-2.5 rounded-xl bg-[#C9A227] hover:bg-[#E4B93F] text-[#0B0F0D] font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all"
            >
              <Home className="w-4 h-4" /> DASHBOARD
            </Link>
          </div>
        </div>

        {/* Mini Auction Error Banner */}
        {initiateError && (
          <div
            data-testid="mini-auction-error"
            className="p-4 rounded-xl bg-[#141917] border border-[#B8322E]/40 text-red-300 flex flex-wrap items-center justify-between gap-3 font-mono text-xs shadow-lg animate-in fade-in"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-[#B8322E] shrink-0" />
              <span>{initiateError}</span>
            </div>
            <button
              onClick={handleStartMiniAuction}
              disabled={isInitiating}
              className="px-4 py-1.5 rounded-lg bg-[#B8322E] hover:bg-[#9B2825] text-[#F3F4F1] font-bold uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading State */}
        {isLoading ? (
          <div className="p-10 sm:p-16 rounded-2xl bg-[#141917] border border-[#2A312D] text-center text-[#9CA6A0] space-y-3 font-mono">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#C9A227]" />
            <p className="text-xs">LOADING AUTHORITATIVE AUCTION SUMMARY & ROSTER DATA...</p>
          </div>
        ) : error ? (
          /* Error / Unauthorized State */
          <div className="p-6 sm:p-8 rounded-2xl bg-[#141917] border border-[#B8322E]/40 text-center text-red-300 space-y-4 font-mono">
            <AlertCircle className="w-8 h-8 mx-auto text-[#C9A227]" />
            <h3 className="font-bold text-base text-[#F3F4F1]">ACCESS RESTRICTED OR ERROR</h3>
            <p className="text-xs text-[#9CA6A0] max-w-md mx-auto">{error}</p>
            <div className="pt-2">
              <Link
                href="/dashboard"
                className="px-5 py-2.5 rounded-xl bg-[#C9A227] hover:bg-[#E4B93F] text-[#0B0F0D] font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 shadow-lg transition-all"
              >
                RETURN TO DASHBOARD
              </Link>
            </div>
          </div>
        ) : summaryData ? (
          /* Main Summary Presentation */
          <div className="space-y-6">
            {/* 1. Overview Stat Cards */}
            <AuctionOverviewCards overview={summaryData.overview} />

            {/* 2. Team Purse Utilization Matrix */}
            <TeamPurseMatrix
              teams={summaryData.teams}
              onSelectTeam={(teamId) => setSelectedTeamId(teamId)}
            />

            {/* 3. Comprehensive Spending & Distribution Analytics (PRD Item 6) */}
            <SpendingAnalytics
              overview={summaryData.overview}
              teams={summaryData.teams}
              categoryBreakdown={summaryData.categoryBreakdown}
              roleBreakdown={summaryData.roleBreakdown}
              domesticVsOverseas={summaryData.domesticVsOverseas}
            />

            {/* 4. Interactive Squad Roster Tabs */}
            <SquadRosterTab
              teams={summaryData.teams}
              selectedTeamId={selectedTeamId}
              onSelectPlayer={(playerId, playerName) => {
                setSelectedPlayerId(playerId);
                setSelectedPlayerName(playerName);
              }}
            />

            {/* 5. Auction Leaderboards & Unsold Catalog */}
            <AuctionLeaderboards
              topBuys={summaryData.topBuys}
              unsoldLots={summaryData.unsoldLots}
              onSelectPlayer={(playerId, playerName) => {
                setSelectedPlayerId(playerId);
                setSelectedPlayerName(playerName);
              }}
            />

            {/* 6. Authoritative Player Lifecycle Audit Modal (Phase 17D) */}
            <PlayerHistoryModal
              isOpen={Boolean(selectedPlayerId)}
              onClose={() => {
                setSelectedPlayerId(null);
                setSelectedPlayerName(undefined);
              }}
              roomId={roomId}
              playerId={selectedPlayerId}
              playerNameFallback={selectedPlayerName}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
