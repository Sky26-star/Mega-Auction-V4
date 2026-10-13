import React from 'react';
import { V3SquadPlayer } from '@/hooks/useV3Squad';
import { SquadPlayerCard } from './SquadPlayerCard';

interface SquadRoleSectionProps {
  title: string;
  players: V3SquadPlayer[];
  roleFilter?: string[];
}

export function SquadRoleSection({ title, players, roleFilter }: SquadRoleSectionProps) {
  const filteredPlayers = players.filter(p =>
    roleFilter ? roleFilter.includes(p.player.role) : true
  );

  return (
    <div className="mb-12">
      <div className="flex items-baseline justify-between border-b border-[#2A312D] pb-3 mb-6">
        <h2 className="text-lg sm:text-xl font-black uppercase text-[#F3F4F1] font-display tracking-widest">
          {title}
        </h2>
        <span className="text-xs font-mono font-bold text-[#C9A227]">
          {filteredPlayers.length} {filteredPlayers.length === 1 ? 'PLAYER' : 'PLAYERS'}
        </span>
      </div>

      {filteredPlayers.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredPlayers.map(p => (
            <SquadPlayerCard key={p.lot_id} squadPlayer={p} />
          ))}
        </div>
      ) : (
        <div className="w-full py-12 border-2 border-dashed border-[#2A312D] rounded-2xl bg-[#141917]/30 flex flex-col items-center justify-center space-y-2">
          <p className="font-mono text-sm text-[#9CA6A0] uppercase tracking-widest">
            NO ACQUISITIONS YET
          </p>
        </div>
      )}
    </div>
  );
}
