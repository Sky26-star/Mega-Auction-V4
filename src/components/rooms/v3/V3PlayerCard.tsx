import React from 'react';
import { V3Player } from '@/lib/v3-auction-types';
import { computePlayerRating } from '@/lib/player-rating';
import { V3PlayerStats } from './V3PlayerStats';

interface V3PlayerCardProps {
  player: V3Player;
}

const roleDisplay: Record<string, string> = {
  BATSMAN: 'BATSMAN',
  BOWLER: 'BOWLER',
  ALL_ROUNDER: 'ALL-ROUNDER',
  WICKET_KEEPER: 'WICKET KEEPER',
};

const roleColors: Record<string, string> = {
  BATSMAN: 'text-[#60A5FA] border-[#60A5FA]/30 bg-[#60A5FA]/10',
  BOWLER: 'text-[#34D399] border-[#34D399]/30 bg-[#34D399]/10',
  ALL_ROUNDER: 'text-[#C084FC] border-[#C084FC]/30 bg-[#C084FC]/10',
  WICKET_KEEPER: 'text-[#FBBF24] border-[#FBBF24]/30 bg-[#FBBF24]/10',
};

const categoryLabel: Record<string, string> = {
  MARQUEE: 'ICON',
  A: 'ELITE',
  B: 'PREMIER',
  C: 'CORE',
  D: 'RISING',
};

export function V3PlayerCard({ player }: V3PlayerCardProps) {
  const roleClass = roleColors[player.role] ?? 'text-[#9CA6A0] border-[#2A312D] bg-[#1E2522]';
  const catLabel = categoryLabel[player.category] ?? player.category;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#2A312D] bg-[#0F1410] shadow-2xl">

      {/* Top section: image + core identity */}
      <div className="flex gap-4 p-5 sm:p-6">

        {/* Player Image */}
        <div className="flex-shrink-0">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border-2 border-[#2A312D] bg-[#0B0F0D] flex items-center justify-center">
            {player.image_url ? (
              <img
                src={player.image_url}
                alt={player.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-3xl font-black text-[#2A312D] uppercase select-none">
                {player.name.substring(0, 2)}
              </span>
            )}
          </div>
        </div>

        {/* Identity & Rating */}
        <div className="flex justify-between items-start gap-4 flex-1 min-w-0">
          <div className="flex flex-col min-w-0">
            <div className="flex items-baseline gap-3 mb-2 min-w-0">
              <h2 className="text-2xl sm:text-3xl font-black uppercase text-[#F3F4F1] font-display tracking-tight leading-none truncate">
                {player.name}
              </h2>
            </div>

          {/* Badges row */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold tracking-widest ${roleClass}`}>
              {roleDisplay[player.role] ?? player.role}
            </span>
            <span className="px-2 py-0.5 rounded border border-[#2A312D] bg-[#1E2522] text-[10px] font-mono font-bold text-[#9CA6A0] tracking-widest uppercase">
              {player.country}
            </span>
            <span className="px-2 py-0.5 rounded border border-[#C9A227]/30 bg-[#C9A227]/10 text-[10px] font-mono font-bold text-[#C9A227] tracking-widest">
              SET {catLabel}
            </span>
            {player.is_overseas && (
              <span className="px-2 py-0.5 rounded border border-[#818CF8]/30 bg-[#818CF8]/10 text-[10px] font-mono font-bold text-[#818CF8] tracking-widest">
                OVERSEAS
              </span>
            )}
          </div>

          {/* Info row: base price / age / batting */}
          <div className="flex flex-wrap gap-4 sm:gap-6">
            <div>
              <p className="text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-0.5">Base Price</p>
              <p className="text-lg font-mono-numbers font-bold text-[#E4B93F] leading-none">
                ₹{player.base_price}<span className="text-xs text-[#E4B93F]/60 ml-0.5">L</span>
              </p>
            </div>
            {player.age != null && (
              <div>
                <p className="text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-0.5">Age</p>
                <p className="text-lg font-mono-numbers font-bold text-[#F3F4F1] leading-none">{player.age}</p>
              </div>
            )}
            {player.batting_hand && (
              <div>
                <p className="text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-0.5">Batting</p>
                <p className="text-sm font-mono font-bold text-[#F3F4F1] leading-none uppercase">{player.batting_hand}</p>
              </div>
            )}
          </div>
          </div>
          
          <div className="flex-shrink-0 animate-in fade-in zoom-in-95 duration-500 ease-out">
            <div className="bg-[#1a1710] border border-[#e4b93f]/30 rounded-lg px-3 py-2 flex flex-col items-center justify-center shadow-[0_0_15px_rgba(228,185,63,0.1)]">
              <div className="text-[#e4b93f] flex items-center gap-1.5">
                <span className="text-sm">★</span>
                <span className="text-2xl font-black font-mono-numbers leading-none tracking-tighter">
                  {computePlayerRating(player)}
                </span>
                <span className="text-[10px] font-bold font-mono tracking-widest self-end pb-0.5">LVL</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Player Statistics — below player identity */}
      <div className="px-5 sm:px-6 pb-5 sm:pb-6">
        <V3PlayerStats player={player} />
      </div>

    </div>
  );
}
