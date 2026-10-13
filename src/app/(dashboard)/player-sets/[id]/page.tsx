'use client';

// src/app/(dashboard)/player-sets/[id]/page.tsx
// Mega Auction — Player Database Detail Page (V2 UI/UX Redesign)

import React, { useState, useEffect, useMemo, use } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/layout/navbar';
import { PlayerTable } from '@/components/player-sets/player-table';
import { PlayerModal } from '@/components/player-sets/player-modal';
import { CSVImportModal } from '@/components/player-sets/csv-import-modal';
import { PlayerCard } from '@/components/player-sets/player-card';
import { getPlayerSetById, getPlayersBySetId, createPlayer, updatePlayer, deletePlayer, bulkInsertPlayers } from '@/lib/player-sets';
import { getCurrentProfile } from '@/lib/auth';
import type { PlayerSet, Player, PlayerFormInput } from '@/lib/types/player-set';
import type { Profile } from '@/lib/types/auth';
import {
  ArrowLeft,
  Upload,
  PlusCircle,
  Database,
  Globe,
  Lock,
  Loader2,
  AlertCircle,
  UserCheck,
  Shield,
  X,
} from 'lucide-react';

export default function PlayerSetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const setId = resolvedParams.id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [playerSet, setPlayerSet] = useState<PlayerSet | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isPlayerModalOpen, setIsPlayerModalOpen] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [previewPlayer, setPreviewPlayer] = useState<Player | null>(null);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const [prof, setObj, playerList] = await Promise.all([
          getCurrentProfile(),
          getPlayerSetById(setId),
          getPlayersBySetId(setId),
        ]);

        if (!setObj) {
          setError('Player set not found.');
          return;
        }

        setProfile(prof);
        setPlayerSet(setObj);
        setPlayers(playerList);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to load player set details.');
        }
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [setId]);

  const isOwner = useMemo(() => {
    if (!profile || !playerSet) return false;
    return profile.id === playerSet.created_by;
  }, [profile, playerSet]);

  // Live Category Counts Calculation
  const categoryCounts = useMemo(() => {
    const counts = { MARQUEE: 0, A: 0, B: 0, C: 0, D: 0 };
    players.forEach((p) => {
      if (p.category && counts[p.category as keyof typeof counts] !== undefined) {
        counts[p.category as keyof typeof counts]++;
      }
    });
    return counts;
  }, [players]);

  const handleSavePlayer = async (input: PlayerFormInput) => {
    if (editingPlayer) {
      const updated = await updatePlayer(editingPlayer.id, input);
      setPlayers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } else {
      const newPlayer = await createPlayer(setId, input);
      setPlayers((prev) => [...prev, newPlayer]);
    }
  };

  const handleDeletePlayer = async (playerToDelete: Player) => {
    if (!confirm(`Are you sure you want to delete player "${playerToDelete.name}"?`)) {
      return;
    }
    try {
      await deletePlayer(playerToDelete.id);
      setPlayers((prev) => prev.filter((p) => p.id !== playerToDelete.id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete player');
    }
  };

  const handleImportSuccess = async () => {
    // Reload players
    const updatedList = await getPlayersBySetId(setId);
    setPlayers(updatedList);
  };

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Top Back Navigation Link */}
        <Link
          href="/player-sets"
          className="inline-flex items-center space-x-2 text-xs font-mono font-bold text-[#9CA6A0] hover:text-[#A855F7] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>BACK TO PLAYER SETS</span>
        </Link>

        {/* Loading / Error States */}
        {isLoading ? (
          <div className="p-16 rounded-2xl bg-[#141917] border-2 border-[#2A312D] text-center text-[#9CA6A0] space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#A855F7]" />
            <p className="text-xs font-mono">LOADING PLAYER DATABASE...</p>
          </div>
        ) : error || !playerSet ? (
          <div className="p-8 rounded-2xl bg-red-950/40 border border-red-800/40 flex items-start space-x-3 text-red-400 text-xs font-medium">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error || 'Player set not found.'}</span>
          </div>
        ) : (
          <>
            {/* Header Section */}
            <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/20 text-[#A855F7] border border-[#7C3AED]/40 flex items-center justify-center flex-shrink-0 shadow-inner">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono font-bold text-[#A855F7] uppercase tracking-wider">
                        PLAYER DATABASE
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
                          playerSet.is_public
                            ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                            : 'bg-[#0B0F0D] text-[#9CA6A0] border-[#2A312D]'
                        }`}
                      >
                        {playerSet.is_public ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                        {playerSet.is_public ? 'PUBLIC' : 'PRIVATE'}
                      </span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-black text-[#F3F4F1] tracking-tight uppercase font-display">
                      {playerSet.name}
                    </h1>
                  </div>
                </div>
                <p className="text-xs text-[#9CA6A0] font-medium leading-relaxed max-w-2xl">
                  {playerSet.description || 'Database of cricket stars for live IPL mega auctions.'}
                </p>
              </div>

              {/* Action Buttons (CSV Import & Add Player) */}
              {isOwner && (
                <div className="flex items-center space-x-3 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsCsvModalOpen(true)}
                    className="px-4 py-2.5 rounded-xl border-2 border-[#2A312D] bg-[#0B0F0D] hover:bg-[#181E1A] text-[#F3F4F1] text-xs font-mono font-bold flex items-center space-x-2 transition-all"
                  >
                    <Upload className="w-4 h-4 text-[#A855F7]" />
                    <span>IMPORT CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingPlayer(null);
                      setIsPlayerModalOpen(true);
                    }}
                    className="px-5 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-mono font-bold shadow-lg shadow-purple-950/40 flex items-center space-x-2 transition-all hover:scale-105"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>ADD PLAYER</span>
                  </button>
                </div>
              )}
            </div>

            {/* Database Category Breakdown Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3.5 rounded-xl bg-[#141917] border border-[#2A312D] flex flex-col justify-between">
                <span className="text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-wider">TOTAL PLAYERS</span>
                <span className="text-xl font-mono font-black text-[#F3F4F1] mt-1">{players.length}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#141917] border border-[#2A312D] flex flex-col justify-between border-l-4 border-l-amber-400">
                <span className="text-[9px] font-mono font-bold text-amber-400 uppercase tracking-wider">ICON PLAYERS</span>
                <span className="text-xl font-mono font-black text-[#F3F4F1] mt-1">{categoryCounts.MARQUEE}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#141917] border border-[#2A312D] flex flex-col justify-between border-l-4 border-l-purple-500">
                <span className="text-[9px] font-mono font-bold text-purple-400 uppercase tracking-wider">ELITE PLAYERS</span>
                <span className="text-xl font-mono font-black text-[#F3F4F1] mt-1">{categoryCounts.A}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#141917] border border-[#2A312D] flex flex-col justify-between border-l-4 border-l-indigo-500">
                <span className="text-[9px] font-mono font-bold text-indigo-400 uppercase tracking-wider">PREMIER PLAYERS</span>
                <span className="text-xl font-mono font-black text-[#F3F4F1] mt-1">{categoryCounts.B}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#141917] border border-[#2A312D] flex flex-col justify-between border-l-4 border-l-emerald-500">
                <span className="text-[9px] font-mono font-bold text-emerald-400 uppercase tracking-wider">CORE PLAYERS</span>
                <span className="text-xl font-mono font-black text-[#F3F4F1] mt-1">{categoryCounts.C}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#141917] border border-[#2A312D] flex flex-col justify-between border-l-4 border-l-slate-400">
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider">RISING STARS</span>
                <span className="text-xl font-mono font-black text-[#F3F4F1] mt-1">{categoryCounts.D}</span>
              </div>
            </div>

            {/* Players Table / Empty State */}
            {players.length === 0 ? (
              <div className="p-16 rounded-2xl bg-[#141917] border-2 border-[#2A312D] text-center text-[#9CA6A0] flex flex-col items-center justify-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-[#0B0F0D] border border-[#2A312D] text-[#A855F7] flex items-center justify-center shadow-inner">
                  <UserCheck className="w-8 h-8 text-[#A855F7]" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-[#F3F4F1] mb-1 uppercase font-display">No Players Added</h3>
                  <p className="text-xs text-[#9CA6A0] max-w-sm font-medium">
                    Import a CSV or add players manually to populate this database for live auction rooms.
                  </p>
                </div>
                {isOwner && (
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => setIsCsvModalOpen(true)}
                      className="px-4 py-2.5 rounded-xl border-2 border-[#2A312D] bg-[#0B0F0D] hover:bg-[#181E1A] text-[#F3F4F1] text-xs font-mono font-bold flex items-center space-x-2 transition-all"
                    >
                      <Upload className="w-4 h-4 text-[#A855F7]" />
                      <span>IMPORT CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPlayer(null);
                        setIsPlayerModalOpen(true);
                      }}
                      className="px-5 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-mono font-bold shadow-lg shadow-purple-950/40 flex items-center space-x-2 transition-all hover:scale-105"
                    >
                      <PlusCircle className="w-4 h-4" />
                      <span>ADD PLAYER</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <PlayerTable
                players={players}
                isOwner={isOwner}
                onViewPlayer={(p) => setPreviewPlayer(p)}
                onEditPlayer={(p) => {
                  setEditingPlayer(p);
                  setIsPlayerModalOpen(true);
                }}
                onDeletePlayer={handleDeletePlayer}
              />
            )}
          </>
        )}
      </main>

      {/* Manual Player Create/Edit Modal */}
      <PlayerModal
        isOpen={isPlayerModalOpen}
        onClose={() => {
          setIsPlayerModalOpen(false);
          setEditingPlayer(null);
        }}
        onSubmit={handleSavePlayer}
        initialData={editingPlayer}
      />

      {/* CSV Import Modal */}
      {playerSet && (
        <CSVImportModal
          isOpen={isCsvModalOpen}
          onClose={() => setIsCsvModalOpen(false)}
          onImport={async (validPlayers) => {
            const count = await bulkInsertPlayers(playerSet.id, validPlayers);
            await handleImportSuccess();
            return count;
          }}
        />
      )}

      {/* Player Card Preview Overlay Modal */}
      {previewPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B0F0D]/80 backdrop-blur-sm animate-fade-in">
          <div className="relative max-w-md w-full">
            <button
              type="button"
              onClick={() => setPreviewPlayer(null)}
              className="absolute -top-10 right-0 p-2 rounded-xl bg-[#141917] border border-[#2A312D] text-[#9CA6A0] hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <PlayerCard player={previewPlayer} />
          </div>
        </div>
      )}
    </div>
  );
}
