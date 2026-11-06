import type { V3StatsData } from '@/hooks/useV3Stats';
import { MoneyAmount, ReportMetric } from '../auction-report-ui';

export function AuctionOverview({ stats }: { stats: V3StatsData }) {
  return (
    <section
      aria-label="Auction overview"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
    >
      <ReportMetric label="Players auctioned" detail="Completed lots">
        {stats.totalLotsAuctioned}
      </ReportMetric>
      <ReportMetric
        label="Players sold"
        detail={`${stats.totalLotsAuctioned ? Math.round((stats.totalSold / stats.totalLotsAuctioned) * 100) : 0}% of completed lots`}
        highlight
      >
        {stats.totalSold}
      </ReportMetric>
      <ReportMetric label="Unsold" detail="Available for another round">
        {stats.totalUnsold}
      </ReportMetric>
      <ReportMetric label="Total spent" detail="Across all franchises" highlight>
        <MoneyAmount lakhs={stats.capitalDeployed} />
      </ReportMetric>
      <ReportMetric label="Average price" detail="Per sold player">
        <MoneyAmount lakhs={stats.averageSoldPrice} />
      </ReportMetric>
      <ReportMetric label="Highest bid" detail={stats.highestBidLot?.player.name || 'No sales yet'}>
        <MoneyAmount lakhs={stats.highestBidLot?.winning_bid} />
      </ReportMetric>
    </section>
  );
}
