'use client';

// src/components/auth/live-auction-preview.tsx
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Gavel, TrendingUp, Radio, Clock, Trophy, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface LiveAuctionPreviewProps {
  onClosingStrike?: () => void;
}

interface BidStep {
  amount: string;
  team: string;
  increment: string;
}

// Monotonic Bidding Sequence across 4 Franchises (Bids strictly increase)
const BID_STEPS: BidStep[] = [
  { amount: '₹8.50 Cr', team: 'Mumbai Strikers', increment: '+₹0.50 Cr' },
  { amount: '₹9.00 Cr', team: 'Bengaluru Royals', increment: '+₹0.50 Cr' },
  { amount: '₹9.50 Cr', team: 'Chennai Champions', increment: '+₹0.50 Cr' },
  { amount: '₹10.00 Cr', team: 'Hyderabad Warriors', increment: '+₹0.50 Cr' },
  { amount: '₹10.50 Cr', team: 'Mumbai Strikers', increment: '+₹0.50 Cr' },
];

const DEFAULT_STEP: BidStep = { amount: '₹8.50 Cr', team: 'Mumbai Strikers', increment: '+₹0.50 Cr' };

export function LiveAuctionPreview({ onClosingStrike }: LiveAuctionPreviewProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [seconds, setSeconds] = useState(10);
  const [isSold, setIsSold] = useState(false);
  const [bidPulse, setBidPulse] = useState(false);

  // Ref guard to prevent double-triggering closing strike
  const closingStrikeFiredRef = useRef(false);

  // 1. Countdown Timer (Decreases once per second)
  useEffect(() => {
    if (isSold) return;

    const timer = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isSold]);

  // 2. Synchronize Bidding Steps & SOLD state transition based on `seconds`
  useEffect(() => {
    if (isSold) return;

    if (seconds === 0) {
      setIsSold(true);
      return;
    }

    // Step transitions as timer counts down 10 -> 0
    if (seconds === 8 && stepIndex < 1) {
      setStepIndex(1);
      setBidPulse(true);
      const pulseTimer = setTimeout(() => setBidPulse(false), 500);
      return () => clearTimeout(pulseTimer);
    } else if (seconds === 6 && stepIndex < 2) {
      setStepIndex(2);
      setBidPulse(true);
      const pulseTimer = setTimeout(() => setBidPulse(false), 500);
      return () => clearTimeout(pulseTimer);
    } else if (seconds === 4 && stepIndex < 3) {
      setStepIndex(3);
      setBidPulse(true);
      const pulseTimer = setTimeout(() => setBidPulse(false), 500);
      return () => clearTimeout(pulseTimer);
    } else if (seconds === 2 && stepIndex < 4) {
      setStepIndex(4);
      setBidPulse(true);
      const pulseTimer = setTimeout(() => setBidPulse(false), 500);
      return () => clearTimeout(pulseTimer);
    }
  }, [seconds, stepIndex, isSold]);

  // 3. Controlled Side Effect: Trigger Parent's Closing Strike Callback Safely in useEffect
  useEffect(() => {
    if (isSold && !closingStrikeFiredRef.current) {
      closingStrikeFiredRef.current = true;
      if (onClosingStrike) {
        onClosingStrike();
      }
    } else if (!isSold) {
      closingStrikeFiredRef.current = false;
    }
  }, [isSold, onClosingStrike]);

  // 4. Extended Display Time in SOLD State (10 Seconds) Before Resetting
  useEffect(() => {
    if (!isSold) return;

    const resetTimer = setTimeout(() => {
      setIsSold(false);
      setStepIndex(0);
      setSeconds(10);
    }, 10000);

    return () => clearInterval(resetTimer);
  }, [isSold]);

  const currentStep: BidStep = BID_STEPS[stepIndex] || DEFAULT_STEP;

  return (
    <div className="w-full max-w-xl mx-auto lg:mx-0 my-3 rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-5 sm:p-6 shadow-2xl shadow-black/90 relative overflow-hidden transition-all hover:border-[#C9A227]/40 group">
      
      {/* Top Broadcast Banner Bar */}
      <div className="flex items-center justify-between border-b border-[#2A312D] pb-3.5 mb-4">
        <div className="flex items-center space-x-2.5">
          <div className="flex items-center space-x-2 px-3 py-1 rounded-full bg-[#B8322E]/15 border border-[#B8322E]/50 text-[#E4B93F] text-xs font-bold tracking-wider uppercase shadow-sm">
            <span className={`w-2.5 h-2.5 rounded-full ${isSold ? 'bg-[#C9A227]' : 'bg-[#B8322E] animate-pulse-live'}`} />
            <Radio className="w-3.5 h-3.5 text-[#B8322E]" />
            <span>{isSold ? 'AUCTION CONCLUDED' : 'LIVE AUCTION'}</span>
          </div>
          <span className="text-[11px] font-mono-numbers font-bold text-[#9CA6A0] tracking-widest uppercase bg-[#0B0F0D] px-2.5 py-1 rounded border border-[#2A312D]">
            PREVIEW
          </span>
        </div>

        <div className="flex items-center space-x-2 text-xs sm:text-sm font-mono-numbers font-extrabold text-[#E4B93F]">
          <Gavel className="w-4 h-4 text-[#C9A227]" />
          <span>LOT #014</span>
        </div>
      </div>

      {/* Main Player Profile Card Body */}
      <div className="flex items-center space-x-4 sm:space-x-5 mb-4 bg-[#0B0F0D] p-3.5 sm:p-4 rounded-xl border border-[#2A312D] relative overflow-hidden">
        
        {/* STABLE, FIXED-SIZE PLAYER IMAGE FRAME (NO REMOUNT, NO LAYOUT SHIFT) */}
        <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border-2 border-[#C9A227] shadow-xl flex-shrink-0 bg-[#141917] aspect-square">
          <Image
            key="ms-dhoni-portrait"
            src="/images/ms_dhoni.jpg"
            alt="MS Dhoni — Wicketkeeper Batter"
            fill
            sizes="112px"
            className="object-cover object-top pointer-events-none"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F0D]/60 via-transparent to-transparent pointer-events-none" />
        </div>

        {/* Player Info Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-mono-numbers font-bold uppercase tracking-widest px-2.5 py-0.5 rounded bg-[#181E1A] border border-[#2A312D] text-[#C9A227]">
              SET 1 — MARQUEE
            </span>
            
            {/* Countdown Timer Display */}
            <div className={`flex items-center space-x-1.5 text-xs sm:text-sm font-mono-numbers font-bold px-2.5 py-0.5 rounded border ${
              isSold ? 'bg-[#C9A227]/10 border-[#C9A227]/40 text-[#E4B93F]' : 'bg-[#B8322E]/10 border-[#B8322E]/40 text-[#B8322E]'
            }`}>
              <Clock className={`w-3.5 h-3.5 ${isSold ? '' : 'animate-spin'}`} style={{ animationDuration: '6s' }} />
              <span>{isSold ? '00:00' : `00:${seconds < 10 ? '0' + seconds : seconds}`}</span>
            </div>
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-[#F3F4F1] font-display uppercase tracking-wide truncate">
            MS DHONI
          </h2>

          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
            <span className="text-[11px] font-semibold text-[#9CA6A0] uppercase tracking-wider">
              ROLE:
            </span>
            <span className="text-[11px] font-bold text-[#F3F4F1] bg-[#181E1A] px-2.5 py-0.5 rounded border border-[#2A312D] uppercase tracking-wide">
              WICKETKEEPER BATTER
            </span>
          </div>
        </div>
      </div>

      {/* Grid: Base Price & Current Bid */}
      <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-[#0B0F0D] border border-[#2A312D] relative">
        
        {/* Base Price */}
        <div>
          <span className="block text-[11px] font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">
            Base Price
          </span>
          <span className="text-lg sm:text-xl font-bold font-mono-numbers text-[#B4BDB7]">
            ₹2.00 Cr
          </span>
          <span className="block text-[11px] font-mono-numbers font-semibold text-[#9CA6A0] mt-1">
            NEXT MIN: ₹0.50 Cr
          </span>
        </div>

        {/* Current / Final Bid */}
        <div className="text-right">
          <div className="flex items-center justify-end space-x-1 mb-1">
            <span className="text-[11px] font-bold text-[#E4B93F] uppercase tracking-widest">
              {isSold ? 'Final Bid' : 'Current Bid'}
            </span>
            <TrendingUp className="w-4 h-4 text-[#E4B93F]" />
          </div>
          <div className="flex items-baseline justify-end space-x-1.5">
            <span
              className={`text-2xl sm:text-3xl font-black font-mono-numbers transition-all duration-300 ${
                bidPulse ? 'text-[#FFF4B8] scale-105' : 'text-[#E4B93F]'
              }`}
            >
              {currentStep.amount}
            </span>
          </div>
          <span className="text-[11px] font-mono-numbers font-bold text-[#B8322E] flex items-center justify-end space-x-0.5 mt-0.5">
            <span>↑</span>
            <span>{currentStep.increment}</span>
          </span>
        </div>
      </div>

      {/* -------------------------------------------------------------
          DYNAMIC AUCTION STATUS / SOLD STAMP BANNER
         ------------------------------------------------------------- */}
      <div className="mt-4 pt-3.5 border-t border-[#2A312D]">
        <AnimatePresence mode="wait">
          {isSold ? (
            /* SOLD STATE BANNER */
            <motion.div
              key="sold-state"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="p-3.5 rounded-xl bg-gradient-to-r from-[#B8322E]/20 via-[#181E1A] to-[#C9A227]/20 border-2 border-[#E4B93F] shadow-xl flex items-center justify-between"
            >
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-[#B8322E] flex items-center justify-center text-white shadow-lg">
                  <Gavel className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-sm font-black font-display tracking-widest text-[#B8322E] uppercase">
                      🔨 SOLD
                    </span>
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-xs font-bold text-[#F3F4F1]">
                    SOLD TO: <span className="text-[#E4B93F] font-extrabold uppercase">{currentStep.team}</span>
                  </div>
                </div>
              </div>

              <div className="text-right">
                <span className="block text-[10px] font-mono-numbers font-bold text-[#9CA6A0] uppercase">
                  FINAL PRICE
                </span>
                <span className="text-lg font-black font-mono-numbers text-[#E4B93F]">
                  {currentStep.amount}
                </span>
              </div>
            </motion.div>
          ) : (
            /* ACTIVE BIDDING BANNER */
            <motion.div
              key="bidding-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between text-xs sm:text-sm"
            >
              <div className="flex items-center space-x-2">
                <span className="text-xs text-[#9CA6A0] uppercase tracking-wider font-semibold">
                  Leading Team:
                </span>
                <span className="font-bold text-[#F3F4F1] tracking-wide bg-[#181E1A] px-2.5 py-1 rounded border border-[#C9A227]/50 text-xs flex items-center space-x-1.5 shadow-sm">
                  <Trophy className="w-3.5 h-3.5 text-[#C9A227]" />
                  <span>{currentStep.team}</span>
                </span>
              </div>
              
              <div className="flex items-center space-x-2 bg-[#B8322E]/15 border border-[#B8322E]/50 px-2.5 py-1 rounded text-xs font-mono-numbers font-bold text-[#B8322E]">
                <span className="w-2 h-2 rounded-full bg-[#B8322E] animate-pulse" />
                <span>BIDDING...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
