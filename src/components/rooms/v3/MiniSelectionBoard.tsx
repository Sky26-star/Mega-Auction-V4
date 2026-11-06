// src/components/rooms/v3/MiniSelectionBoard.tsx
// Mini Auction Selection Board (Phase 16D — Option A Open Draft Board)

import React, { useState, useEffect, useMemo } from 'react';
import { useV3MiniSelections } from '@/hooks/useV3MiniSelections';
import { V3MiniAuctionSession, V3Team, V3Player } from '@/lib/v3-auction-types';
import { createClient } from '@/lib/supabase/client';
import {
  Timer,
  CheckCircle2,
  Lock,
  Search,
  Users,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface MiniSelectionBoardProps {
  auctionId: string;
  roomId: string;
  miniSession: V3MiniAuctionSession;
  teams: V3Team[];
  myTeam: V3Team | null;
  isHost: boolean;
  onRefreshSession?: () => void;
}

export function MiniSelectionBoard({
  auctionId,
  roomId,
  miniSession,
  teams,
  myTeam,
  isHost,
  onRefreshSession
}: MiniSelectionBoardProps) {
  const {
    selections,
    teamStatuses,
    loading: selectionsLoading,
    error: selectionsError,
    pendingPlayerIds,
    isConfirming,
    isConfirmed,
    mySelectedPlayerIds,
    mySelections,
    toggleSelection,
    confirmSelections,
  } = useV3MiniSelections({
    auctionId,
    myTeamId: myTeam?.id || null,
  });

  // Candidate Player Pool state
  const [candidatePlayers, setCandidatePlayers] = useState<V3Player[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Starting selection pending state for host
  const [isStartingSelection, setIsStartingSelection] = useState(false);
  const [hostActionError, setHostActionError] = useState<string | null>(null);

  // 1. Fetch Candidate Players: Players in this auction not currently in squad_players
  useEffect(() => {
    let isCancelled = false;
    async function loadCandidatePool() {
      if (!auctionId) return;
      setLoadingCandidates(true);
      try {
        const supabase = createClient();

        // 1a. Fetch all players allocated to this auction (from auction_lots or player_sets)
        const [lotsRes, squadsRes] = await Promise.all([
          supabase
            .from('auction_lots')
            .select('player_id, players(*)')
            .eq('auction_id', auctionId),
          supabase
            .from('squad_players')
            .select('player_id')
            .eq('auction_id', auctionId),
        ]);

        if (lotsRes.error) throw lotsRes.error;

        const ownedPlayerIds = new Set((squadsRes.data || []).map((s: any) => s.player_id));

        // Deduplicate distinct players not currently in squad_players
        const playerMap = new Map<string, V3Player>();
        (lotsRes.data || []).forEach((lot: any) => {
          const p = Array.isArray(lot.players) ? lot.players[0] : lot.players;
          if (p && !ownedPlayerIds.has(p.id) && !playerMap.has(p.id)) {
            playerMap.set(p.id, p);
          }
        });

        if (!isCancelled) {
          setCandidatePlayers(Array.from(playerMap.values()));
        }
      } catch (err: any) {
        console.error('Error loading candidate pool for mini selection:', err);
      } finally {
        if (!isCancelled) {
          setLoadingCandidates(false);
        }
      }
    }
    loadCandidatePool();
    return () => {
      isCancelled = true;
    };
  }, [auctionId]);

  // 2. Display-Only 60-Second Countdown Timer (Strictly non-authoritative)
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!miniSession.selection_expires_at || miniSession.status !== 'SELECTION_OPEN') {
      setSecondsRemaining(null);
      return;
    }

    const targetTime = new Date(miniSession.selection_expires_at).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.ceil((targetTime - now) / 1000));
      setSecondsRemaining(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 500);

    return () => clearInterval(interval);
  }, [miniSession.selection_expires_at, miniSession.status]);

  // The authenticated server worker closes expired selections and starts eligible mini auctions.
  useEffect(() => {
    if (!miniSession.selection_expires_at || miniSession.status !== 'SELECTION_OPEN') return;

    const remainingMs = new Date(miniSession.selection_expires_at).getTime() - Date.now();
    const timeout = setTimeout(() => {
      onRefreshSession?.();
    }, Math.max(0, remainingMs) + 300);

    return () => clearTimeout(timeout);
  }, [miniSession.selection_expires_at, miniSession.status, onRefreshSession]);

  // Host Action: Start Mini Selection
  const handleStartSelection = async () => {
    if (!isHost || isStartingSelection) return;
    setIsStartingSelection(true);
    setHostActionError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('v3_start_mini_selection', {
        p_auction_id: auctionId,
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.error || 'Failed to start selection window');
      }

      onRefreshSession?.();
    } catch (err: any) {
      console.error('Error starting mini selection:', err);
      setHostActionError(err.message || 'Failed to start selection');
    } finally {
      setIsStartingSelection(false);
    }
  };

  // Filtered candidate players
  const filteredCandidates = useMemo(() => {
    return candidatePlayers.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.country?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === 'ALL' || p.category === categoryFilter;
      const matchesRole = roleFilter === 'ALL' || p.role === roleFilter;
      return matchesSearch && matchesCategory && matchesRole;
    });
  }, [candidatePlayers, searchQuery, categoryFilter, roleFilter]);

  // Map of nominations by other teams for Option A open draft visibility
  const otherTeamsNominationsMap = useMemo(() => {
    const map = new Map<string, string[]>(); // playerId -> teamNames[]
    selections.forEach(s => {
      if (s.team_id !== myTeam?.id) {
        const team = teams.find(t => t.id === s.team_id);
        const teamLabel = team?.short_name || team?.name || 'Franchise';
        const existing = map.get(s.player_id) || [];
        existing.push(teamLabel);
        map.set(s.player_id, existing);
      }
    });
    return map;
  }, [selections, myTeam?.id, teams]);

  // -------------------------------------------------------------
  // STATE: SELECTION CLOSED
  // -------------------------------------------------------------
  if (miniSession.status === 'SELECTION_CLOSED') {
    return (
      <div className="w-full bg-[#141917] border-2 border-[#2A312D] rounded-3xl p-8 sm:p-12 text-center flex flex-col items-center justify-center space-y-4 shadow-2xl">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <div className="space-y-1">
          <h3 className="text-2xl font-black font-display uppercase tracking-tight text-[#F3F4F1]">
            Selections Closed
          </h3>
          <p className="text-sm font-mono text-[#9CA6A0] max-w-md mx-auto">
            Candidate pool finalized with {miniSession.total_lots} nominated {miniSession.total_lots === 1 ? 'lot' : 'lots'}. Preparing Pool Review for franchises...
          </p>
        </div>
        <div className="pt-2 flex items-center space-x-2 text-xs font-mono text-[#C9A227]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>INITIALIZING POOL REVIEW PHASE</span>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE: SETUP (Host can start selection)
  // -------------------------------------------------------------
  if (miniSession.status === 'SETUP') {
    return (
      <div className="w-full bg-[#141917] border border-[#2A312D] rounded-3xl p-8 text-center flex flex-col items-center justify-center space-y-6 shadow-xl">
        <div className="space-y-2 max-w-md">
          <span className="text-xs font-mono font-bold text-[#C9A227] uppercase tracking-widest block">
            PHASE: MINI AUCTION SETUP
          </span>
          <h3 className="text-2xl sm:text-3xl font-black font-display uppercase tracking-tight text-[#F3F4F1]">
            ROSTER RELEASE & PREPARATION
          </h3>
          <p className="text-xs font-mono text-[#9CA6A0] leading-relaxed">
            Franchises can release players in their Squad Management page. When ready, the host starts the 60-second player selection window.
          </p>
        </div>

        {hostActionError && (
          <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs font-mono flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{hostActionError}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center gap-3">
          {isHost ? (
            <button
              onClick={handleStartSelection}
              disabled={isStartingSelection}
              className="px-6 py-3 rounded-xl bg-[#C9A227] hover:bg-[#B38D1C] text-[#0B0F0D] font-mono font-bold text-xs uppercase tracking-wider flex items-center space-x-2 transition-all hover:scale-105 shadow-xl disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isStartingSelection ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>STARTING WINDOW...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>START MINI SELECTION (60s)</span>
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center space-x-2 font-mono text-xs text-[#9CA6A0] bg-[#0B0F0D] px-4 py-2 rounded-xl border border-[#2A312D]">
              <Loader2 className="w-4 h-4 animate-spin text-[#C9A227]" />
              <span>WAITING FOR HOST TO OPEN SELECTIONS</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE: SELECTION_OPEN (Live Selection Board)
  // -------------------------------------------------------------
  return (
    <div className="w-full flex flex-col space-y-6">

      {/* Board Top Banner & Timer */}
      <div className="bg-[#141917] border border-[#2A312D] rounded-3xl p-6 shadow-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-mono text-xs font-bold text-emerald-400 uppercase tracking-widest">
              SELECTION WINDOW LIVE
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black font-display uppercase tracking-tight text-[#F3F4F1]">
            MINI AUCTION DRAFT BOARD
          </h2>
          <p className="text-xs font-mono text-[#9CA6A0]">
            Nominate players for the Mini Auction lot pool. All franchises observe selections live in open draft mode.
          </p>
        </div>

        {/* Display Timer & Confirmation Action */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full lg:w-auto">
          {/* 60s Display Timer */}
          <div className="bg-[#0B0F0D] border-2 border-[#C9A227]/40 px-5 py-3 rounded-2xl flex items-center space-x-3 shrink-0">
            <Timer className="w-6 h-6 text-[#C9A227] animate-pulse" />
            <div>
              <span className="block text-[9px] font-mono uppercase tracking-widest text-[#9CA6A0]">TIME REMAINING</span>
              <span className="text-xl sm:text-2xl font-mono-numbers font-black text-[#F3F4F1] leading-none">
                {secondsRemaining !== null ? `${secondsRemaining}s` : '0s'}
              </span>
            </div>
          </div>

          {/* Confirmation Control */}
          {myTeam && (
            <div className="flex items-center">
              {isConfirmed ? (
                <div className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/50 flex items-center space-x-2 text-emerald-300 font-mono text-xs font-bold uppercase tracking-wider">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span>NOMINATIONS CONFIRMED ({mySelections.length})</span>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isConfirming || secondsRemaining === 0}
                  onClick={() => confirmSelections()}
                  className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-lg transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isConfirming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>CONFIRMING...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>CONFIRM NOMINATIONS ({mySelections.length})</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Status Bar (Open Draft Model) */}
      <div className="bg-[#141917]/70 border border-[#2A312D] rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#9CA6A0] mr-2">
          FRANCHISE STATUS:
        </span>
        {teams.map(team => {
          const isTeamConfirmed = teamStatuses.some(ts => ts.team_id === team.id && ts.has_confirmed);
          const nominationCount = selections.filter(s => s.team_id === team.id).length;
          return (
            <div
              key={team.id}
              className={`px-3 py-1.5 rounded-xl border font-mono text-xs flex items-center space-x-2 ${
                isTeamConfirmed
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#0B0F0D] border-[#2A312D] text-[#9CA6A0]'
              }`}
            >
              <span className="font-bold">{team.short_name || team.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#141917] border border-[#2A312D]">
                {nominationCount} {nominationCount === 1 ? 'nom' : 'noms'}
              </span>
              {isTeamConfirmed ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </div>
          );
        })}
      </div>

      {/* Filter and Search Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#9CA6A0] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search candidate players by name or country..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#141917] border border-[#2A312D] rounded-xl pl-9 pr-4 py-2.5 text-xs font-mono text-[#F3F4F1] placeholder-[#9CA6A0] focus:border-[#C9A227] focus:outline-none transition-colors"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#141917] border border-[#2A312D] rounded-xl px-3 py-2 text-xs font-mono text-[#F3F4F1] focus:border-[#C9A227] focus:outline-none"
          >
            <option value="ALL">All Categories</option>
            <option value="MARQUEE">Marquee</option>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
            <option value="D">Grade D</option>
          </select>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-[#141917] border border-[#2A312D] rounded-xl px-3 py-2 text-xs font-mono text-[#F3F4F1] focus:border-[#C9A227] focus:outline-none"
          >
            <option value="ALL">All Roles</option>
            <option value="BATSMAN">Batter</option>
            <option value="BOWLER">Bowler</option>
            <option value="ALL_ROUNDER">All-Rounder</option>
            <option value="WICKET_KEEPER">Wicketkeeper</option>
          </select>
        </div>
      </div>

      {/* Selections Error Banner */}
      {selectionsError && (
        <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs font-mono flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{selectionsError}</span>
        </div>
      )}

      {/* Candidate Player Cards Grid */}
      {loadingCandidates ? (
        <div className="w-full py-20 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#C9A227]" />
          <p className="text-xs font-mono text-[#9CA6A0] uppercase tracking-widest">
            LOADING CANDIDATE POOL...
          </p>
        </div>
      ) : filteredCandidates.length === 0 ? (
        <div className="w-full py-16 border-2 border-dashed border-[#2A312D] rounded-3xl bg-[#141917]/30 flex flex-col items-center justify-center space-y-2 text-center p-6">
          <p className="font-mono text-sm text-[#F3F4F1] font-bold uppercase tracking-wider">
            No Candidate Players Found
          </p>
          <p className="font-mono text-xs text-[#9CA6A0]">
            Try adjusting your search criteria or category filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredCandidates.map(player => {
            const isNominatedByMe = mySelectedPlayerIds.has(player.id);
            const isPending = pendingPlayerIds.has(player.id);
            const otherNominations = otherTeamsNominationsMap.get(player.id) || [];
            const isControlDisabled = isConfirmed || isPending || secondsRemaining === 0 || !myTeam;

            return (
              <div
                key={player.id}
                className={`relative rounded-2xl border p-4 shadow-xl flex flex-col justify-between space-y-3 transition-all ${
                  isNominatedByMe
                    ? 'bg-[#18231D] border-emerald-500/60 shadow-emerald-950/20'
                    : 'bg-[#141917] border-[#2A312D] hover:border-[#C9A227]/40'
                }`}
              >
                {/* Header: Name and Base Price */}
                <div>
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <h4 className="font-black font-display uppercase tracking-tight text-[#F3F4F1] text-lg leading-tight">
                      {player.name}
                    </h4>
                    <span className="shrink-0 font-mono font-bold text-xs text-[#C9A227] bg-[#0B0F0D] px-2 py-0.5 rounded border border-[#C9A227]/30">
                      ₹{player.base_price}L
                    </span>
                  </div>
                  <p className="text-[11px] font-mono font-bold text-[#9CA6A0] uppercase tracking-wider">
                    {player.role} • {player.country}
                  </p>
                </div>

                {/* Other Teams Nominations Badges (Open Draft) */}
                {otherNominations.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[9px] font-mono text-[#9CA6A0]">Also by:</span>
                    {otherNominations.map((teamLabel, idx) => (
                      <span
                        key={idx}
                        className="px-1.5 py-0.5 rounded bg-[#0B0F0D] border border-amber-500/30 text-[9px] font-mono text-amber-300 font-bold"
                      >
                        {teamLabel}
                      </span>
                    ))}
                  </div>
                )}

                {/* Card Action Control */}
                <div className="pt-2 border-t border-[#2A312D] flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[#9CA6A0]">
                    Set: {player.category}
                  </span>

                  {myTeam && (
                    <button
                      type="button"
                      disabled={isControlDisabled}
                      onClick={() => toggleSelection(player.id, !isNominatedByMe)}
                      className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                        isNominatedByMe
                          ? 'bg-red-950/60 hover:bg-red-900 border border-red-500/40 text-red-200'
                          : 'bg-[#C9A227] hover:bg-[#B38D1C] text-[#0B0F0D]'
                      }`}
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>SAVING...</span>
                        </>
                      ) : isNominatedByMe ? (
                        <>
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>REMOVE</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          <span>NOMINATE</span>
                        </>
                      )}
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
