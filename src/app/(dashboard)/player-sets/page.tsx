'use client';

// src/app/(dashboard)/player-sets/page.tsx
// Mega Auction — Player Database Control Center Page (V2 UI/UX Redesign)

import React, { useState, useEffect, useMemo } from 'react';
import { AuctionSelect } from '@/components/ui/auction-select';
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
  Layers,
  AlertCircle,
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

  const clearFilters = () => { setSearchTerm(''); setTabFilter('ALL'); };
  const openCreate = () => { setEditingSet(null); setIsModalOpen(true); };
  const metrics = [
    { label: 'Player sets', value: playerSets.length, Icon: Layers },
    { label: 'Total players', value: totalPlayersCount, Icon: Users },
    { label: 'Public pools', value: publicSetsCount, Icon: Globe },
    { label: 'Private pools', value: playerSets.length - publicSetsCount, Icon: Lock },
  ];
  const tabs = [
    { value: 'ALL' as const, label: 'All sets', count: playerSets.length },
    { value: 'MY_SETS' as const, label: 'My sets', count: mySetsCount },
    { value: 'PUBLIC' as const, label: 'Public', count: publicSetsCount },
  ];
  const createButton = <button type="button" onClick={openCreate} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#C9A227] px-5 text-sm font-bold text-[#0B0F0D] transition-colors hover:bg-[#E4B93F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F0D]"><PlusCircle className="h-4 w-4" /> Create player set</button>;

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1]">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
        <header className="flex flex-col justify-between gap-5 border-b border-[#2A312D] pb-7 sm:flex-row sm:items-center">
          <div className="max-w-xl">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#C9A227]">Auction library</p>
            <h1 className="text-3xl font-bold uppercase sm:text-4xl">Player <span className="text-[#E4B93F]">sets</span></h1>
            <p className="mt-3 text-sm leading-relaxed text-[#9CA6A0]">Build your player pool. Set the tiers, shape the competition and bring your next auction to life.</p>
          </div>
          {createButton}
        </header>
        <section aria-label="Player library overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map(({label, value, Icon}) => <div key={label} className="min-w-0 rounded-xl border border-[#2A312D] bg-[#141917] p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2"><span className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA6A0]">{label}</span><Icon className="h-4 w-4 shrink-0 text-[#C9A227]" aria-hidden="true" /></div>
            <p className="font-mono text-2xl font-semibold tabular-nums sm:text-3xl">{isLoading ? <span className="inline-block h-8 w-12 animate-pulse rounded bg-[#242E27]" aria-label="Loading" /> : value.toLocaleString()}</p>
          </div>)}
        </section>
        <section aria-label="Find player sets" className="space-y-4 rounded-xl border border-[#2A312D] bg-[#141917] p-3 sm:p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div role="group" aria-label="Filter player sets" className="grid grid-cols-3 gap-1 rounded-lg border border-[#2A312D] bg-[#0B0F0D] p-1 lg:flex">
              {tabs.map(tab => <button key={tab.value} type="button" aria-pressed={tabFilter === tab.value} onClick={() => setTabFilter(tab.value)} className={tabFilter === tab.value ? 'flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#C9A227] px-3 text-xs font-semibold text-[#0B0F0D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]' : 'flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold text-[#9CA6A0] hover:bg-[#242E27] hover:text-[#F3F4F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]'}>{tab.label}<span className="font-mono opacity-70">{tab.count}</span></button>)}
            </div>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row lg:flex-1 lg:justify-end">
              <label className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg border border-[#39443B] bg-[#0B0F0D] px-3 focus-within:ring-2 focus-within:ring-[#C9A227] sm:flex-1 lg:max-w-xs">
                <Search className="h-4 w-4 shrink-0 text-[#9CA6A0]" aria-hidden="true" /><span className="sr-only">Search player sets</span>
                <input type="search" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search name or description…" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" />
              </label>
              <AuctionSelect label="Sort player sets" value={sortBy} onValueChange={value => setSortBy(value as typeof sortBy)} options={[{value:'date_desc',label:'Newest first'},{value:'date_asc',label:'Oldest first'},{value:'name_asc',label:'Name: A to Z'},{value:'players_desc',label:'Most players'}]} className="w-full sm:w-44 sm:shrink-0" />
            </div>
          </div>
        </section>
        {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="h-5 w-5 shrink-0" /><span>{error}</span></div>}
        <div className="flex items-center justify-between gap-3 text-xs text-[#9CA6A0]" aria-live="polite"><p>{isLoading ? 'Loading your library…' : filteredSets.length + ' of ' + playerSets.length + ' player sets'}</p>{(searchTerm || tabFilter !== 'ALL') && <button type="button" onClick={clearFilters} className="min-h-10 rounded px-2 font-semibold text-[#E4B93F] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]">Clear filters</button>}</div>
        {isLoading ? (
          <div aria-label="Loading player sets" className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{[1,2,3].map(i => <div key={i} className="h-80 animate-pulse space-y-5 rounded-xl border border-[#2A312D] bg-[#141917] p-6"><div className="h-5 w-2/3 rounded bg-[#242E27]" /><div className="h-16 rounded bg-[#181E1A]" /><div className="h-8 rounded bg-[#242E27]" /></div>)}</div>
        ) : filteredSets.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-[#39443B] px-5 py-12 text-center sm:py-16">
            <Database className="mb-4 h-9 w-9 text-[#C9A227]" />
            <h2 className="text-2xl font-semibold">{playerSets.length === 0 ? 'Your next auction starts here' : 'No sets match your filters'}</h2>
            <p className="mb-6 mt-2 max-w-sm text-sm leading-relaxed text-[#9CA6A0]">{playerSets.length === 0 ? 'Create a player set to organize your stars, categories and base prices.' : 'Try another search or browse all available player sets.'}</p>
            {playerSets.length === 0 ? createButton : <button type="button" onClick={clearFilters} className="min-h-12 rounded-lg border border-[#C9A227]/50 px-5 text-sm font-semibold text-[#E4B93F] hover:bg-[#C9A227]/10">Clear filters</button>}
          </div>
        ) : (
          <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">{filteredSets.map(set => <PlayerSetCard key={set.id} playerSet={set} isOwner={profile ? set.created_by === profile.id : false} onEdit={s => { setEditingSet(s); setIsModalOpen(true); }} onDelete={handleDeleteSet} />)}</div>
        )}
      </main>
      <PlayerSetModal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingSet(null); }} onSubmit={handleCreateOrUpdateSet} initialData={editingSet} />
    </div>
  );
}
