'use client';

// src/components/rooms/auction-room-header.tsx
import React, { useState } from 'react';
import Link from 'next/link';
import type { Room } from '@/lib/types/room';
import { ConnectionStatus } from './connection-status';
import {
  ArrowLeft,
  Crown,
  Copy,
  CheckCircle,
  RefreshCw,
  Radio,
  Gavel,
  Users,
} from 'lucide-react';

export interface AuctionRoomHeaderProps {
  room: Room;
  participantCount: number;
  maxManagers?: number;
  isHost: boolean;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function AuctionRoomHeader({
  room,
  participantCount,
  maxManagers = 10,
  isHost,
  onRefresh,
  isLoading = false,
}: AuctionRoomHeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = () => {
    if (!room?.code) return;
    navigator.clipboard.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLobby = room.status === 'OPEN' || room.status === 'LOCKED';
  const hostName = room.host_profile?.display_name || room.host_profile?.username || 'Host';

  return (
    <header className="w-full rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-4 sm:p-6 shadow-2xl relative overflow-hidden">
      {/* Top Console Navigation Ticker Bar */}
      <div className="flex items-center justify-between border-b border-[#2A312D] pb-3 mb-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/rooms"
            className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-[#0B0F0D] border border-[#2A312D] text-[#9CA6A0] hover:text-[#F3F4F1] hover:border-[#C9A227]/40 text-xs font-semibold transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>EXIT LOBBY</span>
          </Link>

          <ConnectionStatus isConnected={true} />
        </div>

        <div className="flex items-center space-x-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-[#0B0F0D] border border-[#2A312D] text-[#9CA6A0] hover:text-[#E4B93F] hover:border-[#C9A227]/40 text-xs font-mono-numbers font-semibold transition-all"
              title="Refresh Room State"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#C9A227]' : ''}`} />
              <span className="hidden sm:inline">REFRESH</span>
            </button>
          )}

          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-[#0B0F0D] border border-[#2A312D] text-xs font-mono-numbers font-bold text-[#E4B93F]">
            <Radio className="w-3.5 h-3.5 text-[#B8322E] animate-pulse-live" />
            <span className="uppercase">{isLobby ? 'LOBBY MODE' : 'LIVE STAGE'}</span>
          </div>
        </div>
      </div>

      {/* Main Broadcast Control Console Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        
        {/* Left Console Brand Block */}
        <div className="space-y-1.5">
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-mono-numbers font-extrabold text-[#C9A227] uppercase tracking-widest bg-[#0B0F0D] px-2.5 py-0.5 rounded border border-[#2A312D]">
              MEGA AUCTION ARENA
            </span>
            <span className="text-[10px] font-mono-numbers font-bold text-[#9CA6A0] uppercase tracking-wider">
              CONTROL CONSOLE
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-[#F3F4F1] font-display uppercase tracking-wide flex items-center gap-3">
            <span>{room.name}</span>
          </h1>

          <div className="flex flex-wrap items-center gap-3 text-xs pt-0.5">
            {/* Status Pill */}
            <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-[#181E1A] border border-[#2A312D]">
              <span
                className={`w-2 h-2 rounded-full ${
                  room.status === 'OPEN' ? 'bg-emerald-400 animate-pulse' : 'bg-[#E4B93F]'
                }`}
              />
              <span className="font-mono-numbers font-bold text-[#F3F4F1] uppercase">
                {room.status === 'OPEN' ? '● WAITING FOR PLAYERS' : `● ${room.status}`}
              </span>
            </div>

            <span className="text-[#2A312D] hidden sm:inline">•</span>

            {/* Host Badge */}
            <div className="flex items-center space-x-1.5 text-[#9CA6A0]">
              <Crown className="w-4 h-4 text-[#C9A227]" />
              <span>HOST:</span>
              <strong className="text-[#F3F4F1] font-bold">{hostName}</strong>
              {isHost && (
                <span className="text-[10px] font-mono-numbers font-extrabold bg-[#C9A227]/20 text-[#E4B93F] border border-[#C9A227]/40 px-1.5 py-0.5 rounded">
                  YOU
                </span>
              )}
            </div>

            <span className="text-[#2A312D] hidden sm:inline">•</span>

            {/* Manager Count */}
            <div className="flex items-center space-x-1.5 text-[#9CA6A0]">
              <Users className="w-4 h-4 text-[#E4B93F]" />
              <span className="font-mono-numbers font-bold text-[#F3F4F1]">
                {participantCount}/{maxManagers} MANAGERS
              </span>
            </div>
          </div>
        </div>

        {/* Right Room Code Quick Console Box */}
        <div className="flex items-center space-x-3 bg-[#0B0F0D] p-3.5 rounded-xl border-2 border-[#2A312D] shadow-inner self-start lg:self-center">
          <div className="pr-3 border-r border-[#2A312D]">
            <span className="block text-[10px] font-mono-numbers font-bold text-[#9CA6A0] uppercase tracking-widest mb-0.5">
              ROOM CODE
            </span>
            <code className="text-2xl font-mono-numbers font-black tracking-widest text-[#E4B93F]">
              {room.code}
            </code>
          </div>

          <button
            type="button"
            onClick={handleCopyCode}
            className="p-2.5 rounded-lg bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#E4B93F] transition-all flex items-center justify-center"
            title="Copy Room Code"
          >
            {copied ? (
              <CheckCircle className="w-5 h-5 text-emerald-400" />
            ) : (
              <Copy className="w-5 h-5 text-[#C9A227]" />
            )}
          </button>
        </div>

      </div>
    </header>
  );
}
