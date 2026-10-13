'use client';

// src/components/rooms/auction-status-bar.tsx
import React from 'react';

export interface AuctionStatusBarProps {
  participantCount: number;
  roomCode: string;
  defaultPurseCr: number; // e.g. 100
  playerSetName?: string;
  auctionMode?: string;
  isConnected?: boolean;
}

export function AuctionStatusBar({
  participantCount,
  roomCode,
  defaultPurseCr,
  playerSetName = 'IPL 2026 MARQUEE',
  auctionMode = 'MEGA AUCTION',
  isConnected = true,
}: AuctionStatusBarProps) {
  // Ensure Purse is always formatted in Crores
  const formattedPurse = defaultPurseCr > 0 ? `₹${defaultPurseCr} Cr` : '₹100 Cr';

  return (
    <div className="w-full bg-[#0B0F0D] border-y border-[#2A312D] px-4 py-2.5 overflow-x-auto scrollbar-none">
      <div className="max-w-7xl mx-auto flex items-center justify-between min-w-max gap-6 text-xs font-mono-numbers font-bold">
        
        {/* Connection Status */}
        <div className="flex items-center space-x-2 text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-live" />
          <span>● ONLINE</span>
        </div>

        <span className="text-[#2A312D]">|</span>

        {/* Managers */}
        <div className="flex items-center space-x-2 text-[#F3F4F1]">
          <span className="text-[#9CA6A0]">MANAGERS:</span>
          <span className="text-[#E4B93F]">● {participantCount} MANAGERS</span>
        </div>

        <span className="text-[#2A312D]">|</span>

        {/* Room Code */}
        <div className="flex items-center space-x-2 text-[#F3F4F1]">
          <span className="text-[#9CA6A0]">ROOM CODE:</span>
          <span className="text-[#C9A227] tracking-widest">● ROOM {roomCode}</span>
        </div>

        <span className="text-[#2A312D]">|</span>

        {/* Purse in Crores */}
        <div className="flex items-center space-x-2 text-[#F3F4F1]">
          <span className="text-[#9CA6A0]">STARTING PURSE:</span>
          <span className="text-[#E4B93F]">● {formattedPurse} PURSE</span>
        </div>

        <span className="text-[#2A312D]">|</span>

        {/* Player Set */}
        <div className="flex items-center space-x-2 text-[#F3F4F1]">
          <span className="text-[#9CA6A0]">PLAYER POOL:</span>
          <span className="text-[#F3F4F1] uppercase">● {playerSetName}</span>
        </div>

        <span className="text-[#2A312D]">|</span>

        {/* Auction Mode */}
        <div className="flex items-center space-x-2 text-[#C9A227]">
          <span className="w-2 h-2 rounded-full bg-[#C9A227]" />
          <span className="uppercase">● {auctionMode}</span>
        </div>

      </div>
    </div>
  );
}
