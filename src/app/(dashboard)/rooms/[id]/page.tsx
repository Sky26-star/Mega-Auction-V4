'use client';

export const dynamic = 'force-dynamic';

// src/app/(dashboard)/rooms/[id]/page.tsx
// Redesigned Live Cricket Auction Control Room Page (V2 Auction State Integrated)

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Navbar } from '@/components/layout/navbar';
import { AuctionRoomHeader } from '@/components/rooms/auction-room-header';
import { AuctionStatusBar } from '@/components/rooms/auction-status-bar';
import { AuctionInfoStrip } from '@/components/rooms/auction-info-strip';
import { AuctionParticipants } from '@/components/rooms/auction-participants';
import { AuctionHostControls } from '@/components/rooms/auction-host-controls';
import { AuctionInvitePanel } from '@/components/rooms/auction-invite-panel';
import { TeamModal } from '@/components/rooms/team-modal';
import { RoomSettingsModal } from '@/components/rooms/room-settings-modal';
import { RoomInviteModal } from '@/components/rooms/room-invite-modal';

import {
  getRoomById,
  getRoomParticipants,
  getAuctionTeamsByRoomId,
  updateMyTeam,
  removeRoomParticipant,
  updateRoom,
} from '@/lib/rooms';
import { getPlayersBySetId } from '@/lib/player-sets';
import { getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/client';
import {
  AuctionState,
  RawInputPlayer,
} from '@/lib/auction/state';
import {
  getRoomAuctionState,
  loadAuthoritativeRoomAuctionState,
  subscribeToRoomAuctionState,
} from '@/lib/auction/state-manager';
import { useV3AuctionContext } from '@/components/rooms/v3/V3AuctionStateProvider';
import type { Room, RoomParticipant, Team, UpdateTeamInput } from '@/lib/types/room';
import type { Profile } from '@/lib/types/auth';
import { Loader2, AlertCircle, Radio, ArrowRight, Trophy } from 'lucide-react';

// Fallback default player pool generator if room player_set_id has 0 players
function getDefaultFallbackPlayers(): RawInputPlayer[] {
  return [
    { id: 'dhoni-01', name: 'MS DHONI', category: 'MARQUEE', base_price: 200, role: 'WICKET_KEEPER', country: 'India', image_url: '/images/ms_dhoni.jpg' },
    { id: 'virat-02', name: 'VIRAT KOHLI', category: 'MARQUEE', base_price: 200, role: 'BATSMAN', country: 'India' },
    { id: 'rohit-03', name: 'ROHIT SHARMA', category: 'MARQUEE', base_price: 200, role: 'BATSMAN', country: 'India' },
    { id: 'bumrah-04', name: 'JASPRIT BUMRAH', category: 'MARQUEE', base_price: 200, role: 'BOWLER', country: 'India' },
    { id: 'cummins-05', name: 'PAT CUMMINS', category: 'A', base_price: 150, role: 'ALL_ROUNDER', country: 'Australia' },
    { id: 'head-06', name: 'TRAVIS HEAD', category: 'A', base_price: 150, role: 'BATSMAN', country: 'Australia' },
    { id: 'klassn-07', name: 'HEINRICH KLASEN', category: 'B', base_price: 100, role: 'WICKET_KEEPER', country: 'South Africa' },
    { id: 'rinku-08', name: 'RINKU SINGH', category: 'C', base_price: 75, role: 'BATSMAN', country: 'India' },
    { id: 'abhishek-09', name: 'ABHISHEK SHARMA', category: 'D', base_price: 50, role: 'ALL_ROUNDER', country: 'India' },
  ];
}

// Upper bound on Realtime-triggered authoritative-state fetches per 1s poll window
const MAX_EVENT_REVALIDATIONS_PER_WINDOW = 3;

export default function RoomLobbyPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  // Authoritative Auction State
  const [auctionState, setAuctionState] = useState<AuctionState | null>(null);
  const [isStartingAuction, setIsStartingAuction] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lifecycle, Concurrency & Realtime Tracking Refs
  const isMountedRef = useRef<boolean>(true);
  const inFlightRef = useRef<boolean>(false);
  const pendingRevalidationRef = useRef<boolean>(false);
  const pendingSpinnerRef = useRef<boolean>(false);
  const activeAuctionIdRef = useRef<string | null>(null);
  const lobbyLoadSeqRef = useRef<number>(0);
  const teamsRef = useRef<Team[]>(teams);
  const participantsRef = useRef<RoomParticipant[]>(participants);
  const auctionStateRef = useRef<AuctionState | null>(auctionState);

  const stateInFlightPromiseRef = useRef<Promise<AuctionState | null> | null>(null);
  const pendingStateRevalidationRef = useRef<boolean>(false);
  const stateSeqRef = useRef<number>(0);

  const lobbyRevalidationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stateRevalidationTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Event-triggered authoritative fetches started in the current 1s poll window (reset by the poll tick)
  const eventRevalidationCountRef = useRef<number>(0);

  useEffect(() => {
    auctionStateRef.current = auctionState;
  }, [auctionState]);

  useEffect(() => {
    teamsRef.current = teams;
  }, [teams]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (lobbyRevalidationTimerRef.current) {
        clearTimeout(lobbyRevalidationTimerRef.current);
        lobbyRevalidationTimerRef.current = null;
      }
      if (stateRevalidationTimerRef.current) {
        clearTimeout(stateRevalidationTimerRef.current);
        stateRevalidationTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (room?.auction_id) {
      activeAuctionIdRef.current = room.auction_id;
    } else if (auctionState?.auctionId) {
      activeAuctionIdRef.current = auctionState.auctionId;
    }
  }, [room?.auction_id, auctionState?.auctionId]);

  // Host and Countdown Overlay States & Refs
  const isHost = Boolean(profile && room && room.host_id === profile.id);
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { refresh: refreshContext } = useV3AuctionContext();
  const isHostRef = useRef(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  const myTeam = useMemo(() => {
    return teams.find((t) => {
      const p = participants.find((part) => part.team_id === t.id);
      return Boolean(profile && p?.user_id === profile.id);
    });
  }, [teams, participants, profile]);

  // Track initial state to handle one-time event-driven navigation for active participants
  const hasEverBeenNotStartedRef = useRef<boolean>(false);

  // Team Modal state
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  // Settings Modal state
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Invite Modal state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  const refreshAuthoritativeState = useCallback(async (
    isEvent = false,
    forceFresh = false
  ): Promise<AuctionState | null> => {
    if (!roomId || !isAuthLoaded || !isSignedIn) return null;

    while (forceFresh && stateInFlightPromiseRef.current) {
      const runningRequest = stateInFlightPromiseRef.current;
      await runningRequest;
    }

    if (stateInFlightPromiseRef.current) {
      pendingStateRevalidationRef.current = true;
      return stateInFlightPromiseRef.current;
    }

    if (isEvent) {
      // A trailing refresh is already scheduled: coalesce into it instead of cancelling the delay
      if (stateRevalidationTimerRef.current) return auctionStateRef.current;
      // Per-window cap reached: defer to the next poll tick, which drains this pending flag
      if (eventRevalidationCountRef.current >= MAX_EVENT_REVALIDATIONS_PER_WINDOW) {
        pendingStateRevalidationRef.current = true;
        return auctionStateRef.current;
      }
      eventRevalidationCountRef.current += 1;
    }

    // Direct callers (lobby load, auction start) supersede any scheduled trailing refresh;
    // the fetch started here begins after all prior events, so it incorporates them.
    if (stateRevalidationTimerRef.current) {
      clearTimeout(stateRevalidationTimerRef.current);
      stateRevalidationTimerRef.current = null;
    }
    pendingStateRevalidationRef.current = false;

    const currentSeq = ++stateSeqRef.current;

    const promise = (async () => {
      try {
        const activeState = await loadAuthoritativeRoomAuctionState(roomId);
        if (!isMountedRef.current || currentSeq !== stateSeqRef.current) {
          return activeState;
        }

        if (activeState) {
          auctionStateRef.current = activeState;
          if (activeState.auctionId) {
            activeAuctionIdRef.current = activeState.auctionId;
          }
          setAuctionState(activeState);
          console.log('[AUCTION SYNC DEBUG] Authoritative state refreshed:', {
            roomId,
            auctionId: activeState.auctionId,
            auctionStatus: activeState.auctionStatus,
            currentPlayer: activeState.currentPlayer?.name,
          });
        } else {
          auctionStateRef.current = null;
          setAuctionState(null);
        }

        return activeState;
      } catch (err) {
        console.warn('[AUCTION SYNC DEBUG] Failed to refresh authoritative state:', err);
        return null;
      } finally {
        stateInFlightPromiseRef.current = null;
        if (
          isMountedRef.current &&
          pendingStateRevalidationRef.current &&
          eventRevalidationCountRef.current < MAX_EVENT_REVALIDATIONS_PER_WINDOW
        ) {
          pendingStateRevalidationRef.current = false;
          if (stateRevalidationTimerRef.current) {
            clearTimeout(stateRevalidationTimerRef.current);
          }
          stateRevalidationTimerRef.current = setTimeout(() => {
            stateRevalidationTimerRef.current = null;
            if (isMountedRef.current) {
              refreshAuthoritativeState(true);
            }
          }, 100);
        }
        // If the cap is reached, pendingStateRevalidationRef stays set and is drained by the next poll tick.
      }
    })();

    stateInFlightPromiseRef.current = promise;
    return promise;
  }, [roomId, isAuthLoaded, isSignedIn]);

  const loadLobbyData = useCallback(
    async (showSpinner = true, isPolling = false) => {
      if (!roomId || !isAuthLoaded) return;

      if (!isSignedIn) {
        if (isMountedRef.current) {
          setError('You must be signed in to access this auction room.');
          setIsLoading(false);
        }
        return;
      }

      if (inFlightRef.current) {
        if (isPolling) return;
        pendingRevalidationRef.current = true;
        if (showSpinner) pendingSpinnerRef.current = true;
        return;
      }

      if (isPolling && lobbyRevalidationTimerRef.current) {
        return;
      }

      if (lobbyRevalidationTimerRef.current) {
        clearTimeout(lobbyRevalidationTimerRef.current);
        lobbyRevalidationTimerRef.current = null;
      }

      inFlightRef.current = true;
      const currentSeq = ++lobbyLoadSeqRef.current;
      if (showSpinner && isMountedRef.current) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const [prof, roomData] = await Promise.all([
          getCurrentProfile(),
          getRoomById(roomId),
        ]);

        if (!isMountedRef.current || currentSeq !== lobbyLoadSeqRef.current) return;

        if (!roomData) {
          setError('Auction control room not found or access denied.');
          return;
        }

        if (roomData.auction_id) {
          activeAuctionIdRef.current = roomData.auction_id;
        }

        setProfile(prof);
        setRoom(roomData);

        if (roomData.status === 'EXPIRED') {
          setError('Room expired due to inactivity.');
          return;
        }

        if (roomData.status === 'LOCKED') {
          console.log('[AUCTION SYNC DEBUG] Lobby loaded for LOCKED room', { roomId });
          return;
        }

        const [parts, teamData] = await Promise.all([
          getRoomParticipants(roomId),
          getAuctionTeamsByRoomId(roomId),
        ]);

        if (!isMountedRef.current || currentSeq !== lobbyLoadSeqRef.current) return;

        setParticipants(parts);
        setTeams(teamData);
        participantsRef.current = parts;
        teamsRef.current = teamData;

        // Fetch authoritative state through shared single-flight authority
        await refreshAuthoritativeState();
        if (!isMountedRef.current || currentSeq !== lobbyLoadSeqRef.current) return;

        setError(null);
      } catch (err: unknown) {
        if (!isMountedRef.current || currentSeq !== lobbyLoadSeqRef.current) return;
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to load auction room lobby.');
        }
      } finally {
        inFlightRef.current = false;
        if (isMountedRef.current && currentSeq === lobbyLoadSeqRef.current) {
          setIsLoading(false);
        }
        if (isMountedRef.current && pendingRevalidationRef.current) {
          pendingRevalidationRef.current = false;
          const nextShowSpinner = pendingSpinnerRef.current;
          pendingSpinnerRef.current = false;
          if (lobbyRevalidationTimerRef.current) {
            clearTimeout(lobbyRevalidationTimerRef.current);
          }
          lobbyRevalidationTimerRef.current = setTimeout(() => {
            lobbyRevalidationTimerRef.current = null;
            if (isMountedRef.current) {
              loadLobbyData(nextShowSpinner, false);
            }
          }, 100);
        }
      }
    },
    [roomId, isAuthLoaded, isSignedIn, refreshAuthoritativeState]
  );

  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!isSignedIn) {
      setError('You must be signed in to access this auction room.');
      setIsLoading(false);
      return;
    }
    loadLobbyData(true);
  }, [isAuthLoaded, isSignedIn, loadLobbyData]);

  // Automatic Navigation & State Subscriber
  useEffect(() => {
    if (!roomId || !isAuthLoaded || !isSignedIn) return;
    const unsub = subscribeToRoomAuctionState(roomId, (newState) => {
      if (!isMountedRef.current) return;
      if (newState) {
        auctionStateRef.current = newState;
        if (newState.auctionId) {
          activeAuctionIdRef.current = newState.auctionId;
        }
        setAuctionState(newState);
      } else {
        auctionStateRef.current = null;
        setAuctionState(null);
      }
    });
    return () => unsub();
  }, [roomId, isAuthLoaded, isSignedIn]);

  useEffect(() => {
    if (auctionState?.auctionStatus === 'LIVE' || (auctionState as any)?.auctionStatus === 'IN_PROGRESS') {
      console.log('[AUCTION SYNC DEBUG] Lobby detected active state, navigating automatically...', { roomId, status: auctionState?.auctionStatus });
      router.push(`/rooms/${roomId}/auction`);
    } else if ((auctionState as any)?.auctionStatus === 'MINI_AUCTION') {
      console.log('[AUCTION SYNC DEBUG] Lobby detected MINI_AUCTION state, navigating automatically...', { roomId });
      router.push(`/rooms/${roomId}/mini-auction`);
    }
  }, [auctionState?.auctionStatus, roomId, router]);

  const executeAuctionStart = useCallback(async () => {
    // Old execution logic removed
    setIsStartingAuction(false);
  }, []);

  const cancelLocalCountdownTimer = useCallback(() => {
    console.log('[AUCTION START FLOW] Cancelling countdown overlay.', { roomId });
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setIsCountdownActive(false);
    setCountdownSeconds(3);
  }, [roomId]);

  const startLocalCountdownTimer = useCallback(() => {
    console.log('[AUCTION START FLOW] Starting 3-second countdown overlay...', { roomId });
    setIsCountdownActive(true);
    setCountdownSeconds(3);

    let currentSec = 3;
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    countdownTimerRef.current = setInterval(async () => {
      currentSec -= 1;
      setCountdownSeconds(currentSec);

      if (currentSec <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setIsCountdownActive(false);
        if (isHostRef.current) {
          // await executeAuctionStart(); -- Removed
        }
      }
    }, 1000);
  }, [roomId]);

  const handleCancelStart = useCallback(() => {
    console.log('[AUCTION START FLOW] Host clicked CANCEL AUCTION START.', { roomId });
    const supabase = createClient();
    supabase.channel(`room:${roomId}`).send({
      type: 'broadcast',
      event: 'auction:countdown_cancel',
      payload: { roomId },
    });
    cancelLocalCountdownTimer();
  }, [roomId, cancelLocalCountdownTimer]);

  const handleStartAuction = useCallback(async () => {
    if (!isHostRef.current) {
      alert('Only the room host can start the auction.');
      return;
    }

    const currentStatus = auctionState?.auctionStatus as string | undefined;
    if (currentStatus === 'IN_PROGRESS' || currentStatus === 'LIVE') {
      console.log('Auction already IN_PROGRESS or LIVE.');
      router.push(`/rooms/${roomId}/auction`);
      return;
    }

    if (auctionState?.auctionStatus === 'COMPLETED') {
      alert('Auction session has already been completed.');
      return;
    }

    console.log('[AUCTION START FLOW] Host clicked START AUCTION.');
    setIsStartingAuction(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('v3_start_auction', {
        p_room_id: roomId
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.error || 'Failed to start auction');
      }

      // 1. Force the provider and lobby to sync their state WITH the new IN_PROGRESS backend status BEFORE navigating
      const [syncedState] = await Promise.all([
        refreshAuthoritativeState(false, true),
        refreshContext ? refreshContext() : Promise.resolve(),
      ]);

      if (!syncedState) {
        throw new Error(
          'Auction start succeeded, but authoritative state could not be refreshed. Please retry or refresh the room.'
        );
      }

      setAuctionState(syncedState);

      // Navigate only after authoritative state has been fetched
      router.push(`/rooms/${roomId}/auction`);

    } catch (err: any) {
      console.error('Start auction error:', err);
      alert(err.message || 'Failed to start auction');
      setIsStartingAuction(false);
    }
  }, [roomId, auctionState?.auctionStatus, router, refreshContext, refreshAuthoritativeState]);

  const handleContinueAuction = useCallback(() => {
    router.push(`/rooms/${roomId}/auction`);
  }, [roomId, router]);

  // Realtime channel subscription effect
  useEffect(() => {
    if (!roomId || !isAuthLoaded || !isSignedIn) return;

    const supabase = createClient();
    const channelName = `room:${roomId}`;
    console.log('[AUCTION SYNC DEBUG] Lobby subscribing to Realtime channel:', channelName);

    const isRelevantTeamPayload = (payload: any): boolean => {
      const currentAuctionId = activeAuctionIdRef.current;
      const newRow = payload?.new as Record<string, any> | undefined;
      const oldRow = payload?.old as Record<string, any> | undefined;
      const newAuctionId = newRow?.auction_id;
      const oldAuctionId = oldRow?.auction_id;

      // If current room's auction ID is unresolved, do not discard potentially relevant events
      if (!currentAuctionId) {
        return true;
      }

      // If either payload.new.auction_id or payload.old.auction_id matches the current auction ID, accept
      if (
        (newAuctionId && newAuctionId === currentAuctionId) ||
        (oldAuctionId && oldAuctionId === currentAuctionId)
      ) {
        return true;
      }

      // If at least one auction ID is present (or both) and neither matched, reject
      if (newAuctionId || oldAuctionId) {
        return false;
      }

      // If event auction ID is missing while current auction ID is known,
      // use safe fallback only when row identity can be verified against known room teams or participants
      const eventTeamId = newRow?.id || oldRow?.id;
      if (
        eventTeamId &&
        (teamsRef.current.some((t) => t.id === eventTeamId) ||
          participantsRef.current.some((p) => p.team_id === eventTeamId))
      ) {
        return true;
      }

      // Otherwise, avoid repeatedly triggering unnecessary reloads; polling fallback maintains consistency
      return false;
    };

    const isRelevantLotPayload = (payload: any): boolean => {
      const currentAuctionId = activeAuctionIdRef.current;
      const newRow = payload?.new as Record<string, any> | undefined;
      const oldRow = payload?.old as Record<string, any> | undefined;
      const newAuctionId = newRow?.auction_id;
      const oldAuctionId = oldRow?.auction_id;

      // If current room's auction ID is unresolved, do not discard potentially relevant events
      if (!currentAuctionId) {
        return true;
      }

      // If either payload.new.auction_id or payload.old.auction_id matches the current auction ID, accept
      if (
        (newAuctionId && newAuctionId === currentAuctionId) ||
        (oldAuctionId && oldAuctionId === currentAuctionId)
      ) {
        return true;
      }

      // If at least one auction ID is present (or both) and neither matched, reject
      if (newAuctionId || oldAuctionId) {
        return false;
      }

      // If event auction ID is missing while current auction ID is known,
      // verify row identity against the active lot, current player, or known team bids/wins
      const eventLotId = newRow?.id || oldRow?.id;
      const currentLotId = auctionStateRef.current?.lotId;
      if (eventLotId && currentLotId && eventLotId === currentLotId) {
        return true;
      }

      const eventPlayerId = newRow?.player_id || oldRow?.player_id;
      const currentPlayerId = auctionStateRef.current?.currentPlayerId;
      if (eventPlayerId && currentPlayerId && eventPlayerId === currentPlayerId) {
        return true;
      }

      const teamIdCandidate =
        newRow?.highest_bidder_team_id ||
        oldRow?.highest_bidder_team_id ||
        newRow?.winning_team_id ||
        oldRow?.winning_team_id;
      if (teamIdCandidate && teamsRef.current.some((t) => t.id === teamIdCandidate)) {
        return true;
      }

      // Otherwise, avoid repeatedly triggering unnecessary reloads; polling fallback maintains consistency
      return false;
    };

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auctions', filter: `room_id=eq.${roomId}` },
        (payload) => {
          console.log('[AUCTION SYNC DEBUG] Lobby received postgres_changes (auctions):', payload);
          refreshAuthoritativeState(true);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auction_lots' },
        (payload) => {
          if (!isRelevantLotPayload(payload)) return;
          console.log('[AUCTION SYNC DEBUG] Lobby received relevant postgres_changes (auction_lots):', payload);
          refreshAuthoritativeState(true);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          console.log('[AUCTION SYNC DEBUG] Lobby received postgres_changes (rooms):', payload);
          loadLobbyData(false);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${roomId}` },
        () => {
          loadLobbyData(false);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teams' },
        (payload) => {
          if (!isRelevantTeamPayload(payload)) return;
          console.log('[AUCTION SYNC DEBUG] Lobby received relevant postgres_changes (teams):', payload);
          loadLobbyData(false);
        }
      )
      .on('broadcast', { event: '*' }, async (payload) => {
        console.log('[AUCTION SYNC DEBUG] Lobby received broadcast event:', payload);
        const evt = payload?.event || payload?.payload?.event;
        if (evt === 'auction:countdown_start') {
          console.log('[AUCTION START FLOW] Received broadcast auction:countdown_start');
          startLocalCountdownTimer();
          return;
        }
        if (evt === 'auction:countdown_cancel') {
          console.log('[AUCTION START FLOW] Received broadcast auction:countdown_cancel');
          cancelLocalCountdownTimer();
          return;
        }
      })
      .subscribe((status) => {
        console.log('[AUCTION SYNC DEBUG] Lobby channel subscription status:', channelName, status);
      });

    // 1-second interval lobby status poll to guarantee no client is stranded in lobby when auction starts
    const pollInterval = setInterval(() => {
      // Open a new event-revalidation window and drain any event deferred by the cap
      eventRevalidationCountRef.current = 0;
      if (
        pendingStateRevalidationRef.current &&
        !stateInFlightPromiseRef.current &&
        !stateRevalidationTimerRef.current
      ) {
        refreshAuthoritativeState(true);
      }
      loadLobbyData(false, true);
    }, 1000);

    return () => {
      clearInterval(pollInterval);
      if (lobbyRevalidationTimerRef.current) {
        clearTimeout(lobbyRevalidationTimerRef.current);
        lobbyRevalidationTimerRef.current = null;
      }
      if (stateRevalidationTimerRef.current) {
        clearTimeout(stateRevalidationTimerRef.current);
        stateRevalidationTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [roomId, isAuthLoaded, isSignedIn, loadLobbyData, refreshAuthoritativeState, startLocalCountdownTimer, cancelLocalCountdownTimer]);

  const handleUpdateMyTeam = async (data: UpdateTeamInput) => {
    if (!editingTeam) return;
    try {
      await updateMyTeam(editingTeam.id, data);
      setTeams((prev) =>
        prev.map((t) =>
          t.id === editingTeam.id
            ? {
                ...t,
                name: data.team_name,
                short_name: data.team_short_name.toUpperCase(),
                color: data.team_color,
              }
            : t
        )
      );
      setIsTeamModalOpen(false);
      setEditingTeam(null);
      await loadLobbyData(false);
    } catch (err: unknown) {
      throw err;
    }
  };

  const handleUpdateSettings = async (data: { name: string; default_purse: number; timer_duration_seconds: number; max_squad_size: number; bot_count?: number }) => {
    try {
      const updatedRoom = await updateRoom(roomId, data);
      setRoom(updatedRoom);
      await loadLobbyData(false);
    } catch (err: unknown) {
      throw err; // Modal handles displaying the error
    }
  };

  const handleRemoveParticipant = async (participant: RoomParticipant) => {
    const isSelf = Boolean(profile && participant.user_id === profile.id);
    const message = isSelf
      ? 'Are you sure you want to leave this room? Your team franchise will be deleted.'
      : `Are you sure you want to remove participant "${participant.profile?.display_name || 'User'}" from this room?`;

    if (!confirm(message)) return;

    try {
      await removeRoomParticipant(participant.id);
      if (isSelf) {
        router.push('/rooms');
      } else {
        await loadLobbyData(false);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove participant');
    }
  };

  const handleCopyInviteLink = () => {
    if (!room?.code) return;
    const inviteUrl = `${window.location.origin}/rooms/join?code=${room.code}`;
    navigator.clipboard.writeText(inviteUrl);
  };

  const rawPurse = room?.settings?.default_purse || 100;
  const defaultPurseCr = rawPurse > 1000 ? Math.round(rawPurse / 100) : rawPurse;
  const maxSquadSize = room?.settings?.max_squad_size || 15;
  const maxOverseas = room?.settings?.max_overseas || 8;
  const timerSeconds = room?.settings?.timer_duration_seconds || 15;
  const humanParticipantsCount = useMemo(() => {
    return participants.filter((p) => !p.is_bot).length || 1;
  }, [participants]);

  const leadingTeamName = useMemo(() => {
    if (!auctionState?.highestBidderId) return 'NO BIDS / NONE';
    const team = teams.find((t) => t.id === auctionState.highestBidderId);
    return team ? team.name : 'NO BIDS / NONE';
  }, [auctionState, teams]);

  const isAuctionLive = auctionState?.auctionStatus === 'LIVE';

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col font-sans selection:bg-[#C9A227]/30 selection:text-[#E4B93F]">
      <Navbar />

      <main className="flex-1 flex flex-col w-full">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-[#C9A227]" />
            <p className="text-sm font-mono-numbers text-[#9CA6A0] uppercase tracking-widest">
              INITIALIZING AUCTION CONTROL ROOM...
            </p>
          </div>
        ) : error || !room ? (
          <div className="max-w-4xl mx-auto w-full my-12 p-6 rounded-2xl bg-[#B8322E]/10 border-2 border-[#B8322E]/40 text-[#B8322E] text-sm flex flex-col space-y-4">
            <div className="flex items-center space-x-4">
              <AlertCircle className="w-6 h-6 flex-shrink-0 text-[#B8322E]" />
              <div className="font-mono-numbers">
                <strong className="block text-base font-bold uppercase mb-1">
                  {error?.includes('expired') ? 'ROOM EXPIRED' : 'AUCTION ACCESS ERROR'}
                </strong>
                <span className="text-[#F3F4F1]/90">{error || 'Auction room was not found.'}</span>
              </div>
            </div>
            <div className="flex items-center space-x-3 pt-2 border-t border-[#B8322E]/20">
              <Link
                href="/dashboard"
                className="px-4 py-2 rounded-xl bg-[#141917] hover:bg-[#1E2522] border border-[#2A312D] text-xs font-mono-numbers font-bold text-[#F3F4F1] transition-all"
              >
                RETURN TO DASHBOARD
              </Link>
              <Link
                href="/rooms"
                className="px-4 py-2 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] border border-[#7C3AED]/50 text-xs font-mono-numbers font-bold text-white shadow-md transition-all"
              >
                BROWSE ROOMS
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col w-full space-y-0">


            {/* Old Live Auction Navigation Banner has been removed per V3 Engine prep */}

            {/* PROMINENT COMPLETED AUCTION SUMMARY BANNER (Rendered when auction is COMPLETED) */}
            {auctionState?.auctionStatus === 'COMPLETED' && (
              <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-purple-900 p-3 text-white shadow-xl flex items-center justify-center space-x-4 font-mono font-bold text-xs sm:text-sm border-b border-purple-500/30">
                <div className="flex items-center space-x-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span>AUCTION COMPLETED</span>
                </div>
                <span className="hidden sm:inline">|</span>
                <Link
                  href={`/rooms/${roomId}/summary`}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/40 flex items-center space-x-2 transition-all hover:scale-105 shadow-md"
                >
                  <span>VIEW AUCTION SUMMARY & RESULTS</span>
                  <ArrowRight className="w-4 h-4 text-white" />
                </Link>
              </div>
            )}

            {/* Top Room Console Header */}
            <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-2">
              <AuctionRoomHeader
                room={room}
                participantCount={participants.length}
                maxManagers={10}
                isHost={isHost}
                onRefresh={() => loadLobbyData(true)}
                isLoading={isLoading}
              />
            </div>

            {/* Horizontal Auction Status Ticker Bar */}
            <AuctionStatusBar
              participantCount={participants.length}
              roomCode={room.code}
              defaultPurseCr={defaultPurseCr}
              playerSetName={room.player_set_name}
              isConnected={true}
            />

            {/* Horizontal Auction Info Strip */}
            <AuctionInfoStrip
              playerSetName={room.player_set_name}
              defaultPurseCr={defaultPurseCr}
              timerSeconds={timerSeconds}
              maxSquadSize={maxSquadSize}
              maxOverseas={maxOverseas}
              botCount={room.settings?.bot_count ?? 0}
              totalManagers={participants.length}
              maxManagers={10}
            />

            {/* Main Stage & Control Panel Layout Grid */}
            <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

                {/* LEFT STAGE COLUMN (~65% width on desktop) */}
                <div className="lg:col-span-7 flex flex-col h-full items-center justify-center border-2 border-dashed border-[#2A312D] rounded-3xl bg-[#0B0F0D]/50 text-[#8B938E] p-8 text-center">
                  <h2 className="text-xl font-black uppercase font-display tracking-wider mb-2">AUCTION LOBBY</h2>
                  <p className="font-mono text-sm max-w-md">
                    {isHost
                      ? 'You are the Host. When everyone is ready, click "START AUCTION" to enter the live auction room.'
                      : 'Waiting for the Host to start the auction. You will be automatically redirected to the live auction room when it begins.'}
                  </p>
                </div>

                {/* RIGHT CONTROL PANEL COLUMN (~35% width on desktop) */}
                <div className="lg:col-span-5 space-y-4">
                  {/* Host Controls */}
                  <AuctionHostControls
                    isHost={isHost}
                    onStartAuction={handleStartAuction}
                    onContinueAuction={handleContinueAuction}
                    onOpenSettings={() => setIsSettingsModalOpen(true)}
                    auctionStatus={auctionState?.auctionStatus || 'NOT_STARTED'}
                    isStartingAuction={isStartingAuction || isCountdownActive}
                    onEditTeam={
                      myTeam
                        ? () => {
                          setEditingTeam(myTeam);
                          setIsTeamModalOpen(true);
                        }
                        : undefined
                    }
                    onShareInvite={() => setIsInviteModalOpen(true)}
                    onCopyInvite={() => setIsInviteModalOpen(true)}
                    onLeaveRoom={() => {
                      const myPart = participants.find((p) => profile && p.user_id === profile.id);
                      if (myPart) handleRemoveParticipant(myPart);
                    }}
                  />

                  {/* Invite Panel */}
                  <AuctionInvitePanel roomCode={room.code} />

                  {/* Auction Managers Roster */}
                  <AuctionParticipants
                    teams={teams}
                    participants={participants}
                    currentUserId={profile?.id}
                    isHost={isHost}
                    maxSquadSize={maxSquadSize}
                    maxOverseas={maxOverseas}
                    onEditTeam={(t) => {
                      setEditingTeam(t);
                      setIsTeamModalOpen(true);
                    }}
                    onRemoveParticipant={handleRemoveParticipant}
                  />
                </div>

              </div>
            </div>
          </div>
        )}
      </main>

      {/* 3-SECOND STARTING COUNTDOWN OVERLAY (HOST ONLY) */}
      {isCountdownActive && (
        <div className="fixed inset-0 z-50 bg-[#0B0F0D]/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full p-8 rounded-3xl bg-[#141917] border-2 border-[#C9A227]/50 shadow-2xl space-y-6 relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-40 h-40 bg-[#C9A227]/10 rounded-full blur-3xl pointer-events-none" />

            <div className="space-y-2">
              <span className="text-xs font-mono font-extrabold text-[#E4B93F] uppercase tracking-widest block">
                MEGA AUCTION ARENA
              </span>
              <h2 className="text-2xl font-black text-[#F3F4F1] uppercase font-display tracking-tight">
                AUCTION STARTING
              </h2>
            </div>

            {/* Countdown Digit Display */}
            <div className="py-4">
              <div className="w-28 h-28 mx-auto rounded-3xl bg-[#0B0F0D] border-4 border-[#C9A227] flex items-center justify-center font-mono font-black text-6xl text-[#E4B93F] shadow-2xl animate-pulse">
                {countdownSeconds}
              </div>
            </div>

            <p className="text-xs font-mono text-[#9CA6A0] uppercase tracking-wider">
              GET READY... INITIALIZING MULTIPLAYER SYNC
            </p>

            {/* CANCEL BUTTON (HOST ONLY) */}
            {isHost && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCancelStart}
                  className="w-full py-3 px-6 rounded-xl bg-red-950/80 hover:bg-red-900 border-2 border-red-500/60 text-red-300 font-mono font-bold text-xs uppercase tracking-wider shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer"
                >
                  CANCEL AUCTION START
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Team Identity Edit Modal */}
      <TeamModal
        isOpen={isTeamModalOpen}
        onClose={() => {
          setIsTeamModalOpen(false);
          setEditingTeam(null);
        }}
        onSubmit={handleUpdateMyTeam}
        initialData={editingTeam}
      />

      {/* Room Settings Edit Modal */}
      <RoomSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onSubmit={handleUpdateSettings}
        initialData={room}
        isHost={isHost}
        humanParticipantsCount={humanParticipantsCount}
      />

      {/* Share Room Invite Modal */}
      <RoomInviteModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        roomCode={room?.code || ''}
        roomName={room?.name}
      />
    </div>
  );
}
