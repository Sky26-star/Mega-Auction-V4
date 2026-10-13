// src/components/summary/spending-analytics.tsx
// Comprehensive Spending Analytics, Role/Category Distribution & Data Export (PRD Item 6)

import React, { useState } from 'react';
import type {
  CategoryBreakdown,
  RoleBreakdown,
  DomesticVsOverseasBreakdown,
  SummaryTeamData,
  SummaryOverview,
} from '@/lib/summary/loader';
import { PieChart, BarChart3, Download, FileText, Globe, UserCheck, Layers, CheckCircle } from 'lucide-react';

interface SpendingAnalyticsProps {
  overview: SummaryOverview;
  teams: SummaryTeamData[];
  categoryBreakdown: CategoryBreakdown[];
  roleBreakdown: RoleBreakdown[];
  domesticVsOverseas: DomesticVsOverseasBreakdown;
}

export function SpendingAnalytics({
  overview,
  teams,
  categoryBreakdown,
  roleBreakdown,
  domesticVsOverseas,
}: SpendingAnalyticsProps) {
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  // CSV Export Handler
  const handleExportCSV = () => {
    const headers = [
      'Team Name',
      'Team Code',
      'Player Name',
      'Role',
      'Category',
      'Country',
      'Is Overseas',
      'Base Price (Cr)',
      'Sold Price (Cr)',
      'Auction Round',
    ];

    const rows: string[][] = [];
    teams.forEach((team) => {
      team.squad.forEach((player) => {
        rows.push([
          `"${team.name}"`,
          `"${team.shortName}"`,
          `"${player.name}"`,
          `"${player.role}"`,
          `"${player.category}"`,
          `"${player.country}"`,
          player.isOverseas ? 'Yes' : 'No',
          player.basePriceCr.toFixed(2),
          player.purchasePriceCr.toFixed(2),
          player.isMiniRound ? 'Mini Auction' : player.isUnsoldRound ? 'Round 2' : 'Mega Auction',
        ]);
      });
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `MegaAuction_${overview.roomCode}_Summary.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadSuccess('CSV Report downloaded successfully!');
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  // JSON Export Handler
  const handleExportJSON = () => {
    const exportData = {
      roomCode: overview.roomCode,
      roomName: overview.roomName,
      exportedAt: new Date().toISOString(),
      overview,
      teams: teams.map((t) => ({
        name: t.name,
        shortName: t.shortName,
        isBot: t.isBot,
        initialPurseCr: t.initialPurseCr,
        totalSpentCr: t.totalSpentCr,
        remainingPurseCr: t.remainingPurseCr,
        playersBought: t.playersBought,
        overseasCount: t.overseasCount,
        squad: t.squad,
      })),
      categoryBreakdown,
      roleBreakdown,
      domesticVsOverseas,
    };

    const dataStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', dataStr);
    link.setAttribute('download', `MegaAuction_${overview.roomCode}_Summary.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadSuccess('JSON Data exported successfully!');
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  const totalRosterSpend = (domesticVsOverseas.domesticSpendCr + domesticVsOverseas.overseasSpendCr) || overview.totalSpendCr || 1;

  return (
    <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-3 sm:p-4 space-y-4 shadow-xl font-mono">
      {/* Header & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2A312D] pb-4">
        <div>
          <h3 className="text-xs font-black text-[#F3F4F1] uppercase tracking-wider flex items-center gap-2">
            <PieChart className="w-4 h-4 text-[#C9A227]" />
            AUCTION SPENDING & SQUAD DISTRIBUTION ANALYTICS
          </h3>
          <span className="text-[10px] text-[#9CA6A0] block mt-0.5">
            Authoritative financial allocation across roles, categories, and player origins
          </span>
        </div>

        <div className="flex items-center gap-2">
          {downloadSuccess && (
            <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 bg-emerald-950/60 border border-emerald-500/40 px-2.5 py-1 rounded-full">
              <CheckCircle className="w-3 h-3 text-emerald-400" /> {downloadSuccess}
            </span>
          )}
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] hover:border-[#C9A227]/50 hover:bg-[#181E1A] text-[#F3F4F1] hover:text-[#E4B93F] text-xs font-bold uppercase flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5" /> CSV EXPORT
          </button>
          <button
            onClick={handleExportJSON}
            className="px-3 py-1.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] hover:border-[#C9A227]/50 hover:bg-[#181E1A] text-[#F3F4F1] hover:text-[#E4B93F] text-xs font-bold uppercase flex items-center gap-1.5 transition-all shadow-sm"
          >
            <FileText className="w-3.5 h-3.5" /> JSON EXPORT
          </button>
        </div>
      </div>

      {/* Analytics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {/* 1. ROLE-WISE SPENDING BREAKDOWN */}
        <div className="bg-[#0B0F0D] border border-[#2A312D] p-4 rounded-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-[#2A312D] pb-2">
            <span className="text-[10px] font-bold text-[#E4B93F] uppercase tracking-widest flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#C9A227]" /> ROLE DISTRIBUTION
            </span>
            <span className="text-[9px] text-[#9CA6A0] uppercase">{roleBreakdown.length} Roles</span>
          </div>

          <div className="space-y-2.5 text-xs">
            {roleBreakdown.map((r) => (
              <div key={r.role} className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-[#F3F4F1] font-bold uppercase">{r.role}</span>
                  <span className="text-[#E4B93F] font-black">
                    ₹{r.totalSpentCr.toFixed(2)} Cr ({r.percentage}%)
                  </span>
                </div>
                <div className="w-full bg-[#141917] h-1.5 rounded-full overflow-hidden border border-[#2A312D]">
                  <div
                    className="h-full bg-[#C9A227] rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, r.percentage)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2. CATEGORY-WISE SPENDING BREAKDOWN */}
        <div className="bg-[#0B0F0D] border border-[#2A312D] p-4 rounded-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-[#2A312D] pb-2">
            <span className="text-[10px] font-bold text-[#E4B93F] uppercase tracking-widest flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-[#C9A227]" /> CATEGORY ALLOCATION
            </span>
            <span className="text-[9px] text-[#9CA6A0] uppercase">{categoryBreakdown.length} Categories</span>
          </div>

          <div className="space-y-2.5 text-xs">
            {categoryBreakdown.map((c) => (
              <div key={c.category} className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-[#F3F4F1] font-bold uppercase">{c.category}</span>
                  <span className="text-[#E4B93F] font-black">
                    ₹{c.totalSpentCr.toFixed(2)} Cr ({c.percentage}%)
                  </span>
                </div>
                <div className="w-full bg-[#141917] h-1.5 rounded-full overflow-hidden border border-[#2A312D]">
                  <div
                    className="h-full bg-[#E4B93F] rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, c.percentage)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. DOMESTIC VS OVERSEAS ALLOCATION */}
        <div className="bg-[#0B0F0D] border border-[#2A312D] p-4 rounded-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-[#2A312D] pb-2">
            <span className="text-[10px] font-bold text-[#E4B93F] uppercase tracking-widest flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-[#C9A227]" /> DOMESTIC VS OVERSEAS
            </span>
            <span className="text-[9px] text-[#9CA6A0] uppercase">Player Origin</span>
          </div>

          <div className="space-y-3 text-xs pt-1">
            {/* Domestic */}
            <div className="bg-[#141917] p-2.5 rounded-xl border border-[#2A312D] flex items-center justify-between">
              <div>
                <span className="text-[10px] text-[#9CA6A0] uppercase block font-bold">DOMESTIC (INDIA)</span>
                <span className="text-xs text-[#F3F4F1] font-bold">{domesticVsOverseas.domesticCount} Players</span>
              </div>
              <div className="text-right">
                <span className="font-black text-emerald-400 text-xs block">
                  ₹{domesticVsOverseas.domesticSpendCr.toFixed(2)} Cr
                </span>
                <span className="text-[9px] text-[#9CA6A0]">
                  {totalRosterSpend > 0
                    ? Math.round((domesticVsOverseas.domesticSpendCr / totalRosterSpend) * 100)
                    : 0}% Spend
                </span>
              </div>
            </div>

            {/* Overseas */}
            <div className="bg-[#141917] p-2.5 rounded-xl border border-[#2A312D] flex items-center justify-between">
              <div>
                <span className="text-[10px] text-[#E4B93F] uppercase block font-bold">OVERSEAS (INTL)</span>
                <span className="text-xs text-[#F3F4F1] font-bold">{domesticVsOverseas.overseasCount} Players</span>
              </div>
              <div className="text-right">
                <span className="font-black text-[#E4B93F] text-xs block">
                  ₹{domesticVsOverseas.overseasSpendCr.toFixed(2)} Cr
                </span>
                <span className="text-[9px] text-[#9CA6A0]">
                  {totalRosterSpend > 0
                    ? Math.round((domesticVsOverseas.overseasSpendCr / totalRosterSpend) * 100)
                    : 0}% Spend
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
