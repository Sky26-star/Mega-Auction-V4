import React, { useEffect, useState } from 'react';
import { V3AuctionLot, V3Player, V3Team } from '@/lib/v3-auction-types';
import Image from 'next/image';

interface V3ResultAnimationProps {
  animation: {
    status: 'SOLD' | 'UNSOLD';
    lot: V3AuctionLot;
    player: V3Player;
  };
  teams: V3Team[];
}

export function V3ResultAnimation({ animation, teams }: V3ResultAnimationProps) {
  console.log(`[ TRACE 5 ] ${Date.now()} | V3ResultAnimation render | lot_id: ${animation.lot.id}`);

  const { status, lot, player } = animation;
  const isSold = status === 'SOLD';
  const winningTeam = isSold ? teams.find(t => t.id === lot.winning_team_id) : null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center pointer-events-none transition-all duration-500
      opacity-100 backdrop-blur-sm bg-black/60
    `}>
      {/* Container with pop-in scale animation */}
      <div className={`relative flex flex-col items-center justify-center w-full max-w-4xl p-8 transform transition-transform duration-500 ease-out
        scale-100 translate-y-0
      `}>

        {/* The big status text behind everything (large and semi-transparent) */}
        <div className={`absolute -z-10 font-black tracking-tighter text-[15rem] leading-none select-none opacity-20
          ${isSold ? 'text-[#10B981]' : 'text-[#B8322E]'}
        `}>
          {status}
        </div>

        {/* Foreground Content Card */}
        <div className={`relative flex flex-col items-center justify-center p-12 w-full rounded-[3rem] border-4 overflow-hidden shadow-2xl
          ${isSold ? 'bg-gradient-to-b from-[#10B981]/10 to-[#0B0F0D] border-[#10B981]/30 shadow-[#10B981]/20'
                   : 'bg-gradient-to-b from-[#B8322E]/10 to-[#0B0F0D] border-[#B8322E]/30 shadow-[#B8322E]/20'}
        `}>

          {/* Main Status Text (Foreground) */}
          <h1 className={`font-display font-black text-6xl md:text-8xl uppercase tracking-wider drop-shadow-lg mb-8
            ${isSold ? 'text-[#10B981]' : 'text-[#B8322E]'}
          `}>
            {status}
          </h1>

          {/* Player Image / Name */}
          <div className="flex flex-col items-center space-y-4 mb-8">
            {player.image_url ? (
              <div className="relative w-32 h-32 md:w-48 md:h-48 rounded-full border-4 border-[#2A312D] overflow-hidden bg-[#141917] shadow-xl">
                <Image src={player.image_url} alt={player.name} fill className="object-cover" />
              </div>
            ) : (
              <div className="w-32 h-32 md:w-48 md:h-48 rounded-full border-4 border-[#2A312D] bg-[#141917] flex items-center justify-center shadow-xl">
                <span className="font-mono text-4xl text-[#9CA6A0]">{player.name.charAt(0)}</span>
              </div>
            )}

            <h2 className="font-display font-bold text-3xl md:text-5xl text-[#F3F4F1] text-center">
              {player.name}
            </h2>
            <div className="flex space-x-2 text-sm font-mono font-bold text-[#9CA6A0] uppercase tracking-widest">
              <span>{player.role}</span>
              <span>•</span>
              <span>{player.country}</span>
            </div>
          </div>

          {/* Sold Result Details */}
          {isSold && winningTeam && (
            <div className="flex flex-col items-center animate-fade-in-up mt-4">
              <span className="text-sm font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-3">
                PURCHASED BY
              </span>

              <div className="flex items-center space-x-4 bg-[#0B0F0D] px-8 py-4 rounded-2xl border-2 border-[#10B981]/30">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-[#C9A227] text-[#141917] font-bold text-sm"
                >
                  {winningTeam.short_name.substring(0, 2)}
                </div>
                <span className="font-display font-bold text-2xl text-[#F3F4F1] uppercase">
                  {winningTeam.name}
                </span>
              </div>

              <div className="mt-6 flex flex-col items-center">
                <span className="text-xs font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">
                  FINAL PRICE
                </span>
                <div className="text-5xl font-mono-numbers font-black text-[#E4B93F] drop-shadow-md">
                  ₹{lot.winning_bid} <span className="text-2xl text-[#E4B93F]/70">L</span>
                </div>
              </div>
            </div>
          )}

          {/* Unsold Details */}
          {!isSold && (
            <div className="flex flex-col items-center animate-fade-in-up mt-4">
              <div className="px-6 py-3 rounded-xl border border-dashed border-[#B8322E]/50 text-[#B8322E] font-mono text-lg">
                NO BIDS RECEIVED
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
