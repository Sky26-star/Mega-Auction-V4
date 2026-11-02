import type { V3Team } from '@/lib/v3-auction-types';
import { MoneyAmount, ReportMetric } from './auction-report-ui';

export function SquadMetrics({ team }: { team: V3Team }) {
  return (
    <section aria-label="Franchise overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <ReportMetric label="Available purse" detail="Ready for your next signing" highlight>
        <MoneyAmount lakhs={team.purse} />
      </ReportMetric>
      <ReportMetric label="Total spent" detail="Invested in this squad">
        <MoneyAmount lakhs={team.initial_purse - team.purse} />
      </ReportMetric>
      <ReportMetric
        label="Squad size"
        detail={`${Math.max(0, 25 - team.players_bought)} places remaining`}
      >
        <span className="font-mono-numbers">
          {team.players_bought}
          <span className="ml-2 text-sm font-normal text-[#9CA6A0]">/ 25</span>
        </span>
      </ReportMetric>
      <ReportMetric
        label="Overseas players"
        detail={`${Math.max(0, 8 - team.overseas_count)} overseas places remaining`}
      >
        <span className="font-mono-numbers">
          {team.overseas_count}
          <span className="ml-2 text-sm font-normal text-[#9CA6A0]">/ 8</span>
        </span>
      </ReportMetric>
    </section>
  );
}
