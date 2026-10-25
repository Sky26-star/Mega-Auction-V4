'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useV3AuctionContext } from '@/components/rooms/v3/V3AuctionStateProvider';
import { getCurrentProfile } from '@/lib/auth';
import { V3PlayerCard } from '@/components/rooms/v3/V3PlayerCard';
import { V3BidPanel } from '@/components/rooms/v3/V3BidPanel';
import { V3ResultAnimation } from '@/components/rooms/v3/V3ResultAnimation';
import { V3Timer } from '@/components/rooms/v3/V3Timer';
import { V3Teams } from '@/components/rooms/v3/V3Teams';
import { Navbar } from '@/components/layout/navbar';
import { Loader2, AlertCircle, ArrowLeft, Trophy } from 'lucide-react';
import { V3Team } from '@/lib/v3-auction-types';

function ResumingCountdown({ targetMs, onComplete }: { targetMs: number; onComplete?: () => void }) {
  const [timeLeft, setTimeLeft] = useState<number>(3);
  const completedRef = useRef(false);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.ceil((targetMs - now) / 1000));
      setTimeLeft(diff);
      if (now >= targetMs && !completedRef.current) {
        completedRef.current = true;
        if (onComplete) onComplete();
      }
    };
    update();
    const interval = setInterval(update, 50); // fast update for UI responsiveness
    return () => clearInterval(interval);
  }, [targetMs, onComplete]);

  const getSubtext = (t: number) => {
    if (t === 3) return 'PREPARE TO BID';
    if (t === 2) return 'GET READY';
    if (t === 1) return 'FINAL CHECK';
    return 'AUCTION LIVE';
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6 animate-in fade-in zoom-in duration-300">
      <h3 className="text-[#C9A227] font-mono text-xl tracking-[0.2em] uppercase font-bold drop-shadow-md">Auction Resuming</h3>
      <div className="relative flex items-center justify-center w-48 h-48">
        <div className="absolute inset-0 rounded-full border-4 border-[#C9A227]/20 animate-pulse"></div>
        <div className="absolute inset-0 rounded-full border-t-4 border-[#C9A227] animate-spin" style={{ animationDuration: '3s' }}></div>
        <div className="text-8xl font-mono-numbers font-black text-[#F3F4F1] drop-shadow-[0_0_15px_rgba(201,162,39,0.5)]">
          {timeLeft > 0 ? timeLeft : '0'}
        </div>
      </div>
      <p className="text-[#9CA6A0] font-mono text-lg tracking-widest uppercase transition-all duration-300 drop-shadow-sm font-semibold">
        {getSubtext(timeLeft)}
      </p>
    </div>
  );
}

export default function V3AuctionPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;

  const { state, loading, error, refresh, animation, triggerAnimation } = useV3AuctionContext();
  const [myTeam, setMyTeam] = useState<V3Team | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshedRef = useRef(false);
  const lastRoomIdRef = useRef(roomId);

  // If opening auction page with cached null auction state (e.g. non-host navigated from lobby),
  // perform one fresh fetch to replace stale null state before showing an error.
  useEffect(() => {
    if (lastRoomIdRef.current !== roomId) {
      lastRoomIdRef.current = roomId;
      refreshedRef.current = false;
    }

    let isMounted = true;

    if (!state.auction && !refreshedRef.current) {
      refreshedRef.current = true;
      setIsRefreshing(true);
      refresh()
        .catch((err) => {
          console.error('Failed to refresh auction state on mount:', err);
        })
        .finally(() => {
          if (isMounted) {
            setIsRefreshing(false);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [roomId, state.auction, refresh]);

  useEffect(() => {
    async function loadUser() {
      const profile = await getCurrentProfile();
      if (profile) {
        import('@/lib/rooms').then(({ getRoomParticipants, getRoomById }) => {
          getRoomById(roomId).then(room => {
            if (room) {
              setIsHost(room.host_id === profile.id);
            }
          });
          if (state.teams.length > 0) {
            getRoomParticipants(roomId).then(parts => {
              const myPart = parts.find(p => p.user_id === profile.id);
              if (myPart && myPart.team_id) {
                const team = state.teams.find(t => t.id === myPart.team_id);
                setMyTeam(team || null);
              }
            });
          }
        }).catch(err => console.error("Error loading participants/room:", err));
      }
    }
    if (!loading) {
      loadUser();
    }
  }, [roomId, state.teams, loading]);


  const handlePauseAuction = async () => {
    if (!isHost || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/auction/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId: state.auction?.id })
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to pause auction');
      }
      await refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResumeAuction = async () => {
    if (!isHost || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/auction/resume-countdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId: state.auction?.id })
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to resume auction');
      }
      await refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    if (animation) {
      console.log(`[ TRACE 3 ] ${Date.now()} | page.tsx received animation | lot_id: ${animation.lot.id}`);
    }
  }, [animation]);

  const isMiniAuctionActive = Boolean(
    state.auction && (
      state.auction.status === 'MINI_AUCTION' ||
      (state.miniSession &&
        state.miniSession.status !== 'COMPLETED' &&
        (state.currentLot?.is_mini_round || state.miniSession.status === 'BIDDING'))
    )
  );

  useEffect(() => {
    if (isMiniAuctionActive) {
      router.push(`/rooms/${roomId}/mini-auction`);
    }
  }, [isMiniAuctionActive, roomId, router]);

  if (loading || isRefreshing) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col items-center justify-center space-y-4 p-4 sm:p-12">
        <Loader2 className="w-10 h-10 animate-spin text-[#C9A227]" />
        <p className="text-sm font-mono-numbers text-[#9CA6A0] uppercase tracking-widest">
          SYNCING V3 AUCTION STATE...
        </p>
      </div>
    );
  }

  if (error || !state.auction) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#B8322E]/10 border-2 border-[#B8322E]/40 p-6 rounded-2xl flex flex-col items-center text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-[#B8322E]" />
          <div>
            <h2 className="text-xl font-bold text-[#F3F4F1] mb-2 uppercase">Auction Error</h2>
            <p className="text-[#B8322E] font-mono text-sm">{error || 'Auction not found'}</p>
          </div>
          <button
            onClick={() => router.push(`/rooms/${roomId}`)}
            className="px-6 py-2 bg-[#141917] border border-[#2A312D] text-[#F3F4F1] rounded-xl hover:bg-[#1E2522] transition-colors"
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  // Not started yet?
  if (state.auction.status === 'LOBBY' || state.auction.status === 'READY' || state.auction.status === 'STARTING') {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col">
        <Navbar auctionRoom />
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <p className="text-[#9CA6A0] font-mono uppercase tracking-widest mb-4">Waiting for auction to start...</p>
          <button
            onClick={() => router.push(`/rooms/${roomId}`)}
            className="flex min-h-11 items-center space-x-2 rounded-lg border border-[#2A312D] bg-[#141917] px-4 py-2 text-sm font-mono text-[#F3F4F1] hover:bg-[#1E2522] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>BACK TO LOBBY</span>
          </button>
        </div>
      </div>
    );
  }

  if (isMiniAuctionActive) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col items-center justify-center space-y-4 p-4 sm:p-12">
        <Loader2 className="w-10 h-10 animate-spin text-[#C9A227]" />
        <p className="text-sm font-mono-numbers text-[#9CA6A0] uppercase tracking-widest">
          TRANSITIONING TO MINI AUCTION...
        </p>
      </div>
    );
  }

  // Completed auction?
  if (state.auction.status === 'COMPLETED') {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col text-[#F3F4F1]">
        {animation && <V3ResultAnimation animation={animation} teams={state.teams} responsive />}
        <Navbar auctionRoom />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
          <div className="w-20 h-20 rounded-full bg-[#C9A227]/10 border border-[#C9A227]/30 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(201,162,39,0.15)]">
            <Trophy className="w-10 h-10 text-[#C9A227]" />
          </div>
          <h2 className="text-3xl font-bold font-mono text-[#F3F4F1] uppercase tracking-wider mb-3">
            Auction Completed
          </h2>
          <p className="text-[#9CA6A0] font-mono text-sm leading-relaxed mb-8">
            All lots have concluded. The official auction results, team squad rosters, purse analytics, and player histories are now finalized.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 w-full">
            <button
              onClick={() => router.push(`/rooms/${roomId}/summary`)}
              className="flex min-h-11 flex-1 items-center justify-center space-x-2 rounded-xl bg-gradient-to-b from-[#C9A227] to-[#B38D1C] px-6 py-3.5 text-sm font-mono font-bold uppercase tracking-wider text-[#0B0F0D] shadow-[0_0_20px_rgba(201,162,39,0.25)] transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3F4F1] motion-reduce:transition-none"
            >
              <span>VIEW SUMMARY &amp; RESULTS</span>
            </button>
            <button
              onClick={() => router.push(`/rooms/${roomId}`)}
              className="min-h-11 rounded-xl border border-[#2A312D] bg-[#141917] px-6 py-3.5 text-sm font-mono uppercase tracking-wider text-[#9CA6A0] transition-colors hover:border-[#3A433E] hover:text-[#F3F4F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F] motion-reduce:transition-none"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F0D] flex flex-col text-[#F3F4F1] selection:bg-[#C9A227]/30">
      {animation && (
        (() => {
          console.log(`[ TRACE 4 ] ${Date.now()} | Immediately before rendering V3ResultAnimation | lot_id: ${animation.lot.id}`);
          return <V3ResultAnimation animation={animation} teams={state.teams} responsive />;
        })()
      )}

      <Navbar auctionRoom />

      <main className="mx-auto flex min-w-0 w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-5 pb-32 sm:px-6 sm:py-5 sm:pb-8 lg:px-8">

        {/* Navigation & Host Controls */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={() => router.push('/dashboard')}
            className="group flex min-h-11 items-center space-x-2 rounded-lg border border-transparent bg-[#141917]/50 px-3 py-2 text-sm font-mono text-[#9CA6A0] transition-colors hover:border-[#2A312D] hover:text-[#C9A227] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F0D] sm:text-xs"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span>BACK TO DASHBOARD</span>
          </button>

          {isHost && (
            <div className="flex items-center space-x-2 sm:justify-end">
              {state.auction.status === 'IN_PROGRESS' && (
                <button
                  onClick={handlePauseAuction}
                  disabled={actionLoading}
                  className="group relative min-h-11 overflow-hidden rounded-xl border border-[#B8322E]/30 bg-[#141917] px-5 py-2 transition-all duration-300 hover:border-[#B8322E] hover:shadow-[0_0_15px_rgba(184,50,46,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F0D] disabled:opacity-50 motion-reduce:transition-none"
                >
                  <div className="absolute inset-0 w-0 bg-[#B8322E]/10 transition-all duration-300 ease-out group-hover:w-full"></div>
                  <div className="relative flex items-center space-x-2">
                    <div className="w-2 h-2 rounded-full bg-[#B8322E] group-hover:animate-pulse"></div>
                    <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#F3F4F1]">
                      {actionLoading ? 'PAUSING...' : 'PAUSE AUCTION'}
                    </span>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* PAUSED OVERLAY */}
        {state.auction.status === 'PAUSED' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-[#0B0F0D]/70 p-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-md transition-all duration-500 motion-reduce:transition-none">
            <div className="my-auto flex max-h-full w-full max-w-lg flex-col items-center overflow-y-auto rounded-3xl border border-[#C9A227]/30 bg-[#141917] p-5 text-center shadow-[0_0_50px_rgba(0,0,0,0.5)] sm:p-8">

              {(() => {
                let resumeTime: number | null = null;
                try {
                  const parsed = state.auction.paused_reason ? JSON.parse(state.auction.paused_reason) : null;
                  resumeTime = parsed?.resume_expires_at || null;
                } catch(e) {}

                if (resumeTime) {
                  return (
                    <div className="w-full">
                      <ResumingCountdown
                        targetMs={resumeTime}
                        onComplete={() => {
                          refresh();
                        }}
                      />
                    </div>
                  );
                }

                return (
                  <>
                    <div className="w-16 h-16 rounded-full bg-[#C9A227]/10 flex items-center justify-center mb-6">
                      <div className="w-6 h-6 border-l-4 border-r-4 border-[#C9A227] animate-pulse"></div>
                    </div>
                    <h2 className="text-3xl font-bold font-mono text-[#F3F4F1] uppercase tracking-widest mb-2 drop-shadow-md">
                      Auction Paused
                    </h2>

                    <div className="w-full flex flex-col items-center mt-4">
                      {isHost ? (
                        <>
                          <p className="text-[#9CA6A0] font-mono mb-8 leading-relaxed text-sm">
                            The auction is temporarily paused.<br/>
                            Your current auction state has been preserved.
                          </p>
                          <button
                            onClick={handleResumeAuction}
                            disabled={actionLoading}
                          className="group relative min-h-11 w-full overflow-hidden rounded-xl bg-gradient-to-b from-[#C9A227] to-[#B38D1C] py-4 text-xl font-mono font-black uppercase tracking-wider text-[#0B0F0D] shadow-[0_0_30px_rgba(201,162,39,0.2)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_40px_rgba(201,162,39,0.4)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3F4F1] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                          >
                            <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-500 ease-in-out"></div>
                            {actionLoading ? 'RESUMING...' : '▶ RESUME AUCTION'}
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-[#9CA6A0] font-mono mb-6 leading-relaxed text-sm">
                            The host has temporarily paused the auction.<br/>
                            Please wait for the host to resume.
                          </p>
                          <div className="px-4 py-2 border border-[#2A312D] rounded-lg bg-[#0B0F0D]/50 text-[#8B938E] text-xs font-mono uppercase tracking-widest">
                            STATUS: Auction Paused
                          </div>
                        </>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            MAIN TWO-COLUMN LAYOUT
            Left:  Player Card (with embedded stats)
            Right: Timer + Bid Panel (auction panel)
            ═══════════════════════════════════════════════════ */}
        <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] lg:grid-cols-[minmax(0,1fr)_360px]">

          {/* LEFT: Player Card (includes stats via V3PlayerStats) */}
          <div className="min-w-0">
            {state.currentPlayer && state.currentLot ? (
              <V3PlayerCard player={state.currentPlayer} responsive />
            ) : (
              <div className="h-full min-h-[220px] border-2 border-dashed border-[#2A312D] rounded-2xl bg-[#141917]/50 flex items-center justify-center">
                <span className="font-mono text-[#8B938E] uppercase tracking-widest text-sm">Waiting for next player...</span>
              </div>
            )}
          </div>

          {/* RIGHT: Auction Panel — Timer + Bid Panel */}
          <div className="flex min-w-0 flex-col gap-4">
            {/* Bid Panel */}
            {state.currentLot ? (
              <V3BidPanel
                lot={state.currentLot}
                teams={state.teams}
                myTeam={myTeam}
                auctionId={state.auction.id}
                onBidSuccess={refresh}
                timer={<V3Timer lot={state.currentLot} auction={state.auction} compact />}
                responsive
              />
            ) : (
              <div className="flex-1 border-2 border-dashed border-[#2A312D] rounded-2xl bg-[#141917]/50 flex items-center justify-center py-10">
                <span className="font-mono text-[#8B938E] uppercase tracking-widest text-sm">No active lot.</span>
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM: Teams overview */}
        <div className="w-full pb-8">
          <V3Teams teams={state.teams} lot={state.currentLot} responsive />
        </div>

      </main>
    </div>
  );
}
