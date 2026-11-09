import type { V3Team } from '@/lib/v3-auction-types';
import { MoneyAmount, SectionHeading } from '../auction-report-ui';

export function LeagueComparison({ teams }: { teams: V3Team[] }) {
  return (
    <section className="min-w-0">
      <SectionHeading
        title="Franchise comparison"
        subtitle="Ranked by total spend, from highest to lowest."
        aside={`${teams.length} ${teams.length === 1 ? 'franchise' : 'franchises'}`}
      />
      <div className="space-y-3">
        {teams.map((team, index) => {
          const spent = team.initial_purse - team.purse;
          const percentage =
            team.initial_purse > 0
              ? Math.min(100, Math.max(0, (spent / team.initial_purse) * 100))
              : 0;
          return (
            <article
              key={team.id}
              className={`min-w-0 rounded-2xl border bg-[#141917] p-4 sm:p-5 ${index === 0 ? 'border-[#C9A227]/40' : 'border-[#2A312D]'}`}
            >
              <div className="mb-4 flex min-w-0 items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-mono-numbers text-sm ${index === 0 ? 'bg-[#C9A227]/15 text-[#E4B93F]' : 'bg-[#202722] text-[#9CA6A0]'}`}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="min-w-0 break-words text-lg font-semibold uppercase leading-snug">
                  {team.name}
                </h3>
              </div>
              <dl className="grid grid-cols-2 gap-4">
                <div className="min-w-0">
                  <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA6A0]">
                    Spent
                  </dt>
                  <dd>
                    <MoneyAmount lakhs={spent} className="text-lg font-semibold text-[#E4B93F]" />
                  </dd>
                </div>
                <div className="min-w-0 text-right">
                  <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA6A0]">
                    Purse left
                  </dt>
                  <dd>
                    <MoneyAmount lakhs={team.purse} className="justify-end text-lg font-semibold" />
                  </dd>
                </div>
              </dl>
              <div
                className="my-3 h-1.5 overflow-hidden rounded-full bg-[#262D27]"
                role="progressbar"
                aria-label={`${team.name} budget spent`}
                aria-valuenow={Math.round(percentage)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-[#C9A227]"
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-xs text-[#9CA6A0]">
                <span>
                  <strong className="font-medium text-[#F3F4F1]">{team.players_bought}</strong>{' '}
                  players ·{' '}
                  <strong className="font-medium text-[#F3F4F1]">{team.overseas_count}/8</strong>{' '}
                  overseas
                </span>
                <span>{percentage.toFixed(0)}% of budget used</span>
              </div>
            </article>
          );
        })}
        {!teams.length && (
          <p className="rounded-2xl border border-dashed border-[#2A312D] p-6 text-sm text-[#9CA6A0]">
            Franchise spending will appear when teams join the auction.
          </p>
        )}
      </div>
    </section>
  );
}
