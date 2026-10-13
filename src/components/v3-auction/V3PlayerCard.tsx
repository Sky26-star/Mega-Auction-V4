import React from 'react';
import { V3Player } from '@/lib/v3-auction-types';
import { User, Trophy, Plane, MapPin } from 'lucide-react';

interface V3PlayerCardProps {
  player: V3Player | null;
}

export function V3PlayerCard({ player }: V3PlayerCardProps) {
  if (!player) {
    return (
      <div className="w-full h-64 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center shadow-lg">
        <p className="text-slate-500 font-medium tracking-widest text-sm">NO PLAYER ACTIVE</p>
      </div>
    );
  }

  const roleColors: Record<string, string> = {
    BATSMAN: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    BOWLER: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    ALL_ROUNDER: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
    WICKET_KEEPER: 'text-amber-400 bg-amber-400/10 border-amber-400/20'
  };

  const roleDisplay: Record<string, string> = {
    BATSMAN: 'Batter',
    BOWLER: 'Bowler',
    ALL_ROUNDER: 'All-Rounder',
    WICKET_KEEPER: 'Wicket Keeper'
  };

  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6">

      {/* Category Badge */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <div className="px-3 py-1 rounded-full bg-slate-800 border border-slate-600 shadow-sm flex items-center gap-2">
          <Trophy className="w-4 h-4 text-gold-400" />
          <span className="text-xs font-bold text-slate-200 tracking-wider">SET {player.category}</span>
        </div>
        {player.is_overseas && (
          <div className="px-3 py-1 rounded-full bg-indigo-900/50 border border-indigo-500/30 flex items-center gap-2">
            <Plane className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold text-indigo-300 tracking-wider">OVERSEAS</span>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-6 relative z-10">

        {/* Photo Area */}
        <div className="w-full md:w-1/3 flex flex-col items-center justify-center shrink-0">
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-slate-700 bg-slate-800 flex items-center justify-center shadow-inner">
            {player.image_url ? (
              <img src={player.image_url} alt={player.name} className="w-full h-full object-cover" />
            ) : (
              <User className="w-12 h-12 text-slate-500" />
            )}
          </div>
        </div>

        {/* Details Area */}
        <div className="w-full flex flex-col justify-center">
          <h2 className="text-3xl font-black text-white tracking-tight uppercase">{player.name}</h2>

          <div className="mt-4 flex flex-wrap gap-3">
            <div className={`px-3 py-1.5 rounded-lg border text-sm font-semibold flex items-center gap-2 ${roleColors[player.role] || 'text-slate-300 border-slate-700 bg-slate-800'}`}>
              {roleDisplay[player.role] || player.role}
            </div>

            <div className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-sm font-medium text-slate-300 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-slate-400" />
              {player.country}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-700/50">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-slate-400 uppercase tracking-widest">Base Price</span>
              <span className="text-2xl font-bold text-white">₹{player.base_price.toLocaleString()}L</span>
            </div>
          </div>

        </div>
      </div>

      {/* Background Accent */}
      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
    </div>
  );
}
