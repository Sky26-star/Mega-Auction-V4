'use client';

// src/app/(dashboard)/player-sets/page.tsx
// Mega Auction — Player Database Control Center Page (V2 UI/UX Redesign)

import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from '@/components/layout/navbar';
import { PlayerSetCard } from '@/components/player-sets/player-set-card';
import { PlayerSetModal } from '@/components/player-sets/player-set-modal';
import { getPlayerSets, createPlayerSet, updatePlayerSet, deletePlayerSet } from '@/lib/player-sets';
import { getCurrentProfile } from '@/lib/auth';
import type { PlayerSet, PlayerSetFormInput } from '@/lib/types/player-set';
import type { Profile } from '@/lib/types/auth';
import {
  Database,
  PlusCircle,
  Search,
  Users,
  Globe,
  Lock,
  ArrowUpDown,
  Layers,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';

export default function PlayerSetsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [playerSets, setPlayerSets] = useState<PlayerSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters, Search & Sorting
  const [tabFilter, setTabFilter] = useState<'ALL' | 'MY_SETS' | 'PUBLIC'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'name_asc' | 'players_desc'>('date_desc');

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<PlayerSet | null>(null);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const [prof, sets] = await Promise.all([
          getCurrentProfile(),
          getPlayerSets(),
        ]);
        setProfile(prof);
        setPlayerSets(sets);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to load player sets');
        }
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const handleCreateOrUpdateSet = async (data: PlayerSetFormInput) => {
    if (editingSet) {
      const updated = await updatePlayerSet(editingSet.id, data);
      setPlayerSets((prev) =>
        prev.map((s) => (s.id === updated.id ? { ...updated, player_count: s.player_count, category_counts: s.category_counts, preview_images: s.preview_images } : s))
      );
    } else {
      const newSet = await createPlayerSet(data);
      setPlayerSets((prev) => [{ ...newSet, player_count: 0, category_counts: { MARQUEE: 0, A: 0, B: 0, C: 0, D: 0 }, preview_images: [] }, ...prev]);
    }
  };

  const handleDeleteSet = async (setToDelete: PlayerSet) => {
    if (!confirm(`Are you sure you want to delete "${setToDelete.name}"? All players inside will be permanently deleted.`)) {
      return;
    }
    try {
      await deletePlayerSet(setToDelete.id);
      setPlayerSets((prev) => prev.filter((s) => s.id !== setToDelete.id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete player set');
    }
  };

  const totalPlayersCount = useMemo(() => {
    return playerSets.reduce((sum, ps) => sum + (ps.player_count || 0), 0);
  }, [playerSets]);

  const publicSetsCount = useMemo(() => {
    return playerSets.filter((s) => s.is_public).length;
  }, [playerSets]);

  const mySetsCount = useMemo(() => {
    return playerSets.filter((s) => profile && s.created_by === profile.id).length;
  }, [playerSets, profile]);

  const filteredSets = useMemo(() => {
    return playerSets
      .filter((ps) => {
        const searchLower = searchTerm.toLowerCase().trim();
        const matchesSearch =
          ps.name.toLowerCase().includes(searchLower) ||
          (ps.description && ps.description.toLowerCase().includes(searchLower));

        const isOwner = profile ? ps.created_by === profile.id : false;
        const matchesTab =
          tabFilter === 'ALL' ||
          (tabFilter === 'MY_SETS' && isOwner) ||
          (tabFilter === 'PUBLIC' && ps.is_public);

        return matchesSearch && matchesTab;
      })
      .sort((a, b) => {
        if (sortBy === 'date_desc') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sortBy === 'date_asc') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
        if (sortBy === 'players_desc') return (b.player_count || 0) - (a.player_count || 0);
        return 0;
      });
  }, [playerSets, searchTerm, tabFilter, sortBy, profile]);

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Hero Header Section */}
        <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
          <div className="space-y-1.5 z-10 max-w-2xl">
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/20 text-[#A855F7] border border-[#7C3AED]/40 flex items-center justify-center flex-shrink-0 shadow-inner">
                <Database className="w-5 h-5" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-[#F3F4F1] tracking-tight uppercase font-display">
                PLAYER SETS
              </h1>
            </div>
            <p className="text-xs text-[#9CA6A0] font-medium leading-relaxed">
              Build and manage your auction player databases. Player sets define the cricket star pools, category tiers, and base prices imported directly into live IPL auction rooms.
            </p>
          </div>

          {/* Primary Action Button */}
          <button
            type="button"
            onClick={() => {
              setEditingSet(null);
              setIsModalOpen(true);
            }}
            className="px-5 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-mono font-bold text-xs shadow-lg shadow-purple-950/40 flex items-center space-x-2 transition-all hover:scale-105 active:scale-95 flex-shrink-0"
          >
            <PlusCircle className="w-4 h-4" />
            <span>CREATE PLAYER SET</span>
          </button>
        </div>

        {/* Command-Center Summary Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#141917] border border-[#2A312D] flex items-center space-x-3 shadow-lg">
            <div className="w-9 h-9 rounded-lg bg-[#7C3AED]/20 text-[#A855F7] border border-[#7C3AED]/30 flex items-center justify-center">
              <Layers className="w-4.5 h-4.5" />
            </div>
            <div>
              <span className="block text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-wider">TOTAL SETS</span>
              <span className="text-lg font-mono font-black text-[#F3F4F1]">{playerSets.length}</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#141917] border border-[#2A312D] flex items-center space-x-3 shadow-lg">
            <div className="w-9 h-9 rounded-lg bg-indigo-950 text-indigo-400 border border-indigo-800/60 flex items-center justify-center">
              <Users className="w-4.5 h-4.5" />
            </div>
            <div>
              <span className="block text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-wider">TOTAL PLAYERS</span>
              <span className="text-lg font-mono font-black text-[#F3F4F1]">{totalPlayersCount}</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#141917] border border-[#2A312D] flex items-center space-x-3 shadow-lg">
            <div className="w-9 h-9 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800/60 flex items-center justify-center">
              <Globe className="w-4.5 h-4.5" />
            </div>
            <div>
              <span className="block text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-wider">PUBLIC POOLS</span>
              <span className="text-lg font-mono font-black text-emerald-400">{publicSetsCount}</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#141917] border border-[#2A312D] flex items-center space-x-3 shadow-lg">
            <div className="w-9 h-9 rounded-lg bg-amber-950 text-amber-400 border border-amber-800/60 flex items-center justify-center">
              <Lock className="w-4.5 h-4.5" />
            </div>
            <div>
              <span className="block text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-wider">PRIVATE POOLS</span>
              <span className="text-lg font-mono font-black text-amber-400">{playerSets.length - publicSetsCount}</span>
            </div>
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="p-4 rounded-2xl bg-[#141917] border border-[#2A312D] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          {/* Tab Filter */}
          <div className="flex items-center space-x-1 p-1 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
            <button
              type="button"
              onClick={() => setTabFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                tabFilter === 'ALL'
                  ? 'bg-[#7C3AED] text-white shadow-md'
                  : 'text-[#9CA6A0] hover:text-[#F3F4F1]'
              }`}
            >
              ALL SETS ({playerSets.length})
            </button>
            <button
              type="button"
              onClick={() => setTabFilter('MY_SETS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                tabFilter === 'MY_SETS'
                  ? 'bg-[#7C3AED] text-white shadow-md'
                  : 'text-[#9CA6A0] hover:text-[#F3F4F1]'
              }`}
            >
              MY SETS ({mySetsCount})
            </button>
            <button
              type="button"
              onClick={() => setTabFilter('PUBLIC')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                tabFilter === 'PUBLIC'
                  ? 'bg-[#7C3AED] text-white shadow-md'
                  : 'text-[#9CA6A0] hover:text-[#F3F4F1]'
              }`}
            >
              PUBLIC SETS ({publicSetsCount})
            </button>
          </div>

          {/* Search & Sort Controls */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA6A0]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search player databases..."
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#9CA6A0] focus:outline-none focus:border-[#7C3AED] text-xs font-medium transition-all"
              />
            </div>

            <div className="flex items-center space-x-1.5 bg-[#0B0F0D] border border-[#2A312D] rounded-xl px-2.5 py-2 text-xs">
              <ArrowUpDown className="w-3.5 h-3.5 text-[#A855F7]" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-[#F3F4F1] focus:outline-none font-mono font-bold text-xs cursor-pointer"
              >
                <option value="date_desc" className="bg-[#141917]">NEWEST FIRST</option>
                <option value="date_asc" className="bg-[#141917]">OLDEST FIRST</option>
                <option value="name_asc" className="bg-[#141917]">NAME: A TO Z</option>
                <option value="players_desc" className="bg-[#141917]">MOST PLAYERS</option>
              </select>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/40 flex items-start space-x-3 text-red-400 text-xs font-medium">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Player Set Grid / Skeletons / Empty State */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-[#141917] border-2 border-[#2A312D] animate-pulse p-5 space-y-4">
                <div className="w-1/3 h-4 bg-[#222A25] rounded" />
                <div className="w-full h-8 bg-[#181E1A] rounded" />
                <div className="w-2/3 h-4 bg-[#181E1A] rounded" />
              </div>
            ))}
          </div>
        ) : filteredSets.length === 0 ? (
          <div className="p-16 rounded-2xl bg-[#141917] border-2 border-[#2A312D] text-center text-[#9CA6A0] flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-[#0B0F0D] border border-[#2A312D] text-[#A855F7] flex items-center justify-center shadow-inner">
              <ShieldAlert className="w-8 h-8 text-[#A855F7]" />
            </div>
            <div>
              <h3 className="text-lg font-black text-[#F3F4F1] mb-1 uppercase font-display">No Player Databases Yet</h3>
              <p className="text-xs text-[#9CA6A0] max-w-sm font-medium">
                Create your first auction player database to populate marquee stars and tier rosters.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingSet(null);
                setIsModalOpen(true);
              }}
              className="px-5 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-mono font-bold shadow-lg shadow-purple-950/40 flex items-center space-x-2 transition-all hover:scale-105"
            >
              <PlusCircle className="w-4 h-4" />
              <span>CREATE PLAYER SET</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredSets.map((set) => {
              const isOwner = profile ? set.created_by === profile.id : false;
              return (
                <PlayerSetCard
                  key={set.id}
                  playerSet={set}
                  isOwner={isOwner}
                  onEdit={(s) => {
                    setEditingSet(s);
                    setIsModalOpen(true);
                  }}
                  onDelete={handleDeleteSet}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* Modal */}
      <PlayerSetModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingSet(null);
        }}
        onSubmit={handleCreateOrUpdateSet}
        initialData={editingSet}
      />
    </div>
  );
}
