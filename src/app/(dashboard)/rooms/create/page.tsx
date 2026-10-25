'use client';

// src/app/(dashboard)/rooms/create/page.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/layout/navbar';
import { createRoom, generateRandomCode, generateUniqueRoomCode } from '@/lib/rooms';
import { getPlayerSets } from '@/lib/player-sets';
import { createRoomSchema } from '@/lib/validations/room';
import type { PlayerSet } from '@/lib/types/player-set';
import { CreateRoomPreview } from '@/components/rooms/create-room-preview';
import { PlayerSetCombobox } from '@/components/rooms/player-set-combobox';
import { AuctionStepper } from '@/components/ui/auction-stepper';
import { RoomPlayerPoolSelector } from '@/components/rooms/room-player-pool-selector';
import {
  ArrowLeft,
  Gavel,
  Database,
  Coins,
  Clock,
  Users,
  Globe,
  Loader2,
  AlertCircle,
  RefreshCw,
  PlusCircle,
  Copy,
  CheckCircle,
  Cpu,
  Trophy,
  Sparkles,
  ArrowRight,
  Lock,
} from 'lucide-react';

export default function CreateRoomPage() {
  const router = useRouter();
  const [playerSets, setPlayerSets] = useState<PlayerSet[]>([]);
  const [isLoadingSets, setIsLoadingSets] = useState(true);
  const [setsError, setSetsError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [codeMode, setCodeMode] = useState<'AUTO' | 'CUSTOM'>('AUTO');
  const [roomCode, setRoomCode] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [playerSetId, setPlayerSetId] = useState('DEFAULT');

  // Auction Settings State (Crores, Seconds, Squad Size, Fixed Overseas)
  const [defaultPurse, setDefaultPurse] = useState(100); // In Crores: 100, 110, 120, 130, 140, 150
  const [timerDuration, setTimerDuration] = useState(10); // Seconds: 10, 15, 20
  const [maxSquadSize, setMaxSquadSize] = useState(15); // Squad: 15, 20, 25
  const maxOverseas = 8; // Fixed Tournament Rule (8 Players)

  // Bot Opponents State (Min 0, Max 9, Default 0)
  const [enableBots, setEnableBots] = useState(true);
  const [botCount, setBotCount] = useState(0);
  const [botDifficulty, setBotDifficulty] = useState<'Easy' | 'Balanced' | 'Aggressive'>('Balanced');

  // Host Franchise Identity State (Phase 5B)
  const [teamName, setTeamName] = useState('Chennai Champions');
  const [teamShortName, setTeamShortName] = useState('CC');
  const [teamColor, setTeamColor] = useState('#C9A227');

  const [playerPool, setPlayerPool] = useState<string[]>([]);

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto Generate Room Code on Mount
  useEffect(() => {
    generateUniqueRoomCode()
      .then((code) => setRoomCode(code))
      .catch(() => setRoomCode(generateRandomCode()));
  }, []);

  const handleRegenerateCode = async () => {
    try {
      const code = await generateUniqueRoomCode();
      setRoomCode(code);
    } catch {
      setRoomCode(generateRandomCode());
    }
  };

  const handleCopyCode = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Load Player Sets
  const loadSets = useCallback(async () => {
    setIsLoadingSets(true);
    setSetsError(null);
    try {
      const sets = await getPlayerSets();
      setPlayerSets(sets);
    } catch (err: unknown) {
      console.error('Failed to load player sets:', err);
      setSetsError(err instanceof Error ? err.message : 'Unable to load player sets. Please try again.');
    } finally {
      setIsLoadingSets(false);
    }
  }, []);

  useEffect(() => {
    loadSets();
  }, [loadSets]);

  // Selected Player Set
  const selectedSet = playerSetId === 'DEFAULT' 
    ? { name: 'Official IPL 2026 Dataset', player_count: 202 } as PlayerSet
    : playerSets.find((s) => s.id === playerSetId) || null;

  // Form Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const activeBotCount = enableBots ? botCount : 0;

    // Note: min_bid_increment = 50 is provided ONLY as a backward-compatible placeholder for existing RPC schema
    const validation = createRoomSchema.safeParse({
      name,
      code: roomCode,
      is_custom_code: codeMode === 'CUSTOM',
      player_set_id: playerSetId,
      default_purse: defaultPurse,
      timer_duration_seconds: timerDuration,
      min_bid_increment: 50,
      max_squad_size: maxSquadSize,
      max_overseas: maxOverseas,
      team_name: teamName,
      team_short_name: teamShortName,
      team_color: teamColor,
      bot_count: activeBotCount,
      bot_difficulty: botDifficulty,
      player_pool: playerPool,
    });

    if (!validation.success) {
      setFormError(validation.error.issues[0]?.message || 'Invalid room configuration');
      return;
    }

    setIsSubmitting(true);
    try {
      const newRoom = await createRoom(validation.data);
      router.push(`/rooms/${newRoom.id}`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Failed to create auction room');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid =
    name.trim().length >= 3 &&
    playerSetId.length > 0 &&
    defaultPurse >= 100 &&
    defaultPurse <= 150 &&
    timerDuration >= 10 &&
    timerDuration <= 20 &&
    maxSquadSize >= 15 &&
    maxSquadSize <= 25 &&
    teamName.trim().length >= 2 &&
    teamShortName.trim().length >= 2 &&
    teamShortName.trim().length <= 5;

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col relative overflow-x-hidden selection:bg-[#C9A227]/30 selection:text-[#E4B93F]">
      {/* Top Application Navbar */}
      <Navbar />

      {/* Stadium Floodlight & Dark Atmosphere Backdrop */}
      <div className="pointer-events-none absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-30">
        <div className="absolute -top-40 -left-40 w-[700px] h-[700px] bg-[#C9A227]/10 rounded-full blur-[180px]" />
        <div className="absolute top-1/2 -right-40 w-[600px] h-[600px] bg-[#B8322E]/10 rounded-full blur-[180px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#2A312D_1px,transparent_1px)] [background-size:32px_32px] opacity-25" />
      </div>

      {/* Main Content Container — Desktop Balanced 2-Column Split */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 flex flex-col justify-center relative z-10 my-auto">

        {/* Navigation & Header Section */}
        <div className="mb-6 space-y-3">
          <Link
            href="/rooms"
            className="inline-flex items-center space-x-2 text-xs font-bold text-[#9CA6A0] hover:text-[#E4B93F] transition-colors uppercase tracking-wider"
          >
            <ArrowLeft className="w-4 h-4 text-[#C9A227]" />
            <span>BACK TO AUCTION ROOMS</span>
          </Link>

          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2A312D] pb-4">
            <div>
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#141917] border border-[#C9A227]/40 text-[#E4B93F] text-xs font-bold uppercase tracking-wider mb-2 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <Gavel className="w-3.5 h-3.5 text-[#C9A227]" />
                <span>READY TO CONFIGURE</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-black text-[#F3F4F1] uppercase font-display tracking-tight leading-none">
                CREATE NEW <span className="text-[#C9A227]">AUCTION ROOM</span>
              </h1>
              <p className="text-xs sm:text-sm text-[#9CA6A0] mt-1.5 leading-relaxed max-w-2xl">
                Configure your room parameters, auction rules, bot opponents, and franchise identity before the bidding starts.
              </p>
            </div>
          </div>
        </div>

        {/* 12-Column Desktop Grid Layout (Left ~60% Config / Right ~40% Live Preview) */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">

          {/* LEFT CONFIGURATION PANEL (Col 7 - 60%) */}
          <div className="lg:col-span-7 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-6" id="create-room-form">

              {/* Form Error Alert */}
              {formError && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-[#8F2724]/20 border border-[#B8322E]/60 flex items-start space-x-3 text-[#F3F4F1] text-xs sm:text-sm shadow-inner"
                >
                  <AlertCircle className="w-5 h-5 text-[#B8322E] flex-shrink-0 mt-0.5" />
                  <span className="leading-snug">{formError}</span>
                </div>
              )}

              {/* -------------------------------------------------------------
                  SECTION 1 — ROOM IDENTITY
                 ------------------------------------------------------------- */}
              <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-xl space-y-5">
                <div className="flex items-center space-x-2.5 pb-3 border-b border-[#2A312D]">
                  <div className="w-7 h-7 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F]">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h2 className="text-base sm:text-lg font-extrabold text-[#F3F4F1] uppercase font-display tracking-wider">
                    SECTION 1 — ROOM IDENTITY
                  </h2>
                </div>

                {/* Room Name */}
                <div>
                  <label htmlFor="room-name" className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                    Room Name
                  </label>
                  <input
                    id="room-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Mega Auction 2026"
                    className="w-full px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#9CA6A0] focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all text-sm"
                    required
                  />
                </div>

                {/* Room Code Selection (Auto Generate vs Custom) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider">
                      Lobby Room Code
                    </label>
                    <div className="flex items-center space-x-1 p-0.5 rounded-lg bg-[#0B0F0D] border border-[#2A312D]">
                      <button
                        type="button"
                        onClick={() => setCodeMode('AUTO')}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all ${
                          codeMode === 'AUTO'
                            ? 'bg-[#181E1A] text-[#E4B93F] border border-[#C9A227]/40 shadow-sm'
                            : 'text-[#9CA6A0] hover:text-[#F3F4F1]'
                        }`}
                      >
                        Auto Generate
                      </button>
                      <button
                        type="button"
                        onClick={() => setCodeMode('CUSTOM')}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-all ${
                          codeMode === 'CUSTOM'
                            ? 'bg-[#181E1A] text-[#E4B93F] border border-[#C9A227]/40 shadow-sm'
                            : 'text-[#9CA6A0] hover:text-[#F3F4F1]'
                        }`}
                      >
                        Custom Code
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <input
                      type="text"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 6))}
                      readOnly={codeMode === 'AUTO'}
                      placeholder="TALBEE"
                      maxLength={6}
                      className={`flex-1 px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#E4B93F] font-mono-numbers text-lg font-black tracking-widest focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all ${
                        codeMode === 'AUTO' ? 'cursor-not-allowed opacity-90' : ''
                      }`}
                    />

                    {codeMode === 'AUTO' ? (
                      <button
                        type="button"
                        onClick={handleRegenerateCode}
                        className="px-4 py-3 rounded-xl bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#E4B93F] font-bold text-xs flex items-center space-x-1.5 transition-colors shadow-sm"
                        title="Regenerate Code"
                      >
                        <RefreshCw className="w-4 h-4 text-[#C9A227]" />
                        <span className="hidden sm:inline">REGEN</span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="px-4 py-3 rounded-xl bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#F3F4F1] font-bold text-xs flex items-center space-x-1.5 transition-colors shadow-sm"
                      title="Copy Code"
                    >
                      {copiedCode ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-[#C9A227]" />
                      )}
                      <span className="hidden sm:inline">{copiedCode ? 'COPIED' : 'COPY'}</span>
                    </button>
                  </div>
                </div>

                {/* Auction Type Badge */}
                <div className="pt-2 flex items-center justify-between text-xs">
                  <span className="text-[#9CA6A0] font-semibold uppercase tracking-wider">
                    Auction Engine Type:
                  </span>
                  <span className="px-3 py-1 rounded-full bg-[#C9A227]/15 border border-[#C9A227]/40 text-[#E4B93F] font-bold font-mono-numbers text-xs uppercase">
                    MEGA AUCTION (MARQUEE + SETS)
                  </span>
                </div>
              </div>

              {/* -------------------------------------------------------------
                  SECTION 2 — PLAYER SET POOL
                 ------------------------------------------------------------- */}
              <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-xl space-y-5">
                <div className="flex items-center space-x-2.5 pb-3 border-b border-[#2A312D]">
                  <div className="w-7 h-7 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#C9A227]">
                    <Database className="w-4 h-4" />
                  </div>
                  <h2 className="text-base sm:text-lg font-extrabold text-[#F3F4F1] uppercase font-display tracking-wider">
                    SECTION 2 — PLAYER SET POOL
                  </h2>
                </div>

                <div>
                  <label id="player-set-label" htmlFor="player-set-select" className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                    Select Auction Player Set
                  </label>

                  {isLoadingSets && (
                    <div className="p-4 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-xs text-[#9CA6A0] flex items-center space-x-3">
                      <Loader2 className="w-4 h-4 animate-spin text-[#C9A227]" />
                      <span>Loading available player sets...</span>
                    </div>
                  )}

                  {!isLoadingSets && setsError && (
                    <div className="p-4 rounded-xl bg-[#8F2724]/20 border border-[#B8322E]/60 flex items-center justify-between text-xs text-[#F3F4F1]">
                      <div className="flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 text-[#B8322E]" />
                        <span>Unable to load player sets.</span>
                      </div>
                      <button
                        type="button"
                        onClick={loadSets}
                        className="px-3 py-1 rounded-lg bg-[#B8322E]/30 hover:bg-[#B8322E]/50 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}

                  {!isLoadingSets && !setsError && (
                    <PlayerSetCombobox
                      value={playerSetId}
                      onValueChange={setPlayerSetId}
                      options={[
                        { id: 'DEFAULT', name: 'Official IPL 2026 Dataset', playerCount: 202, typeLabel: 'Default pool' },
                        ...playerSets
                          .filter(set => set.id !== '00000000-0000-0000-0000-000000000202')
                          .map(set => ({
                            id: set.id,
                            name: set.name,
                            playerCount: set.player_count ?? 0,
                            typeLabel: set.is_public ? 'Public pool' : 'Private pool',
                          })),
                      ]}
                    />
                  )}
                </div>

                {/* Player Set Category Statistics Breakdown */}
                {selectedSet && (
                  <div className="p-4 rounded-xl bg-[#0B0F0D] border border-[#2A312D] grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="text-center p-2 rounded-lg bg-[#141917] border border-[#2A312D]">
                      <span className="block text-[10px] font-bold text-[#9CA6A0] uppercase tracking-wider">
                        TOTAL PLAYERS
                      </span>
                      <span className="text-base font-black font-mono-numbers text-[#E4B93F]">
                        {selectedSet.player_count ?? 0}
                      </span>
                    </div>

                    <div className="text-center p-2 rounded-lg bg-[#141917] border border-[#2A312D]">
                      <span className="block text-[10px] font-bold text-[#9CA6A0] uppercase tracking-wider">
                        BATTERS
                      </span>
                      <span className="text-base font-black font-mono-numbers text-[#F3F4F1]">
                        {Math.round((selectedSet.player_count ?? 0) * 0.35)}
                      </span>
                    </div>

                    <div className="text-center p-2 rounded-lg bg-[#141917] border border-[#2A312D]">
                      <span className="block text-[10px] font-bold text-[#9CA6A0] uppercase tracking-wider">
                        ALL-ROUNDERS
                      </span>
                      <span className="text-base font-black font-mono-numbers text-[#C9A227]">
                        {Math.round((selectedSet.player_count ?? 0) * 0.25)}
                      </span>
                    </div>

                    <div className="text-center p-2 rounded-lg bg-[#141917] border border-[#2A312D]">
                      <span className="block text-[10px] font-bold text-[#9CA6A0] uppercase tracking-wider">
                        BOWLERS
                      </span>
                      <span className="text-base font-black font-mono-numbers text-[#F3F4F1]">
                        {Math.round((selectedSet.player_count ?? 0) * 0.40)}
                      </span>
                    </div>
                  </div>
                )}

                {/* ROOM-SCOPED PLAYER POOL */}
                {selectedSet && (
                  <div className="pt-4 border-t border-[#2A312D]">
                    <div className="mb-4">
                      <h3 className="text-sm font-bold text-[#F3F4F1] uppercase tracking-wider">Room-Scoped Player Pool</h3>
                      <p className="text-xs text-[#9CA6A0] mt-1">Select which players from the dataset will participate in this auction.</p>
                    </div>
                    <RoomPlayerPoolSelector playerSetId={playerSetId} onChange={setPlayerPool} />
                  </div>
                )}
              </div>

              {/* -------------------------------------------------------------
                  SECTION 3 — AUCTION SETTINGS (Crores, Seconds, Squad & Fixed Overseas)
                 ------------------------------------------------------------- */}
              <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-xl space-y-5">
                <div className="flex items-center space-x-2.5 pb-3 border-b border-[#2A312D]">
                  <div className="w-7 h-7 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F]">
                    <Coins className="w-4 h-4" />
                  </div>
                  <h2 className="text-base sm:text-lg font-extrabold text-[#F3F4F1] uppercase font-display tracking-wider">
                    SECTION 3 — AUCTION RULES & PURSE
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

                  {/* 1. STARTING PURSE (CRORES) */}
                  <AuctionStepper
                    id="starting-purse-stepper"
                    label="STARTING PURSE (CRORES)"
                    icon={<Coins className="w-3.5 h-3.5 text-[#E4B93F]" />}
                    value={defaultPurse}
                    min={100}
                    max={150}
                    step={10}
                    formatValue={(v) => `₹${v} Cr`}
                    formatDelta={(d) => (d > 0 ? `+₹${d} Cr` : `-₹${Math.abs(d)} Cr`)}
                    onChange={setDefaultPurse}
                  />

                  {/* 2. TIMER PER LOT */}
                  <AuctionStepper
                    id="timer-per-lot-stepper"
                    label="TIMER PER LOT"
                    icon={<Clock className="w-3.5 h-3.5 text-[#B8322E]" />}
                    value={timerDuration}
                    min={10}
                    max={20}
                    step={5}
                    formatValue={(v) => `${v} SEC`}
                    formatDelta={(d) => (d > 0 ? `+${d} SEC` : `-${Math.abs(d)} SEC`)}
                    onChange={setTimerDuration}
                  />

                  {/* 3. MAX SQUAD SIZE */}
                  <AuctionStepper
                    id="max-squad-size-stepper"
                    label="MAX SQUAD SIZE"
                    icon={<Users className="w-3.5 h-3.5 text-[#C9A227]" />}
                    value={maxSquadSize}
                    min={15}
                    max={25}
                    step={5}
                    formatValue={(v) => `${v} PLAYERS`}
                    formatDelta={(d) => (d > 0 ? `+${d} PLAYERS` : `-${Math.abs(d)} PLAYERS`)}
                    onChange={setMaxSquadSize}
                  />

                  {/* 4. OVERSEAS PLAYER LIMIT (FIXED 8 - LOCKED) */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-sky-400" />
                        <span>OVERSEAS PLAYER LIMIT</span>
                      </label>
                      <span className="text-[10px] font-mono-numbers font-bold px-2 py-0.5 rounded bg-[#181E1A] border border-[#2A312D] text-sky-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        <span>FIXED RULE</span>
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
                      <div className="flex items-center space-x-2">
                        <span className="text-base font-black font-mono-numbers text-sky-400 tracking-wide">
                          8 PLAYERS
                        </span>
                      </div>
                      <div className="flex items-center space-x-1.5 text-xs text-[#9CA6A0]">
                        <Lock className="w-3.5 h-3.5" />
                        <span className="text-[11px] italic">Fixed tournament rule</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* -------------------------------------------------------------
                  SECTION 4 — BOT OPPONENTS
                 ------------------------------------------------------------- */}
              <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-xl space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-[#2A312D]">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F]">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <h2 className="text-base sm:text-lg font-extrabold text-[#F3F4F1] uppercase font-display tracking-wider">
                      SECTION 4 — BOT OPPONENTS
                    </h2>
                  </div>

                  {/* Bot Toggle Switch */}
                  <label htmlFor="enable-bots-toggle" className="flex items-center space-x-2 cursor-pointer">
                    <input
                      id="enable-bots-toggle"
                      type="checkbox"
                      checked={enableBots}
                      onChange={(e) => setEnableBots(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-[#0B0F0D] peer-focus:outline-none rounded-full peer border border-[#2A312D] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[#9CA6A0] peer-checked:after:bg-[#E4B93F] after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#181E1A] relative" />
                    <span className="text-xs font-bold text-[#F3F4F1] uppercase tracking-wider">
                      {enableBots ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </label>
                </div>

                {enableBots && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
                    <div>
                      <AuctionStepper
                        id="bot-opponents-stepper"
                        label="BOT OPPONENTS"
                        subtext="AI MANAGERS"
                        icon={<Cpu className="w-3.5 h-3.5 text-[#E4B93F]" />}
                        value={botCount}
                        min={0}
                        max={9}
                        step={1}
                        formatValue={(v) => (v === 0 ? '0 BOTS (DISABLED)' : `${v} AI MANAGERS`)}
                        formatDelta={(d) => (d > 0 ? `+${d} BOT` : `-${Math.abs(d)} BOT`)}
                        onChange={setBotCount}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                        Bot Bidding Difficulty
                      </label>
                      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
                        {(['Easy', 'Balanced', 'Aggressive'] as const).map((diff) => (
                          <button
                            key={diff}
                            type="button"
                            onClick={() => setBotDifficulty(diff)}
                            className={`py-2 px-2 text-[11px] font-bold rounded-lg uppercase tracking-wider transition-all ${
                              botDifficulty === diff
                                ? 'bg-[#181E1A] text-[#E4B93F] border border-[#C9A227]/40 shadow-sm'
                                : 'text-[#9CA6A0] hover:text-[#F3F4F1]'
                            }`}
                          >
                            {diff}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* -------------------------------------------------------------
                  SECTION 5 — YOUR FRANCHISE IDENTITY
                 ------------------------------------------------------------- */}
              <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-xl space-y-5">
                <div className="flex items-center space-x-2.5 pb-3 border-b border-[#2A312D]">
                  <div className="w-7 h-7 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#C9A227]">
                    <Trophy className="w-4 h-4" />
                  </div>
                  <h2 className="text-base sm:text-lg font-extrabold text-[#F3F4F1] uppercase font-display tracking-wider">
                    SECTION 5 — YOUR HOST FRANCHISE IDENTITY
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* Team Name */}
                  <div className="md:col-span-1">
                    <label htmlFor="team-name" className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                      Team Name
                    </label>
                    <input
                      id="team-name"
                      type="text"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="e.g. Chennai Champions"
                      className="w-full px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#9CA6A0] focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all text-xs sm:text-sm"
                      required
                    />
                  </div>

                  {/* Short Code */}
                  <div>
                    <label htmlFor="team-short-code" className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                      Short Code (2-5 Chars)
                    </label>
                    <input
                      id="team-short-code"
                      type="text"
                      value={teamShortName}
                      onChange={(e) => setTeamShortName(e.target.value.toUpperCase())}
                      placeholder="e.g. CC"
                      maxLength={5}
                      className="w-full px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#E4B93F] font-mono-numbers text-xs sm:text-sm uppercase font-bold focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all"
                      required
                    />
                  </div>

                  {/* Color Picker */}
                  <div>
                    <label htmlFor="team-color-picker" className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                      Franchise Color
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        id="team-color-picker"
                        type="color"
                        value={teamColor}
                        onChange={(e) => setTeamColor(e.target.value)}
                        className="w-11 h-11 rounded-xl bg-[#0B0F0D] border border-[#2A312D] cursor-pointer p-1"
                      />
                      <input
                        type="text"
                        value={teamColor}
                        onChange={(e) => setTeamColor(e.target.value)}
                        placeholder="#C9A227"
                        className="flex-1 px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] font-mono-numbers text-xs focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons Container */}
              <div className="pt-4 flex items-center justify-end space-x-4">
                <Link
                  href="/rooms"
                  className="px-6 py-4 rounded-xl border border-[#2A312D] text-[#9CA6A0] hover:text-[#F3F4F1] hover:bg-[#141917] text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Cancel
                </Link>

                {/* Primary CTA Button (Auction Crimson #B8322E) */}
                <button
                  id="create-room-submit-btn"
                  type="submit"
                  disabled={isSubmitting || isLoadingSets || !playerSetId || !isFormValid}
                  className="py-4 px-8 rounded-xl bg-[#B8322E] hover:bg-[#9B2825] active:bg-[#8F2724] text-[#F3F4F1] font-bold text-xs uppercase tracking-widest shadow-xl shadow-[#B8322E]/25 border border-[#B8322E]/60 focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:ring-offset-2 focus:ring-offset-[#0B0F0D] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center space-x-2 min-h-[52px]"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#F3F4F1]" />
                      <span>CREATING ROOM...</span>
                    </>
                  ) : (
                    <>
                      <span>CREATE AUCTION ROOM</span>
                      <ArrowRight className="w-4 h-4 text-[#F3F4F1]" />
                    </>
                  )}
                </button>
              </div>

            </form>
          </div>

          {/* RIGHT LIVE ROOM PREVIEW PANEL (Col 5 - 40%) */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end w-full pt-1">
            <CreateRoomPreview
              name={name}
              code={roomCode}
              selectedSet={selectedSet}
              defaultPurse={defaultPurse}
              timerDuration={timerDuration}
              maxSquadSize={maxSquadSize}
              maxOverseas={maxOverseas}
              teamName={teamName}
              teamShortName={teamShortName}
              teamColor={teamColor}
              enableBots={enableBots}
              botCount={botCount}
              botDifficulty={botDifficulty}
            />
          </div>

        </div>
      </main>

      {/* Broadcast Footer */}
      <footer className="py-4 border-t border-[#2A312D]/60 text-center relative z-10 mt-auto">
        <p className="text-[11px] font-mono-numbers text-[#9CA6A0] tracking-wider uppercase">
          MEGA AUCTION ARENA &bull; AUCTION CONTROL CENTER v1.0
        </p>
      </footer>
    </div>
  );
}
