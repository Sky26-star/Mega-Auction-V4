'use client';

export const dynamic = 'force-dynamic';

// src/app/(dashboard)/history/page.tsx
// Authoritative Historical Auction Archives (Phase 17E)
// Displays completed auctions with explicit Mega/Mini breakdown and gross vs net financial semantics.

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/layout/navbar';
import { loadUserCompletedAuctionsList } from '@/lib/history/loader';
import {
  History,
  Trophy,
  ArrowRight,
  Loader2,
  AlertCircle,
  Clock,
  Layers,
  CheckCircle2,
  DollarSign,
  TrendingDown,
  Sparkles,
  RefreshCw,
  Home,
} from 'lucide-react';

interface AuctionHistoryItem {
  auctionId: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  status: string;
  completedAt: string | null;
  megaCompletedAt: string | null;
  totalLots: number;
  soldLots: number;
  grossSpendCr: number;
  netCapitalSpendCr: number;
  isHost: boolean;
}

export default function AuctionHistoryPage() {
  const [historyList, setHistoryList] = useState<AuctionHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    setIsLoading(true);
    setError(null);
    const { data, error: err } = await loadUserCompletedAuctionsList();
    if (err) {
      setError(err);
    } else {
      setHistoryList(data || []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col font-sans selection:bg-[#C9A227]/30 selection:text-[#E4B93F]">
      <Navbar />

      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 flex-1 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2A312D] pb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#141917] border border-[#C9A227]/40 flex items-center justify-center text-[#E4B93F] shadow-lg shadow-black/50">
              <History className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#E4B93F] uppercase tracking-widest bg-[#1F190B] border border-[#C9A227]/40 px-2 py-0.5 rounded-full">
                  HISTORICAL ARCHIVES
                </span>
                <span className="text-[10px] text-[#9CA6A0]">PHASE 17E</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-[#F3F4F1] font-display uppercase tracking-wider mt-1">
                COMPLETED AUCTION HISTORIES
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchHistory}
              className="p-2.5 rounded-2xl bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/40 text-[#9CA6A0] hover:text-[#F3F4F1] transition-all shadow-md"
              title="Refresh Archives"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <Link
              href="/dashboard"
              className="px-4 py-2.5 rounded-2xl bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/50 text-[#F3F4F1] font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-md transition-all"
            >
              <Home className="w-4 h-4" /> DASHBOARD
            </Link>
          </div>
        </div>

        {/* Content Body */}
        {isLoading ? (
          <div className="p-16 rounded-3xl bg-[#141917] border border-[#2A312D] text-center text-[#9CA6A0] space-y-3 font-mono">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#C9A227]" />
            <p className="text-xs uppercase tracking-widest">
              LOADING AUTHORITATIVE AUCTION HISTORIES...
            </p>
          </div>
        ) : error ? (
          <div className="p-8 rounded-3xl bg-red-950/40 border border-red-800/40 text-center text-red-300 space-y-4 font-mono">
            <AlertCircle className="w-8 h-8 mx-auto text-red-400" />
            <h3 className="font-bold text-base text-red-200 uppercase">Archive Error</h3>
            <p className="text-xs text-zinc-300 max-w-md mx-auto">{error}</p>
          </div>
        ) : historyList.length === 0 ? (
          <div className="p-12 rounded-3xl bg-[#141917] border border-[#2A312D] text-center space-y-4 font-mono">
            <Trophy className="w-12 h-12 mx-auto text-[#9CA6A0]/40" />
            <h3 className="text-base font-bold text-[#F3F4F1] uppercase">No Completed Auctions Yet</h3>
            <p className="text-xs text-[#9CA6A0] max-w-md mx-auto">
              Completed Mega and Mini auctions you host or participate in will automatically be archived here with complete settlement provenance.
            </p>
            <div className="pt-2">
              <Link
                href="/rooms"
                className="px-5 py-2.5 rounded-2xl bg-[#C9A227] hover:bg-[#E4B93F] text-black font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 shadow-lg transition-all"
              >
                Browse Auction Rooms
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 font-mono">
            {historyList.map((auction) => (
              <div
                key={auction.auctionId || auction.roomId}
                className="p-5 rounded-2xl bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/40 transition-all shadow-xl space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2A312D] pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-[#C9A227] bg-[#1F190B] border border-[#C9A227]/40 px-2 py-0.5 rounded-full">
                        ROOM #{auction.roomCode}
                      </span>
                      <span className="bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> {auction.status}
                      </span>
                      {auction.isHost && (
                        <span className="bg-purple-950/80 border border-purple-500/40 text-purple-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          HOST
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-white mt-1">
                      {auction.roomName}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/rooms/${auction.roomId}/summary`}
                      className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-md"
                    >
                      <Trophy className="w-3.5 h-3.5" /> POST-AUCTION SUMMARY
                    </Link>
                    <Link
                      href={`/rooms/${auction.roomId}`}
                      className="px-3 py-2 rounded-xl bg-[#0B0F0D] border border-[#2A312D] hover:border-white/20 text-[#9CA6A0] hover:text-white text-xs font-bold uppercase flex items-center gap-1 transition-all"
                    >
                      LOBBY
                    </Link>
                  </div>
                </div>

                {/* Metrics Grid with Strict Financial Semantics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
                    <span className="text-[9px] text-[#9CA6A0] block uppercase font-bold">
                      PLAYERS SOLD
                    </span>
                    <span className="text-sm font-black text-emerald-400">
                      {auction.soldLots} <span className="text-xs font-normal text-zinc-500">/ {auction.totalLots}</span>
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
                    <span className="text-[9px] text-[#C9A227] block uppercase font-bold">
                      GROSS ACQUISITIONS
                    </span>
                    <span className="text-sm font-black text-[#E4B93F]">
                      ₹{auction.grossSpendCr.toFixed(2)} Cr
                    </span>
                    <span className="text-[8px] text-[#9CA6A0] block">Total hammer price</span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
                    <span className="text-[9px] text-blue-300 block uppercase font-bold">
                      NET CAPITAL SPEND
                    </span>
                    <span className="text-sm font-black text-blue-300">
                      ₹{auction.netCapitalSpendCr.toFixed(2)} Cr
                    </span>
                    <span className="text-[8px] text-[#9CA6A0] block">After release refunds</span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
                    <span className="text-[9px] text-[#9CA6A0] block uppercase font-bold">
                      COMPLETED AT
                    </span>
                    <span className="text-xs font-bold text-white block truncate">
                      {auction.completedAt
                        ? new Date(auction.completedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                        : 'Completed'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
