import React from 'react';
import { V3StatsLot } from '@/hooks/useV3Stats';
import { V3Team } from '@/lib/v3-auction-types';

interface MostExpensiveAcquisitionsProps {
  lots: V3StatsLot[];
  teams: V3Team[];
}

export function MostExpensiveAcquisitions({ lots, teams }: MostExpensiveAcquisitionsProps) {
  if (lots.length === 0) {
    return null;
  }

  const getTeamName = (teamId: string | null) => {
    if (!teamId) return 'Unknown';
    const team = teams.find(t => t.id === teamId);
    return team?.name || 'Unknown';
  };

  return (
    <div className="mb-16 animate-in slide-in-from-bottom-4 fade-in duration-700 delay-700 fill-mode-both">
      <h2 className="text-sm font-mono font-bold text-[#C9A227] uppercase tracking-widest mb-6 border-b border-[#2A312D] pb-3">
        Most Expensive Acquisitions
      </h2>
      <div className="flex flex-col space-y-3">
        {lots.map((lot, index) => (
          <div
            key={lot.lot_id}
            className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 sm:p-5 rounded-2xl border border-[#2A312D] bg-[#141917] hover:border-[#C9A227]/30 transition-all duration-300"
            style={{ animationDelay: `${(index + 5) * 100}ms` }}
          >
            <div className="flex items-center space-x-4 w-full md:w-auto mb-4 md:mb-0">
              <div className="w-8 text-center text-[#9CA6A0] font-mono text-sm font-bold shrink-0">
                {index + 1}
              </div>
              <div className="flex flex-col">
                <span className="font-black font-display uppercase tracking-wider text-lg sm:text-xl text-[#F3F4F1] truncate">
                  {lot.player.name}
                </span>
                <span className="text-[10px] sm:text-xs font-mono font-bold text-[#9CA6A0] uppercase tracking-widest">
                  {lot.player.role} • {lot.player.is_overseas ? lot.player.country : 'INDIA'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between w-full md:w-auto md:space-x-8 px-12 md:px-0">
               <div className="flex flex-col">
                  <span className="text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">Franchise</span>
                  <span className="font-mono-numbers font-bold text-sm text-[#D0D4D1]">
                    {getTeamName(lot.winning_team_id)}
                  </span>
                </div>
              <div className="flex flex-col text-right md:text-left">
                <span className="text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">Final Price</span>
                <span className="font-mono-numbers font-black text-lg text-[#C9A227]">
                  ₹{lot.winning_bid?.toFixed(2)} <span className="text-xs text-[#9CA6A0]">Cr</span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
