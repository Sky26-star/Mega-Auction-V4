'use client';

// src/components/auth/auction-feature-strip.tsx
import React from 'react';
import { Users, ShieldCheck, Cpu, Zap } from 'lucide-react';

export function AuctionFeatureStrip() {
  return (
    <div className="w-full max-w-xl mx-auto lg:mx-0 pt-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        
        {/* Feature 1: Live Rooms */}
        <div className="p-3 sm:p-3.5 rounded-xl bg-[#141917] border-2 border-[#2A312D] transition-all hover:border-[#C9A227]/50 group shadow-md">
          <div className="w-8 h-8 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F] mb-2 group-hover:border-[#C9A227]">
            <Users className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-[#F3F4F1] uppercase tracking-wider font-display mb-1">
            LIVE ROOMS
          </h3>
          <p className="text-[11px] text-[#9CA6A0] leading-snug">
            Create or join multiplayer auction rooms.
          </p>
        </div>

        {/* Feature 2: Rule Engine */}
        <div className="p-3 sm:p-3.5 rounded-xl bg-[#141917] border-2 border-[#2A312D] transition-all hover:border-[#C9A227]/50 group shadow-md">
          <div className="w-8 h-8 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#C9A227] mb-2 group-hover:border-[#C9A227]">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-[#F3F4F1] uppercase tracking-wider font-display mb-1">
            RULE ENGINE
          </h3>
          <p className="text-[11px] text-[#9CA6A0] leading-snug">
            Automatic purse & squad validation.
          </p>
        </div>

        {/* Feature 3: Bot Opponents */}
        <div className="p-3 sm:p-3.5 rounded-xl bg-[#141917] border-2 border-[#2A312D] transition-all hover:border-[#C9A227]/50 group shadow-md">
          <div className="w-8 h-8 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F] mb-2 group-hover:border-[#C9A227]">
            <Cpu className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-[#F3F4F1] uppercase tracking-wider font-display mb-1">
            BOT OPPONENTS
          </h3>
          <p className="text-[11px] text-[#9CA6A0] leading-snug">
            Compete against automated franchises.
          </p>
        </div>

        {/* Feature 4: Real-Time Bidding */}
        <div className="p-3 sm:p-3.5 rounded-xl bg-[#141917] border-2 border-[#2A312D] transition-all hover:border-[#B8322E]/60 group shadow-md">
          <div className="w-8 h-8 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#B8322E] mb-2 group-hover:border-[#B8322E]">
            <Zap className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-[#F3F4F1] uppercase tracking-wider font-display mb-1">
            REAL-TIME BIDDING
          </h3>
          <p className="text-[11px] text-[#9CA6A0] leading-snug">
            Synchronized bidding across participants.
          </p>
        </div>

      </div>
    </div>
  );
}
