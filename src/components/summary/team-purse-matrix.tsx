
'use client';

import React from 'react';
import type { SummaryTeamData } from '@/lib/summary/loader';
import { Bot, User, Globe, Users, Wallet, TrendingUp } from 'lucide-react';

interface TeamPurseMatrixProps {
  teams: SummaryTeamData[];
  onSelectTeam?: (teamId: string) => void;
}

export function TeamPurseMatrix({ teams, onSelectTeam }: TeamPurseMatrixProps) {
  return (
    <section className="rounded-2xl border border-[#2A312D] bg-[#141917] p-3 sm:p-4 space-y-4 shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2A312D] pb-3">
        <h3 className="flex items-center gap-2 font-mono text-[11px] sm:text-xs font-black tracking-wide text-[#F3F4F1]">
          <Wallet className="h-4 w-4 text-[#C9A227]" />
          TEAM PURSE UTILIZATION & SQUAD MATRIX
        </h3>
        <span className="rounded-full border border-[#2A312D] bg-[#0B0F0D] px-2.5 py-1 text-[9px] font-mono text-[#9CA6A0]">
          {teams.length} PARTICIPATING FRANCHISES
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {teams.map((team) => {
          const initialPurse = Number(team.initialPurseCr) || 0;
          const spent = Number(team.totalSpentCr) || 0;
          const squadLimit = Number(team.maxSquadSize) || 0;
          const overseasLimit = Number(team.maxOverseas) || 0;

          const spendPct =
            initialPurse > 0
              ? Math.min(100, Math.max(0, (spent / initialPurse) * 100))
              : 0;

          const squadPct =
            squadLimit > 0
              ? Math.min(100, Math.max(0, (team.playersBought / squadLimit) * 100))
              : 0;

          return (
            <button
              key={team.id}
              type="button"
              onClick={() => onSelectTeam?.(team.id)}
              className="group min-w-0 w-full rounded-xl border border-[#2A312D] bg-[#0B0F0D] p-3 text-left transition-colors hover:border-[#C9A227]/50 hover:bg-[#181E1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]"
              aria-label={`View ${team.name} squad`}
            >
              {/* Team identity */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
                    style={{ backgroundColor: team.color }}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-[#F3F4F1] group-hover:text-[#E4B93F]">
                        {team.name}
                      </span>
                      <span className="text-[9px] font-mono text-[#9CA6A0]">
                        {team.shortName}
                      </span>
                    </div>
                  </div>
                </div>

                <span
                  className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-mono font-bold ${team.isBot
                    ? 'border-[#2A312D] bg-[#141917] text-[#9CA6A0]'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    }`}
                >
                  {team.isBot ? (
                    <Bot className="h-3 w-3" />
                  ) : (
                    <User className="h-3 w-3" />
                  )}
                  {team.isBot ? 'BOT' : 'HUMAN'}
                </span>
              </div>

              {/* Purse utilization */}
              <div className="mt-4 space-y-2">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[8px] font-mono tracking-wide text-[#9CA6A0]">
                      NET CAPITAL SPENT
                    </p>
                    <p className="mt-0.5 text-sm font-black text-[#E4B93F]">
                      ₹{spent.toFixed(2)} Cr
                    </p>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-[#9CA6A0]">
                    {Math.round(spendPct)}%
                  </span>
                </div>

                <div
                  className="h-2 overflow-hidden rounded-full border border-[#2A312D] bg-[#141917]"
                  role="progressbar"
                  aria-label={`${team.name} purse utilized`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(spendPct)}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#C9A227] to-[#E4B93F] transition-all duration-500"
                    style={{ width: `${spendPct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 text-[9px] font-mono text-[#9CA6A0]">
                  <span>INITIAL PURSE</span>
                  <span className="text-[#F3F4F1]">
                    ₹{initialPurse.toFixed(2)} Cr
                  </span>
                </div>
              </div>

              {/* Auction round breakdown */}
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#2A312D] pt-3 text-[9px] font-mono">
                <div className="min-w-0">
                  <span className="block text-[#9CA6A0]">MEGA</span>
                  <span className="mt-0.5 block truncate font-bold text-[#F3F4F1]">
                    ₹{team.megaSpendCr.toFixed(2)}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="block text-[#9CA6A0]">REFUNDS</span>
                  <span className="mt-0.5 block truncate font-bold text-emerald-400">
                    ₹{team.releaseRefundsCr.toFixed(2)}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="block text-[#9CA6A0]">MINI</span>
                  <span className="mt-0.5 block truncate font-bold text-[#E4B93F]">
                    ₹{team.miniSpendCr.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Squad and purse metrics */}
              <div className="mt-3 rounded-lg border border-[#2A312D] bg-[#141917] p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[9px] font-mono text-[#9CA6A0]">
                    <Users className="h-3 w-3 text-[#C9A227]" /> SQUAD
                  </span>
                  <span className="text-[10px] font-mono font-bold text-[#F3F4F1]">
                    {team.playersBought}/{squadLimit}
                  </span>
                </div>

                <div className="mb-3 h-1 overflow-hidden rounded-full bg-[#0B0F0D]">
                  <div
                    className="h-full rounded-full bg-[#C9A227]"
                    style={{ width: `${squadPct}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                  <div className="min-w-0">
                    <span className="block text-[8px] font-mono text-[#9CA6A0]">
                      PURSE REMAINING
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-black text-emerald-400">
                      ₹{team.remainingPurseCr.toFixed(2)} Cr
                    </span>
                  </div>

                  <div className="min-w-0">
                    <span className="flex items-center gap-1 text-[8px] font-mono text-[#9CA6A0]">
                      <TrendingUp className="h-3 w-3 text-[#C9A227]" /> AVG BUY
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-black text-[#E4B93F]">
                      ₹{team.avgPurchasePriceCr.toFixed(2)} Cr
                    </span>
                  </div>

                  <div className="min-w-0">
                    <span className="block text-[8px] font-mono text-[#9CA6A0]">
                      PLAYERS BOUGHT
                    </span>
                    <span className="mt-0.5 block text-xs font-bold text-[#F3F4F1]">
                      {team.playersBought}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <span className="flex items-center gap-1 text-[8px] font-mono text-[#9CA6A0]">
                      <Globe className="h-3 w-3 text-[#C9A227]" /> OVERSEAS
                    </span>
                    <span className="mt-0.5 block text-xs font-bold text-[#E4B93F]">
                      {team.overseasCount}/{overseasLimit}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
