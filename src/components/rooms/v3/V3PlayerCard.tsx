import React from 'react';
import { V3Player } from '@/lib/v3-auction-types';
import { computePlayerRating } from '@/lib/player-rating';
import { V3PlayerStats } from './V3PlayerStats';

interface V3PlayerCardProps {
  player: V3Player;
  responsive?: boolean;
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

export function V3PlayerCard({ player, responsive = false }: V3PlayerCardProps) {
  const roleClass = roleColors[player.role] ?? 'text-[#9CA6A0] border-[#2A312D] bg-[#1E2522]';
  const catLabel = categoryLabel[player.category] ?? player.category;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#2A312D] bg-[#0F1410] shadow-2xl">

      {/* Top section: image + core identity */}
      <div className={responsive ? 'flex min-w-0 gap-3 p-4 sm:gap-4 sm:p-6' : 'flex gap-4 p-5 sm:p-6'}>

        {/* Player Image */}
        <div className="flex-shrink-0">
          <div className={responsive ? 'flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-[#2A312D] bg-[#0B0F0D] sm:h-20 sm:w-20 lg:h-28 lg:w-28' : 'flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-[#2A312D] bg-[#0B0F0D] sm:h-28 sm:w-28'}>
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
        <div className={responsive ? 'flex min-w-0 flex-1 items-start justify-between gap-2 sm:gap-4' : 'flex min-w-0 flex-1 items-start justify-between gap-4'}>
          <div className="flex flex-col min-w-0">
            <div className={responsive ? 'mb-2 flex min-w-0 items-baseline gap-2 sm:gap-3' : 'mb-2 flex min-w-0 items-baseline gap-3'}>
              <h2 className={responsive ? 'min-w-0 truncate text-xl font-black uppercase leading-tight tracking-tight text-[#F3F4F1] font-display sm:text-3xl sm:leading-none' : 'truncate text-2xl font-black uppercase leading-none tracking-tight text-[#F3F4F1] font-display sm:text-3xl'}>
                {player.name}
              </h2>
            </div>

          {/* Badges row */}
          <div className={responsive ? 'mb-3 flex flex-wrap gap-1.5' : 'mb-3 flex flex-wrap gap-1.5'}>
            <span className={`${responsive ? 'rounded border px-2 py-1 text-xs font-mono font-bold tracking-wider sm:py-0.5 sm:text-[10px] sm:tracking-widest' : 'rounded border px-2 py-0.5 text-[10px] font-mono font-bold tracking-widest'} ${roleClass}`}>
              {roleDisplay[player.role] ?? player.role}
            </span>
            <span className={responsive ? 'rounded border border-[#2A312D] bg-[#1E2522] px-2 py-1 text-xs font-mono font-bold uppercase tracking-wider text-[#9CA6A0] sm:py-0.5 sm:text-[10px] sm:tracking-widest' : 'rounded border border-[#2A312D] bg-[#1E2522] px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest text-[#9CA6A0]'}>
              {player.country}
            </span>
            <span className={responsive ? 'rounded border border-[#C9A227]/30 bg-[#C9A227]/10 px-2 py-1 text-xs font-mono font-bold tracking-wider text-[#C9A227] sm:py-0.5 sm:text-[10px] sm:tracking-widest' : 'rounded border border-[#C9A227]/30 bg-[#C9A227]/10 px-2 py-0.5 text-[10px] font-mono font-bold tracking-widest text-[#C9A227]'}>
              SET {catLabel}
            </span>
            {player.is_overseas && (
              <span className={responsive ? 'rounded border border-[#818CF8]/30 bg-[#818CF8]/10 px-2 py-1 text-xs font-mono font-bold tracking-wider text-[#818CF8] sm:py-0.5 sm:text-[10px] sm:tracking-widest' : 'rounded border border-[#818CF8]/30 bg-[#818CF8]/10 px-2 py-0.5 text-[10px] font-mono font-bold tracking-widest text-[#818CF8]'}>
                OVERSEAS
              </span>
            )}
          </div>

          {/* Info row: base price / age / batting */}
          <div className={responsive ? 'flex flex-wrap gap-3 sm:gap-6' : 'flex flex-wrap gap-4 sm:gap-6'}>
            <div>
              <p className={responsive ? 'mb-0.5 text-xs font-mono font-bold uppercase tracking-wider text-[#9CA6A0] sm:text-[9px] sm:tracking-widest' : 'mb-0.5 text-[9px] font-mono font-bold uppercase tracking-widest text-[#9CA6A0]'}>Base Price</p>
              <p className={responsive ? 'text-base font-mono-numbers font-bold leading-none text-[#E4B93F] sm:text-lg' : 'text-lg font-mono-numbers font-bold leading-none text-[#E4B93F]'}>
                ₹{player.base_price}<span className="text-xs text-[#E4B93F]/60 ml-0.5">L</span>
              </p>
            </div>
            {player.age != null && (
              <div>
                <p className={responsive ? 'mb-0.5 text-xs font-mono font-bold uppercase tracking-wider text-[#9CA6A0] sm:text-[9px] sm:tracking-widest' : 'mb-0.5 text-[9px] font-mono font-bold uppercase tracking-widest text-[#9CA6A0]'}>Age</p>
                <p className={responsive ? 'text-base font-mono-numbers font-bold leading-none text-[#F3F4F1] sm:text-lg' : 'text-lg font-mono-numbers font-bold leading-none text-[#F3F4F1]'}>{player.age}</p>
              </div>
            )}
            {player.batting_hand && (
              <div>
                <p className={responsive ? 'mb-0.5 text-xs font-mono font-bold uppercase tracking-wider text-[#9CA6A0] sm:text-[9px] sm:tracking-widest' : 'mb-0.5 text-[9px] font-mono font-bold uppercase tracking-widest text-[#9CA6A0]'}>Batting</p>
                <p className={responsive ? 'text-sm font-mono font-bold leading-none text-[#F3F4F1] uppercase' : 'text-sm font-mono font-bold leading-none text-[#F3F4F1] uppercase'}>{player.batting_hand}</p>
              </div>
            )}
          </div>
          </div>
          
          <div className={`shrink-0 animate-in fade-in zoom-in-95 duration-500 ease-out ${responsive ? 'motion-reduce:animate-none' : ''}`}>
            <div className={responsive ? 'flex flex-col items-center justify-center rounded-lg border border-[#e4b93f]/30 bg-[#1a1710] px-2 py-1.5 shadow-[0_0_15px_rgba(228,185,63,0.1)] sm:px-2 sm:py-2 lg:px-3' : 'flex flex-col items-center justify-center rounded-lg border border-[#e4b93f]/30 bg-[#1a1710] px-3 py-2 shadow-[0_0_15px_rgba(228,185,63,0.1)]'}>
              <div className="text-[#e4b93f] flex items-center gap-1.5">
                <span className="text-sm">★</span>
                <span className={responsive ? 'text-xl font-black font-mono-numbers leading-none tracking-tighter sm:text-xl lg:text-2xl' : 'text-2xl font-black font-mono-numbers leading-none tracking-tighter'}>
                  {computePlayerRating(player)}
                </span>
                <span className="text-[10px] font-bold font-mono tracking-widest self-end pb-0.5">LVL</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Player Statistics — below player identity */}
      <div className={responsive ? 'px-4 pb-4 sm:px-6 sm:pb-6' : 'px-5 pb-5 sm:px-6 sm:pb-6'}>
        <V3PlayerStats player={player} responsive={responsive} />
      </div>

    </div>
  );
}
