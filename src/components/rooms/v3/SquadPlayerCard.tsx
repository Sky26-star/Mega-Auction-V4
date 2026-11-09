import type { V3SquadPlayer } from '@/hooks/useV3Squad';
import { MoneyAmount } from './auction-report-ui';

export function SquadPlayerCard({ squadPlayer }: { squadPlayer: V3SquadPlayer }) {
  const { player, winning_bid } = squadPlayer;
  const initials = player.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-[#2A312D] bg-[#141917] p-4 transition-colors hover:border-[#C9A227]/50">
      <div className="mb-4 flex items-center justify-between gap-2">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#C9A227]/20 bg-[#C9A227]/10 font-display text-lg text-[#E4B93F]"
        >
          {initials}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${player.is_overseas ? 'bg-[#C9A227]/10 text-[#E4B93F]' : 'bg-[#242E27] text-[#ABBFAF]'}`}
        >
          {player.is_overseas ? 'Overseas' : 'Domestic'}
        </span>
      </div>
      <h4 className="break-words text-xl font-semibold uppercase leading-tight">{player.name}</h4>
      <p className="mb-4 mt-1 text-xs leading-relaxed text-[#9CA6A0]">
        {player.country || 'India'} · {player.role.replaceAll('_', ' ')}
      </p>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-[#2A312D] pt-3">
        <div>
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[#9CA6A0]">
            Acquired for
          </p>
          <MoneyAmount lakhs={winning_bid} className="text-lg font-semibold text-[#E4B93F]" />
        </div>
        {player.category && (
          <span className="rounded-md border border-[#2A312D] px-2 py-1 text-[10px] text-[#9CA6A0]">
            Set {player.category}
          </span>
        )}
      </div>
    </article>
  );
}
