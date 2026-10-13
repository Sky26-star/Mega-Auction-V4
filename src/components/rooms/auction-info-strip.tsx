'use client';

// src/components/rooms/auction-info-strip.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Database, Coins, Clock, Users, Globe, Cpu } from 'lucide-react';

interface AuctionInfoStripProps {
  playerSetName?: string | null;
  playerCount?: number | null;
  defaultPurseCr: number;
  timerSeconds: number;
  maxSquadSize: number;
  maxOverseas: number;
  botCount: number;
  totalManagers: number;
  maxManagers?: number;
}

/**
 * Reusable animated value wrapper that triggers a subtle 400ms scale pulse & gold glow
 * strictly when the underlying value changes.
 */
function AnimatedAuctionValue({ children, valueKey }: { children: React.ReactNode; valueKey: any }) {
  const [animating, setAnimating] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setAnimating(true);
    const timer = setTimeout(() => setAnimating(false), 400);
    return () => clearTimeout(timer);
  }, [valueKey]);

  return (
    <span
      className={`inline-block transition-all duration-300 transform ${
        animating
          ? 'scale-105 text-[#E4B93F] drop-shadow-[0_0_8px_rgba(228,185,63,0.6)] -translate-y-0.5'
          : ''
      }`}
    >
      {children}
    </span>
  );
}

export function AuctionInfoStrip({
  playerSetName,
  playerCount,
  defaultPurseCr,
  timerSeconds,
  maxSquadSize,
  maxOverseas,
  botCount,
  totalManagers,
  maxManagers = 10,
}: AuctionInfoStripProps) {
  const formattedPlayerPool = playerSetName ? `${playerSetName}${playerCount ? ` (${playerCount})` : ''}` : 'IPL Core Pool';

  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-2">
      <div className="rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-3 sm:p-4 shadow-xl">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          
          {/* 1. PLAYER POOL */}
          <div className="p-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex flex-col justify-between space-y-1">
            <div className="flex items-center space-x-1.5 text-[#9CA6A0]">
              <Database className="w-3.5 h-3.5 text-[#C9A227] flex-shrink-0" />
              <span className="text-[10px] font-extrabold uppercase tracking-wider font-display">PLAYER POOL</span>
            </div>
            <div className="text-xs font-black text-[#F3F4F1] font-mono-numbers truncate">
              <AnimatedAuctionValue valueKey={formattedPlayerPool}>
                {formattedPlayerPool}
              </AnimatedAuctionValue>
            </div>
          </div>

          {/* 2. STARTING PURSE */}
          <div className="p-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex flex-col justify-between space-y-1">
            <div className="flex items-center space-x-1.5 text-[#9CA6A0]">
              <Coins className="w-3.5 h-3.5 text-[#E4B93F] flex-shrink-0" />
              <span className="text-[10px] font-extrabold uppercase tracking-wider font-display">PURSE</span>
            </div>
            <div className="text-xs sm:text-sm font-black text-[#E4B93F] font-mono-numbers">
              <AnimatedAuctionValue valueKey={defaultPurseCr}>
                ₹{defaultPurseCr} Cr
              </AnimatedAuctionValue>
            </div>
          </div>

          {/* 3. TIMER PER LOT */}
          <div className="p-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex flex-col justify-between space-y-1">
            <div className="flex items-center space-x-1.5 text-[#9CA6A0]">
              <Clock className="w-3.5 h-3.5 text-[#B8322E] flex-shrink-0" />
              <span className="text-[10px] font-extrabold uppercase tracking-wider font-display">TIMER PER LOT</span>
            </div>
            <div className="text-xs sm:text-sm font-black text-[#F3F4F1] font-mono-numbers">
              <AnimatedAuctionValue valueKey={timerSeconds}>
                {timerSeconds} SEC
              </AnimatedAuctionValue>
            </div>
          </div>

          {/* 4. MAX SQUAD SIZE */}
          <div className="p-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex flex-col justify-between space-y-1">
            <div className="flex items-center space-x-1.5 text-[#9CA6A0]">
              <Users className="w-3.5 h-3.5 text-[#C9A227] flex-shrink-0" />
              <span className="text-[10px] font-extrabold uppercase tracking-wider font-display">MAX SQUAD SIZE</span>
            </div>
            <div className="text-xs sm:text-sm font-black text-[#F3F4F1] font-mono-numbers">
              <AnimatedAuctionValue valueKey={maxSquadSize}>
                {maxSquadSize} PLAYERS
              </AnimatedAuctionValue>
            </div>
          </div>

          {/* 5. OVERSEAS LIMIT */}
          <div className="p-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex flex-col justify-between space-y-1">
            <div className="flex items-center space-x-1.5 text-[#9CA6A0]">
              <Globe className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
              <span className="text-[10px] font-extrabold uppercase tracking-wider font-display">OVERSEAS LIMIT</span>
            </div>
            <div className="text-xs sm:text-sm font-black text-sky-400 font-mono-numbers">
              <AnimatedAuctionValue valueKey={maxOverseas}>
                {maxOverseas} PLAYERS
              </AnimatedAuctionValue>
            </div>
          </div>

          {/* 6. BOT OPPONENTS */}
          <div className="p-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex flex-col justify-between space-y-1">
            <div className="flex items-center space-x-1.5 text-[#9CA6A0]">
              <Cpu className="w-3.5 h-3.5 text-[#E4B93F] flex-shrink-0" />
              <span className="text-[10px] font-extrabold uppercase tracking-wider font-display">BOT OPPONENTS</span>
            </div>
            <div className="text-xs font-black text-[#F3F4F1] font-mono-numbers truncate">
              <AnimatedAuctionValue valueKey={`${botCount}-${totalManagers}`}>
                {botCount} AI BOTS ({totalManagers}/{maxManagers})
              </AnimatedAuctionValue>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
