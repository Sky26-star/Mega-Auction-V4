'use client';

// src/components/rooms/auction-participant-card.tsx
import React from 'react';
import type { Team, RoomParticipant } from '@/lib/types/room';
import { BOT_FRANCHISE_POOL } from '@/lib/bots';
import { Shield, Bot, User, Crown, Edit, UserX, LogOut, Coins, Globe, Users } from 'lucide-react';

export interface AuctionParticipantCardProps {
  team: Team;
  participant?: RoomParticipant;
  currentUserId?: string;
  isHost: boolean;
  maxSquadSize?: number;
  maxOverseas?: number;
  onEditTeam?: (team: Team) => void;
  onRemoveParticipant?: (participant: RoomParticipant) => void;
}

export function AuctionParticipantCard({
  team,
  participant,
  currentUserId,
  isHost,
  maxSquadSize = 15,
  maxOverseas = 8,
  onEditTeam,
  onRemoveParticipant,
}: AuctionParticipantCardProps) {
  const isOwner = Boolean(currentUserId && participant?.user_id === currentUserId);
  const isPartHost = participant?.role === 'HOST';

  // Ensure Purse is always displayed in Crores
  const purseCr = team.purse > 0 ? team.purse : team.initial_purse || 100;
  const formattedPurse = `₹${purseCr} Cr`;

  const squadCount = team.players_bought || 0;
  const overseasCount = team.overseas_count || 0;

  const matchedBot = BOT_FRANCHISE_POOL.find(
    (b) => b.name.trim().toLowerCase() === team.name.trim().toLowerCase() || b.shortName === team.short_name
  );
  const managerDisplayName =
    participant?.profile?.display_name ||
    participant?.profile?.username ||
    (team.is_bot ? (matchedBot?.managerName ? `AI Manager (${matchedBot.managerName})` : 'AI Manager') : 'Franchise Owner');

  return (
    <div className="p-4 rounded-xl bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/40 transition-all shadow-lg relative overflow-hidden group">
      
      {/* Side Team Color Strip */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5"
        style={{ backgroundColor: team.color || '#C9A227' }}
      />

      <div className="pl-2 space-y-3">
        
        {/* Top Header: Team Logo/Color + Short Name + Badges */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div
              className="w-8 h-8 rounded-lg border border-white/20 flex items-center justify-center font-black text-xs text-white shadow-md flex-shrink-0"
              style={{ backgroundColor: team.color || '#3B82F6' }}
            >
              {team.short_name.slice(0, 3)}
            </div>

            <div>
              <div className="flex items-center space-x-1.5">
                <h4 className="text-sm font-bold text-[#F3F4F1] font-display uppercase tracking-wide truncate max-w-[150px]">
                  {team.name}
                </h4>
                <span className="font-mono-numbers text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-[#0B0F0D] border border-[#2A312D] text-[#C9A227]">
                  {team.short_name}
                </span>
              </div>

              {/* Manager Name */}
              <div className="flex items-center space-x-1.5 text-xs text-[#9CA6A0] mt-0.5">
                {team.is_bot ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#E4B93F] font-semibold">
                    <Bot className="w-3.5 h-3.5" /> {managerDisplayName}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#9CA6A0] font-semibold">
                    <User className="w-3.5 h-3.5 text-[#C9A227]" />
                    <strong className="text-[#F3F4F1]">{managerDisplayName}</strong>
                  </span>
                )}

                {team.is_bot && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-mono-numbers font-extrabold px-1.5 py-0.5 rounded bg-amber-500/15 text-[#E4B93F] border border-amber-500/30">
                    ● BOT
                  </span>
                )}

                {isPartHost && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-mono-numbers font-extrabold px-1.5 py-0.5 rounded bg-[#C9A227]/20 text-[#E4B93F] border border-[#C9A227]/40">
                    <Crown className="w-2.5 h-2.5" /> HOST
                  </span>
                )}

                {isOwner && (
                  <span className="text-[9px] font-mono-numbers font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                    YOU
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-1">
            {isOwner && onEditTeam && (
              <button
                type="button"
                onClick={() => onEditTeam(team)}
                className="p-1.5 rounded-lg bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#E4B93F] text-xs font-semibold transition-colors"
                title="Edit Team Identity"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
            )}

            {participant && !isPartHost && onRemoveParticipant && (isOwner || isHost) && (
              <button
                type="button"
                onClick={() => onRemoveParticipant(participant)}
                className="p-1.5 rounded-lg text-[#9CA6A0] hover:text-[#B8322E] hover:bg-[#B8322E]/10 border border-transparent hover:border-[#B8322E]/30 transition-colors"
                title={isOwner ? 'Leave Room & Delete Team' : 'Remove Participant'}
              >
                {isOwner ? <LogOut className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        {/* Stats Grid: Purse, Squad, Overseas */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#2A312D] text-xs font-mono-numbers">
          {/* Purse Remaining */}
          <div className="bg-[#0B0F0D] p-2 rounded-lg border border-[#2A312D] text-center">
            <span className="text-[9px] font-bold text-[#9CA6A0] uppercase block mb-0.5 flex items-center justify-center gap-1">
              <Coins className="w-3 h-3 text-[#E4B93F]" />
              <span>PURSE</span>
            </span>
            <span className="font-extrabold text-[#E4B93F] text-xs">
              {formattedPurse}
            </span>
          </div>

          {/* Squad Count */}
          <div className="bg-[#0B0F0D] p-2 rounded-lg border border-[#2A312D] text-center">
            <span className="text-[9px] font-bold text-[#9CA6A0] uppercase block mb-0.5 flex items-center justify-center gap-1">
              <Users className="w-3 h-3 text-[#C9A227]" />
              <span>SQUAD</span>
            </span>
            <span className="font-bold text-[#F3F4F1] text-xs">
              {squadCount} / {maxSquadSize}
            </span>
          </div>

          {/* Overseas Count */}
          <div className="bg-[#0B0F0D] p-2 rounded-lg border border-[#2A312D] text-center">
            <span className="text-[9px] font-bold text-[#9CA6A0] uppercase block mb-0.5 flex items-center justify-center gap-1">
              <Globe className="w-3 h-3 text-sky-400" />
              <span>OVERSEAS</span>
            </span>
            <span className="font-bold text-sky-400 text-xs">
              {overseasCount} / {maxOverseas}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
