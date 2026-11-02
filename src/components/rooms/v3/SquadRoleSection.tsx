import type { V3SquadPlayer } from '@/hooks/useV3Squad';
import { SquadPlayerCard } from './SquadPlayerCard';

export function SquadRoleSection({
  title,
  players,
  roleFilter,
}: {
  title: string;
  players: V3SquadPlayer[];
  roleFilter?: string[];
}) {
  const filteredPlayers = players.filter((p) => !roleFilter || roleFilter.includes(p.player.role));
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-base font-semibold uppercase tracking-wide">{title}</h3>
        <span className="rounded-md border border-[#2A312D] bg-[#141917] px-2 py-0.5 font-mono-numbers text-[10px] text-[#9CA6A0]">
          {filteredPlayers.length}
        </span>
        <div className="h-px flex-1 bg-[#2A312D]" />
      </div>
      {filteredPlayers.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredPlayers.map((p) => (
            <SquadPlayerCard key={p.id || p.lot_id} squadPlayer={p} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-[#2A312D] px-4 py-3 text-xs text-[#9CA6A0]">
          No {title.toLowerCase()} signed yet.
        </p>
      )}
    </section>
  );
}
