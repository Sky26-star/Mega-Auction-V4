
// src/components/summary/squad-roster-tab.tsx
// Interactive Team Squad Roster Inspection

import React, { useEffect, useState } from 'react';
import type { SummaryTeamData } from '@/lib/summary/loader';
import { Shield, Globe, Sparkles, UserCheck } from 'lucide-react';

interface SquadRosterTabProps {
  teams: SummaryTeamData[];
  selectedTeamId?: string;
  onSelectPlayer?: (playerId: string, playerName?: string) => void;
}

export function SquadRosterTab({
  teams,
  selectedTeamId,
  onSelectPlayer,
}: SquadRosterTabProps) {
  const [activeTeamId, setActiveTeamId] = useState<string>(
    selectedTeamId || teams[0]?.id || ''
  );

  useEffect(() => {
    if (selectedTeamId && teams.some((team) => team.id === selectedTeamId)) {
      setActiveTeamId(selectedTeamId);
    }
  }, [selectedTeamId, teams]);

  const activeTeam = teams.find((team) => team.id === activeTeamId) || teams[0];

  if (!activeTeam) {
    return null;
  }

  return (
    <div className="min-w-0 rounded-2xl border border-[#2A312D] bg-[#141917] p-3 shadow-xl sm:p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2A312D] pb-3">
        <h3 className="flex items-center gap-2 font-mono text-xs font-black uppercase tracking-wider text-[#F3F4F1]">
          <Shield className="h-4 w-4 text-[#C9A227]" />
          TEAM SQUAD ROSTERS ({teams.length} TEAMS)
        </h3>

        <span className="font-mono text-[10px] uppercase text-[#9CA6A0]">
          {activeTeam.squad.length} Players Acquired
        </span>
      </div>

      {/* Team Tabs */}
      <div
        className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-[#2A312D]"
        role="tablist"
        aria-label="Select team roster"
      >
        {teams.map((team) => {
          const isActive = team.id === activeTeamId;

          return (
            <button
              key={team.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTeamId(team.id)}
              className={`shrink-0 flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 font-mono text-xs font-bold uppercase transition-all ${isActive
                ? 'border-[#C9A227] bg-[#C9A227] text-[#0B0F0D] shadow-md shadow-[#C9A227]/20 font-black'
                : 'border-[#2A312D] bg-[#0B0F0D] text-[#9CA6A0] hover:border-[#C9A227]/40 hover:text-[#F3F4F1] hover:bg-[#181E1A]'
                }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full border border-white/20"
                style={{ backgroundColor: team.color }}
              />
              <span>{team.shortName}</span>
              <span className="text-[10px] font-normal opacity-75">
                ({team.playersBought})
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Team Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2A312D] bg-[#0B0F0D] p-3 font-mono sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white/20 text-xs font-black text-white shadow-md"
            style={{ backgroundColor: activeTeam.color }}
          >
            {activeTeam.shortName}
          </div>

          <div className="min-w-0">
            <h4 className="break-words text-base font-bold text-[#F3F4F1]">
              {activeTeam.name}
            </h4>
            <span className="block text-[10px] text-[#9CA6A0]">
              {activeTeam.isBot
                ? '🤖 AI Bot Managed Franchise'
                : '👤 Human Managed Franchise'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-xs">
          <div>
            <span className="block text-[8px] uppercase text-[#9CA6A0]">
              NET CAPITAL SPEND
            </span>
            <span className="font-black text-[#E4B93F]">
              ₹{activeTeam.totalSpentCr.toFixed(2)} Cr
            </span>
          </div>

          <div className="h-6 w-px bg-[#2A312D]" />

          <div>
            <span className="block text-[8px] uppercase text-[#9CA6A0]">
              PURSE LEFT
            </span>
            <span className="font-black text-emerald-400">
              ₹{activeTeam.remainingPurseCr.toFixed(2)} Cr
            </span>
          </div>

          <div className="h-6 w-px bg-[#2A312D]" />

          <div>
            <span className="block text-[8px] uppercase text-[#9CA6A0]">
              OVERSEAS
            </span>
            <span className="font-bold text-[#E4B93F]">
              {activeTeam.overseasCount} / {activeTeam.maxOverseas}
            </span>
          </div>
        </div>
      </div>

      {/* Squad Roster */}
      {activeTeam.squad.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-[#2A312D] bg-[#0B0F0D] p-8 text-center font-mono text-xs text-[#9CA6A0]">
          <UserCheck className="mx-auto h-6 w-6 text-[#9CA6A0]" />
          <p>No players acquired by {activeTeam.name} during this auction.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {activeTeam.squad.map((player, idx) => (
            <div
              key={player.squadPlayerId || player.id || idx}
              onClick={() => onSelectPlayer?.(player.id, player.name)}
              className="group flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-xl border border-[#2A312D] bg-[#0B0F0D] p-3 font-mono transition-colors hover:border-[#C9A227]/50 hover:bg-[#181E1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]"
              title="Click to view full player lifecycle history"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-4 shrink-0 text-right text-xs font-bold text-[#9CA6A0]">
                  {idx + 1}.
                </span>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="break-words text-sm font-bold text-[#F3F4F1]">
                      {player.name}
                    </span>

                    {player.isOverseas && (
                      <span className="flex items-center gap-0.5 rounded border border-[#2A312D] bg-[#141917] px-1.5 py-0.5 text-[8px] font-bold text-[#E4B93F]">
                        <Globe className="h-2.5 w-2.5" /> OS
                      </span>
                    )}

                    {player.isMiniRound && (
                      <span className="flex items-center gap-0.5 rounded border border-[#C9A227]/40 bg-[#C9A227]/10 px-1.5 py-0.5 text-[8px] font-bold text-[#E4B93F]">
                        <Sparkles className="h-2.5 w-2.5" /> MINI
                      </span>
                    )}

                    {player.isUnsoldRound && (
                      <span className="flex items-center gap-0.5 rounded border border-[#C9A227]/40 bg-[#C9A227]/10 px-1.5 py-0.5 text-[8px] font-bold text-[#E4B93F]">
                        <Sparkles className="h-2.5 w-2.5" /> RD 2
                      </span>
                    )}
                  </div>

                  <span className="block break-words text-[10px] text-[#9CA6A0]">
                    {player.role} • {player.category} ({player.country})
                  </span>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <span className="block text-sm font-black text-[#E4B93F]">
                  ₹{player.purchasePriceCr.toFixed(2)} Cr
                </span>
                <span className="block text-[8px] uppercase text-[#9CA6A0]">
                  Base: ₹{player.basePriceCr.toFixed(2)} Cr
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}