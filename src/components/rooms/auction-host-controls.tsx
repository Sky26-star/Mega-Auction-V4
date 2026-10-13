'use client';

// src/components/rooms/auction-host-controls.tsx
// Host Controls Component for Live Auction Room (V2 State Model Integrated)

import React from 'react';
import { Settings, Share2, LogOut, Shield, Play, Gavel, Loader2 } from 'lucide-react';

export interface AuctionHostControlsProps {
  isHost: boolean;
  onEditTeam?: () => void;
  onCopyInvite?: () => void;
  onLeaveRoom?: () => void;
  onStartAuction?: () => void;
  onContinueAuction?: () => void;
  onOpenSettings?: () => void;
  auctionStatus?: string;
  isStartingAuction?: boolean;
}

export function AuctionHostControls({
  isHost,
  onEditTeam,
  onCopyInvite,
  onLeaveRoom,
  onStartAuction,
  onContinueAuction,
  onOpenSettings,
  auctionStatus = 'NOT_STARTED',
  isStartingAuction = false,
}: AuctionHostControlsProps) {
  const isLive = ['LIVE', 'IN_PROGRESS', 'PAUSED'].includes(auctionStatus);
  const isCompleted = auctionStatus === 'COMPLETED';

  return (
    <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-4 shadow-xl space-y-3 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#2A312D] pb-2.5">
        <h3 className="text-xs font-black text-[#F3F4F1] uppercase font-display tracking-wider flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#E4B93F]" />
          <span>ROOM CONTROLS</span>
        </h3>
        {isHost && (
          <span className="text-[10px] font-mono-numbers font-extrabold text-[#E4B93F] bg-[#0B0F0D] px-2 py-0.5 rounded border border-[#2A312D]">
            HOST CONTROL
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2">
        {/* START/CONTINUE AUCTION BUTTON */}
        {(isHost || isLive) && (
          <button
            type="button"
            onClick={isLive ? onContinueAuction : onStartAuction}
            disabled={(!isLive && isStartingAuction) || isCompleted}
            className={`w-full py-2.5 px-3.5 rounded-xl font-mono-numbers font-extrabold text-xs flex items-center justify-between shadow-lg transition-all ${
              isCompleted
                ? 'bg-slate-900 border border-slate-700 text-slate-400 cursor-not-allowed'
                : 'bg-[#7C3AED] hover:bg-[#6D28D9] border border-[#7C3AED]/50 text-white shadow-purple-950/40 hover:scale-[1.01] active:scale-[0.99]'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Play className="w-4 h-4 fill-current group-hover:scale-110 transition-transform" />
              <span>
                {isLive ? 'CONTINUE AUCTION' : isCompleted ? 'AUCTION COMPLETED' : 'START AUCTION'}
              </span>
            </div>
            {isStartingAuction && !isLive ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Gavel className="w-4 h-4 text-[#E4B93F]" />
            )}
          </button>
        )}

        {isHost && !isLive && !isCompleted && onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full py-2 px-3 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] border border-[#2A312D] text-[#F3F4F1] hover:border-[#C9A227]/40 text-xs font-mono-numbers font-bold flex items-center justify-between transition-all"
          >
            <span>ROOM SETTINGS</span>
            <Settings className="w-3.5 h-3.5 text-[#C9A227]" />
          </button>
        )}

        {onEditTeam && (
          <button
            type="button"
            onClick={onEditTeam}
            className="w-full py-2 px-3 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] border border-[#2A312D] text-[#F3F4F1] hover:border-[#C9A227]/40 text-xs font-mono-numbers font-bold flex items-center justify-between transition-all"
          >
            <span>EDIT MY FRANCHISE</span>
            <Settings className="w-3.5 h-3.5 text-[#C9A227]" />
          </button>
        )}

        {onCopyInvite && (
          <button
            type="button"
            onClick={onCopyInvite}
            className="w-full py-2 px-3 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] border border-[#2A312D] text-[#F3F4F1] hover:border-[#C9A227]/40 text-xs font-mono-numbers font-bold flex items-center justify-between transition-all"
          >
            <span>SHARE ROOM INVITE</span>
            <Share2 className="w-3.5 h-3.5 text-emerald-400" />
          </button>
        )}

        {onLeaveRoom && (
          <button
            type="button"
            onClick={onLeaveRoom}
            className="w-full py-2 px-3 rounded-xl bg-red-950/30 hover:bg-red-900/40 border border-red-800/40 text-red-400 text-xs font-mono-numbers font-bold flex items-center justify-between transition-all"
          >
            <span>LEAVE ROOM</span>
            <LogOut className="w-3.5 h-3.5 text-red-400" />
          </button>
        )}
      </div>
    </div>
  );
}
