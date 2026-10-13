import React from 'react';
import { V3Team } from '@/lib/v3-auction-types';

interface LeagueComparisonProps {
  teams: V3Team[];
}

export function LeagueComparison({ teams }: LeagueComparisonProps) {
  return (
    <div className="mb-16 animate-in slide-in-from-bottom-4 fade-in duration-700 delay-300 fill-mode-both">
      <h2 className="text-sm font-mono font-bold text-[#C9A227] uppercase tracking-widest mb-6 border-b border-[#2A312D] pb-3">
        League-Wide Comparison
      </h2>
      <div className="flex flex-col space-y-3">
        {teams.map((team, index) => {
          const capitalDeployed = team.initial_purse - team.purse;
          let rankIcon = null;
          if (index === 0) rankIcon = '🥇';
          else if (index === 1) rankIcon = '🥈';
          else if (index === 2) rankIcon = '🥉';

          const isTop3 = index < 3;

          return (
            <div
              key={team.id}
              className={`flex flex-col md:flex-row items-start md:items-center justify-between p-4 sm:p-5 rounded-2xl border ${
                isTop3 ? 'border-[#C9A227]/30 bg-[#181E1A] shadow-md shadow-[#C9A227]/5' : 'border-[#2A312D] bg-[#141917]'
              } transition-all duration-300 hover:-translate-y-0.5`}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-center space-x-4 w-full md:w-auto mb-4 md:mb-0">
                <div className="w-8 text-center text-xl shrink-0">
                  {rankIcon ? rankIcon : <span className="text-[#9CA6A0] font-mono text-sm font-bold">{index + 1}</span>}
                </div>
                <div className="flex flex-col">
                  <span className={`font-black font-display uppercase tracking-wider text-lg sm:text-xl truncate ${isTop3 ? 'text-[#F3F4F1]' : 'text-[#D0D4D1]'}`}>
                    {team.name}
                  </span>
                </div>
              </div>

              <div className="flex flex-row flex-wrap gap-4 sm:gap-8 w-full md:w-auto px-12 md:px-0">
                <div className="flex flex-col">
                  <span className="text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">Capital Deployed</span>
                  <span className={`font-mono-numbers font-black text-lg ${isTop3 ? 'text-[#C9A227]' : 'text-[#F3F4F1]'}`}>
                    ₹{capitalDeployed.toFixed(2)} <span className="text-xs text-[#9CA6A0]">Cr</span>
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">Players</span>
                  <span className="font-mono-numbers font-black text-lg text-[#F3F4F1]">
                    {team.players_bought}
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">Overseas</span>
                  <span className="font-mono-numbers font-black text-lg text-[#F3F4F1]">
                    {team.overseas_count} <span className="text-xs text-[#9CA6A0]">/ 8</span>
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest mb-1">Remaining Purse</span>
                  <span className="font-mono-numbers font-black text-lg text-[#F3F4F1]">
                    ₹{team.purse.toFixed(2)} <span className="text-xs text-[#9CA6A0]">Cr</span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
