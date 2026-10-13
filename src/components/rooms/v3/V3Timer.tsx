import React, { useState, useEffect } from 'react';
import { V3AuctionLot, V3Auction } from '@/lib/v3-auction-types';
import { Clock } from 'lucide-react';

interface V3TimerProps {
  lot: V3AuctionLot;
  auction?: V3Auction | null;
}

export function V3Timer({ lot, auction }: V3TimerProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    // 1. If auction is paused, parse paused_reason for static display
    if (auction?.status === 'PAUSED' && auction.paused_reason) {
      try {
        const parsed = JSON.parse(auction.paused_reason);
        if (parsed.remaining_ms != null) {
          setSecondsLeft(Math.ceil(parsed.remaining_ms / 1000));
          return; // Frozen timer, no interval
        }
      } catch (e) {
        // Fallthrough if parsing fails
      }
    }

    let targetTime: string | null = null;

    if (lot.status === 'GET_READY') {
      targetTime = lot.get_ready_expires_at;
    } else if (lot.status === 'BIDDING') {
      targetTime = lot.timer_expires_at;
    }

    if (!targetTime) {
      setSecondsLeft(null);
      return;
    }

    const targetDate = new Date(targetTime).getTime();

    const updateTimer = () => {
      const now = new Date().getTime();
      const diff = Math.max(0, Math.ceil((targetDate - now) / 1000));
      setSecondsLeft(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);

    return () => clearInterval(interval);
  }, [lot.status, lot.get_ready_expires_at, lot.timer_expires_at, auction?.status, auction?.paused_reason]);

  if (secondsLeft === null || lot.status === 'PENDING') {
    return null;
  }

  const isPaused = auction?.status === 'PAUSED';
  const isUrgent = !isPaused && lot.status === 'BIDDING' && secondsLeft <= 5 && secondsLeft > 0;

  // Format seconds to mm:ss if desired, or just keep it as XXs. The user suggested 00:04, but currently it's just {secondsLeft}s. Let's format it nicely.
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  };

  return (
    <div className={`flex flex-col items-center justify-center p-6 rounded-3xl border-2 transition-all duration-300 ${
      isPaused
        ? 'bg-[#1E2522]/80 border-[#C9A227]/50 shadow-[0_0_15px_rgba(201,162,39,0.1)]'
        : isUrgent
          ? 'bg-[#B8322E]/10 border-[#B8322E] shadow-[0_0_30px_rgba(184,50,46,0.2)]'
          : 'bg-[#141917] border-[#2A312D]'
    }`}>
      <div className="flex items-center space-x-2 mb-2">
        <Clock className={`w-5 h-5 ${isPaused ? 'text-[#C9A227] opacity-80' : isUrgent ? 'text-[#B8322E] animate-pulse' : 'text-[#9CA6A0]'}`} />
        <span className={`text-sm font-mono font-bold uppercase tracking-widest ${
          isPaused ? 'text-[#C9A227] animate-pulse' : isUrgent ? 'text-[#B8322E]' : 'text-[#9CA6A0]'
        }`}>
          {isPaused ? 'PAUSED' : lot.status === 'GET_READY' ? 'STARTING IN' : 'TIME REMAINING'}
        </span>
      </div>
      <div className={`text-6xl font-mono-numbers font-black ${
        isPaused ? 'text-[#F3F4F1] opacity-70' : isUrgent ? 'text-[#B8322E]' : 'text-[#F3F4F1]'
      }`}>
        {formatTime(secondsLeft)}
      </div>
    </div>
  );
}
