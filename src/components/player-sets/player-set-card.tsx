'use client';

// src/components/player-sets/player-set-card.tsx
// Auction Database Control Center Card Component (V2 UI/UX Redesign)

import React from 'react';
import Link from 'next/link';
import type { PlayerSet } from '@/lib/types/player-set';
import { Database, Users, Globe, Lock, ArrowRight, Edit, Trash2, Calendar, User as UserIcon } from 'lucide-react';

interface PlayerSetCardProps {
  playerSet: PlayerSet;
  isOwner: boolean;
  onEdit?: (playerSet: PlayerSet) => void;
  onDelete?: (playerSet: PlayerSet) => void;
}

export function PlayerSetCard({ playerSet, isOwner, onEdit, onDelete }: PlayerSetCardProps) {
  const formattedDate = playerSet.updated_at
    ? new Date(playerSet.updated_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : new Date(playerSet.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

  const totalPlayers = playerSet.player_count || 0;
  const counts = playerSet.category_counts || { MARQUEE: 0, A: 0, B: 0, C: 0, D: 0 };

  // Calculate percentage widths for distribution meter bar
  const getMeterPct = (val: number) => {
    if (totalPlayers === 0) return 0;
    return Math.max(0, Math.min(100, Math.round((val / totalPlayers) * 100)));
  };

  const pctIcon = getMeterPct(counts.MARQUEE);
  const pctElite = getMeterPct(counts.A);
  const pctPremier = getMeterPct(counts.B);
  const pctCore = getMeterPct(counts.C);
  const pctRising = getMeterPct(counts.D);

  const previewImages = playerSet.preview_images || [];

  return (
    <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#2A312D] hover:border-[#7C3AED]/60 shadow-xl hover:shadow-2xl hover:shadow-purple-950/20 hover:-translate-y-0.5 transition-all duration-200 p-5 flex flex-col justify-between group font-sans">
      <div>
        {/* Top Header */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#7C3AED]/20 text-[#A855F7] border border-[#7C3AED]/40 flex items-center justify-center flex-shrink-0 shadow-inner">
              <Database className="w-4 h-4" />
            </div>
            <h3 className="text-base font-black text-[#F3F4F1] group-hover:text-[#A855F7] transition-colors truncate font-display">
              {playerSet.name}
            </h3>
          </div>

          <div className="flex items-center space-x-2 flex-shrink-0">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                playerSet.is_public
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                  : 'bg-[#0B0F0D] text-[#9CA6A0] border-[#2A312D]'
              }`}
            >
              {playerSet.is_public ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {playerSet.is_public ? 'PUBLIC' : 'PRIVATE'}
            </span>

            {isOwner && (
              <div className="flex items-center space-x-0.5">
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(playerSet)}
                    className="p-1.5 rounded-lg text-[#9CA6A0] hover:text-white hover:bg-[#181E1A] transition-colors"
                    title="Edit Player Set"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(playerSet)}
                    className="p-1.5 rounded-lg text-[#9CA6A0] hover:text-red-400 hover:bg-red-950/30 transition-colors"
                    title="Delete Player Set"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-[#9CA6A0] line-clamp-2 mb-4 leading-relaxed min-h-[36px]">
          {playerSet.description || 'Custom cricket player database for IPL auction rooms.'}
        </p>

        {/* Player Count & Avatar Preview Strip */}
        <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Users className="w-4 h-4 text-[#A855F7]" />
            <span className="text-xs font-mono font-extrabold text-[#F3F4F1] tracking-wider">
              {totalPlayers} <span className="text-[10px] font-sans font-bold text-[#9CA6A0] uppercase">PLAYERS</span>
            </span>
          </div>

          {/* Overlapping Avatar Preview Strip */}
          <div className="flex items-center -space-x-2">
            {previewImages.length > 0 ? (
              previewImages.map((url, idx) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={idx}
                  src={url}
                  alt="Player"
                  className="w-6 h-6 rounded-full object-cover border-2 border-[#0B0F0D]"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ))
            ) : (
              <div className="w-6 h-6 rounded-full bg-[#181E1A] border-2 border-[#0B0F0D] flex items-center justify-center text-[#9CA6A0]">
                <UserIcon className="w-3 h-3" />
              </div>
            )}
          </div>
        </div>

        {/* Category Breakdown Meter & Counts */}
        <div className="space-y-1.5 mb-5">
          <div className="flex items-center justify-between text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-wider">
            <span>CATEGORY COMPOSITION</span>
            <span className="text-[#E4B93F]">5 TIERS</span>
          </div>

          {/* Segmented Progress Meter Bar */}
          <div className="h-2 w-full rounded-full bg-[#181E1A] border border-[#2A312D] overflow-hidden flex">
            {totalPlayers > 0 ? (
              <>
                <div style={{ width: `${pctIcon}%` }} className="bg-amber-400 h-full" title={`Icon: ${counts.MARQUEE}`} />
                <div style={{ width: `${pctElite}%` }} className="bg-purple-500 h-full" title={`Elite: ${counts.A}`} />
                <div style={{ width: `${pctPremier}%` }} className="bg-indigo-500 h-full" title={`Premier: ${counts.B}`} />
                <div style={{ width: `${pctCore}%` }} className="bg-emerald-500 h-full" title={`Core: ${counts.C}`} />
                <div style={{ width: `${pctRising}%` }} className="bg-slate-500 h-full" title={`Rising: ${counts.D}`} />
              </>
            ) : (
              <div className="w-full bg-[#222A25] h-full" />
            )}
          </div>

          {/* Individual Category Numbers Grid */}
          <div className="grid grid-cols-5 gap-1 pt-1 text-center">
            <div className="p-1 rounded bg-[#0B0F0D] border border-[#2A312D]">
              <span className="block text-[8px] font-bold text-amber-400 font-mono uppercase">ICON</span>
              <span className="text-[11px] font-bold font-mono text-[#F3F4F1]">{counts.MARQUEE}</span>
            </div>
            <div className="p-1 rounded bg-[#0B0F0D] border border-[#2A312D]">
              <span className="block text-[8px] font-bold text-purple-400 font-mono uppercase">ELITE</span>
              <span className="text-[11px] font-bold font-mono text-[#F3F4F1]">{counts.A}</span>
            </div>
            <div className="p-1 rounded bg-[#0B0F0D] border border-[#2A312D]">
              <span className="block text-[8px] font-bold text-indigo-400 font-mono uppercase">PREMIER</span>
              <span className="text-[11px] font-bold font-mono text-[#F3F4F1]">{counts.B}</span>
            </div>
            <div className="p-1 rounded bg-[#0B0F0D] border border-[#2A312D]">
              <span className="block text-[8px] font-bold text-emerald-400 font-mono uppercase">CORE</span>
              <span className="text-[11px] font-bold font-mono text-[#F3F4F1]">{counts.C}</span>
            </div>
            <div className="p-1 rounded bg-[#0B0F0D] border border-[#2A312D]">
              <span className="block text-[8px] font-bold text-slate-400 font-mono uppercase">RISING</span>
              <span className="text-[11px] font-bold font-mono text-[#F3F4F1]">{counts.D}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Info & Dominant Action */}
      <div className="pt-3 border-t border-[#2A312D] flex items-center justify-between text-xs">
        <div className="flex items-center space-x-1 text-[10px] text-[#9CA6A0] font-mono">
          <Calendar className="w-3 h-3 text-[#A855F7]" />
          <span>{formattedDate}</span>
        </div>

        {/* DOMINANT ACTION BUTTON */}
        <Link
          href={`/player-sets/${playerSet.id}`}
          className="px-4 py-2 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-mono font-bold text-xs shadow-lg shadow-purple-950/40 flex items-center space-x-1.5 transition-all group/btn"
        >
          <span>OPEN DATABASE</span>
          <ArrowRight className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
}
