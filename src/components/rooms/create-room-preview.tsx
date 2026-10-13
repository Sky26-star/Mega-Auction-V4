'use client';

// src/components/rooms/create-room-preview.tsx
import React, { useState, useEffect } from 'react';
import type { PlayerSet } from '@/lib/types/player-set';
import {
  Gavel,
  CheckCircle,
  Copy,
  Clock,
  Coins,
  Users,
  Globe,
  Database,
  ShieldAlert,
  Cpu,
  Trophy,
  Lock,
} from 'lucide-react';

interface CreateRoomPreviewProps {
  name: string;
  code: string;
  selectedSet: PlayerSet | null;
  defaultPurse: number; // In Crores (e.g. 100)
  timerDuration: number; // In Seconds (10, 15, 20)
  maxSquadSize: number; // (15, 20, 25)
  maxOverseas: number; // Fixed 8
  teamName: string;
  teamShortName: string;
  teamColor: string;
  enableBots?: boolean;
  botCount?: number;
  botDifficulty?: string;
}

function AnimatedValue({ children, valueKey }: { children: React.ReactNode; valueKey: any }) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 350);
    return () => clearTimeout(t);
  }, [valueKey]);

  return (
    <span
      className={`inline-block transition-all duration-300 ${
        pulse ? 'scale-105 text-[#E4B93F] drop-shadow-[0_0_8px_rgba(228,185,63,0.5)]' : ''
      }`}
    >
      {children}
    </span>
  );
}

export function CreateRoomPreview({
  name,
  code,
  selectedSet,
  defaultPurse,
  timerDuration,
  maxSquadSize,
  maxOverseas,
  teamName,
  teamShortName,
  teamColor,
  enableBots = false,
  botCount = 4,
  botDifficulty = 'Balanced',
}: CreateRoomPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedRoomName = name.trim() || 'Mega Auction 2026';
  const formattedCode = code.trim().toUpperCase() || 'TALBEE';
  const formattedTeamName = teamName.trim() || 'Host Franchise';
  const formattedShortCode = teamShortName.trim().toUpperCase() || 'HOST';
  const playerCount = selectedSet?.player_count ?? 0;
  const setName = selectedSet?.name ?? 'Select Player Pool';

  return (
    <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-5 sm:p-6 shadow-2xl shadow-black/90 relative overflow-hidden transition-all hover:border-[#C9A227]/40 group">
      
      {/* Top Banner Bar */}
      <div className="flex items-center justify-between border-b border-[#2A312D] pb-3.5 mb-4">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#C9A227]/15 border border-[#C9A227]/40 text-[#E4B93F] text-xs font-bold tracking-wider uppercase shadow-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>WAITING FOR PLAYERS</span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 text-xs font-mono-numbers font-extrabold text-[#E4B93F]">
          <Gavel className="w-4 h-4 text-[#C9A227]" />
          <span>ROOM PREVIEW</span>
        </div>
      </div>

      {/* Brand Header */}
      <div className="mb-4 text-center pb-3 border-b border-[#2A312D]">
        <span className="text-[10px] font-mono-numbers font-bold text-[#C9A227] uppercase tracking-widest block mb-0.5">
          MEGA AUCTION ARENA
        </span>
        <h2 className="text-xl sm:text-2xl font-black text-[#F3F4F1] font-display uppercase tracking-wide truncate">
          <AnimatedValue valueKey={formattedRoomName}>{formattedRoomName}</AnimatedValue>
        </h2>
      </div>

      {/* Room Code Banner */}
      <div className="mb-4 p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-between">
        <div>
          <span className="block text-[10px] font-bold text-[#9CA6A0] uppercase tracking-widest mb-0.5">
            LOBBY ROOM CODE
          </span>
          <span className="text-xl font-black font-mono-numbers text-[#E4B93F] tracking-widest">
            {formattedCode}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopyCode}
          className="px-3 py-1.5 rounded-lg bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#E4B93F] text-xs font-bold flex items-center space-x-1.5 transition-colors"
          title="Copy Room Code"
        >
          {copied ? (
            <>
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>COPIED!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>COPY</span>
            </>
          )}
        </button>
      </div>

      {/* Configuration Details Grid */}
      <div className="space-y-3 bg-[#0B0F0D] p-4 rounded-xl border border-[#2A312D]">
        
        {/* Selected Player Pool */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
            <Database className="w-3.5 h-3.5 text-[#C9A227]" />
            <span>PLAYER POOL:</span>
          </span>
          <span className="font-bold text-[#F3F4F1] truncate max-w-[180px] bg-[#181E1A] px-2 py-0.5 rounded border border-[#2A312D]">
            <AnimatedValue valueKey={setName}>
              {setName} ({playerCount})
            </AnimatedValue>
          </span>
        </div>

        {/* Starting Purse */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
            <Coins className="w-3.5 h-3.5 text-[#E4B93F]" />
            <span>STARTING PURSE:</span>
          </span>
          <span className="font-black font-mono-numbers text-[#E4B93F] text-sm">
            <AnimatedValue valueKey={defaultPurse}>₹{defaultPurse} Cr</AnimatedValue>
          </span>
        </div>

        {/* Timer Per Lot */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
            <Clock className="w-3.5 h-3.5 text-[#B8322E]" />
            <span>TIMER PER LOT:</span>
          </span>
          <span className="font-bold font-mono-numbers text-[#F3F4F1]">
            <AnimatedValue valueKey={timerDuration}>{timerDuration} SEC</AnimatedValue>
          </span>
        </div>

        {/* Squad Limit */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
            <Users className="w-3.5 h-3.5 text-[#C9A227]" />
            <span>MAX SQUAD SIZE:</span>
          </span>
          <span className="font-bold font-mono-numbers text-[#F3F4F1]">
            <AnimatedValue valueKey={maxSquadSize}>{maxSquadSize} PLAYERS</AnimatedValue>
          </span>
        </div>

        {/* Overseas Limit */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
            <Globe className="w-3.5 h-3.5 text-sky-400" />
            <span>OVERSEAS LIMIT:</span>
          </span>
          <span className="font-bold font-mono-numbers text-sky-400 flex items-center space-x-1 bg-[#181E1A] px-2 py-0.5 rounded border border-[#2A312D]">
            <AnimatedValue valueKey={maxOverseas}>{maxOverseas} PLAYERS</AnimatedValue>
            <Lock className="w-3 h-3 text-[#9CA6A0]" />
          </span>
        </div>

        {/* Bot Opponents */}
        <div className="flex items-center justify-between text-xs pt-1 border-t border-[#2A312D]/60">
          <span className="text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
            <Cpu className="w-3.5 h-3.5 text-[#E4B93F]" />
            <span>BOT OPPONENTS:</span>
          </span>
          <span className="font-bold text-[#F3F4F1] bg-[#181E1A] px-2 py-0.5 rounded border border-[#2A312D]">
            <AnimatedValue valueKey={`${enableBots}-${botCount}`}>
              {enableBots && botCount > 0 ? `${botCount} AI BOTS (${1 + botCount}/10 MANAGERS)` : 'DISABLED (1/10 MANAGERS)'}
            </AnimatedValue>
          </span>
        </div>

      </div>

      {/* Host Franchise Identity Card */}
      <div className="mt-4 p-3.5 rounded-xl bg-gradient-to-r from-[#181E1A] via-[#141917] to-[#181E1A] border border-[#C9A227]/40 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div
            className="w-8 h-8 rounded-lg border border-white/20 flex items-center justify-center font-black text-xs text-white shadow-md transition-all"
            style={{ backgroundColor: teamColor || '#3B82F6' }}
          >
            {formattedShortCode.slice(0, 3)}
          </div>
          <div>
            <span className="block text-[10px] font-bold text-[#9CA6A0] uppercase tracking-widest">
              HOST FRANCHISE
            </span>
            <span className="text-xs font-bold text-[#F3F4F1] flex items-center space-x-1">
              <Trophy className="w-3.5 h-3.5 text-[#C9A227]" />
              <AnimatedValue valueKey={formattedTeamName}>{formattedTeamName}</AnimatedValue>
            </span>
          </div>
        </div>

        <span className="text-[10px] font-mono-numbers font-extrabold text-[#C9A227] uppercase bg-[#0B0F0D] px-2 py-1 rounded border border-[#2A312D]">
          {formattedShortCode}
        </span>
      </div>

      {/* Status Footer */}
      <div className="mt-4 pt-3 border-t border-[#2A312D] flex items-center justify-between">
        <div className="flex items-center space-x-1.5 text-xs text-emerald-400 font-bold">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>READY TO CREATE</span>
        </div>
        <span className="text-[11px] font-mono-numbers text-[#9CA6A0]">
          LOBBY v1.0
        </span>
      </div>

    </div>
  );
}
