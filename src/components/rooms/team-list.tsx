'use client';

// src/components/rooms/team-list.tsx
// Phase 5B Unified Team Roster with Owner Identity Editing & Removal Actions

import React from 'react';
import type { Team, RoomParticipant } from '@/lib/types/room';
import { Shield, Bot, User, Edit, UserX, LogOut, DollarSign } from 'lucide-react';

interface TeamListProps {
  teams: Team[];
  participants: RoomParticipant[];
  currentUserId?: string;
  isHost: boolean;
  onEditMyTeam?: (team: Team) => void;
  onRemoveParticipant?: (participant: RoomParticipant) => void;
}

export function TeamList({
  teams,
  participants,
  currentUserId,
  isHost,
  onEditMyTeam,
  onRemoveParticipant,
}: TeamListProps) {
  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-400" />
          <span>Auction Franchises ({teams.length})</span>
        </h3>
      </div>

      {/* Teams Grid */}
      {teams.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center text-slate-400">
          <Shield className="w-10 h-10 mx-auto mb-2 text-slate-600" />
          <p className="text-xs font-semibold text-white mb-1">No Franchises Configured Yet</p>
          <p className="text-[11px] text-slate-400">
            Franchises are created automatically when participants join the auction lobby.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teams.map((team) => {
            const assignedPart = participants.find((p) => p.team_id === team.id);
            const isOwner = Boolean(currentUserId && assignedPart?.user_id === currentUserId);
            const isPartHost = assignedPart?.role === 'HOST';

            return (
              <div
                key={team.id}
                className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all shadow-xl flex items-center justify-between relative overflow-hidden"
              >
                {/* Side Color Strip */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1.5"
                  style={{ backgroundColor: team.color }}
                />

                <div className="pl-2 space-y-1.5">
                  <div className="flex items-center space-x-2">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: team.color }}
                    />
                    <h4 className="text-sm font-bold text-white">{team.name}</h4>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-bold text-indigo-300">
                      {team.short_name}
                    </span>
                    {isOwner && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        YOUR TEAM
                      </span>
                    )}
                  </div>

                  {/* Manager info */}
                  <div className="flex items-center space-x-2 text-xs text-slate-400">
                    {team.is_bot ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-violet-400 font-medium">
                        <Bot className="w-3.5 h-3.5" /> AI Bot Manager
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-indigo-300 font-medium">
                        <User className="w-3.5 h-3.5" />
                        {assignedPart?.profile?.display_name || assignedPart?.profile?.username || 'Franchise Owner'}
                      </span>
                    )}
                  </div>

                  {/* Purse stats */}
                  <div className="flex items-center space-x-3 text-xs font-mono pt-1 text-slate-300">
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                      Starting Purse: <strong className="text-white">{team.initial_purse} Lakhs</strong>
                    </span>
                  </div>
                </div>

                {/* Team Actions */}
                <div className="flex items-center space-x-1.5">
                  {/* Owner Identity Edit */}
                  {isOwner && onEditMyTeam && (
                    <button
                      onClick={() => onEditMyTeam(team)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 text-xs font-semibold transition-colors"
                      title="Edit Franchise Identity"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  )}

                  {/* Non-host member self-leave or Host moderation remove */}
                  {assignedPart && !isPartHost && onRemoveParticipant && (isOwner || isHost) && (
                    <button
                      onClick={() => onRemoveParticipant(assignedPart)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors"
                      title={isOwner ? 'Leave Room & Delete Team' : 'Remove Participant'}
                    >
                      {isOwner ? <LogOut className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

