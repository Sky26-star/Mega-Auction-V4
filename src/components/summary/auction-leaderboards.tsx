
// src/components/summary/auction-leaderboards.tsx
// Top Purchases & Unsold Player Catalog

import React from 'react';
import type { SummaryPlayerItem } from '@/lib/summary/loader';
import { Crown, AlertTriangle, Sparkles } from 'lucide-react';

interface AuctionLeaderboardsProps {
  topBuys: SummaryPlayerItem[];
  unsoldLots: {
    id: string;
    playerId?: string;
    lotIndex: number;
    playerName: string;
    role: string;
    category: string;
    country: string;
    isOverseas: boolean;
    basePriceCr: number;
    isUnsoldRound: boolean;
    isMiniRound?: boolean;
  }[];
  onSelectPlayer?: (playerId: string, playerName?: string) => void;
}

export function AuctionLeaderboards({
  topBuys,
  unsoldLots,
  onSelectPlayer,
}: AuctionLeaderboardsProps) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 font-mono xl:grid-cols-2">
      {/* Top Purchases */}
      <section className="min-w-0 space-y-4 rounded-2xl border border-[#2A312D] bg-[#141917] p-3 shadow-xl sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2A312D] pb-3">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#F3F4F1]">
            <Crown className="h-4 w-4 shrink-0 text-[#C9A227]" />
            TOP 5 MOST EXPENSIVE PURCHASES
          </h3>
          <span className="text-[10px] font-bold text-[#E4B93F]">
            MARQUEE BUYS
          </span>
        </div>

        {topBuys.length === 0 ? (
          <p className="py-6 text-center text-xs text-[#9CA6A0]">
            No purchases completed in this auction.
          </p>
        ) : (
          <div className="space-y-2">
            {topBuys.map((player, idx) => (
              <button
                key={player.squadPlayerId || player.id || idx}
                type="button"
                onClick={() => onSelectPlayer?.(player.id, player.name)}
                className="group flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-[#2A312D] bg-[#0B0F0D] p-3 text-left transition-colors hover:border-[#C9A227]/50 hover:bg-[#181E1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]"
                title="Click to view full player lifecycle history"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${idx === 0
                      ? 'bg-[#C9A227] text-[#0B0F0D] shadow-md shadow-[#C9A227]/30'
                      : idx === 1
                        ? 'bg-[#F3F4F1] text-[#0B0F0D]'
                        : idx === 2
                          ? 'bg-[#9CA6A0] text-[#0B0F0D]'
                          : 'border border-[#2A312D] bg-[#141917] text-[#9CA6A0]'
                      }`}
                  >
                    #{idx + 1}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="break-words text-sm font-bold text-[#F3F4F1]">
                        {player.name}
                      </span>
                      <span
                        className="max-w-full rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
                        style={{
                          backgroundColor: player.teamColor || '#2A312D',
                        }}
                      >
                        {player.teamName}
                      </span>
                    </div>
                    <span className="block text-[10px] text-[#9CA6A0]">
                      {player.role} • {player.country}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span className="block text-sm font-black text-[#E4B93F]">
                    ₹{player.purchasePriceCr.toFixed(2)} Cr
                  </span>
                  <span className="block text-[8px] uppercase text-[#9CA6A0]">
                    Base: ₹{player.basePriceCr.toFixed(2)} Cr
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Unsold Player Catalog */}
      <section className="min-w-0 space-y-4 rounded-2xl border border-[#2A312D] bg-[#141917] p-3 shadow-xl sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2A312D] pb-3">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#F3F4F1]">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[#C9A227]" />
            UNSOLD PLAYER CATALOG ({unsoldLots.length})
          </h3>
          <span className="text-[10px] uppercase text-[#9CA6A0]">
            PASSED LOTS
          </span>
        </div>

        {unsoldLots.length === 0 ? (
          <div className="space-y-2 rounded-xl border border-[#2A312D] bg-[#0B0F0D] p-8 text-center text-xs text-[#9CA6A0]">
            <Sparkles className="mx-auto h-5 w-5 text-emerald-400" />
            <p className="font-bold text-[#F3F4F1]">100% SOLD OUT!</p>
            <p className="text-[10px] text-[#9CA6A0]">
              All player lots were successfully acquired by participating teams.
            </p>
          </div>
        ) : (
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-[#2A312D]">
            {unsoldLots.map((lot, idx) => (
              <button
                key={lot.id || idx}
                type="button"
                onClick={() =>
                  onSelectPlayer?.(lot.playerId || lot.id, lot.playerName)
                }
                className="group flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-[#2A312D] bg-[#0B0F0D] p-3 text-left transition-colors hover:border-[#C9A227]/40 hover:bg-[#181E1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]"
                title="Click to view full player lifecycle history"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-[#9CA6A0]">
                      LOT #{lot.lotIndex + 1}
                    </span>
                    <span className="break-words text-sm font-bold text-[#F3F4F1]">
                      {lot.playerName}
                    </span>

                    {lot.isMiniRound && (
                      <span className="rounded border border-[#C9A227]/40 bg-[#C9A227]/10 px-1.5 py-0.5 text-[8px] font-bold text-[#E4B93F]">
                        MINI
                      </span>
                    )}

                    {lot.isUnsoldRound && (
                      <span className="rounded border border-[#C9A227]/40 bg-[#C9A227]/10 px-1.5 py-0.5 text-[8px] font-bold text-[#E4B93F]">
                        RD 2
                      </span>
                    )}
                  </div>

                  <span className="block break-words text-[10px] text-[#9CA6A0]">
                    {lot.role} • {lot.category} ({lot.country})
                  </span>
                </div>

                <div className="shrink-0 text-right">
                  <span className="block text-xs font-bold text-[#F3F4F1]">
                    ₹{lot.basePriceCr.toFixed(2)} Cr
                  </span>
                  <span className="block text-[8px] font-bold uppercase text-[#B8322E]">
                    UNSOLD
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
