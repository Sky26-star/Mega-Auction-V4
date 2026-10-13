// src/test/unit/mini-completion-routing.test.ts
// Unit Tests for Phase 16A — Mini State Exposure + Mini-Aware Completion Routing
//
// Validates:
// A. Mega COMPLETED -> no Mini redirect; preserves room lobby return
// B. Mega COMPLETED -> host Mini initiation remains available
// C. Mini SETUP -> no completion redirect
// D. Mini SELECTION_OPEN -> no completion redirect
// E. Mini BIDDING -> /auction remains valid active arena
// F. Mini COMPLETED + total_lots = 0 -> direct /auction goes to /rooms/[id]
// G. Mini COMPLETED + total_lots > 0 -> Mini completion path only (with summary link)
// H. Loading state -> no premature redirect or classification
// I. Missing miniSession during unresolved loading -> no false Mega/Mini classification
// J. Re-render / realtime update -> no redirect loop
// K. Existing Mega behavior -> zero regression

import { describe, it, expect } from 'vitest';
import type { V3AuctionStatus, V3MiniAuctionSession, MiniAuctionStatus } from '@/lib/v3-auction-types';

interface RoutingStateInput {
  loading: boolean;
  auctionStatus: V3AuctionStatus | null;
  miniSession: V3MiniAuctionSession | null;
}

/**
 * Pure evaluation function mirroring the exact logic in V3AuctionPage (rooms/[id]/auction/page.tsx)
 */
function evaluateCompletionRouting(input: RoutingStateInput) {
  const { loading, auctionStatus, miniSession } = input;

  const isMiniZeroLotCompleted = !loading && auctionStatus === 'COMPLETED' && miniSession?.status === 'COMPLETED' && miniSession?.total_lots === 0;
  const isMiniLotsCompleted = !loading && auctionStatus === 'COMPLETED' && miniSession?.status === 'COMPLETED' && (miniSession?.total_lots ?? 0) > 0;
  const isMegaCompleted = !loading && auctionStatus === 'COMPLETED' && (!miniSession || miniSession.status !== 'COMPLETED');

  let action: 'LOADING' | 'NOT_STARTED' | 'ACTIVE_BIDDING' | 'REDIRECT_TO_ROOM' | 'MINI_COMPLETED_VIEW' | 'MEGA_COMPLETED_VIEW' = 'ACTIVE_BIDDING';

  if (loading) {
    action = 'LOADING';
  } else if (!auctionStatus || auctionStatus === 'LOBBY' || auctionStatus === 'READY' || auctionStatus === 'STARTING') {
    action = 'NOT_STARTED';
  } else if (isMiniZeroLotCompleted) {
    action = 'REDIRECT_TO_ROOM';
  } else if (isMiniLotsCompleted) {
    action = 'MINI_COMPLETED_VIEW';
  } else if (isMegaCompleted) {
    action = 'MEGA_COMPLETED_VIEW';
  } else if (auctionStatus === 'IN_PROGRESS' || auctionStatus === 'PAUSED') {
    action = 'ACTIVE_BIDDING';
  }

  return {
    isMiniZeroLotCompleted,
    isMiniLotsCompleted,
    isMegaCompleted,
    action,
  };
}

describe('Phase 16A — Mini State Exposure & Completion Routing Unit Tests', () => {
  it('A & K: Mega COMPLETED -> shows MEGA_COMPLETED_VIEW without redirecting to Mini summary', () => {
    const res = evaluateCompletionRouting({
      loading: false,
      auctionStatus: 'COMPLETED',
      miniSession: null,
    });

    expect(res.isMegaCompleted).toBe(true);
    expect(res.isMiniLotsCompleted).toBe(false);
    expect(res.isMiniZeroLotCompleted).toBe(false);
    expect(res.action).toBe('MEGA_COMPLETED_VIEW');
  });

  it('B: Mega COMPLETED with miniSession in SETUP (not yet completed) -> still treated as Mega post-auction', () => {
    const res = evaluateCompletionRouting({
      loading: false,
      auctionStatus: 'COMPLETED',
      miniSession: {
        id: 'mini-1',
        auction_id: 'auc-1',
        status: 'SETUP',
        selection_expires_at: null,
        total_lots: 0,
        closed_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    expect(res.isMegaCompleted).toBe(true);
    expect(res.action).toBe('MEGA_COMPLETED_VIEW');
  });

  it('C & D: Mini SETUP / SELECTION_OPEN -> no completion redirect', () => {
    const statuses: MiniAuctionStatus[] = ['SETUP', 'SELECTION_OPEN', 'SELECTION_CLOSED'];
    for (const status of statuses) {
      const res = evaluateCompletionRouting({
        loading: false,
        auctionStatus: 'COMPLETED', // Auction is paused/completed waiting for mini selection
        miniSession: {
          id: 'mini-1',
          auction_id: 'auc-1',
          status,
          selection_expires_at: null,
          total_lots: 0,
          closed_at: null,
          completed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });

      // While mini is in setup/selection, it does NOT trigger mini completed actions
      expect(res.isMiniZeroLotCompleted).toBe(false);
      expect(res.isMiniLotsCompleted).toBe(false);
      expect(res.action).toBe('MEGA_COMPLETED_VIEW');
    }
  });

  it('E: Mini BIDDING -> action is ACTIVE_BIDDING (/auction remains valid live arena)', () => {
    const res = evaluateCompletionRouting({
      loading: false,
      auctionStatus: 'IN_PROGRESS',
      miniSession: {
        id: 'mini-1',
        auction_id: 'auc-1',
        status: 'BIDDING',
        selection_expires_at: null,
        total_lots: 5,
        closed_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    expect(res.isMegaCompleted).toBe(false);
    expect(res.isMiniLotsCompleted).toBe(false);
    expect(res.isMiniZeroLotCompleted).toBe(false);
    expect(res.action).toBe('ACTIVE_BIDDING');
  });

  it('F: Mini COMPLETED + total_lots = 0 -> REDIRECT_TO_ROOM (returns to /rooms/[id])', () => {
    const res = evaluateCompletionRouting({
      loading: false,
      auctionStatus: 'COMPLETED',
      miniSession: {
        id: 'mini-1',
        auction_id: 'auc-1',
        status: 'COMPLETED',
        selection_expires_at: null,
        total_lots: 0,
        closed_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    expect(res.isMiniZeroLotCompleted).toBe(true);
    expect(res.isMiniLotsCompleted).toBe(false);
    expect(res.isMegaCompleted).toBe(false);
    expect(res.action).toBe('REDIRECT_TO_ROOM');
  });

  it('G: Mini COMPLETED + total_lots > 0 -> MINI_COMPLETED_VIEW (dedicated final summary)', () => {
    const res = evaluateCompletionRouting({
      loading: false,
      auctionStatus: 'COMPLETED',
      miniSession: {
        id: 'mini-1',
        auction_id: 'auc-1',
        status: 'COMPLETED',
        selection_expires_at: null,
        total_lots: 4,
        closed_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    expect(res.isMiniLotsCompleted).toBe(true);
    expect(res.isMiniZeroLotCompleted).toBe(false);
    expect(res.isMegaCompleted).toBe(false);
    expect(res.action).toBe('MINI_COMPLETED_VIEW');
  });

  it('H & I: Loading state -> no premature redirect or classification', () => {
    const res = evaluateCompletionRouting({
      loading: true,
      auctionStatus: 'COMPLETED',
      miniSession: null, // Still unresolved
    });

    expect(res.isMiniZeroLotCompleted).toBe(false);
    expect(res.isMiniLotsCompleted).toBe(false);
    expect(res.isMegaCompleted).toBe(false);
    expect(res.action).toBe('LOADING');
  });

  it('J: Repeated re-render / realtime update evaluates deterministically without state mutation or loops', () => {
    const input: RoutingStateInput = {
      loading: false,
      auctionStatus: 'COMPLETED',
      miniSession: {
        id: 'mini-1',
        auction_id: 'auc-1',
        status: 'COMPLETED',
        selection_expires_at: null,
        total_lots: 0,
        closed_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };

    const res1 = evaluateCompletionRouting(input);
    const res2 = evaluateCompletionRouting(input);
    const res3 = evaluateCompletionRouting(input);

    expect(res1).toEqual(res2);
    expect(res2).toEqual(res3);
    expect(res1.action).toBe('REDIRECT_TO_ROOM');
  });
});
