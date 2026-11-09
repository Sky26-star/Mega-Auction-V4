import type { V3StatsLot } from '@/hooks/useV3Stats';
import type { V3Team } from '@/lib/v3-auction-types';
import { MoneyAmount, SectionHeading } from '../auction-report-ui';

export function MostExpensiveAcquisitions({
  lots,
  teams,
}: {
  lots: V3StatsLot[];
  teams: V3Team[];
}) {
  return (
    <section className="min-w-0">
      <SectionHeading
        title="Top acquisitions"
        subtitle="The five biggest signings by final price."
      />
      <ol className="overflow-hidden rounded-2xl border border-[#2A312D] bg-[#141917]">
        {lots.map((lot, index) => (
          <li
            key={lot.lot_id}
            className="flex min-w-0 gap-3 border-b border-[#2A312D] p-4 last:border-0 sm:p-5"
          >
            <span className="mt-1 w-5 shrink-0 font-mono-numbers text-xs text-[#9CA6A0]">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <h3 className="min-w-0 break-words text-lg font-semibold uppercase leading-snug">
                  {lot.player.name}
                </h3>
                <MoneyAmount
                  lakhs={lot.winning_bid}
                  className="text-base font-semibold text-[#E4B93F]"
                />
              </div>
              <p className="mt-1 text-xs text-[#9CA6A0]">
                {lot.player.role.replaceAll('_', ' ')} · {lot.player.country || 'India'}
              </p>
              <p className="mt-3 break-words text-xs text-[#D0D4D1]">
                {teams.find((t) => t.id === lot.winning_team_id)?.name || 'Unassigned franchise'}
              </p>
            </div>
          </li>
        ))}
        {!lots.length && (
          <li className="p-6 text-sm leading-relaxed text-[#9CA6A0]">
            No completed signings yet. The highest-priced players will appear here after a sale.
          </li>
        )}
      </ol>
    </section>
  );
}
