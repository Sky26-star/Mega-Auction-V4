import React from 'react';
import { V3AuctionStatus as StatusType, V3LotStatus } from '@/lib/v3-auction-types';
import { Activity, Circle } from 'lucide-react';

interface V3AuctionStatusProps {
  auctionStatus: StatusType;
  lotStatus: V3LotStatus | undefined;
  lotIndex: number;
}

export function V3AuctionStatus({ auctionStatus, lotStatus, lotIndex }: V3AuctionStatusProps) {
  const isLive = auctionStatus === 'IN_PROGRESS';

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between shadow-sm z-10 relative">
      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-bold tracking-widest ${
          isLive
            ? 'bg-red-950/40 border-red-900/50 text-red-500'
            : 'bg-slate-800 border-slate-700 text-slate-400'
        }`}>
          {isLive ? (
            <><Circle className="w-2.5 h-2.5 fill-red-500 animate-pulse" /> LIVE</>
          ) : (
            <><Activity className="w-3.5 h-3.5" /> {auctionStatus}</>
          )}
        </div>

        {lotIndex > 0 && (
          <div className="text-slate-300 font-medium">
            Lot <span className="text-white font-bold">#{lotIndex}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {lotStatus && (
          <div className={`px-4 py-1.5 rounded-lg border font-bold text-sm tracking-widest ${
            lotStatus === 'GET_READY' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
            lotStatus === 'BIDDING' ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' :
            lotStatus === 'SOLD' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
            lotStatus === 'UNSOLD' ? 'bg-slate-800 border-slate-700 text-slate-400' :
            'bg-slate-800 border-slate-700 text-slate-400'
          }`}>
            {lotStatus.replace('_', ' ')}
          </div>
        )}
      </div>
    </div>
  );
}
