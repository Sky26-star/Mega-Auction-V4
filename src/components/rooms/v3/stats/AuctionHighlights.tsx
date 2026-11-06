import { Flame, Timer, TrendingUp } from 'lucide-react';
import type { V3StatsData, V3StatsLot } from '@/hooks/useV3Stats';
import { formatLakhsToCr } from '@/lib/auction/units';
import { MoneyAmount, SectionHeading } from '../auction-report-ui';

export function AuctionHighlights({ stats }: { stats: V3StatsData }) {
  const highlights = [
    {
      title: 'Fiercest battle',
      icon: Flame,
      lot: stats.mostBidsLot,
      metric: `${stats.mostBidsLot?.bid_count || 0} bids`,
      empty: 'Bidding battles will appear after the first sale.',
    },
    {
      title: 'Longest standoff',
      icon: Timer,
      lot: stats.longestBattleLot,
      metric: `${Math.round(stats.longestBattleLot?.battle_duration_seconds || 0)} seconds`,
      empty: 'Waiting for a player with multiple timed bids.',
    },
    {
      title: 'Biggest price jump',
      icon: TrendingUp,
      lot: stats.biggestPriceJumpLot,
      metric: `₹${formatLakhsToCr(stats.biggestPriceJumpLot?.max_increment)} Cr jump`,
      empty: 'Waiting for a price increase between bids.',
    },
  ];
  return (
    <section>
      <SectionHeading title="Auction highlights" subtitle="The moments that made this auction." />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {highlights.map(({ title, icon: Icon, lot, metric, empty }) => (
          <article
            key={title}
            className={`flex min-w-0 flex-col rounded-2xl border p-5 ${lot ? 'border-[#C9A227]/30 bg-[#191F18]' : 'border-[#2A312D] bg-[#141917]'}`}
          >
            <div className="mb-5 flex items-center gap-2 text-[#C9A227]">
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <h3 className="font-sans text-[11px] font-semibold uppercase tracking-wider">
                {title}
              </h3>
            </div>
            {lot ? (
              <HighlightDetails
                lot={lot}
                metric={metric}
                teamName={
                  stats.teamsSummary.find((t) => t.id === lot.winning_team_id)?.name ||
                  'Unassigned franchise'
                }
              />
            ) : (
              <div className="flex flex-1 flex-col justify-center py-2">
                <p className="text-base font-medium text-[#9CA6A0]">No highlight yet</p>
                <p className="mt-2 text-xs leading-relaxed text-[#9CA6A0]">{empty}</p>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function HighlightDetails({
  lot,
  metric,
  teamName,
}: {
  lot: V3StatsLot;
  metric: string;
  teamName: string;
}) {
  return (
    <>
      <h4 className="break-words text-2xl font-semibold uppercase leading-tight">
        {lot.player.name}
      </h4>
      <p className="mt-1 text-xs text-[#9CA6A0]">
        {lot.player.role.replaceAll('_', ' ')} · {lot.player.country || 'India'}
      </p>
      <p className="mb-5 mt-4 text-lg font-semibold text-[#E4B93F]">{metric}</p>
      <div className="mt-auto border-t border-[#C9A227]/15 pt-3">
        <p className="mb-2 break-words text-xs text-[#9CA6A0]">{teamName}</p>
        <MoneyAmount lakhs={lot.winning_bid} className="text-lg font-semibold" />
        <span className="ml-2 text-xs text-[#9CA6A0]">winning bid</span>
      </div>
    </>
  );
}
