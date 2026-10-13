import React from 'react';
import { V3Team } from '@/lib/v3-auction-types';
import { Users, Wallet, Plane } from 'lucide-react';

interface V3TeamPurseProps {
  team: V3Team;
  isMyTeam: boolean;
  isHighestBidder: boolean;
}

export function V3TeamPurse({ team, isMyTeam, isHighestBidder }: V3TeamPurseProps) {
  return (
    <div className={`p-4 rounded-xl border transition-all ${
      isHighestBidder
        ? 'bg-blue-900/40 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]'
        : isMyTeam
          ? 'bg-slate-800 border-slate-600'
          : 'bg-slate-800/50 border-slate-700/50'
    }`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="text-white font-bold tracking-wide truncate pr-2 max-w-[120px] lg:max-w-[150px]">
            {team.name}
          </h4>
          <span className="text-xs font-semibold text-slate-400">
            {team.short_name} {team.is_bot && '(BOT)'} {isMyTeam && '(YOU)'}
          </span>
        </div>

        {isHighestBidder && (
          <div className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] font-black uppercase rounded-sm border border-blue-500/30">
            Leading
          </div>
        )}
      </div>

      <div className="space-y-2 mt-2">
        <div className="flex justify-between items-center bg-slate-900/50 px-2 py-1.5 rounded-md">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Wallet className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Purse</span>
          </div>
          <span className={`font-bold text-sm ${team.purse < 1000 ? 'text-red-400' : 'text-emerald-400'}`}>
            ₹{team.purse.toLocaleString()}L
          </span>
        </div>

        <div className="flex justify-between items-center px-1">
          <div className="flex items-center gap-1 text-slate-400" title="Squad Size">
            <Users className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">{team.players_bought}/25</span>
          </div>
          <div className="flex items-center gap-1 text-slate-400" title="Overseas Players">
            <Plane className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">{team.overseas_count}/8</span>
          </div>
        </div>
      </div>
    </div>
  );
}
