'use client';

// src/components/auth/live-activity-counters.tsx
import React, { useState, useEffect } from 'react';
import { Users, DoorOpen, Radio } from 'lucide-react';

export function LiveActivityCounters() {
  const [onlineCount, setOnlineCount] = useState(122);

  // Subtle live pulse number variation to enhance broadcast feel
  useEffect(() => {
    const interval = setInterval(() => {
      setOnlineCount((prev) => {
        const delta = Math.floor(Math.random() * 3) - 1; // -1, 0, +1
        return Math.max(120, Math.min(128, prev + delta));
      });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full max-w-xl mx-auto lg:mx-0 py-2">
      <div className="flex items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-[#141917] border-2 border-[#2A312D] text-xs sm:text-sm shadow-xl">
        
        {/* Metric 1: Online Users */}
        <div className="flex-1 flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] shadow-inner">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <Users className="w-4 h-4 text-[#E4B93F]" />
          <span className="font-mono-numbers font-black text-[#F3F4F1] text-sm sm:text-base">
            {onlineCount}
          </span>
          <span className="text-[11px] font-bold text-[#9CA6A0] uppercase tracking-wider hidden sm:inline">
            ONLINE
          </span>
        </div>

        {/* Metric 2: Active Rooms */}
        <div className="flex-1 flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] shadow-inner">
          <span className="w-2.5 h-2.5 rounded-full bg-[#C9A227] animate-pulse" />
          <DoorOpen className="w-4 h-4 text-[#C9A227]" />
          <span className="font-mono-numbers font-black text-[#F3F4F1] text-sm sm:text-base">
            16
          </span>
          <span className="text-[11px] font-bold text-[#9CA6A0] uppercase tracking-wider hidden sm:inline">
            ROOMS
          </span>
        </div>

        {/* Metric 3: Live Auctions */}
        <div className="flex-1 flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] shadow-inner">
          <span className="w-2.5 h-2.5 rounded-full bg-[#B8322E] animate-pulse-live" />
          <Radio className="w-4 h-4 text-[#B8322E]" />
          <span className="font-mono-numbers font-black text-[#F3F4F1] text-sm sm:text-base">
            7
          </span>
          <span className="text-[11px] font-bold text-[#9CA6A0] uppercase tracking-wider hidden sm:inline">
            LIVE
          </span>
        </div>

      </div>
    </div>
  );
}
