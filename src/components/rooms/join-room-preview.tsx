'use client';

// src/components/rooms/join-room-preview.tsx
import React from 'react';
import type { Room } from '@/lib/types/room';
import {
  Gavel,
  Database,
  Coins,
  Clock,
  Users,
  Globe,
  Loader2,
  AlertCircle,
  Trophy,
  Lock,
  Radio,
  Search,
  WifiOff,
} from 'lucide-react';

export type VerificationState = 'IDLE' | 'VERIFYING' | 'FOUND' | 'NOT_FOUND' | 'ERROR';

interface JoinRoomPreviewProps {
  code: string;
  room: Room | null;
  verificationState: VerificationState;
  errorMessage?: string | null;
}

export function JoinRoomPreview({
  code,
  room,
  verificationState,
  errorMessage,
}: JoinRoomPreviewProps) {
  const formattedCode = code.trim().toUpperCase();
  const spacedCode = formattedCode.split('').join(' ');

  // STATE 2 — VERIFYING
  if (verificationState === 'VERIFYING') {
    return (
      <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#C9A227]/40 p-8 shadow-2xl text-center space-y-4 min-h-[360px] flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F]">
          <Loader2 className="w-6 h-6 animate-spin text-[#C9A227]" />
        </div>
        <div>
          <span className="text-xs font-mono-numbers font-black text-[#E4B93F] uppercase tracking-wider block mb-1">
            ● VERIFYING CODE...
          </span>
          <p className="text-xs text-[#9CA6A0]">Checking room code with auction database...</p>
        </div>
      </div>
    );
  }

  // STATE 4 — NOT FOUND
  if (verificationState === 'NOT_FOUND') {
    return (
      <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#B8322E]/60 p-6 sm:p-8 shadow-2xl text-center space-y-4 min-h-[360px] flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-xl bg-[#8F2724]/20 border border-[#B8322E]/60 flex items-center justify-center text-[#B8322E]">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div>
          <span className="px-3 py-1 rounded-full bg-[#8F2724]/20 text-[#B8322E] border border-[#B8322E]/60 text-xs font-black uppercase font-mono-numbers inline-flex items-center gap-1.5 mb-2">
            ✕ ROOM NOT FOUND
          </span>
          <h3 className="text-base font-bold text-[#F3F4F1] uppercase">Invalid Room Code</h3>
          <p className="text-xs text-[#9CA6A0] mt-1 max-w-xs mx-auto leading-relaxed">
            {errorMessage || 'Check the code and try again.'}
          </p>
        </div>
      </div>
    );
  }

  // STATE 5 — ERROR (Network / Connection Failure)
  if (verificationState === 'ERROR') {
    return (
      <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#C9A227]/40 p-6 sm:p-8 shadow-2xl text-center space-y-4 min-h-[360px] flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-xl bg-[#0B0F0D] border border-[#C9A227]/40 flex items-center justify-center text-[#E4B93F]">
          <WifiOff className="w-6 h-6 text-[#E4B93F]" />
        </div>
        <div>
          <span className="px-3 py-1 rounded-full bg-[#C9A227]/15 text-[#E4B93F] border border-[#C9A227]/40 text-xs font-black uppercase font-mono-numbers inline-flex items-center gap-1.5 mb-2">
            ⚠ UNABLE TO VERIFY ROOM
          </span>
          <h3 className="text-base font-bold text-[#F3F4F1] uppercase">Connection Error</h3>
          <p className="text-xs text-[#9CA6A0] mt-1 max-w-xs mx-auto leading-relaxed">
            {errorMessage || 'Please check your connection and try again.'}
          </p>
        </div>
      </div>
    );
  }

  // STATE 3 — FOUND (Verified Room Data)
  if (verificationState === 'FOUND' && room) {
    const statusStr = (room.status as string) || 'OPEN';
    const isLive = statusStr === 'LOCKED' || statusStr === 'IN_PROGRESS' || statusStr === 'LIVE';

    // Room Settings (safely extract from room.settings or defaults)
    const settings = room.settings || {};
    const defaultPurse = settings.default_purse ?? 100;
    const timerDuration = settings.timer_duration_seconds ?? 10;
    const maxSquadSize = settings.max_squad_size ?? 15;
    const maxOverseas = settings.max_overseas ?? 8;
    const hostName = room.host_profile?.display_name || room.host_profile?.username || 'Host';

    return (
      <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#C9A227]/60 p-5 sm:p-6 shadow-2xl shadow-black/90 relative overflow-hidden transition-all">
        {/* Top Banner Bar */}
        <div className="flex items-center justify-between border-b border-[#2A312D] pb-3.5 mb-4">
          {isLive ? (
            <span className="px-3 py-1 rounded-full bg-[#B8322E]/20 border border-[#B8322E]/60 text-[#B8322E] text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#B8322E] animate-pulse" />
              <span>AUCTION IN PROGRESS</span>
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full bg-[#C9A227]/15 border border-[#C9A227]/40 text-[#E4B93F] text-xs font-bold tracking-wider uppercase flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>● ROOM FOUND (OPEN)</span>
            </span>
          )}

          <div className="flex items-center space-x-1.5 text-xs font-mono-numbers font-extrabold text-[#E4B93F]">
            <Gavel className="w-4 h-4 text-[#C9A227]" />
            <span>PREVIEW</span>
          </div>
        </div>

        {/* Room Header & Code Banner */}
        <div className="mb-4 text-center pb-3 border-b border-[#2A312D]">
          <span className="text-[10px] font-mono-numbers font-bold text-[#C9A227] uppercase tracking-widest block mb-0.5">
            MEGA AUCTION ARENA
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-[#F3F4F1] font-display uppercase tracking-wide truncate">
            {room.name}
          </h2>
          <div className="mt-2 inline-block px-4 py-1.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
            <span className="text-base font-black font-mono-numbers text-[#E4B93F] tracking-[0.25em]">
              {spacedCode || room.code}
            </span>
          </div>
        </div>

        {/* Room Information Grid */}
        <div className="space-y-3 bg-[#0B0F0D] p-4 rounded-xl border border-[#2A312D]">
          
          {/* Host */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
              <Trophy className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>HOST:</span>
            </span>
            <span className="font-bold text-[#F3F4F1] bg-[#181E1A] px-2 py-0.5 rounded border border-[#2A312D]">
              {hostName}
            </span>
          </div>

          {/* Player Set */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
              <Database className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>PLAYER POOL:</span>
            </span>
            <span className="font-bold text-[#F3F4F1] truncate max-w-[180px] bg-[#181E1A] px-2 py-0.5 rounded border border-[#2A312D]">
              {room.player_set_name || 'Standard Pool'}
            </span>
          </div>

          {/* Starting Purse */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
              <Coins className="w-3.5 h-3.5 text-[#E4B93F]" />
              <span>STARTING PURSE:</span>
            </span>
            <span className="font-black font-mono-numbers text-[#E4B93F] text-sm">
              ₹{defaultPurse} Cr
            </span>
          </div>

          {/* Timer Per Lot */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-[#B8322E]" />
              <span>TIMER PER LOT:</span>
            </span>
            <span className="font-bold font-mono-numbers text-[#F3F4F1]">
              {timerDuration} SEC
            </span>
          </div>

          {/* Squad Limits */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
              <Users className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>MAX SQUAD SIZE:</span>
            </span>
            <span className="font-bold font-mono-numbers text-[#F3F4F1]">
              {maxSquadSize} PLAYERS
            </span>
          </div>

          {/* Overseas Limit */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span>OVERSEAS LIMIT:</span>
            </span>
            <span className="font-bold font-mono-numbers text-sky-400 flex items-center space-x-1 bg-[#181E1A] px-2 py-0.5 rounded border border-[#2A312D]">
              <span>{maxOverseas} PLAYERS</span>
              <Lock className="w-3 h-3 text-[#9CA6A0]" />
            </span>
          </div>

        </div>

        {/* Footer Status */}
        <div className="mt-4 pt-3 border-t border-[#2A312D] flex items-center justify-between text-[11px] font-mono-numbers text-[#9CA6A0]">
          <span className="text-emerald-400 font-bold flex items-center gap-1">
            <Radio className="w-3.5 h-3.5" /> READY FOR MANAGER REGISTRATION
          </span>
          <span>LOBBY v1.0</span>
        </div>
      </div>
    );
  }

  // STATE 1 — IDLE (Default Awaiting Input)
  return (
    <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-6 sm:p-8 shadow-2xl text-center space-y-4 min-h-[360px] flex flex-col items-center justify-center">
      <div className="w-12 h-12 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#9CA6A0]">
        <Search className="w-6 h-6 text-[#C9A227]" />
      </div>
      <div>
        <span className="text-xs font-mono-numbers font-black text-[#C9A227] uppercase tracking-wider block mb-1">
          ● AWAITING ROOM CODE
        </span>
        <h3 className="text-base font-bold text-[#F3F4F1] uppercase">Auction Checkpoint</h3>
        <p className="text-xs text-[#9CA6A0] mt-1 max-w-xs mx-auto leading-relaxed">
          Enter a 6-character room code on the left to preview auction settings and squad rules.
        </p>
      </div>
    </div>
  );
}
