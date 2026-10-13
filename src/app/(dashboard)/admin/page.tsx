'use client';

export const dynamic = 'force-dynamic';

// src/app/(dashboard)/admin/page.tsx
// Authoritative Platform Admin Console (/admin)

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/layout/navbar';
import { type AdminDashboardData } from '@/lib/admin/loader';
import {
  ShieldAlert,
  ShieldCheck,
  Users,
  Home,
  RefreshCw,
  Search,
  Activity,
  Layers,
  Radio,
  CheckCircle2,
  Clock,
  ChevronRight,
  Database,
  Lock,
} from 'lucide-react';

type AdminTab = 'OVERVIEW' | 'ROOMS' | 'USERS' | 'PLAYER_SETS' | 'LIVE_MONITOR';

export default function PlatformAdminDashboardPage() {
  const [adminData, setAdminData] = useState<AdminDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('OVERVIEW');

  // Search filters
  const [roomQuery, setRoomQuery] = useState<string>('');
  const [userQuery, setUserQuery] = useState<string>('');

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/dashboard');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}: Access restricted.`);
        setIsLoading(false);
        return;
      }
      const data: AdminDashboardData = await res.json();
      setAdminData(data);
    } catch (err: any) {
      setError(err?.message || 'NETWORK_ERROR: Failed to connect to admin dashboard.');
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filtered lists
  const filteredRooms = adminData?.rooms.filter(
    (r) =>
      r.name.toLowerCase().includes(roomQuery.toLowerCase()) ||
      r.code.toLowerCase().includes(roomQuery.toLowerCase()) ||
      r.hostName.toLowerCase().includes(roomQuery.toLowerCase())
  ) || [];

  const filteredUsers = adminData?.users.filter(
    (u) =>
      (u.displayName || '').toLowerCase().includes(userQuery.toLowerCase()) ||
      (u.username || '').toLowerCase().includes(userQuery.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-[#060911] text-zinc-100 flex flex-col font-sans">
      <Navbar />

      <div className="max-w-6xl mx-auto w-full px-4 py-6 flex-1 space-y-6">
        {/* Navigation & Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-amber-950/80 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                  <Lock className="w-3 h-3" /> RESTRICTED PLATFORM CONSOLE
                </span>
              </div>
              <h1 className="text-xl md:text-2xl font-black text-white font-mono tracking-tight mt-1">
                MEGA AUCTION PLATFORM ADMIN DASHBOARD
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              className="p-2.5 rounded-2xl bg-[#141A2D] border border-white/10 hover:border-white/20 text-zinc-300 hover:text-white transition-all shadow-md"
              title="Refresh Platform State"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <Link
              href="/dashboard"
              className="px-4 py-2.5 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all"
            >
              <Home className="w-4 h-4" /> USER DASHBOARD
            </Link>
          </div>
        </div>

        {/* Loading State */}
        {isLoading ? (
          <div className="p-16 rounded-3xl bg-[#0D1220] border border-white/10 text-center text-zinc-400 space-y-3 font-mono">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-amber-400" />
            <p className="text-xs">VERIFYING SERVER-SIDE ADMIN AUTHORIZATION & LOADING PLATFORM METRICS...</p>
          </div>
        ) : error ? (
          /* Error / 403 Forbidden Security State */
          <div className="p-8 rounded-3xl bg-red-950/40 border border-red-800/40 text-center text-red-300 space-y-4 font-mono max-w-xl mx-auto shadow-2xl">
            <ShieldAlert className="w-12 h-12 mx-auto text-red-400" />
            <h3 className="font-bold text-lg text-red-200 uppercase tracking-wide">
              403 FORBIDDEN — ACCESS RESTRICTED
            </h3>
            <p className="text-xs text-zinc-300 leading-relaxed">{error}</p>
            <div className="pt-2">
              <Link
                href="/dashboard"
                className="px-5 py-2.5 rounded-2xl bg-red-800 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 shadow-lg"
              >
                <Home className="w-4 h-4" /> RETURN TO USER DASHBOARD
              </Link>
            </div>
          </div>
        ) : adminData ? (
          /* Authoritative Platform Admin Console Content */
          <div className="space-y-6">
            {/* KPI Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
              <div className="bg-[#0D1220] border border-purple-500/30 p-4 rounded-3xl space-y-1 shadow-lg">
                <span className="text-[10px] text-purple-400 font-bold uppercase tracking-widest block">
                  TOTAL USERS
                </span>
                <span className="text-2xl font-black text-white">{adminData.stats.totalUsers}</span>
                <span className="text-[9px] text-zinc-400 block">Registered Accounts</span>
              </div>

              <div className="bg-[#0D1220] border border-amber-500/30 p-4 rounded-3xl space-y-1 shadow-lg">
                <span className="text-[10px] text-amber-400 font-bold uppercase tracking-widest block">
                  TOTAL ROOMS
                </span>
                <span className="text-2xl font-black text-amber-300">{adminData.stats.totalRooms}</span>
                <span className="text-[9px] text-zinc-400 block">{adminData.stats.activeRooms} Open</span>
              </div>

              <div className="bg-[#0D1220] border border-emerald-500/30 p-4 rounded-3xl space-y-1 shadow-lg">
                <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest block">
                  ACTIVE AUCTIONS
                </span>
                <span className="text-2xl font-black text-emerald-300">{adminData.stats.activeAuctions}</span>
                <span className="text-[9px] text-zinc-400 block">Live Bidding Now</span>
              </div>

              <div className="bg-[#0D1220] border border-blue-500/30 p-4 rounded-3xl space-y-1 shadow-lg">
                <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest block">
                  FINISHED AUCTIONS
                </span>
                <span className="text-2xl font-black text-blue-300">{adminData.stats.completedAuctions}</span>
                <span className="text-[9px] text-zinc-400 block">Completed Rooms</span>
              </div>

              <div className="bg-[#0D1220] border border-indigo-500/30 p-4 rounded-3xl space-y-1 shadow-lg">
                <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest block">
                  PLAYER SETS
                </span>
                <span className="text-2xl font-black text-indigo-300">{adminData.stats.totalPlayerSets}</span>
                <span className="text-[9px] text-zinc-400 block">Available Pools</span>
              </div>

              <div className="bg-[#0D1220] border border-zinc-700 p-4 rounded-3xl space-y-1 shadow-lg">
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest block">
                  TOTAL PLAYERS
                </span>
                <span className="text-2xl font-black text-zinc-200">{adminData.stats.totalPlayers}</span>
                <span className="text-[9px] text-zinc-400 block">Catalog Athletes</span>
              </div>
            </div>

            {/* Admin Tabs Navigation */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-white/10 font-mono">
              {(
                [
                  { id: 'OVERVIEW', label: 'OVERVIEW & MONITORING', icon: Activity },
                  { id: 'ROOMS', label: `ROOM MANAGEMENT (${adminData.rooms.length})`, icon: Layers },
                  { id: 'USERS', label: `PLATFORM ACCOUNTS (${adminData.users.length})`, icon: Users },
                  { id: 'PLAYER_SETS', label: `PLAYER POOLS (${adminData.playerSets.length})`, icon: Database },
                  { id: 'LIVE_MONITOR', label: `LIVE MONITOR (${adminData.activeAuctions.length})`, icon: Radio },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as AdminTab)}
                    className={`py-2.5 px-4 rounded-2xl text-xs font-bold uppercase transition-all whitespace-nowrap flex items-center gap-2 border ${
                      isActive
                        ? 'bg-amber-500 border-amber-400 text-black shadow-lg font-black scale-105'
                        : 'bg-[#141A2D] border-white/5 text-zinc-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* TAB 1: OVERVIEW & SYSTEM STATUS */}
            {activeTab === 'OVERVIEW' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 font-mono">
                {/* Active Rooms Monitor Card */}
                <div className="bg-[#0D1220] border border-white/10 p-5 rounded-3xl space-y-4 shadow-xl">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                      ACTIVE PLATFORM ROOMS
                    </h3>
                    <span className="text-[10px] text-zinc-400 uppercase">
                      {adminData.rooms.filter((r) => r.status === 'OPEN').length} Open
                    </span>
                  </div>

                  <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                    {adminData.rooms.slice(0, 6).map((room) => (
                      <div
                        key={room.id}
                        className="bg-[#141A2D] border border-white/5 p-3 rounded-2xl flex items-center justify-between hover:border-amber-400/40 transition-all"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="bg-purple-950/80 border border-purple-500/40 text-purple-300 font-bold text-[10px] px-2 py-0.5 rounded-full">
                              #{room.code}
                            </span>
                            <span className="font-bold text-white text-sm">{room.name}</span>
                          </div>
                          <span className="text-[10px] text-zinc-400 block mt-0.5">
                            Host: {room.hostName} • {room.participantCount} Managers Joined
                          </span>
                        </div>

                        <div className="text-right flex items-center gap-2">
                          <div>
                            <span className="bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase block">
                              {room.status}
                            </span>
                            <span className="text-[8px] text-zinc-500 block mt-0.5">
                              {new Date(room.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <Link
                            href={`/rooms/${room.id}`}
                            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300"
                            title="Inspect Room"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Registered Platform Users Card */}
                <div className="bg-[#0D1220] border border-white/10 p-5 rounded-3xl space-y-4 shadow-xl">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-400" />
                      RECENT REGISTRATIONS
                    </h3>
                    <span className="text-[10px] text-zinc-400 uppercase">
                      {adminData.users.length} Total Accounts
                    </span>
                  </div>

                  <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                    {adminData.users.slice(0, 6).map((u) => (
                      <div
                        key={u.id}
                        className="bg-[#141A2D] border border-white/5 p-3 rounded-2xl flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-purple-900/60 border border-purple-400/40 flex items-center justify-center font-bold text-white text-xs">
                            {(u.displayName || u.username || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">
                                {u.displayName || u.username || 'Anonymous Manager'}
                              </span>
                              {u.isAdmin && (
                                <span className="bg-amber-950/80 border border-amber-500/40 text-amber-300 text-[8px] font-bold px-1.5 py-0.2 rounded uppercase">
                                  ADMIN
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-zinc-400 block">
                              @{u.username || 'no-handle'}
                            </span>
                          </div>
                        </div>

                        <span className="text-[9px] text-zinc-500">
                          Joined {new Date(u.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: ROOM MANAGEMENT */}
            {activeTab === 'ROOMS' && (
              <div className="bg-[#0D1220] border border-white/10 p-5 rounded-3xl space-y-4 shadow-xl font-mono">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    PLATFORM ROOM CATALOG & MONITORING
                  </h3>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search code, name, or host..."
                      value={roomQuery}
                      onChange={(e) => setRoomQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 bg-[#141A2D] border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400 w-64"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-zinc-400 uppercase text-[10px]">
                        <th className="py-2.5 px-3">CODE</th>
                        <th className="py-2.5 px-3">ROOM NAME</th>
                        <th className="py-2.5 px-3">HOST</th>
                        <th className="py-2.5 px-3">MANAGERS</th>
                        <th className="py-2.5 px-3">STATUS</th>
                        <th className="py-2.5 px-3">AUCTION</th>
                        <th className="py-2.5 px-3">CREATED</th>
                        <th className="py-2.5 px-3 text-right">ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredRooms.map((r) => (
                        <tr key={r.id} className="hover:bg-[#141A2D] transition-colors">
                          <td className="py-3 px-3">
                            <span className="bg-purple-950/80 border border-purple-500/40 text-purple-300 font-bold px-2 py-0.5 rounded-full text-[10px]">
                              #{r.code}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-bold text-white">{r.name}</td>
                          <td className="py-3 px-3 text-zinc-300">{r.hostName}</td>
                          <td className="py-3 px-3 text-zinc-400">{r.participantCount} Managers</td>
                          <td className="py-3 px-3">
                            <span className="bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                              {r.status}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-zinc-400 text-[10px] uppercase">
                              {r.auctionStatus || 'NOT STARTED'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-zinc-500 text-[10px]">
                            {new Date(r.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <Link
                              href={`/rooms/${r.id}`}
                              className="px-3 py-1 bg-purple-600/80 hover:bg-purple-500 text-white rounded-lg font-bold text-[10px] uppercase inline-flex items-center gap-1"
                            >
                              OPEN <ChevronRight className="w-3 h-3" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: USER ACCOUNTS */}
            {activeTab === 'USERS' && (
              <div className="bg-[#0D1220] border border-white/10 p-5 rounded-3xl space-y-4 shadow-xl font-mono">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-400" />
                    PLATFORM ACCOUNT CATALOG ({adminData.users.length})
                  </h3>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search display name or handle..."
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 bg-[#141A2D] border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-purple-400 w-64"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {filteredUsers.map((u) => (
                    <div
                      key={u.id}
                      className="bg-[#141A2D] border border-white/5 p-4 rounded-2xl flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-purple-900/60 border border-purple-400/40 flex items-center justify-center font-black text-white text-sm">
                          {(u.displayName || u.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm">
                              {u.displayName || u.username || 'Manager'}
                            </span>
                            {u.isAdmin && (
                              <span className="bg-amber-950/80 border border-amber-500/40 text-amber-300 text-[8px] font-bold px-1.5 py-0.2 rounded uppercase">
                                ADMIN
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-400 block">
                            @{u.username || 'no-handle'}
                          </span>
                        </div>
                      </div>
                      <span className="text-[9px] text-zinc-500 block">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 4: PLAYER POOLS */}
            {activeTab === 'PLAYER_SETS' && (
              <div className="bg-[#0D1220] border border-white/10 p-5 rounded-3xl space-y-4 shadow-xl font-mono">
                <div className="border-b border-white/10 pb-3">
                  <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-400" />
                    PLAYER SETS & POOLS ({adminData.playerSets.length})
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {adminData.playerSets.map((ps) => (
                    <div
                      key={ps.id}
                      className="bg-[#141A2D] border border-white/5 p-4 rounded-2xl space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-base">{ps.name}</span>
                        <span className="bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                          {ps.isPublic ? 'PUBLIC POOL' : 'PRIVATE POOL'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">{ps.description || 'Standard player set'}</p>
                      <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 border-t border-white/5">
                        <span>{ps.playerCount} Registered Athletes</span>
                        <span>Created by {ps.createdByName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 5: LIVE AUCTION MONITOR */}
            {activeTab === 'LIVE_MONITOR' && (
              <div className="bg-[#0D1220] border border-white/10 p-5 rounded-3xl space-y-4 shadow-xl font-mono">
                <div className="border-b border-white/10 pb-3 flex items-center justify-between">
                  <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                    REALTIME AUCTION ENGINE MONITORING
                  </h3>
                  <span className="text-[10px] text-emerald-400 font-bold">
                    {adminData.activeAuctions.length} Active Engine Sessions
                  </span>
                </div>

                {adminData.activeAuctions.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500 text-xs bg-[#141A2D] rounded-2xl border border-white/5 space-y-1">
                    <CheckCircle2 className="w-6 h-6 mx-auto text-zinc-600" />
                    <p>No auctions currently live or in active bidding state.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {adminData.activeAuctions.map((auc) => (
                      <div
                        key={auc.auctionId}
                        className="bg-[#141A2D] border border-emerald-500/30 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="bg-purple-950/80 border border-purple-500/40 text-purple-300 font-bold text-[10px] px-2 py-0.5 rounded-full">
                              #{auc.roomCode}
                            </span>
                            <span className="font-bold text-white text-base">{auc.roomName}</span>
                          </div>
                          <span className="text-[10px] text-zinc-400 block mt-0.5">
                            Status: <strong className="text-emerald-300">{auc.status}</strong> • Sequence #{auc.currentSequence}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-xs">
                          <div>
                            <span className="text-[8px] text-zinc-500 block uppercase">PROGRESS</span>
                            <span className="font-bold text-white">
                              {auc.completedLots} / {auc.totalLots} Lots
                            </span>
                          </div>
                          <Link
                            href={`/rooms/${auc.roomId}/auction`}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs uppercase flex items-center gap-1 shadow-md"
                          >
                            MONITOR STAGE <ChevronRight className="w-3 h-3" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
