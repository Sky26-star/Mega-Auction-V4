// src/components/history/player-history-modal.tsx
// Interactive Player History & Lifecycle Audit Modal (Phase 17D)
// Traces complete chronological provenance across Mega Auction, Releases/Refunds, and Mini Auction.

import React, { useState, useEffect, useCallback } from 'react';
import {
  loadPlayerAuctionHistory,
  type PlayerAuctionHistoryRecord,
} from '@/lib/history/loader';
import {
  X,
  Loader2,
  AlertCircle,
  Globe,
  Sparkles,
  Shield,
  ArrowRight,
  TrendingDown,
  RotateCcw,
  CheckCircle2,
  DollarSign,
  Layers,
} from 'lucide-react';

interface PlayerHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  playerId: string | null;
  playerNameFallback?: string;
}

export function PlayerHistoryModal({
  isOpen,
  onClose,
  roomId,
  playerId,
  playerNameFallback,
}: PlayerHistoryModalProps) {
  const [history, setHistory] = useState<PlayerAuctionHistoryRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!playerId || !roomId) return;
    setIsLoading(true);
    setError(null);
    const { data, error: err } = await loadPlayerAuctionHistory(roomId, playerId);
    if (err) {
      setError(err);
    } else {
      setHistory(data);
    }
    setIsLoading(false);
  }, [roomId, playerId]);

  useEffect(() => {
    if (isOpen && playerId && roomId) {
      fetchHistory();
    } else {
      setHistory(null);
      setError(null);
    }
  }, [isOpen, playerId, roomId, fetchHistory]);

  // Accessibility: Escape key dismissal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#0D1220] border border-white/10 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-[#141A2D]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-purple-300 uppercase tracking-widest bg-purple-950/80 border border-purple-500/40 px-2 py-0.5 rounded-full">
                  LIFECYCLE AUDIT TRAIL
                </span>
                <span className="text-[10px] text-zinc-400">PHASE 17D</span>
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight mt-0.5">
                {history?.player.name || playerNameFallback || 'Player Auction History'}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 scrollbar-thin scrollbar-thumb-white/10">
          {isLoading ? (
            <div className="py-16 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-400" />
              <p className="text-xs text-zinc-400 uppercase tracking-widest">
                Compiling Authoritative Player Lifecycle...
              </p>
            </div>
          ) : error ? (
            <div className="p-6 rounded-2xl bg-red-950/40 border border-red-800/40 text-center text-red-300 space-y-3">
              <AlertCircle className="w-6 h-6 mx-auto text-red-400" />
              <p className="text-xs font-bold">{error}</p>
              <button
                onClick={fetchHistory}
                className="px-4 py-1.5 rounded-xl bg-red-800 text-white text-xs font-bold hover:bg-red-700 transition-colors inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          ) : history ? (
            <>
              {/* 1. Identity & Active Ownership Banner */}
              <div className="bg-[#141A2D] border border-white/5 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white uppercase">
                      {history.player.role} • {history.player.category}
                    </span>
                    {history.player.isOverseas && (
                      <span className="bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 text-[8px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Globe className="w-2.5 h-2.5" /> OVERSEAS
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-400 block">
                    Origin: {history.player.country} | Base Price: ₹{history.player.basePriceCr.toFixed(2)} Cr
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[9px] text-zinc-400 block uppercase font-bold">
                    CURRENT OWNERSHIP
                  </span>
                  {history.currentOwnership.isCurrentlyOwned ? (
                    <div className="flex items-center gap-1.5 justify-end mt-0.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-white/20"
                        style={{ backgroundColor: history.currentOwnership.currentTeamColor || '#6B7280' }}
                      />
                      <span className="font-bold text-white text-sm">
                        {history.currentOwnership.currentTeamName}
                      </span>
                      <span className="bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[8px] font-bold px-1.5 py-0.5 rounded ml-1">
                        ₹{history.currentOwnership.purchasePriceCr?.toFixed(2)} Cr ({history.currentOwnership.acquiredVia})
                      </span>
                    </div>
                  ) : (
                    <span className="text-amber-400 font-bold text-xs bg-amber-950/60 border border-amber-500/40 px-2 py-0.5 rounded-md inline-block mt-0.5">
                      FREE AGENT / UNACQUIRED
                    </span>
                  )}
                </div>
              </div>

              {/* 2. Strict Financial Semantics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                {/* Gross Acquisitions */}
                <div className="bg-[#141A2D] border border-amber-500/20 p-3 rounded-2xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-amber-300 uppercase font-bold">GROSS ACQUISITIONS</span>
                    <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="text-base font-black text-amber-300">
                    ₹{history.financialSummary.grossAcquisitionValueCr.toFixed(2)} Cr
                  </div>
                  <span className="text-[8px] text-zinc-400 block">Total hammer price commitments</span>
                </div>

                {/* Release Refunds */}
                <div className="bg-[#141A2D] border border-blue-500/20 p-3 rounded-2xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-blue-300 uppercase font-bold">RELEASE REFUNDS</span>
                    <TrendingDown className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                  <div className="text-base font-black text-blue-300">
                    ₹{history.financialSummary.totalReleaseRefundsCr.toFixed(2)} Cr
                  </div>
                  <span className="text-[8px] text-zinc-400 block">Capital refunded from releases</span>
                </div>

                {/* Net Capital Spend */}
                <div className="bg-[#141A2D] border border-emerald-500/20 p-3 rounded-2xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-emerald-300 uppercase font-bold">NET CAPITAL SPEND</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="text-base font-black text-emerald-300">
                    ₹{history.financialSummary.netCapitalSpendCr.toFixed(2)} Cr
                  </div>
                  <span className="text-[8px] text-zinc-400 block">Gross acquisitions minus refunds</span>
                </div>
              </div>

              {/* 3. Chronological Lifecycle Timeline */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5 border-b border-white/10 pb-2">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  HISTORICAL AUCTION TIMELINE ({history.timeline.length} EVENTS)
                </h4>

                {history.timeline.length === 0 ? (
                  <p className="text-zinc-500 text-xs py-4 text-center">
                    No historical auction lot events recorded for this player in this session.
                  </p>
                ) : (
                  <div className="relative pl-6 space-y-3 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-white/10">
                    {history.timeline.map((event, idx) => (
                      <div key={event.id || idx} className="relative flex items-start gap-3">
                        <div
                          className={`absolute -left-6 top-1 w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-black ${
                            event.eventType === 'MEGA_ACQUISITION'
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                              : event.eventType === 'RELEASE'
                              ? 'bg-blue-500/20 border-blue-500 text-blue-300'
                              : event.eventType === 'MINI_ACQUISITION'
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                              : 'bg-zinc-800 border-zinc-600 text-zinc-400'
                          }`}
                        >
                          {idx + 1}
                        </div>

                        <div className="bg-[#141A2D] border border-white/5 p-3 rounded-2xl flex-1 space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span
                              className={`font-bold px-1.5 py-0.2 rounded text-[8px] uppercase ${
                                event.phase === 'MEGA'
                                  ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                                  : event.phase === 'MINI'
                                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/40'
                                  : 'bg-blue-950/80 text-blue-300 border border-blue-500/40'
                              }`}
                            >
                              {event.eventType}
                            </span>
                            <span className="text-zinc-500 text-[9px]">
                              {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <p className="text-xs text-zinc-200 font-bold">{event.description}</p>

                          {event.amountCr > 0 && (
                            <div className="text-[10px] text-zinc-400 pt-0.5">
                              Transaction Amount: <span className="font-bold text-white">₹{event.amountCr.toFixed(2)} Cr</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-[#141A2D] flex items-center justify-between text-[10px] text-zinc-400">
          <span>Authoritative source-of-truth reconstruction (PostgreSQL)</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold uppercase transition-all shadow-md"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
