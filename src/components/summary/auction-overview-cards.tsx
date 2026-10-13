
import React from 'react';
import type { SummaryOverview } from '@/lib/summary/loader';
import {
  DollarSign,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Award,
  Clock,
} from 'lucide-react';

interface AuctionOverviewCardsProps {
  overview: SummaryOverview;
}

export function AuctionOverviewCards({ overview }: AuctionOverviewCardsProps) {
  const cards = [
    {
      label: 'GROSS ACQUISITIONS',
      value: `₹${overview.totalSpendCr.toFixed(2)} Cr`,
      note: 'Gross Turnover / Commitments',
      icon: DollarSign,
      color: 'gold',
    },
    {
      label: 'PLAYERS SOLD',
      value: `${overview.soldCount} / ${overview.totalLots}`,
      note: `Mega: ${overview.megaSoldCount ?? overview.round1SoldCount} | Mini: ${overview.miniSoldCount ?? overview.round2SoldCount}`,
      icon: CheckCircle2,
      color: 'emerald',
    },
    {
      label: 'UNSOLD',
      value: String(overview.unsoldCount),
      note: 'Passed Unsold Lots',
      icon: XCircle,
      color: 'danger',
    },
    {
      label: 'AVG PRICE',
      value: `₹${overview.averagePurchasePriceCr.toFixed(2)} Cr`,
      note: 'Mean Sold Value',
      icon: TrendingUp,
      color: 'gold',
    },
    {
      label: 'TOP BUY',
      value: `₹${overview.highestPurchaseCr.toFixed(2)} Cr`,
      note: 'Highest Purchase',
      icon: Award,
      color: 'highlight',
    },
    {
      label: 'DURATION',
      value: `${overview.durationMinutes}`,
      suffix: 'min',
      note: 'Auction Runtime',
      icon: Clock,
      color: 'neutral',
    },
  ] as const;

  const styles = {
    gold: {
      border: 'border-[#2A312D]',
      label: 'text-[#C9A227]',
      value: 'text-[#E4B93F]',
      icon: 'bg-[#0B0F0D] text-[#C9A227] border border-[#2A312D]',
    },
    emerald: {
      border: 'border-[#2A312D]',
      label: 'text-emerald-400',
      value: 'text-[#F3F4F1]',
      icon: 'bg-[#0B0F0D] text-emerald-400 border border-[#2A312D]',
    },
    danger: {
      border: 'border-[#2A312D]',
      label: 'text-[#B8322E]',
      value: 'text-red-400',
      icon: 'bg-[#0B0F0D] text-[#B8322E] border border-[#2A312D]',
    },
    highlight: {
      border: 'border-[#C9A227]/40',
      label: 'text-[#E4B93F]',
      value: 'text-[#E4B93F]',
      icon: 'bg-[#0B0F0D] text-[#E4B93F] border border-[#C9A227]/40',
    },
    neutral: {
      border: 'border-[#2A312D]',
      label: 'text-[#9CA6A0]',
      value: 'text-[#F3F4F1]',
      icon: 'bg-[#0B0F0D] text-[#9CA6A0] border border-[#2A312D]',
    },
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {cards.map((card) => {
        const Icon = card.icon;
        const style = styles[card.color];

        return (
          <div
            key={card.label}
            className={`relative min-w-0 overflow-hidden rounded-2xl border ${style.border} bg-[#141917] p-2.5 sm:p-3 shadow-md hover:border-[#C9A227]/40 transition-colors`}
          >
            <div className="flex items-center justify-between gap-1">
              <span
                className={`text-[8px] sm:text-[9px] font-mono font-black ${style.label} tracking-wide leading-tight`}
              >
                {card.label}
              </span>
              <span className={`shrink-0 rounded-lg p-1 ${style.icon}`}>
                <Icon className="h-3 w-3" />
              </span>
            </div>

            <div
              className={`mt-1 font-mono text-base sm:text-lg font-black ${style.value} whitespace-nowrap`}
            >
              {card.value}
              {'suffix' in card && (
                <span className="ml-1 text-[10px] font-normal text-[#9CA6A0]">
                  {card.suffix}
                </span>
              )}
            </div>

            <p className="mt-1 text-[8px] leading-tight text-[#9CA6A0] font-mono">
              {card.note}
            </p>
          </div>
        );
      })}
    </div>
  );
}
