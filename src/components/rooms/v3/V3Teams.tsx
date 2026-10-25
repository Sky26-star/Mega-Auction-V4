import React from 'react';
import { V3Team, V3AuctionLot } from '@/lib/v3-auction-types';
import { Users, Wallet, Plane } from 'lucide-react';

interface V3TeamsProps {
  teams: V3Team[];
  lot: V3AuctionLot | null;
  responsive?: boolean;
}

export function V3Teams({ teams, lot, responsive = false }: V3TeamsProps) {
  // Sort teams by purse remaining, descending — same as before
  const sortedTeams = [...teams].sort((a, b) => b.purse - a.purse);

  return (
    <div className="bg-[#0F1410] border border-[#2A312D] rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className={`${responsive ? 'text-xs sm:text-[10px]' : 'text-[10px]'} flex items-center gap-2 font-mono font-bold uppercase tracking-[0.2em] text-[#9CA6A0]`}>
          <Users className="w-3.5 h-3.5 text-[#C9A227]" />
          Franchises
        </h3>
        <span className={`${responsive ? 'text-xs sm:text-[9px]' : 'text-[9px]'} rounded border border-[#2A312D] bg-[#0B0F0D] px-2 py-0.5 font-mono text-[#8B938E]`}>
          {teams.length} TEAMS
        </span>
      </div>

      <div className={responsive ? 'grid min-w-0 grid-cols-1 gap-3 min-[400px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'}>
        {sortedTeams.map((team) => {
          const isHighestBidder = lot?.highest_bidder_team_id === team.id;

          return (
            <div
              key={team.id}
              className={`${responsive ? 'min-w-0 rounded-xl border p-3 transition-all duration-300 motion-reduce:transition-none' : 'rounded-xl border p-3 transition-all duration-300'} ${
                isHighestBidder
                  ? 'bg-[#0A1A12] border-[#10B981] shadow-[0_0_12px_rgba(16,185,129,0.12)]'
                  : 'bg-[#0B0F0D] border-[#2A312D]'
              }`}
            >
              {/* Team header */}
              <div className="flex items-center gap-2 mb-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#141917] border border-[#2A312D] flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <span className="text-[8px] font-mono font-black text-[#8B938E] uppercase leading-none">
                    {team.short_name}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className={responsive ? 'min-w-0 truncate text-sm font-bold uppercase leading-tight text-[#F3F4F1] font-display sm:text-[11px] sm:leading-none' : 'truncate text-[11px] font-bold uppercase leading-none text-[#F3F4F1] font-display'}>
                    {team.name}
                  </h4>
                  {team.is_bot && (
                  <span className={responsive ? 'text-xs font-mono text-[#8B938E] sm:text-[8px]' : 'text-[8px] font-mono text-[#8B938E]'}>BOT</span>
                  )}
                </div>
                {isHighestBidder && (
                  <span className={responsive ? 'shrink-0 rounded border border-[#10B981]/30 bg-[#10B981]/10 px-1 py-0.5 text-[10px] font-mono font-black uppercase tracking-wider text-[#10B981] sm:text-[7px]' : 'flex-shrink-0 rounded border border-[#10B981]/30 bg-[#10B981]/10 px-1 py-0.5 text-[7px] font-mono font-black uppercase tracking-wider text-[#10B981]'}>
                    LEADING
                  </span>
                )}
              </div>

              {/* Purse */}
              <div className="flex items-center justify-between bg-[#141917] px-2 py-1.5 rounded-lg mb-1.5 border border-[#2A312D]">
                <span className={responsive ? 'flex items-center gap-1 text-xs font-mono uppercase text-[#9CA6A0] sm:text-[9px]' : 'flex items-center gap-1 text-[9px] font-mono uppercase text-[#9CA6A0]'}>
                  <Wallet className="w-2.5 h-2.5" />Purse
                </span>
                <span className={`font-mono-numbers font-bold text-xs tabular-nums ${team.purse < 500 ? 'text-[#F87171]' : 'text-[#E4B93F]'}`}>
                  ₹{team.purse.toLocaleString()}L
                </span>
              </div>

              {/* Squad / Overseas */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1 text-[#9CA6A0]" title="Squad Size">
                  <Users className="w-2.5 h-2.5" />
                  <span className={responsive ? 'text-xs font-mono sm:text-[9px]' : 'text-[9px] font-mono'}>{team.players_bought}</span>
                </div>
                <div className="flex items-center gap-1 text-[#9CA6A0]" title="Overseas Players">
                  <Plane className="w-2.5 h-2.5" />
                  <span className={responsive ? 'text-xs font-mono sm:text-[9px]' : 'text-[9px] font-mono'}>{team.overseas_count} OS</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
