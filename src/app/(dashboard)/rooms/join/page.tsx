'use client';

// src/app/(dashboard)/rooms/join/page.tsx
// Phase 5B Auction Room Join Checkpoint Page (Fixed Asynchronous State Flow)

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/layout/navbar';
import { lookupRoomByCode, joinRoomWithTeam } from '@/lib/rooms';
import { loadAuthoritativeRoomAuctionState } from '@/lib/auction/state-manager';
import { joinRoomWithTeamSchema } from '@/lib/validations/room';
import type { Room } from '@/lib/types/room';
import { RoomCodeInput } from '@/components/rooms/room-code-input';
import { JoinRoomPreview, type VerificationState } from '@/components/rooms/join-room-preview';
import {
  ArrowLeft,
  Gavel,
  Loader2,
  AlertCircle,
  Trophy,
  ArrowRight,
  Sparkles,
  PlusCircle,
  Compass,
} from 'lucide-react';

function JoinRoomContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCode = searchParams.get('code')?.toUpperCase() || '';

  // Controlled Code Input State
  const [code, setCode] = useState(initialCode);

  // Explicit 5-State Verification State Machine
  const [verificationState, setVerificationState] = useState<VerificationState>('IDLE');
  const [previewRoom, setPreviewRoom] = useState<Room | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Asynchronous Race Condition & Stale Request Protection Refs
  const requestIdRef = useRef<number>(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Your Franchise Identity State (Joining Manager Team Setup)
  const [teamName, setTeamName] = useState('');
  const [teamShortName, setTeamShortName] = useState('');
  const [teamColor, setTeamColor] = useState('#C9A227');

  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  // Track component mount status
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Strict 6-Character Verification Flow with 300ms Debounce & Stale Request Protection
  useEffect(() => {
    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const cleanCode = code.trim().toUpperCase();

    // RULE 1: STRICT 6-CHARACTER GUARD — Zero backend calls for 0-5 chars
    if (cleanCode.length < 6) {
      requestIdRef.current += 1; // Invalidate any pending async lookups
      setPreviewRoom(null);
      setErrorMessage(null);
      setVerificationState('IDLE');
      return;
    }

    // RULE 2: Clear old room data immediately when 6 chars entered
    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;
    setPreviewRoom(null);
    setErrorMessage(null);
    setVerificationState('VERIFYING');

    // RULE 3: 300ms DEBOUNCE
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const room = await lookupRoomByCode(cleanCode);

        // Stale Request / Component Unmount Protection Guard
        if (!isMountedRef.current || requestIdRef.current !== currentRequestId) {
          return;
        }

        setPreviewRoom(room);
        setVerificationState('FOUND');
      } catch (err: unknown) {
        if (!isMountedRef.current || requestIdRef.current !== currentRequestId) {
          return;
        }

        setPreviewRoom(null);
        const msg = err instanceof Error ? err.message : '';

        // RULE 4: Differentiate Error Types (Not Found vs Network/Server Error)
        if (
          msg.includes('not found') ||
          msg.includes('ROOM_NOT_FOUND') ||
          msg.includes('PGRST116')
        ) {
          setErrorMessage('Check the code and try again.');
          setVerificationState('NOT_FOUND');
        } else {
          setErrorMessage(msg || 'Please check your connection and try again.');
          setVerificationState('ERROR');
        }
      }
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [code]);

  // Code Input Change Handler
  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setJoinError(null);
  };

  // Join Room Form Submit Handler
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);

    if (verificationState !== 'FOUND' || !previewRoom) {
      setJoinError('Please enter a valid room code first.');
      return;
    }

    const validation = joinRoomWithTeamSchema.safeParse({
      team_name: teamName,
      team_short_name: teamShortName,
      team_color: teamColor,
    });

    if (!validation.success) {
      setJoinError(validation.error.issues[0]?.message || 'Invalid franchise configuration');
      return;
    }

    setIsJoining(true);
    try {
      const result = await joinRoomWithTeam(code, validation.data);
      const activeState = await loadAuthoritativeRoomAuctionState(result.room_id);
      if (activeState?.auctionStatus === 'LIVE') {
        router.push(`/rooms/${result.room_id}/auction`);
      } else {
        router.push(`/rooms/${result.room_id}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setJoinError(err.message);
      } else {
        setJoinError('Failed to join auction lobby.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsJoining(false);
      }
    }
  };

  // Fix typo if needed, replace fontally with finally
  const handleJoinSafe = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);

    if (verificationState !== 'FOUND' || !previewRoom) {
      setJoinError('Please enter a valid room code first.');
      return;
    }

    const validation = joinRoomWithTeamSchema.safeParse({
      team_name: teamName,
      team_short_name: teamShortName,
      team_color: teamColor,
    });

    if (!validation.success) {
      setJoinError(validation.error.issues[0]?.message || 'Invalid franchise configuration');
      return;
    }

    setIsJoining(true);
    try {
      const result = await joinRoomWithTeam(code, validation.data);
      router.push(`/rooms/${result.room_id}`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setJoinError(err.message);
      } else {
        setJoinError('Failed to join auction lobby.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsJoining(false);
      }
    }
  };

  const isFormValid =
    code.length === 6 &&
    verificationState === 'FOUND' &&
    previewRoom !== null &&
    teamName.trim().length >= 2 &&
    teamShortName.trim().length >= 2 &&
    teamShortName.trim().length <= 5;

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col relative overflow-x-hidden selection:bg-[#C9A227]/30 selection:text-[#E4B93F]">
      {/* Top Application Navbar */}
      <Navbar />

      {/* Stadium Floodlight Backdrop */}
      <div className="pointer-events-none absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-30">
        <div className="absolute -top-40 -left-40 w-[700px] h-[700px] bg-[#C9A227]/10 rounded-full blur-[180px]" />
        <div className="absolute top-1/2 -right-40 w-[600px] h-[600px] bg-[#B8322E]/10 rounded-full blur-[180px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#2A312D_1px,transparent_1px)] [background-size:32px_32px] opacity-25" />
      </div>

      {/* Main Content Container — Desktop Balanced 2-Column Split (55% Left / 45% Right) */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 flex flex-col justify-center relative z-10 my-auto">

        {/* Navigation & Header Section */}
        <div className="mb-6 space-y-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center space-x-2 text-xs font-bold text-[#9CA6A0] hover:text-[#E4B93F] transition-colors uppercase tracking-wider"
          >
            <ArrowLeft className="w-4 h-4 text-[#C9A227]" />
            <span>BACK TO DASHBOARD</span>
          </Link>

          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2A312D] pb-4">
            <div>
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#141917] border border-[#C9A227]/40 text-[#E4B93F] text-xs font-bold uppercase tracking-wider mb-2 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <Gavel className="w-3.5 h-3.5 text-[#C9A227]" />
                <span>READY TO JOIN</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-black text-[#F3F4F1] uppercase font-display tracking-tight leading-none">
                JOIN <span className="text-[#C9A227]">AUCTION ROOM</span>
              </h1>
              <p className="text-xs sm:text-sm text-[#9CA6A0] mt-1.5 leading-relaxed max-w-2xl">
                Enter the 6-character room code shared by your auction host to verify room parameters and set up your franchise.
              </p>
            </div>
          </div>
        </div>

        {/* 12-Column Desktop Grid Layout (Left ~55% / Right ~45%) */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">

          {/* LEFT PANEL — ROOM CODE & FRANCHISE REGISTRATION (Col 7 - 55%) */}
          <div className="lg:col-span-7 space-y-6">
            <form onSubmit={handleJoinSafe} className="space-y-6" id="join-room-form">

              {/* Join Error Alert */}
              {joinError && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-[#8F2724]/20 border border-[#B8322E]/60 flex items-start space-x-3 text-[#F3F4F1] text-xs sm:text-sm shadow-inner"
                >
                  <AlertCircle className="w-5 h-5 text-[#B8322E] flex-shrink-0 mt-0.5" />
                  <span className="leading-snug">{joinError}</span>
                </div>
              )}

              {/* SECTION 1 — ROOM CODE ENTRY */}
              <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-xl space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-[#2A312D]">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F]">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <h2 className="text-base sm:text-lg font-extrabold text-[#F3F4F1] uppercase font-display tracking-wider">
                      STEP 1 — ENTER ROOM CODE
                    </h2>
                  </div>

                  <span className="text-[10px] font-mono-numbers font-extrabold text-[#C9A227] uppercase bg-[#0B0F0D] px-2.5 py-1 rounded border border-[#2A312D]">
                    6 CHARACTERS
                  </span>
                </div>

                {/* 6-Box Room Code Input */}
                <div>
                  <label className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-3">
                    Lobby Room Code
                  </label>

                  <RoomCodeInput
                    code={code}
                    onChange={handleCodeChange}
                    isInvalid={verificationState === 'NOT_FOUND'}
                    disabled={isJoining}
                  />

                  {/* Inline Verification Status Message */}
                  <div className="mt-3 flex items-center justify-between text-xs">
                    {verificationState === 'VERIFYING' ? (
                      <span className="text-[#E4B93F] font-bold flex items-center gap-1.5 animate-pulse">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A227]" />
                        <span>Verifying code...</span>
                      </span>
                    ) : verificationState === 'NOT_FOUND' ? (
                      <span className="text-[#B8322E] font-bold flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Room not found. Check code and try again.</span>
                      </span>
                    ) : verificationState === 'ERROR' ? (
                      <span className="text-[#E4B93F] font-bold flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Unable to verify room. Please try again.</span>
                      </span>
                    ) : verificationState === 'FOUND' ? (
                      <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Room verified! Configure your franchise below.</span>
                      </span>
                    ) : (
                      <span className="text-[#9CA6A0] text-[11px]">
                        Enter a 6-character room code
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION 2 — YOUR FRANCHISE IDENTITY */}
              <div
                className={`p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-xl space-y-5 transition-all duration-300 ${
                  verificationState !== 'FOUND' ? 'opacity-50 pointer-events-none' : 'opacity-100'
                }`}
              >
                <div className="flex items-center space-x-2.5 pb-3 border-b border-[#2A312D]">
                  <div className="w-7 h-7 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#C9A227]">
                    <Trophy className="w-4 h-4" />
                  </div>
                  <h2 className="text-base sm:text-lg font-extrabold text-[#F3F4F1] uppercase font-display tracking-wider">
                    STEP 2 — YOUR FRANCHISE IDENTITY
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* Your Team Name */}
                  <div className="md:col-span-1">
                    <label htmlFor="user-team-name" className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                      YOUR TEAM NAME
                    </label>
                    <input
                      id="user-team-name"
                      type="text"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="e.g. Royal Challengers"
                      className="w-full px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#9CA6A0] focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all text-xs sm:text-sm"
                      required={verificationState === 'FOUND'}
                      disabled={verificationState !== 'FOUND' || isJoining}
                    />
                  </div>

                  {/* Team Short Code */}
                  <div>
                    <label htmlFor="user-short-code" className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                      TEAM SHORT CODE
                    </label>
                    <input
                      id="user-short-code"
                      type="text"
                      value={teamShortName}
                      onChange={(e) => setTeamShortName(e.target.value.toUpperCase())}
                      placeholder="e.g. RCB"
                      maxLength={5}
                      className="w-full px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#E4B93F] font-mono-numbers text-xs sm:text-sm uppercase font-bold focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all"
                      required={verificationState === 'FOUND'}
                      disabled={verificationState !== 'FOUND' || isJoining}
                    />
                  </div>

                  {/* Team Color Picker */}
                  <div>
                    <label htmlFor="user-team-color" className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                      TEAM COLOR
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        id="user-team-color"
                        type="color"
                        value={teamColor}
                        onChange={(e) => setTeamColor(e.target.value)}
                        className="w-11 h-11 rounded-xl bg-[#0B0F0D] border border-[#2A312D] cursor-pointer p-1"
                        disabled={verificationState !== 'FOUND' || isJoining}
                      />
                      <input
                        type="text"
                        value={teamColor}
                        onChange={(e) => setTeamColor(e.target.value)}
                        placeholder="#C9A227"
                        className="flex-1 px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] font-mono-numbers text-xs focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all"
                        disabled={verificationState !== 'FOUND' || isJoining}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons & Secondary Links */}
              <div className="pt-2 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <Link
                    href="/rooms"
                    className="px-5 py-3.5 rounded-xl bg-[#141917] hover:bg-[#181E1A] border border-[#2A312D] text-[#9CA6A0] hover:text-[#F3F4F1] text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all"
                  >
                    <Compass className="w-4 h-4 text-[#C9A227]" />
                    <span>BROWSE ACTIVE ROOMS</span>
                  </Link>

                  {/* Primary CTA (Auction Crimson #B8322E) */}
                  <button
                    id="join-room-submit-btn"
                    type="submit"
                    disabled={!isFormValid || isJoining}
                    className="py-4 px-8 rounded-xl bg-[#B8322E] hover:bg-[#9B2825] active:bg-[#8F2724] text-[#F3F4F1] font-bold text-xs uppercase tracking-widest shadow-xl shadow-[#B8322E]/25 border border-[#B8322E]/60 focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:ring-offset-2 focus:ring-offset-[#0B0F0D] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 min-h-[52px] flex-1 sm:flex-none"
                  >
                    {isJoining ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#F3F4F1]" />
                        <span>JOINING AUCTION...</span>
                      </>
                    ) : (
                      <>
                        <span>JOIN AUCTION</span>
                        <ArrowRight className="w-4 h-4 text-[#F3F4F1]" />
                      </>
                    )}
                  </button>
                </div>

                {/* Create Room Cross-Link */}
                <div className="pt-3 border-t border-[#2A312D]/60 flex items-center justify-between text-xs">
                  <span className="text-[#9CA6A0]">Don&apos;t have a room code?</span>
                  <Link
                    href="/rooms/create"
                    className="text-[#E4B93F] hover:text-white font-bold uppercase tracking-wider flex items-center space-x-1 transition-colors"
                  >
                    <PlusCircle className="w-3.5 h-3.5 text-[#C9A227]" />
                    <span>CREATE AUCTION ROOM &rarr;</span>
                  </Link>
                </div>
              </div>

            </form>
          </div>

          {/* RIGHT DYNAMIC ROOM PREVIEW PANEL (Col 5 - 45%) */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end w-full pt-1">
            <JoinRoomPreview
              code={code}
              room={previewRoom}
              verificationState={verificationState}
              errorMessage={errorMessage}
            />
          </div>

        </div>
      </main>

      {/* Broadcast Footer */}
      <footer className="py-4 border-t border-[#2A312D]/60 text-center relative z-10 mt-auto">
        <p className="text-[11px] font-mono-numbers text-[#9CA6A0] tracking-wider uppercase">
          MEGA AUCTION ARENA &bull; ENTRANCE CHECKPOINT v1.0
        </p>
      </footer>
    </div>
  );
}

export default function JoinRoomPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#C9A227]" />
        </div>
      }
    >
      <JoinRoomContent />
    </Suspense>
  );
}
