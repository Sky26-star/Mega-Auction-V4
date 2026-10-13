'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/layout/navbar';
import { V3AuctionStateProvider, useV3AuctionContext } from '@/components/rooms/v3/V3AuctionStateProvider';
import { MiniSelectionBoard } from '@/components/rooms/v3/MiniSelectionBoard';
import { MiniPoolReview } from '@/components/rooms/v3/MiniPoolReview';
import { V3PlayerCard } from '@/components/rooms/v3/V3PlayerCard';
import { V3Timer } from '@/components/rooms/v3/V3Timer';
import { V3BidPanel } from '@/components/rooms/v3/V3BidPanel';
import { V3Teams } from '@/components/rooms/v3/V3Teams';
import { V3ResultAnimation } from '@/components/rooms/v3/V3ResultAnimation';
import { createClient } from '@/lib/supabase/client';
import { getCurrentProfile } from '@/lib/auth';
import { V3MiniAuctionSession, V3Team, V3Player } from '@/lib/v3-auction-types';
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  Trophy,
  Sparkles,
  Home,
  CheckCircle2,
  RefreshCw,
  ArrowLeftRight,
} from 'lucide-react';

// Live Bidding View Component (Used when status === 'BIDDING')
function MiniBiddingArena({
  auctionId,
  roomId,
  isHost,
  myTeam,
}: {
  auctionId: string;
  roomId: string;
  isHost: boolean;
  myTeam: V3Team | null;
}) {
  const { state, refresh, animation } = useV3AuctionContext();

  useEffect(() => {
    if (!state.currentLot || state.currentLot.auction_id !== auctionId) {
      refresh();
    }
  }, [auctionId, state.currentLot, refresh]);

  return (
    <div className="flex flex-col gap-5 w-full">
      {animation && (
        <V3ResultAnimation animation={animation} teams={state.teams} />
      )}

      {/* Main Two-Column Bidding Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        {/* Left: Player Card */}
        <div>
          {state.currentPlayer ? (
            <V3PlayerCard player={state.currentPlayer} />
          ) : (
            <div className="h-full min-h-[260px] border-2 border-dashed border-[#2A312D] rounded-2xl bg-[#141917]/50 flex flex-col items-center justify-center p-6 text-center space-y-2">
              <Loader2 className="w-8 h-8 animate-spin text-[#C9A227]" />
              <p className="font-mono text-sm text-[#F3F4F1] font-bold uppercase">
                Loading Next Mini Lot...
              </p>
              <p className="font-mono text-xs text-[#9CA6A0]">
                Awaiting authoritative lot transition from engine.
              </p>
            </div>
          )}
        </div>

        {/* Right: Timer + Bid Panel */}
        <div className="flex flex-col gap-4">
          {state.currentLot && (
            <V3Timer lot={state.currentLot} auction={state.auction} />
          )}

          {state.currentLot ? (
            <V3BidPanel
              lot={state.currentLot}
              teams={state.teams}
              myTeam={myTeam}
              auctionId={auctionId}
              onBidSuccess={refresh}
            />
          ) : (
            <div className="h-48 border border-[#2A312D] rounded-2xl bg-[#0F1410] flex items-center justify-center text-xs font-mono text-[#9CA6A0]">
              WAITING FOR ACTIVE LOT
            </div>
          )}
        </div>
      </div>

      {/* Franchises Grid */}
      <V3Teams teams={state.teams} lot={state.currentLot} />
    </div>
  );
}

let nextMiniAuctionInstanceId = 0;

// Inner Component with Context
function MiniAuctionContent({
  roomId,
  auctionId,
  initialSession,
  isHost,
  myTeam,
  teams,
  onRefreshAll,
}: {
  roomId: string;
  auctionId: string;
  initialSession: V3MiniAuctionSession;
  isHost: boolean;
  myTeam: V3Team | null;
  teams: V3Team[];
  onRefreshAll: () => void;
}) {
  const router = useRouter();
  const [instanceId] = useState(() => ++nextMiniAuctionInstanceId);
  const [miniSession, setMiniSession] = useState<V3MiniAuctionSession>(initialSession);

  // Sync state when prop updates
  useEffect(() => {
    setMiniSession(initialSession);
  }, [initialSession]);

  // Subscribe to realtime postgres changes on mini_auction_sessions
  useEffect(() => {
    if (!auctionId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`mini_session_realtime_${auctionId}_instance_${instanceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mini_auction_sessions',
          filter: `auction_id=eq.${auctionId}`,
        },
        (payload) => {
          if (payload.new && (payload.new as any).id) {
            setMiniSession(payload.new as V3MiniAuctionSession);
            onRefreshAll();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [auctionId, instanceId]);

  const refreshSession = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('mini_auction_sessions')
      .select('*')
      .eq('auction_id', auctionId)
      .maybeSingle();

    if (data) {
      setMiniSession(data as V3MiniAuctionSession);
    }
    onRefreshAll();
  }, [auctionId, onRefreshAll]);

  return (
    <div
      data-testid="mini-auction-page"
      data-auction-id={auctionId}
      data-session-id={miniSession.id}
      className="min-h-screen bg-[#0B0F0D] flex flex-col text-[#F3F4F1] font-sans selection:bg-[#C9A227]/30"
    >
      <Navbar />

      <main className="flex-1 flex flex-col w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 gap-5">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2A312D] pb-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/rooms/${roomId}/summary`}
              className="p-2.5 rounded-2xl bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/40 text-[#9CA6A0] hover:text-white transition-all shadow-md"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-[#141917] border border-[#2A312D] text-[#C9A227] font-mono text-[10px] font-bold px-2 py-0.5 rounded-full">
                  MINI AUCTION
                </span>
                <span
                  data-testid="mini-auction-phase"
                  data-status={miniSession.status}
                  className="bg-amber-950/80 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 uppercase"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  PHASE: {miniSession.status}
                </span>
              </div>
              <h1 className="text-xl md:text-2xl font-black text-white font-mono tracking-tight mt-1 flex items-center gap-2">
                <Trophy className="w-6 h-6 text-amber-400" />
                MINI AUCTION ARENA
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refreshSession}
              className="p-2.5 rounded-2xl bg-[#141917] border border-[#2A312D] hover:border-white/20 text-[#9CA6A0] hover:text-white transition-all shadow-md"
              title="Refresh Session"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <Link
              href={`/rooms/${roomId}/summary`}
              className="px-4 py-2.5 rounded-2xl bg-[#141917] border border-[#2A312D] hover:border-white/20 text-zinc-300 hover:text-white font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all"
            >
              SUMMARY
            </Link>

            <Link
              href="/dashboard"
              className="px-4 py-2.5 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all"
            >
              <Home className="w-4 h-4" /> DASHBOARD
            </Link>
          </div>
        </div>

        {/* Phase-Driven Dynamic Workspace */}
        {miniSession.status === 'SETUP' || miniSession.status === 'SELECTION_OPEN' ? (
          <MiniSelectionBoard
            auctionId={auctionId}
            roomId={roomId}
            miniSession={miniSession}
            teams={teams}
            myTeam={myTeam}
            isHost={isHost}
            onRefreshSession={refreshSession}
          />
        ) : miniSession.status === 'SELECTION_CLOSED' ? (
          <div data-testid="mini-auction-pool-review" className="w-full">
            <MiniPoolReview
              auctionId={auctionId}
              roomId={roomId}
              miniSession={miniSession}
              isHost={isHost}
              onStartSuccess={refreshSession}
            />
          </div>
        ) : miniSession.status === 'BIDDING' ? (
          <div data-testid="mini-auction-bidding" className="w-full flex-1 flex flex-col gap-5">
            <MiniBiddingArena
              auctionId={auctionId}
              roomId={roomId}
              isHost={isHost}
              myTeam={myTeam}
            />
          </div>
        ) : miniSession.status === 'COMPLETED' ? (
          <div
            data-testid="mini-auction-complete"
            className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-lg mx-auto space-y-6 my-auto"
          >
            <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shadow-[0_0_30px_rgba(201,162,39,0.15)]">
              <Trophy className="w-10 h-10 text-amber-400" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-black font-display uppercase tracking-wider text-white">
                Mini Auction Completed
              </h2>
              <p className="text-xs font-mono text-zinc-400 leading-relaxed">
                All Mini Auction lots have concluded and player rosters are fully finalized.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full">
              <Link
                href={`/rooms/${roomId}/trades`}
                data-testid="mini-to-trades-entry"
                className="flex-1 py-3 px-6 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-black font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all"
              >
                <ArrowLeftRight className="w-4 h-4" /> ENTER TRADE CENTER
              </Link>
              <Link
                href={`/rooms/${roomId}/summary`}
                className="flex-1 py-3 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all"
              >
                <Trophy className="w-4 h-4" /> VIEW FINAL SUMMARY
              </Link>
              <Link
                href="/dashboard"
                className="py-3 px-6 rounded-xl bg-[#141917] border border-[#2A312D] text-zinc-300 hover:text-white font-mono font-bold text-xs uppercase tracking-wider transition-all"
              >
                DASHBOARD
              </Link>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default function MiniAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auctionId, setAuctionId] = useState<string>('');
  const [miniSession, setMiniSession] = useState<V3MiniAuctionSession | null>(null);
  const [teams, setTeams] = useState<V3Team[]>([]);
  const [myTeam, setMyTeam] = useState<V3Team | null>(null);
  const [isHost, setIsHost] = useState(false);

  const loadData = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const profile = await getCurrentProfile().catch(() => null);

      // 1. Fetch Room
      const { data: room, error: roomErr } = await supabase
        .from('rooms')
        .select('id, host_id, settings')
        .eq('id', roomId)
        .maybeSingle();

      if (roomErr || !room) {
        throw new Error(roomErr?.message || 'Room not found');
      }

      const host = Boolean(profile && profile.id === room.host_id);
      setIsHost(host);

      // 2. Fetch Auction
      const { data: auction, error: aucErr } = await supabase
        .from('auctions')
        .select('id, status')
        .eq('room_id', roomId)
        .maybeSingle();

      if (aucErr || !auction) {
        throw new Error(aucErr?.message || 'Auction not found for this room');
      }

      setAuctionId(auction.id);

      // 3. Fetch Mini Auction Session
      const { data: session, error: sessErr } = await supabase
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', auction.id)
        .maybeSingle();

      if (sessErr) {
        throw new Error(`Failed to load mini auction session: ${sessErr.message}`);
      }

      if (!session) {
        throw new Error('Mini auction has not been initiated yet.');
      }

      setMiniSession(session as V3MiniAuctionSession);

      // 4. Fetch Teams
      const { data: teamRows } = await supabase
        .from('teams')
        .select('*')
        .eq('auction_id', auction.id)
        .order('name', { ascending: true });

      const loadedTeams = (teamRows || []) as V3Team[];
      setTeams(loadedTeams);

      // 5. Determine my team
      if (profile) {
        const { data: participant } = await supabase
          .from('room_participants')
          .select('team_id')
          .eq('room_id', roomId)
          .eq('user_id', profile.id)
          .maybeSingle();

        if (participant?.team_id) {
          const userTeam = loadedTeams.find((t) => t.id === participant.team_id);
          setMyTeam(userTeam || null);
        }
      }
    } catch (err: any) {
      console.error('Error loading mini auction page:', err);
      setError(err.message || 'Failed to load mini auction');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col items-center justify-center font-mono text-zinc-400 space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#C9A227]" />
        <p className="text-xs uppercase tracking-widest">LOADING MINI AUCTION SESSION...</p>
      </div>
    );
  }

  if (error || !miniSession) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col items-center justify-center p-6 text-center font-mono text-red-300 space-y-4">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <h2 className="text-lg font-bold uppercase tracking-wider text-white">MINI AUCTION UNAVAILABLE</h2>
        <p className="text-xs max-w-md text-zinc-400">{error || 'Session not found'}</p>
        <div className="pt-2 flex gap-3">
          <button
            onClick={loadData}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-black font-bold text-xs uppercase"
          >
            Retry
          </button>
          <Link
            href={`/rooms/${roomId}/summary`}
            className="px-4 py-2 rounded-xl bg-[#141917] border border-[#2A312D] text-zinc-300 hover:text-white text-xs uppercase"
          >
            Go to Summary
          </Link>
        </div>
      </div>
    );
  }

  return (
    <V3AuctionStateProvider roomId={roomId}>
      <MiniAuctionContent
        roomId={roomId}
        auctionId={auctionId}
        initialSession={miniSession}
        isHost={isHost}
        myTeam={myTeam}
        teams={teams}
        onRefreshAll={loadData}
      />
    </V3AuctionStateProvider>
  );
}
