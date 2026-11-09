'use client';

import { useParams } from 'next/navigation';
import { useV3Stats } from '@/hooks/useV3Stats';
import { useV3AuctionContext } from '@/components/rooms/v3/V3AuctionStateProvider';
import { StatsHero } from '@/components/rooms/v3/stats/StatsHero';
import { AuctionOverview } from '@/components/rooms/v3/stats/AuctionOverview';
import { LeagueComparison } from '@/components/rooms/v3/stats/LeagueComparison';
import { AuctionHighlights } from '@/components/rooms/v3/stats/AuctionHighlights';
import { MostExpensiveAcquisitions } from '@/components/rooms/v3/stats/MostExpensiveAcquisitions';
import { AuctionReportLayout, ReportFeedback } from '@/components/rooms/v3/auction-report-ui';

export default function StatsPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const { state, loading: stateLoading, error: stateError, refresh } = useV3AuctionContext();
  const {
    stats,
    loading: statsLoading,
    error: statsError,
    refresh: refreshStats,
  } = useV3Stats(state.auction?.id || null);
  const loading = stateLoading || statsLoading;
  const error = stateError || statsError;
  const currentStats = stats?.auctionId === state.auction?.id ? stats : null;

  return (
    <AuctionReportLayout roomId={roomId} active="stats">
      <StatsHero />
      {error || !currentStats ? (
        <ReportFeedback
          loading={loading && !error}
          error={error}
          onRetry={() => {
            void refresh();
            void refreshStats();
          }}
        />
      ) : (
        <>
          <AuctionOverview stats={currentStats} />
          <div className="grid min-w-0 grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-6">
            <LeagueComparison teams={currentStats.teamsSummary} />
            <MostExpensiveAcquisitions
              lots={currentStats.mostExpensive}
              teams={currentStats.teamsSummary}
            />
          </div>
          <AuctionHighlights stats={currentStats} />
        </>
      )}
    </AuctionReportLayout>
  );
}
