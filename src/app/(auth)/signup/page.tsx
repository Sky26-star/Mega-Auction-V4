'use client';

// src/app/(auth)/signup/page.tsx
import React, { useState, useCallback } from 'react';
import { AuthForm } from '@/components/auth/auth-form';
import { AuctionGavelHero } from '@/components/auth/auction-gavel-hero';
import { LiveAuctionPreview } from '@/components/auth/live-auction-preview';
import { LiveActivityCounters } from '@/components/auth/live-activity-counters';
import { AuctionFeatureStrip } from '@/components/auth/auction-feature-strip';
import { Navbar } from '@/components/layout/navbar';

export default function SignupPage() {
  const [closingStrikeTrigger, setClosingStrikeTrigger] = useState(false);

  const handleClosingStrike = useCallback(() => {
    setClosingStrikeTrigger(true);
    const timer = setTimeout(() => {
      setClosingStrikeTrigger(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col relative overflow-x-hidden selection:bg-[#C9A227]/30 selection:text-[#E4B93F]">
      {/* Top Navbar */}
      <Navbar />

      {/* Stadium Floodlight & Dark Atmosphere Backdrop */}
      <div className="pointer-events-none absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-40">
        <div className="absolute -top-40 -left-40 w-[700px] h-[700px] bg-[#C9A227]/10 rounded-full blur-[180px]" />
        <div className="absolute top-1/2 -right-40 w-[600px] h-[600px] bg-[#B8322E]/10 rounded-full blur-[180px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#2A312D_1px,transparent_1px)] [background-size:32px_32px] opacity-25" />
      </div>

      {/* Main Content Area — Desktop Balanced Layout (60% Left / 40% Right) */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 flex items-center justify-center relative z-10 my-auto">
        
        {/* Responsive 12-Column Desktop Grid */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">

          {/* LEFT BRAND & PREVIEW PANEL (~60% Desktop Col 7) */}
          <div className="lg:col-span-7 flex flex-col space-y-4 py-1">
            
            {/* 1. Gavel Hero & Brand Reveal */}
            <div className="order-1">
              <AuctionGavelHero closingStrikeTrigger={closingStrikeTrigger} />
            </div>

            {/* 2. Coded Live Auction Preview (MS Dhoni Card) */}
            <div className="order-2">
              <LiveAuctionPreview onClosingStrike={handleClosingStrike} />
            </div>

            {/* 4. Live Activity Counters */}
            <div className="order-4 lg:order-3">
              <LiveActivityCounters />
            </div>

            {/* 5. Compact Feature Strip */}
            <div className="order-5 lg:order-4">
              <AuctionFeatureStrip />
            </div>

          </div>

          {/* RIGHT SIGNUP PANEL (~40% Desktop Col 5) */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end w-full order-3 lg:order-2 py-2">
            <AuthForm />
          </div>

        </div>
      </main>

      {/* Broadcast Footer */}
      <footer className="py-3.5 border-t border-[#2A312D]/60 text-center relative z-10 mt-auto">
        <p className="text-[11px] font-mono-numbers text-[#9CA6A0] tracking-wider uppercase">
          MEGA AUCTION ARENA &bull; OFFICIAL CRICKET BROADCAST INTERFACE
        </p>
      </footer>
    </div>
  );
}
