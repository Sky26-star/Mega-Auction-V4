'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useV3AuctionState } from '@/hooks/useV3AuctionState';

import { getCurrentProfile } from '@/lib/auth';
import { getRoomById } from '@/lib/rooms';
import { createClient } from '@/lib/supabase/client';
import { V3AuctionState, V3AuctionLot, V3Player } from '@/lib/v3-auction-types';
import { isBotTradeWindowOpen } from '@/lib/trade/bot-cycle-policy';

interface AuctionContextValue {
  state: V3AuctionState;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  animation: { status: 'SOLD' | 'UNSOLD'; lot: V3AuctionLot; player: V3Player } | null;
  triggerAnimation: (lotId: string, knownLot?: V3AuctionLot) => Promise<void>;
}

const AuctionContext = createContext<AuctionContextValue | null>(null);

export function V3AuctionStateProvider({ roomId, children }: { roomId: string; children: React.ReactNode }) {
  const contextValue = useV3AuctionState(roomId);
  const { state, refresh, triggerAnimation } = contextValue;

  const [isHost, setIsHost] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState<string>('Balanced');
  const isTransitioningRef = useRef(false);

  useEffect(() => {
    async function loadUserAndRoom() {
      if (!roomId) return;
      try {
        const profile = await getCurrentProfile();
        if (profile) {
          const room = await getRoomById(roomId);
          if (room) {
            setIsHost(profile.id === room.host_id);
            if (room.settings && typeof room.settings === 'object' && 'bot_difficulty' in room.settings) {
              setBotDifficulty((room.settings as any).bot_difficulty || 'Balanced');
            }
          }
        }
      } catch (err) {
        console.error("Failed to load user or room in Provider:", err);
      }
    }
    loadUserAndRoom();
  }, [roomId]);

  useEffect(() => {
    const auction = state.auction;
    const miniStatus = state.miniSession?.status ?? null;
    if (!isHost || !auction?.id || !isBotTradeWindowOpen(auction.status, miniStatus)) return;

    let disposed = false;
    let running = false;
    const runBotTradeCycle = async () => {
      if (disposed || running) return;
      running = true;
      try {
        const response = await fetch('/api/trade/bot-cycle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auctionId: auction.id }),
        });
        const result = await response.json();
        if (!disposed && (!response.ok || !result.success)) {
          console.error('Room bot trade cycle failed:', result.error || response.statusText);
        }
      } catch (error) {
        if (!disposed) console.error('Room bot trade cycle request failed:', error);
      } finally {
        running = false;
      }
    };

    void runBotTradeCycle();
    const timer = setInterval(runBotTradeCycle, 30_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [isHost, state.auction, state.miniSession?.status]);





  return (
    <AuctionContext.Provider value={contextValue}>
      {children}
    </AuctionContext.Provider>
  );
}

export function useV3AuctionContext() {
  const context = useContext(AuctionContext);
  if (!context) {
    throw new Error('useV3AuctionContext must be used within a V3AuctionStateProvider');
  }
  return context;
}
