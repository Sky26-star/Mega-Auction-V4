'use client';

// src/components/rooms/auction-participants.tsx
import React from 'react';
import type { Team, RoomParticipant } from '@/lib/types/room';
import { AuctionParticipantCard } from './auction-participant-card';
import { Shield, Users } from 'lucide-react';

export interface AuctionParticipantsProps {
  teams: Team[];
  participants: RoomParticipant[];
  currentUserId?: string;
  isHost: boolean;
  maxSquadSize?: number;
  maxOverseas?: number;
  onEditTeam?: (team: Team) => void;
  onRemoveParticipant?: (participant: RoomParticipant) => void;
}

export function AuctionParticipants({
  teams,
  participants,
  currentUserId,
  isHost,
  maxSquadSize = 15,
  maxOverseas = 8,
  onEditTeam,
  onRemoveParticipant,
}: AuctionParticipantsProps) {
  return (
    <div className="w-full space-y-4">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#2A312D] pb-3">
        <h3 className="text-sm font-black text-[#F3F4F1] uppercase font-display tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4 text-[#C9A227]" />
          <span>AUCTION MANAGERS ({teams.length}/10)</span>
        </h3>

        <span className="text-[10px] font-mono-numbers font-extrabold text-[#E4B93F] bg-[#0B0F0D] px-2.5 py-0.5 rounded border border-[#2A312D]">
          ROSTER
        </span>
      </div>

      {/* Teams List */}
      {teams.length === 0 ? (
        <div className="p-8 rounded-xl bg-[#141917] border border-[#2A312D] text-center text-[#9CA6A0]">
          <Shield className="w-10 h-10 mx-auto mb-2 text-[#2A312D]" />
          <p className="text-xs font-bold text-[#F3F4F1] mb-1">NO MANAGERS CONNECTED</p>
          <p className="text-[11px] text-[#9CA6A0]">
            Managers and franchises will appear here as participants join the room code.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map((team) => {
            const assignedPart = participants.find((p) => p.team_id === team.id);
            return (
              <AuctionParticipantCard
                key={team.id}
                team={team}
                participant={assignedPart}
                currentUserId={currentUserId}
                isHost={isHost}
                maxSquadSize={maxSquadSize}
                maxOverseas={maxOverseas}
                onEditTeam={onEditTeam}
                onRemoveParticipant={onRemoveParticipant}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
