'use client';

// src/components/player-sets/player-card.tsx
// Player Card UI Component (Player Master Data V2 Foundation)

import React, { useState } from 'react';
import type { Player } from '@/lib/types/player-set';
import { CATEGORY_UI_LABELS } from '@/lib/types/player-set';
import { Globe, User, Shield, Award, Activity, X } from 'lucide-react';

interface PlayerCardProps {
  player: Player;
  onClose?: () => void;
}

export function getRoleStats(player: Player): { label: string; value: string | number }[] {
  const formatVal = (v: number | string | null | undefined): string | number => {
    if (v === null || v === undefined || v === '') return '-';
    return v;
  };

  switch (player.role) {
    case 'BATSMAN':
      return [
        { label: 'Matches', value: formatVal(player.matches) },
        { label: 'Runs', value: formatVal(player.runs) },
        { label: 'Average', value: formatVal(player.batting_average) },
        { label: 'Strike Rate', value: formatVal(player.strike_rate) },
        { label: '100s', value: formatVal(player.hundreds) },
        { label: '50s', value: formatVal(player.fifties) },
        { label: 'Highest Score', value: formatVal(player.highest_score) },
        { label: 'Boundaries', value: formatVal(player.boundaries) },
      ];

    case 'WICKET_KEEPER':
      return [
        { label: 'Matches', value: formatVal(player.matches) },
        { label: 'Runs', value: formatVal(player.runs) },
        { label: 'Average', value: formatVal(player.batting_average) },
        { label: 'Strike Rate', value: formatVal(player.strike_rate) },
        { label: '50s', value: formatVal(player.fifties) },
        { label: 'Highest Score', value: formatVal(player.highest_score) },
        { label: 'Catches', value: formatVal(player.catches) },
        { label: 'Stumpings', value: formatVal(player.stumpings) },
      ];

    case 'BOWLER':
      return [
        { label: 'Matches', value: formatVal(player.matches) },
        { label: 'Overs', value: formatVal(player.overs) },
        { label: 'Wickets', value: formatVal(player.wickets) },
        { label: 'Bowling Average', value: formatVal(player.bowling_average) },
        { label: 'Economy Rate', value: formatVal(player.economy_rate) },
        { label: 'Strike Rate', value: formatVal(player.bowling_strike_rate) },
        { label: 'Best Bowling', value: formatVal(player.best_bowling) },
        { label: '3-Wicket Hauls', value: formatVal(player.three_wicket_hauls) },
      ];

    case 'ALL_ROUNDER':
    default:
      return [
        { label: 'Matches', value: formatVal(player.matches) },
        { label: 'Runs', value: formatVal(player.runs) },
        { label: 'Batting Average', value: formatVal(player.batting_average) },
        { label: 'Strike Rate', value: formatVal(player.strike_rate) },
        { label: 'Wickets', value: formatVal(player.wickets) },
        { label: 'Bowling Average', value: formatVal(player.bowling_average) },
        { label: 'Economy Rate', value: formatVal(player.economy_rate) },
        { label: 'Best Bowling', value: formatVal(player.best_bowling) },
      ];
  }
}

export function PlayerCard({ player, onClose }: PlayerCardProps) {
  const [imgError, setImgError] = useState(false);
  const stats = getRoleStats(player);
  const categoryLabel = CATEGORY_UI_LABELS[player.category] || player.category;

  return (
    <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden font-sans">
      {/* Top Banner Gradient */}
      <div className="h-28 bg-gradient-to-r from-violet-900/60 via-indigo-900/40 to-slate-900 p-4 flex items-start justify-between">
        <div className="flex items-center space-x-2">
          <span className="px-3 py-1 rounded-full bg-slate-950/80 border border-violet-500/30 text-violet-300 font-bold text-[11px] uppercase tracking-wider shadow">
            {categoryLabel}
          </span>
          {player.is_overseas && (
            <span className="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] font-bold flex items-center gap-1 shadow">
              <Globe className="w-3 h-3" /> Overseas
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-slate-950/60 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Main Content Body */}
      <div className="px-6 pb-6 pt-0 relative -mt-12">
        {/* Avatar & Base Info */}
        <div className="flex items-end space-x-4 mb-4">
          <div className="w-24 h-24 rounded-2xl bg-slate-800 border-2 border-slate-700 overflow-hidden shadow-xl flex-shrink-0 relative">
            {player.image_url && !imgError ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={player.image_url}
                alt={player.name}
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center text-slate-400">
                <User className="w-10 h-10 mb-0.5 text-slate-500" />
                <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">No Image</span>
              </div>
            )}
          </div>

          <div className="pb-1 min-w-0 flex-1">
            <h3 className="text-xl font-bold text-white truncate leading-snug">{player.name}</h3>
            <p className="text-xs text-indigo-400 font-medium flex items-center gap-1.5 mt-0.5">
              <span>{player.country}</span>
              <span>•</span>
              <span className="text-slate-300">{player.role.replace('_', ' ')}</span>
            </p>
            {(player.age !== null || player.batting_hand) && (
              <p className="text-[11px] text-slate-400 mt-1">
                {player.age !== null && <span>Age: {player.age}</span>}
                {player.age !== null && player.batting_hand && <span> • </span>}
                {player.batting_hand && <span>{player.batting_hand}</span>}
              </p>
            )}
          </div>
        </div>

        {/* Base Price & Category classification */}
        <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between mb-5">
          <div className="flex items-center space-x-2">
            <Shield className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-medium text-slate-300">Base Price</span>
          </div>
          <div className="text-right">
            <span className="text-lg font-mono font-bold text-emerald-400">{player.base_price}</span>
            <span className="text-xs font-semibold text-emerald-400/80 ml-1">Lakhs</span>
          </div>
        </div>

        {/* IPL Career 8 Statistics Header */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              IPL Career Statistics
            </h4>
            <span className="text-[10px] text-slate-500 font-mono">ROLE SPECIFIC (8)</span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {stats.map((st, i) => (
              <div
                key={i}
                className="p-2 rounded-xl bg-slate-800/40 border border-slate-800 text-center flex flex-col justify-between min-h-[56px]"
              >
                <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-tight line-clamp-1">
                  {st.label}
                </span>
                <span className="text-xs font-bold font-mono text-white mt-1">
                  {st.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
