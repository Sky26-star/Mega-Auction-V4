'use client';

// src/components/rooms/participant-list.tsx
// Phase 5B Room Participant List with Team Identity & Moderation Removal Actions

import React from 'react';
import type { RoomParticipant, Team } from '@/lib/types/room';
import { Crown, User, Bot, Shield, UserX, LogOut } from 'lucide-react';

interface ParticipantListProps {
  participants: RoomParticipant[];
  teams: Team[];
  currentUserId?: string;
  isHost: boolean;
  onRemoveParticipant?: (participant: RoomParticipant) => void;
}

export function ParticipantList({
  participants,
  teams,
  currentUserId,
  isHost,
  onRemoveParticipant,
}: ParticipantListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <User className="w-4 h-4 text-indigo-400" />
          <span>Room Participants ({participants.length})</span>
        </h3>
      </div>

      <div className="divide-y divide-slate-800/60 rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        {participants.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">
            No participants joined yet.
          </div>
        ) : (
          participants.map((participant) => {
            const isParticipantHost = participant.role === 'HOST';
            const isSelf = Boolean(currentUserId && participant.user_id === currentUserId);
            const assignedTeam = teams.find((t) => t.id === participant.team_id) || participant.team;

            return (
              <div
                key={participant.id}
                className="p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
              >
                {/* User Info */}
                <div className="flex items-center space-x-3">
                  <div className="relative">
                    {participant.is_bot ? (
                      <div className="w-9 h-9 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30 flex items-center justify-center">
                        <Bot className="w-5 h-5" />
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold text-xs uppercase">
                        {participant.profile?.display_name?.charAt(0) || 'U'}
                      </div>
                    )}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
                        participant.is_connected ? 'bg-emerald-500' : 'bg-slate-500'
                      }`}
                      title={participant.is_connected ? 'Connected' : 'Offline'}
                    />
                  </div>

                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-white">
                        {participant.profile?.display_name || (participant.is_bot ? 'AI Bot Manager' : 'Guest Participant')}
                      </span>
                      {isSelf && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          YOU
                        </span>
                      )}
                      {isParticipantHost && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <Crown className="w-3 h-3" /> HOST
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {participant.profile?.username ? `@${participant.profile.username}` : participant.role}
                    </span>
                  </div>
                </div>

                {/* Team Badge and Action */}
                <div className="flex items-center space-x-3">
                  {assignedTeam ? (
                    <span
                      style={{ borderColor: `${assignedTeam.color}60`, backgroundColor: `${assignedTeam.color}20` }}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border text-white shadow-sm"
                    >
                      <Shield className="w-3.5 h-3.5" style={{ color: assignedTeam.color }} />
                      <span>{assignedTeam.name} ({assignedTeam.short_name})</span>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500 italic">No Team Configured</span>
                  )}

                  {/* Self leave or Host removal */}
                  {!isParticipantHost && onRemoveParticipant && (isSelf || isHost) && (
                    <button
                      onClick={() => onRemoveParticipant(participant)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors"
                      title={isSelf ? 'Leave Room & Delete Team' : 'Remove Participant'}
                    >
                      {isSelf ? <LogOut className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

