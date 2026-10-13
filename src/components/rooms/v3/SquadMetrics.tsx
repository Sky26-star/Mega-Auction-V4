import React from 'react';
import { V3Team } from '@/lib/v3-auction-types';

interface SquadMetricsProps {
  team: V3Team;
}

export function SquadMetrics({ team }: SquadMetricsProps) {
  const capitalDeployed = team.initial_purse - team.purse;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard
        label="WAR CHEST"
        value={`₹${team.purse.toFixed(2)}`}
        subtext="Cr"
        highlight
      />
      <MetricCard
        label="CAPITAL DEPLOYED"
        value={`₹${capitalDeployed.toFixed(2)}`}
        subtext="Cr"
      />
      <MetricCard
        label="ROSTER"
        value={team.players_bought.toString()}
        subtext="/ 25"
      />
      <MetricCard
        label="OVERSEAS SLOTS"
        value={team.overseas_count.toString()}
        subtext="/ 8"
      />
    </div>
  );
}

function MetricCard({ label, value, subtext, highlight = false }: { label: string, value: string, subtext: string, highlight?: boolean }) {
  return (
    <div className={`p-5 rounded-2xl border ${highlight ? 'border-[#C9A227]/40 bg-[#181E1A]' : 'border-[#2A312D] bg-[#141917]'}`}>
      <p className="text-[10px] sm:text-xs font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-2">
        {label}
      </p>
      <p className={`text-2xl sm:text-3xl font-mono-numbers font-black tracking-tight ${highlight ? 'text-[#C9A227]' : 'text-[#F3F4F1]'}`}>
        {value} <span className="text-sm sm:text-base font-bold text-[#9CA6A0]">{subtext}</span>
      </p>
    </div>
  );
}
