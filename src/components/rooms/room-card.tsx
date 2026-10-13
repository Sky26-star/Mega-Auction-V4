'use client';

// src/components/rooms/room-card.tsx
import React, { useState } from 'react';
import Link from 'next/link';
import type { Room } from '@/lib/types/room';
import { Crown, Key, ArrowRight, Database, Copy, CheckCircle, Edit, Trash2, Clock, Coins, Cpu } from 'lucide-react';

interface RoomCardProps {
  room: Room;
  currentUserId?: string;
  onEdit?: (room: Room) => void;
  onDelete?: (room: Room) => void;
}

export function RoomCard({ room, currentUserId, onEdit, onDelete }: RoomCardProps) {
  const [copied, setCopied] = useState(false);
  const isHost = currentUserId ? room.host_id === currentUserId : false;

  const handleCopyCode = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const purseCr = room.settings?.default_purse ?? 100;
  const timerSec = room.settings?.timer_duration_seconds ?? 15;
  const botCount = room.settings?.bot_count ?? 0;

  return (
    <div className="p-5 sm:p-6 rounded-2xl bg-[#141917] border-2 border-[#2A312D] hover:border-[#C9A227]/40 transition-all duration-200 group flex flex-col justify-between shadow-2xl relative overflow-hidden">
      
      <div>
        {/* Top Header */}
        <div className="flex items-start justify-between gap-4 mb-3 pb-3 border-b border-[#2A312D]">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-lg sm:text-xl font-black text-[#F3F4F1] font-display uppercase tracking-wide group-hover:text-[#E4B93F] transition-colors truncate max-w-[200px]">
                {room.name}
              </h3>
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-[#9CA6A0]">
              <span>HOST:</span>
              <strong className="text-[#F3F4F1] font-bold">{room.host_profile?.display_name || room.host_profile?.username || 'Host'}</strong>
              {isHost && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-mono-numbers font-extrabold px-1.5 py-0.5 rounded bg-[#C9A227]/20 text-[#E4B93F] border border-[#C9A227]/40">
                  <Crown className="w-2.5 h-2.5" /> YOU
                </span>
              )}
            </div>
          </div>

          <span
            className={`text-[10px] font-mono-numbers font-extrabold px-2.5 py-1 rounded-full border uppercase ${
              room.status === 'OPEN'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : room.status === 'LOCKED'
                ? 'bg-[#E4B93F]/15 text-[#E4B93F] border-[#E4B93F]/30'
                : 'bg-[#181E1A] text-[#9CA6A0] border-[#2A312D]'
            }`}
          >
            {room.status === 'OPEN' ? '● LOBBY' : `● ${room.status}`}
          </span>
        </div>

        {/* Room Details Grid */}
        <div className="my-3 grid grid-cols-2 gap-2 text-xs">
          {/* Room Code Badge */}
          <div className="p-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <Key className="w-3.5 h-3.5 text-[#C9A227]" />
              <code className="font-mono-numbers text-xs font-black tracking-widest text-[#E4B93F]">{room.code}</code>
            </div>
            <button
              onClick={handleCopyCode}
              className="p-1 text-[#9CA6A0] hover:text-[#E4B93F] transition-colors"
              title="Copy Room Code"
            >
              {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Player Set Badge */}
          <div className="p-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center space-x-1.5 text-[#F3F4F1] truncate">
            <Database className="w-3.5 h-3.5 text-[#C9A227] flex-shrink-0" />
            <span className="truncate text-xs font-semibold">{room.player_set_name || 'Player Pool'}</span>
          </div>
        </div>

        {/* Configuration Summary */}
        <div className="grid grid-cols-3 gap-1.5 p-2 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-center text-[11px] font-mono-numbers my-3">
          <div>
            <span className="text-[9px] font-bold text-[#9CA6A0] uppercase block">PURSE</span>
            <span className="font-extrabold text-[#E4B93F]">₹{purseCr} Cr</span>
          </div>
          <div>
            <span className="text-[9px] font-bold text-[#9CA6A0] uppercase block">TIMER</span>
            <span className="font-bold text-[#F3F4F1]">{timerSec}s</span>
          </div>
          <div>
            <span className="text-[9px] font-bold text-[#9CA6A0] uppercase block">BOTS</span>
            <span className="font-bold text-[#F3F4F1]">{botCount > 0 ? `${botCount} Bots` : 'Off'}</span>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="mt-4 pt-3 border-t border-[#2A312D] space-y-2">
        <Link
          href={`/rooms/${room.id}`}
          className="w-full py-2.5 px-4 rounded-xl bg-[#C9A227] hover:bg-[#E4B93F] text-[#0B0F0D] text-xs font-extrabold font-display uppercase tracking-wider shadow-lg flex items-center justify-center space-x-2 transition-all"
        >
          <span>ENTER CONTROL ROOM</span>
          <ArrowRight className="w-4 h-4" />
        </Link>

        {isHost && (onEdit || onDelete) && (
          <div className="flex items-center space-x-2 pt-1">
            {room.status === 'OPEN' && onEdit && (
              <button
                type="button"
                onClick={() => onEdit(room)}
                className="flex-1 py-1.5 px-3 rounded-lg bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#E4B93F] text-xs font-bold font-mono-numbers flex items-center justify-center space-x-1.5 transition-colors"
              >
                <Edit className="w-3.5 h-3.5 text-[#C9A227]" />
                <span>EDIT</span>
              </button>
            )}

            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(room)}
                className="flex-1 py-1.5 px-3 rounded-lg bg-[#B8322E]/10 hover:bg-[#B8322E]/20 border border-[#B8322E]/40 text-[#B8322E] text-xs font-bold font-mono-numbers flex items-center justify-center space-x-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 text-[#B8322E]" />
                <span>DELETE</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
