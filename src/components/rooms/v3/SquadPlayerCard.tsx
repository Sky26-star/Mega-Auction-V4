import React from 'react';
import { V3SquadPlayer } from '@/hooks/useV3Squad';

interface SquadPlayerCardProps {
  squadPlayer: V3SquadPlayer;
}

export function SquadPlayerCard({ squadPlayer }: SquadPlayerCardProps) {
  const { player, winning_bid } = squadPlayer;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[#2A312D] bg-[#141917] p-5 shadow-xl flex flex-col gap-4 hover:border-[#C9A227]/50 hover:bg-[#181E1A] hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#C9A227]/10 transition-all duration-300">
      <div className="absolute inset-0 bg-gradient-to-br from-[#C9A227]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      {/* Top Header */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex flex-col">
          <h3 className="text-xl sm:text-2xl font-black uppercase text-[#F3F4F1] font-display tracking-tight leading-none mb-1">
            {player.name}
          </h3>
          <p className="text-xs font-mono font-bold text-[#9CA6A0] uppercase tracking-widest">
            {player.role} • {player.country}
          </p>
        </div>

        {/* Acquired Price Badge */}
        <div className="shrink-0 text-right bg-[#0B0F0D] border border-[#C9A227]/30 px-3 py-1.5 rounded-lg group-hover:border-[#C9A227] transition-colors">
          <p className="text-[9px] font-mono font-bold text-[#C9A227] uppercase tracking-widest leading-none mb-1">ACQUIRED</p>
          <p className="text-sm font-mono-numbers font-black text-[#F3F4F1] leading-none">
            ₹{winning_bid} <span className="text-[10px] text-[#9CA6A0]">L</span>
          </p>
        </div>
      </div>

      {/* Bottom Meta */}
      <div className="flex flex-wrap gap-2 mt-auto pt-2">
        <span className="px-2 py-1 rounded bg-[#0B0F0D] border border-[#2A312D] text-[10px] font-mono font-bold text-[#9CA6A0]">
          SET: {player.category}
        </span>
        <span className="px-2 py-1 rounded bg-[#0B0F0D] border border-[#2A312D] text-[10px] font-mono font-bold text-[#9CA6A0]">
          {player.is_overseas ? 'OVERSEAS' : 'DOMESTIC'}
        </span>
      </div>
    </div>
  );
}
