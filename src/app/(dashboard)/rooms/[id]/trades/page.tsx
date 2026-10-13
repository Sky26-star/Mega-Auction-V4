'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useV3AuctionState } from '@/hooks/useV3AuctionState';
import { useV3Squad } from '@/hooks/useV3Squad';
import { useV3Trades } from '@/hooks/useV3Trades';
import { Navbar } from '@/components/layout/navbar';
import {
  evaluateTradeFairness,
  validateTradeConstraints,
  DEFAULT_MAX_SQUAD_SIZE,
  DEFAULT_MAX_OVERSEAS,
} from '@/lib/trade/trade-valuation-engine';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';
import type { TradeRecord } from '@/lib/trade/trade-types';
import {
  ArrowLeftRight,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Sparkles,
  Users,
  AlertCircle,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  HelpCircle,
  ChevronRight,
  Bot,
  User,
  ExternalLink,
} from 'lucide-react';

export default function TradeCenterPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;

  // 1. Live Auction and Mini State
  const { state, loading: stateLoading, error: stateError, refresh } = useV3AuctionState(roomId);
  const auctionId = state.auction?.id || null;

  // 2. Squad Data (authoritative squad_players)
  const { squadPlayers, loading: squadLoading, refresh: refreshSquad } = useV3Squad(auctionId);

  // 3. User Franchise Resolution
  const teams = useMemo(() => state.teams || [], [state.teams]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');

  useEffect(() => {
    if (teams.length > 0 && !selectedTeamId) {
      // Default to first non-bot team if possible, else first team
      const humanTeam = teams.find(t => !t.is_bot);
      setSelectedTeamId(humanTeam ? humanTeam.id : teams[0]!.id);
    }
  }, [teams, selectedTeamId]);

  const currentTeam = useMemo(
    () => teams.find(t => t.id === selectedTeamId) || null,
    [teams, selectedTeamId]
  );

  // 4. Trade Realtime Hook
  const {
    trades,
    activeTrades,
    completedTrades,
    receivedOffers,
    sentOffers,
    loading: tradesLoading,
    submitting,
    error: tradeError,
    refresh: refreshTrades,
    proposeTrade,
    respondTrade,
    triggerBotResponse,
  } = useV3Trades(auctionId, selectedTeamId);

  // 5. Active Tab
  const [activeTab, setActiveTab] = useState<'DESK' | 'NEGOTIATIONS' | 'LEDGER'>('DESK');

  // 6. Offer Builder State
  const [targetTeamId, setTargetTeamId] = useState<string>('');
  const [offeredPlayerIds, setOfferedPlayerIds] = useState<string[]>([]);
  const [requestedPlayerIds, setRequestedPlayerIds] = useState<string[]>([]);
  const [proposerNotes, setProposerNotes] = useState<string>('');
  const [parentTradeId, setParentTradeId] = useState<string | null>(null);

  // Feedback alerts
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Auto-dismiss alerts
  useEffect(() => {
    if (feedbackSuccess) {
      const timer = setTimeout(() => setFeedbackSuccess(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [feedbackSuccess]);

  // Set default target team once currentTeam is resolved
  useEffect(() => {
    if (teams.length > 1 && (!targetTeamId || targetTeamId === selectedTeamId)) {
      const partner = teams.find(t => t.id !== selectedTeamId);
      if (partner) setTargetTeamId(partner.id);
    }
  }, [teams, selectedTeamId, targetTeamId]);

  const targetTeam = useMemo(
    () => teams.find(t => t.id === targetTeamId) || null,
    [teams, targetTeamId]
  );

  // Map squads by team
  const currentTeamRoster = useMemo(
    () =>
      squadPlayers
        .filter(p => (p.team_id || p.winning_team_id) === selectedTeamId)
        .map(p => p.player)
        .filter(Boolean),
    [squadPlayers, selectedTeamId]
  );

  const targetTeamRoster = useMemo(
    () =>
      squadPlayers
        .filter(p => (p.team_id || p.winning_team_id) === targetTeamId)
        .map(p => p.player)
        .filter(Boolean),
    [squadPlayers, targetTeamId]
  );

  // Selected player objects
  const offeredPlayers = useMemo(
    () => currentTeamRoster.filter(p => offeredPlayerIds.includes(p.id)),
    [currentTeamRoster, offeredPlayerIds]
  );

  const requestedPlayers = useMemo(
    () => targetTeamRoster.filter(p => requestedPlayerIds.includes(p.id)),
    [targetTeamRoster, requestedPlayerIds]
  );

  // Evaluate Trade Fairness live
  const fairnessResult = useMemo(() => {
    if (!currentTeam || !targetTeam || offeredPlayers.length === 0 || requestedPlayers.length === 0) {
      return null;
    }
    return evaluateTradeFairness({
      proposerTeam: currentTeam,
      receiverTeam: targetTeam,
      proposerPlayers: offeredPlayers,
      receiverPlayers: requestedPlayers,
      proposerRoster: currentTeamRoster,
      receiverRoster: targetTeamRoster,
    });
  }, [currentTeam, targetTeam, offeredPlayers, requestedPlayers, currentTeamRoster, targetTeamRoster]);

  // Validation
  const validationResult = useMemo(() => {
    if (!currentTeam || !targetTeam || offeredPlayers.length === 0 || requestedPlayers.length === 0) {
      return null;
    }
    return validateTradeConstraints({
      proposerTeam: currentTeam,
      receiverTeam: targetTeam,
      proposerPlayers: offeredPlayers,
      receiverPlayers: requestedPlayers,
    });
  }, [currentTeam, targetTeam, offeredPlayers, requestedPlayers]);

  // 7. Check Unlock Conditions
  const isAuctionCompleted = state.auction?.status === 'COMPLETED';
  const isMiniCompleted = !state.miniSession || state.miniSession.status === 'COMPLETED';
  const isTradeUnlocked = isAuctionCompleted && isMiniCompleted;

  // Handlers
  const toggleOfferedPlayer = (playerId: string) => {
    if (offeredPlayerIds.includes(playerId)) {
      setOfferedPlayerIds(prev => prev.filter(id => id !== playerId));
    } else {
      if (offeredPlayerIds.length >= 3) {
        setFeedbackError('Maximum 3 players can be offered per trade.');
        return;
      }
      setOfferedPlayerIds(prev => [...prev, playerId]);
    }
  };

  const toggleRequestedPlayer = (playerId: string) => {
    if (requestedPlayerIds.includes(playerId)) {
      setRequestedPlayerIds(prev => prev.filter(id => id !== playerId));
    } else {
      if (requestedPlayerIds.length >= 3) {
        setFeedbackError('Maximum 3 players can be requested per trade.');
        return;
      }
      setRequestedPlayerIds(prev => [...prev, playerId]);
    }
  };

  const handleProposeTrade = async () => {
    setFeedbackError(null);
    setFeedbackSuccess(null);

    if (!targetTeam || !currentTeam) return;
    if (offeredPlayers.length === 0 || requestedPlayers.length === 0) {
      setFeedbackError('Select at least one player to give and one player to receive.');
      return;
    }

    if (validationResult && !validationResult.valid) {
      setFeedbackError(validationResult.error || 'Trade violates roster constraints.');
      return;
    }

    const res = await proposeTrade(
      {
        receiverTeamId: targetTeam.id,
        proposerPlayerIds: offeredPlayerIds,
        receiverPlayerIds: requestedPlayerIds,
        notes: proposerNotes,
        parentTradeId,
      },
      fairnessResult || undefined
    );

    if (res.success) {
      setFeedbackSuccess(
        parentTradeId
          ? 'Counter-offer submitted successfully!'
          : 'Trade proposal sent successfully to ' + targetTeam.name
      );
      // Reset form
      setOfferedPlayerIds([]);
      setRequestedPlayerIds([]);
      setProposerNotes('');
      setParentTradeId(null);
      setActiveTab('NEGOTIATIONS');

      // If target is bot, trigger automatic evaluation after short delay
      if (targetTeam.is_bot && res.trade_id) {
        setTimeout(async () => {
          const matchingTrade = trades.find(t => t.id === res.trade_id) || ({
            id: res.trade_id,
            receiver_team: targetTeam,
            status: 'PENDING',
          } as TradeRecord);
          await triggerBotResponse(matchingTrade);
          refreshTrades();
          refreshSquad();
        }, 1200);
      }
    } else {
      setFeedbackError(res.error || 'Failed to submit proposal.');
    }
  };

  const handleRespondTrade = async (tradeId: string, action: 'ACCEPT' | 'REJECT' | 'CANCEL') => {
    setFeedbackError(null);
    setFeedbackSuccess(null);

    const res = await respondTrade(tradeId, action);
    if (res.success) {
      setFeedbackSuccess(`Trade proposal ${action.toLowerCase()}ed.`);
      refreshSquad();
      refreshTrades();
    } else {
      setFeedbackError(res.error || `Failed to ${action.toLowerCase()} trade.`);
    }
  };

  const handleStartCounterOffer = (trade: TradeRecord) => {
    // Propose counter back to original proposer
    setTargetTeamId(trade.proposer_team_id);
    // Pre-populate with inverted players
    setOfferedPlayerIds(trade.receiver_player_ids || []);
    setRequestedPlayerIds(trade.proposer_player_ids || []);
    setParentTradeId(trade.id);
    setProposerNotes(`Counter to terms: ${trade.proposer_notes || ''}`);
    setActiveTab('DESK');
  };

  const handleSimulateBot = async (trade: TradeRecord) => {
    setFeedbackError(null);
    setFeedbackSuccess(null);

    const botRoster = squadPlayers
      .filter(p => (p.team_id || p.winning_team_id) === trade.receiver_team_id)
      .map(p => p.player)
      .filter(Boolean);

    const propRoster = squadPlayers
      .filter(p => (p.team_id || p.winning_team_id) === trade.proposer_team_id)
      .map(p => p.player)
      .filter(Boolean);

    const res = await triggerBotResponse(trade, botRoster, propRoster);
    if (res.handled) {
      setFeedbackSuccess(`Bot response processed: ${res.decision} — ${res.reason}`);
      refreshSquad();
      refreshTrades();
    } else {
      setFeedbackError(res.reason ? `Could not process bot decision: ${res.reason}` : 'Could not process bot decision.');
    }
  };

  // Loading Screen
  if (stateLoading || squadLoading) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col items-center justify-center p-12 space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#C9A227]" />
        <p className="text-sm font-mono text-[#9CA6A0] uppercase tracking-widest">
          ESTABLISHING SECURE TRADE CONDUIT...
        </p>
      </div>
    );
  }

  // Error Screen
  if (stateError || !state.auction) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#B8322E]/10 border-2 border-[#B8322E]/40 p-6 rounded-2xl flex flex-col items-center text-center space-y-4">
            <AlertCircle className="w-10 h-10 text-[#B8322E]" />
            <div>
              <h2 className="text-xl font-bold text-[#F3F4F1] mb-2 uppercase">Trade Center Unavailable</h2>
              <p className="text-[#B8322E] font-mono text-sm">{stateError || 'Auction data not found.'}</p>
            </div>
            <button
              onClick={() => router.push(`/rooms/${roomId}`)}
              className="px-6 py-2 bg-[#141917] border border-[#2A312D] text-[#F3F4F1] rounded-xl hover:bg-[#1E2522] transition-colors"
            >
              Return to Room Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Locked State Screen
  if (!isTradeUnlocked) {
    return (
      <div className="min-h-screen bg-[#0B0F0D] flex flex-col text-[#F3F4F1]">
        <Navbar />
        <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-16 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-[#C9A227]/10 border border-[#C9A227]/30 flex items-center justify-center mb-6">
            <ShieldAlert className="w-10 h-10 text-[#C9A227]" />
          </div>

          <span className="text-xs font-mono uppercase tracking-widest text-[#C9A227] px-3 py-1 rounded-full bg-[#C9A227]/10 border border-[#C9A227]/20 mb-3">
            TRADING WINDOW CURRENTLY LOCKED
          </span>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight uppercase mb-4">
            Franchise Trade Desk Locked
          </h1>

          <p className="text-sm sm:text-base text-[#9CA6A0] max-w-xl mx-auto mb-8 leading-relaxed font-sans">
            Player-to-player transfers are unavailable while active bidding is underway. The Trade Window unlocks authoritatively once both the <strong className="text-[#F3F4F1]">Mega Auction</strong> and the <strong className="text-[#F3F4F1]">Mini Auction</strong> have fully concluded.
          </p>

          <div className="w-full max-w-md bg-[#141917] border border-[#2A312D] rounded-xl p-5 mb-8 text-left space-y-3 font-mono text-xs">
            <div className="flex justify-between items-center py-1 border-b border-[#2A312D]/60">
              <span className="text-[#9CA6A0]">Mega Auction Status:</span>
              <span className={isAuctionCompleted ? 'text-[#10B981]' : 'text-[#C9A227]'}>
                {state.auction.status}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-[#2A312D]/60">
              <span className="text-[#9CA6A0]">Mini Auction Status:</span>
              <span className={isMiniCompleted ? 'text-[#10B981]' : 'text-[#C9A227]'}>
                {state.miniSession?.status || 'NOT_APPLICABLE'}
              </span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-[#9CA6A0]">Trade Window Gate:</span>
              <span className="text-[#B8322E] uppercase font-bold">LOCKED UNTIL CONCLUSION</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 justify-center">
            <button
              onClick={() => router.push(`/rooms/${roomId}/auction`)}
              className="px-6 py-3 bg-[#C9A227] text-[#0B0F0D] font-bold rounded-xl hover:bg-[#d8af2c] transition-colors uppercase text-xs tracking-wider flex items-center space-x-2"
            >
              <span>ENTER AUCTION ARENA</span>
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => router.push(`/rooms/${roomId}`)}
              className="px-6 py-3 bg-[#141917] border border-[#2A312D] text-[#F3F4F1] font-mono rounded-xl hover:bg-[#1E2522] transition-colors text-xs"
            >
              Return to Lobby
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Active Trade Center Interface
  return (
    <div className="min-h-screen bg-[#0B0F0D] flex flex-col text-[#F3F4F1] selection:bg-[#C9A227]/30">
      <Navbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col animate-in fade-in duration-300">
        {/* Header & Controls */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8 border-b border-[#2A312D] pb-6">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <span className="text-xs font-mono uppercase tracking-widest text-[#10B981] px-2.5 py-0.5 rounded-full bg-[#10B981]/10 border border-[#10B981]/20 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
                TRADE WINDOW OPEN
              </span>
              <span className="text-xs font-mono text-[#9CA6A0]">ROOM #{roomId.slice(0, 8).toUpperCase()}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight uppercase flex items-center gap-3">
              <ArrowLeftRight className="w-8 h-8 text-[#C9A227]" />
              Franchise Trade Desk
            </h1>
            <p className="text-sm text-[#9CA6A0] mt-1 font-sans">
              Propose and execute player exchanges across franchises with zero-budget deterministic fair valuation.
            </p>
          </div>

          {/* Franchise Selector & Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center space-x-2 bg-[#141917] border border-[#2A312D] px-3 py-1.5 rounded-xl">
              <span className="text-xs font-mono text-[#9CA6A0]">Acting As:</span>
              <select
                value={selectedTeamId}
                onChange={e => setSelectedTeamId(e.target.value)}
                className="bg-transparent text-xs font-bold text-[#C9A227] outline-none cursor-pointer"
              >
                {teams.map(t => (
                  <option key={t.id} value={t.id} className="bg-[#141917] text-[#F3F4F1]">
                    {t.name} {t.is_bot ? '(BOT)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => router.push(`/rooms/${roomId}/summary`)}
              className="px-3 py-1.5 bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/60 text-xs font-mono text-[#9CA6A0] hover:text-[#F3F4F1] rounded-xl transition-colors flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Summary</span>
            </button>

            <button
              onClick={() => router.push(`/rooms/${roomId}/squad`)}
              className="px-3 py-1.5 bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/60 text-xs font-mono text-[#9CA6A0] hover:text-[#F3F4F1] rounded-xl transition-colors flex items-center gap-1.5"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Squad Roster</span>
            </button>
          </div>
        </div>

        {/* Global Feedback Banner */}
        {feedbackSuccess && (
          <div className="mb-6 p-4 rounded-xl bg-[#10B981]/10 border border-[#10B981]/40 text-[#10B981] flex items-center justify-between text-sm font-mono animate-in fade-in">
            <div className="flex items-center space-x-3">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span>{feedbackSuccess}</span>
            </div>
            <button onClick={() => setFeedbackSuccess(null)} className="text-[#10B981] hover:text-white">
              ✕
            </button>
          </div>
        )}

        {feedbackError && (
          <div className="mb-6 p-4 rounded-xl bg-[#B8322E]/10 border border-[#B8322E]/40 text-[#B8322E] flex items-center justify-between text-sm font-mono animate-in fade-in">
            <div className="flex items-center space-x-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{feedbackError}</span>
            </div>
            <button onClick={() => setFeedbackError(null)} className="text-[#B8322E] hover:text-white">
              ✕
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-[#2A312D] mb-8 space-x-6">
          <button
            onClick={() => setActiveTab('DESK')}
            className={`pb-3 text-xs sm:text-sm font-mono uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'DESK'
                ? 'border-[#C9A227] text-[#C9A227] font-bold'
                : 'border-transparent text-[#9CA6A0] hover:text-[#F3F4F1]'
            }`}
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>TRADE DESK (BUILDER)</span>
          </button>

          <button
            onClick={() => setActiveTab('NEGOTIATIONS')}
            className={`pb-3 text-xs sm:text-sm font-mono uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all relative ${
              activeTab === 'NEGOTIATIONS'
                ? 'border-[#C9A227] text-[#C9A227] font-bold'
                : 'border-transparent text-[#9CA6A0] hover:text-[#F3F4F1]'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>ACTIVE OFFERS</span>
            {receivedOffers.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-[#C9A227] text-[#0B0F0D] text-[10px] font-bold flex items-center justify-center">
                {receivedOffers.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('LEDGER')}
            className={`pb-3 text-xs sm:text-sm font-mono uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'LEDGER'
                ? 'border-[#C9A227] text-[#C9A227] font-bold'
                : 'border-transparent text-[#9CA6A0] hover:text-[#F3F4F1]'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>TRADE LEDGER ({completedTrades.length})</span>
          </button>
        </div>

        {/* TAB 1: TRADE DESK / OFFER BUILDER */}
        {activeTab === 'DESK' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            {parentTradeId && (
              <div className="p-4 rounded-xl bg-[#C9A227]/10 border border-[#C9A227]/40 flex items-center justify-between">
                <div className="flex items-center space-x-3 text-xs font-mono text-[#C9A227]">
                  <Sparkles className="w-4 h-4" />
                  <span>COUNTER-OFFER MODE: Modifying terms for previous trade offer.</span>
                </div>
                <button
                  onClick={() => {
                    setParentTradeId(null);
                    setOfferedPlayerIds([]);
                    setRequestedPlayerIds([]);
                    setProposerNotes('');
                  }}
                  className="text-xs font-mono text-[#9CA6A0] hover:text-[#F3F4F1] underline"
                >
                  Clear Counter Mode
                </button>
              </div>
            )}

            {/* Franchise Exchange Header */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center bg-[#141917] p-5 rounded-2xl border border-[#2A312D]">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#9CA6A0]">
                  Your Franchise
                </span>
                <div className="flex items-center space-x-3 mt-1">
                  <span
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: (currentTeam as any)?.color || '#C9A227' }}
                  />
                  <h2 className="text-xl font-bold">{currentTeam?.name}</h2>
                  <span className="text-xs font-mono text-[#9CA6A0]">
                    ({currentTeamRoster.length} players, {currentTeam?.overseas_count} overseas)
                  </span>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#9CA6A0]">
                  Target Trade Partner
                </span>
                <div className="flex items-center space-x-3 mt-1">
                  <select
                    value={targetTeamId}
                    onChange={e => {
                      setTargetTeamId(e.target.value);
                      setRequestedPlayerIds([]);
                    }}
                    className="w-full bg-[#1A201D] border border-[#2A312D] rounded-xl px-4 py-2.5 text-sm font-bold text-[#F3F4F1] focus:border-[#C9A227] outline-none cursor-pointer"
                  >
                    {teams
                      .filter(t => t.id !== selectedTeamId)
                      .map(t => (
                        <option key={t.id} value={t.id} className="bg-[#141917]">
                          {t.name} {t.is_bot ? '(BOT)' : ''} — {t.players_bought} players
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 3-Column Offer Builder */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Your Roster (Select up to 3) */}
              <div className="lg:col-span-4 bg-[#141917] border border-[#2A312D] rounded-2xl p-5 space-y-4">
                <div className="flex justify-between items-center border-b border-[#2A312D] pb-3">
                  <div>
                    <h3 className="font-bold text-sm uppercase tracking-wide">
                      Select Players to Give
                    </h3>
                    <p className="text-[11px] font-mono text-[#9CA6A0]">
                      {offeredPlayerIds.length}/3 Selected
                    </p>
                  </div>
                  {offeredPlayerIds.length > 0 && (
                    <button
                      onClick={() => setOfferedPlayerIds([])}
                      className="text-[10px] font-mono text-[#B8322E] hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {currentTeamRoster.length === 0 ? (
                  <p className="text-xs font-mono text-[#9CA6A0] py-6 text-center">
                    No players in roster.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                    {currentTeamRoster.map(player => {
                      const isSelected = offeredPlayerIds.includes(player.id);
                      return (
                        <div
                          key={player.id}
                          onClick={() => toggleOfferedPlayer(player.id)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                            isSelected
                              ? 'bg-[#C9A227]/15 border-[#C9A227] shadow-sm'
                              : 'bg-[#181F1B] border-[#2A312D]/80 hover:border-[#2A312D]'
                          }`}
                        >
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-xs">{player.name}</span>
                              {player.is_overseas && (
                                <span className="text-[9px] font-mono px-1 py-0.2 bg-[#2A312D] text-[#9CA6A0] rounded">
                                  OS
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono text-[#9CA6A0]">
                              {player.role} • Base ₹{player.base_price}L
                            </span>
                          </div>

                          <span
                            className={`w-5 h-5 rounded-md flex items-center justify-center text-xs font-mono font-bold ${
                              isSelected
                                ? 'bg-[#C9A227] text-[#0B0F0D]'
                                : 'border border-[#2A312D] text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Middle Column: Valuation & Deal Balance */}
              <div className="lg:col-span-4 bg-[#141917] border border-[#2A312D] rounded-2xl p-5 space-y-5">
                <div className="text-center border-b border-[#2A312D] pb-3">
                  <h3 className="font-bold text-sm uppercase tracking-wide flex items-center justify-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#C9A227]" />
                    Fair-Value Intelligence
                  </h3>
                  <p className="text-[11px] font-mono text-[#9CA6A0]">
                    Deterministic Valuation & Fit
                  </p>
                </div>

                {!fairnessResult ? (
                  <div className="py-12 text-center text-xs font-mono text-[#9CA6A0] space-y-2">
                    <ArrowLeftRight className="w-8 h-8 text-[#2A312D] mx-auto" />
                    <p>Select at least one player on each side to compute fair-value balance.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Visual Meter */}
                    <div>
                      <div className="flex justify-between items-center text-xs font-mono mb-1.5">
                        <span className="text-[#9CA6A0]">Acceptance Likelihood:</span>
                        <span
                          className={`font-bold ${
                            fairnessResult.acceptanceLikelihood >= 70
                              ? 'text-[#10B981]'
                              : fairnessResult.acceptanceLikelihood >= 40
                              ? 'text-[#C9A227]'
                              : 'text-[#B8322E]'
                          }`}
                        >
                          {fairnessResult.acceptanceLikelihood}%
                        </span>
                      </div>
                      <div className="w-full bg-[#1A201D] h-2.5 rounded-full overflow-hidden border border-[#2A312D]">
                        <div
                          className={`h-full transition-all duration-500 ${
                            fairnessResult.acceptanceLikelihood >= 70
                              ? 'bg-[#10B981]'
                              : fairnessResult.acceptanceLikelihood >= 40
                              ? 'bg-[#C9A227]'
                              : 'bg-[#B8322E]'
                          }`}
                          style={{ width: `${fairnessResult.acceptanceLikelihood}%` }}
                        />
                      </div>
                    </div>

                    {/* Value Comparison Pill */}
                    <div className="bg-[#181F1B] p-3 rounded-xl border border-[#2A312D] space-y-2 text-xs font-mono">
                      <div className="flex justify-between">
                        <span className="text-[#9CA6A0]">You Offer:</span>
                        <span className="font-bold text-[#F3F4F1]">
                          {fairnessResult.proposerGivenValue} pts
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#9CA6A0]">You Request:</span>
                        <span className="font-bold text-[#F3F4F1]">
                          {fairnessResult.proposerReceivedValue} pts
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-[#2A312D] pt-1.5">
                        <span className="text-[#9CA6A0]">Fairness Grade:</span>
                        <span
                          className={`font-bold uppercase ${
                            fairnessResult.fairnessGrade === 'HIGHLY_FAVORABLE'
                              ? 'text-[#10B981]'
                              : fairnessResult.fairnessGrade === 'FAIR'
                              ? 'text-[#C9A227]'
                              : 'text-[#B8322E]'
                          }`}
                        >
                          {fairnessResult.fairnessGrade.replace('_', ' ')}
                        </span>
                      </div>
                    </div>

                    {/* Squad Role Impact */}
                    <div className="bg-[#181F1B] p-3 rounded-xl border border-[#2A312D] space-y-1 text-[11px] font-mono">
                      <p className="text-[#9CA6A0]">
                        {fairnessResult.roleImpact.proposerDeficitFilled
                          ? '✓ Fills a starting deficit on your squad.'
                          : '• Provides depth in existing covered roles.'}
                      </p>
                      <p className="text-[#9CA6A0]">
                        {fairnessResult.roleImpact.receiverDeficitFilled
                          ? `✓ Solves a key roster gap for ${targetTeam?.name}.`
                          : `• Upgrades bench depth for ${targetTeam?.name}.`}
                      </p>
                    </div>

                    {/* Plain Explanation */}
                    <p className="text-[11px] text-[#9CA6A0] italic leading-relaxed">
                      "{fairnessResult.explanation}"
                    </p>

                    {/* Notes Input */}
                    <div>
                      <input
                        type="text"
                        placeholder="Optional trade notes or message..."
                        value={proposerNotes}
                        onChange={e => setProposerNotes(e.target.value)}
                        className="w-full bg-[#181F1B] border border-[#2A312D] rounded-xl px-3 py-2 text-xs text-[#F3F4F1] placeholder-[#9CA6A0]/60 outline-none focus:border-[#C9A227]"
                      />
                    </div>

                    {/* Constraint Alert */}
                    {validationResult && !validationResult.valid && (
                      <div className="p-2.5 rounded-lg bg-[#B8322E]/10 border border-[#B8322E]/40 text-[#B8322E] text-[11px] font-mono">
                        {validationResult.error}
                      </div>
                    )}

                    {/* Submit CTA */}
                    <button
                      onClick={handleProposeTrade}
                      disabled={submitting || (validationResult !== null && !validationResult.valid)}
                      className="w-full py-3 bg-[#C9A227] hover:bg-[#d8af2c] disabled:opacity-50 text-[#0B0F0D] font-bold rounded-xl transition-all uppercase text-xs tracking-wider flex items-center justify-center space-x-2"
                    >
                      {submitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>{parentTradeId ? 'SUBMIT COUNTER-OFFER' : 'PROPOSE TRADE'}</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Right Column: Target Team's Roster (Select up to 3) */}
              <div className="lg:col-span-4 bg-[#141917] border border-[#2A312D] rounded-2xl p-5 space-y-4">
                <div className="flex justify-between items-center border-b border-[#2A312D] pb-3">
                  <div>
                    <h3 className="font-bold text-sm uppercase tracking-wide">
                      Select Players to Receive
                    </h3>
                    <p className="text-[11px] font-mono text-[#9CA6A0]">
                      {requestedPlayerIds.length}/3 Selected
                    </p>
                  </div>
                  {requestedPlayerIds.length > 0 && (
                    <button
                      onClick={() => setRequestedPlayerIds([])}
                      className="text-[10px] font-mono text-[#B8322E] hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {targetTeamRoster.length === 0 ? (
                  <p className="text-xs font-mono text-[#9CA6A0] py-6 text-center">
                    No players in target roster.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                    {targetTeamRoster.map(player => {
                      const isSelected = requestedPlayerIds.includes(player.id);
                      return (
                        <div
                          key={player.id}
                          onClick={() => toggleRequestedPlayer(player.id)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                            isSelected
                              ? 'bg-[#C9A227]/15 border-[#C9A227] shadow-sm'
                              : 'bg-[#181F1B] border-[#2A312D]/80 hover:border-[#2A312D]'
                          }`}
                        >
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-xs">{player.name}</span>
                              {player.is_overseas && (
                                <span className="text-[9px] font-mono px-1 py-0.2 bg-[#2A312D] text-[#9CA6A0] rounded">
                                  OS
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono text-[#9CA6A0]">
                              {player.role} • Base ₹{player.base_price}L
                            </span>
                          </div>

                          <span
                            className={`w-5 h-5 rounded-md flex items-center justify-center text-xs font-mono font-bold ${
                              isSelected
                                ? 'bg-[#C9A227] text-[#0B0F0D]'
                                : 'border border-[#2A312D] text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ACTIVE NEGOTIATIONS */}
        {activeTab === 'NEGOTIATIONS' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            {/* Received Offers */}
            <div className="space-y-4">
              <h2 className="text-lg font-bold uppercase tracking-wide flex items-center gap-2">
                <span>Received Proposals</span>
                <span className="text-xs font-mono text-[#9CA6A0]">
                  ({receivedOffers.length})
                </span>
              </h2>

              {receivedOffers.length === 0 ? (
                <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-8 text-center text-xs font-mono text-[#9CA6A0]">
                  No active trade proposals awaiting your action.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {receivedOffers.map(trade => (
                    <div
                      key={trade.id}
                      className="bg-[#141917] border border-[#C9A227]/40 rounded-2xl p-5 space-y-4 shadow-lg shadow-black/40"
                    >
                      <div className="flex justify-between items-start border-b border-[#2A312D] pb-3">
                        <div>
                          <span className="text-[10px] font-mono text-[#C9A227] uppercase tracking-wider">
                            From: {trade.proposer_team?.name}
                          </span>
                          <h3 className="font-bold text-sm">
                            Trade Offer #{trade.id.slice(0, 8)}
                          </h3>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#C9A227]/10 text-[#C9A227] border border-[#C9A227]/30">
                          {trade.status}
                        </span>
                      </div>

                      {/* Trade Terms Breakdown */}
                      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                        <div className="bg-[#181F1B] p-3 rounded-xl border border-[#2A312D]">
                          <span className="text-[10px] text-[#10B981] font-bold block mb-1">
                            THEY GIVE (YOU GET):
                          </span>
                          <div className="space-y-1">
                            {trade.proposer_players?.map(p => (
                              <div key={p.id} className="text-[#F3F4F1] font-semibold">
                                • {p.name} ({p.role})
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="bg-[#181F1B] p-3 rounded-xl border border-[#2A312D]">
                          <span className="text-[10px] text-[#B8322E] font-bold block mb-1">
                            THEY WANT (YOU GIVE):
                          </span>
                          <div className="space-y-1">
                            {trade.receiver_players?.map(p => (
                              <div key={p.id} className="text-[#F3F4F1] font-semibold">
                                • {p.name} ({p.role})
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {trade.proposer_notes && (
                        <p className="text-xs text-[#9CA6A0] italic">
                          "{trade.proposer_notes}"
                        </p>
                      )}

                      {/* Controls */}
                      <div className="flex items-center gap-2 pt-2 border-t border-[#2A312D]">
                        <button
                          onClick={() => handleRespondTrade(trade.id, 'ACCEPT')}
                          disabled={submitting}
                          className="flex-1 py-2 bg-[#10B981] hover:bg-[#0ea571] text-[#0B0F0D] font-bold rounded-xl text-xs uppercase tracking-wider transition-colors"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleStartCounterOffer(trade)}
                          disabled={submitting}
                          className="flex-1 py-2 bg-[#1A201D] hover:bg-[#2A312D] border border-[#2A312D] text-[#C9A227] font-bold rounded-xl text-xs uppercase tracking-wider transition-colors"
                        >
                          Counter
                        </button>
                        <button
                          onClick={() => handleRespondTrade(trade.id, 'REJECT')}
                          disabled={submitting}
                          className="py-2 px-3 bg-[#B8322E]/20 hover:bg-[#B8322E]/40 text-[#B8322E] border border-[#B8322E]/40 font-bold rounded-xl text-xs uppercase tracking-wider transition-colors"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sent Offers */}
            <div className="space-y-4 pt-6 border-t border-[#2A312D]">
              <h2 className="text-lg font-bold uppercase tracking-wide flex items-center gap-2">
                <span>Sent Proposals</span>
                <span className="text-xs font-mono text-[#9CA6A0]">
                  ({sentOffers.length})
                </span>
              </h2>

              {sentOffers.length === 0 ? (
                <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-8 text-center text-xs font-mono text-[#9CA6A0]">
                  No outbound proposals pending.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sentOffers.map(trade => (
                    <div
                      key={trade.id}
                      className="bg-[#141917] border border-[#2A312D] rounded-2xl p-5 space-y-4"
                    >
                      <div className="flex justify-between items-start border-b border-[#2A312D] pb-3">
                        <div>
                          <span className="text-[10px] font-mono text-[#9CA6A0] uppercase tracking-wider">
                            To: {trade.receiver_team?.name}
                          </span>
                          <h3 className="font-bold text-sm">
                            Proposal #{trade.id.slice(0, 8)}
                          </h3>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#C9A227]/10 text-[#C9A227] border border-[#C9A227]/30">
                          {trade.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                        <div className="bg-[#181F1B] p-2.5 rounded-xl border border-[#2A312D]">
                          <span className="text-[10px] text-[#9CA6A0] block mb-1">YOU GIVE:</span>
                          {trade.proposer_players?.map(p => (
                            <div key={p.id}>• {p.name}</div>
                          ))}
                        </div>
                        <div className="bg-[#181F1B] p-2.5 rounded-xl border border-[#2A312D]">
                          <span className="text-[10px] text-[#9CA6A0] block mb-1">YOU RECEIVE:</span>
                          {trade.receiver_players?.map(p => (
                            <div key={p.id}>• {p.name}</div>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-[#2A312D]">
                        {trade.receiver_team?.is_bot && trade.status === 'PENDING' ? (
                          <button
                            onClick={() => handleSimulateBot(trade)}
                            disabled={submitting}
                            className="px-3 py-1.5 bg-[#C9A227]/10 border border-[#C9A227]/30 hover:bg-[#C9A227]/20 text-xs font-mono text-[#C9A227] rounded-lg flex items-center gap-1.5"
                          >
                            <Bot className="w-3.5 h-3.5" />
                            <span>Simulate Bot Response</span>
                          </button>
                        ) : (
                          <span className="text-[10px] font-mono text-[#9CA6A0]">
                            Awaiting response
                          </span>
                        )}

                        <button
                          onClick={() => handleRespondTrade(trade.id, 'CANCEL')}
                          disabled={submitting}
                          className="px-3 py-1.5 text-xs font-mono text-[#B8322E] hover:underline"
                        >
                          Withdraw Proposal
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: TRADE LEDGER (HISTORY) */}
        {activeTab === 'LEDGER' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <h2 className="text-lg font-bold uppercase tracking-wide">Finalized Trade Log</h2>

            {completedTrades.length === 0 ? (
              <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-12 text-center text-xs font-mono text-[#9CA6A0]">
                No completed trades in room ledger.
              </div>
            ) : (
              <div className="space-y-3">
                {completedTrades.map(trade => {
                  const isAccepted = trade.status === 'ACCEPTED';
                  return (
                    <div
                      key={trade.id}
                      className={`p-4 rounded-xl border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
                        isAccepted
                          ? 'bg-[#10B981]/5 border-[#10B981]/30'
                          : 'bg-[#141917] border-[#2A312D]'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                              isAccepted
                                ? 'bg-[#10B981] text-[#0B0F0D]'
                                : trade.status === 'REJECTED'
                                ? 'bg-[#B8322E]/20 text-[#B8322E]'
                                : 'bg-[#2A312D] text-[#9CA6A0]'
                            }`}
                          >
                            {trade.status}
                          </span>
                          <span className="text-xs font-bold">
                            {trade.proposer_team?.name} ↔ {trade.receiver_team?.name}
                          </span>
                        </div>

                        <div className="text-xs font-mono text-[#9CA6A0] flex flex-wrap gap-x-4">
                          <span>
                            Gave: {trade.proposer_players?.map(p => p.name).join(', ')}
                          </span>
                          <span>
                            Received: {trade.receiver_players?.map(p => p.name).join(', ')}
                          </span>
                        </div>
                      </div>

                      <div className="text-right text-[11px] font-mono text-[#9CA6A0]">
                        <span>{new Date(trade.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
