// src/test/unit/auction-initialization.test.ts
// Unit Tests for Phase 1 Authoritative Auction Initialization Rules

import { describe, it, expect } from 'vitest';
import { initializeAuction, startNextPlayer } from '@/lib/auction/state';
import { getNextMinimumBid } from '@/lib/auction/bid-increments';

describe('Auction Engine Phase 1 — State Initialization Unit Tests', () => {
  const samplePlayers = [
    { id: 'p1', name: 'AB de Villiers', category: 'ICON', basePrice: 200, country: 'South Africa', role: 'Batsman' },
    { id: 'p2', name: 'Jasprit Bumrah', category: 'ELITE', basePrice: 150, country: 'India', role: 'Fast Bowler' },
  ];

  it('1. Initialized auction starts with NOT_STARTED status and empty bidder state', () => {
    const state = initializeAuction(samplePlayers);
    expect(state.auctionStatus).toBe('NOT_STARTED');
    expect(state.currentPlayerIndex).toBe(-1);
    expect(state.currentPlayer).toBeNull();
    expect(state.highestBidderId).toBeNull();
    expect(state.bidCount).toBe(0);
  });

  it('2. Starting first player initializes status to LIVE and sets opening bid to base price', () => {
    const initial = initializeAuction(samplePlayers);
    const liveState = startNextPlayer(initial);

    expect(liveState.auctionStatus).toBe('LIVE');
    expect(liveState.currentPlayerIndex).toBe(0);
    expect(liveState.currentPlayer?.name).toBe('AB de Villiers');
    expect(liveState.currentPlayer?.basePrice).toBe(200);
    expect(liveState.currentBid).toBe(200); // Base price = ₹2.00 Cr
    expect(liveState.highestBidderId).toBeNull(); // NO BIDS yet
    expect(liveState.bidCount).toBe(0);
  });

  it('3. Opening next minimum bid calculates correctly from base price', () => {
    const basePriceCr = 2.00;
    const nextMinBidCr = getNextMinimumBid(basePriceCr);
    expect(nextMinBidCr).toBe(2.25); // ₹2.00 Cr -> ₹2.25 Cr (+₹0.25 Cr)
  });

  it('4. Higher base price opening next minimum bid follows increment tier rules', () => {
    expect(getNextMinimumBid(5.00)).toBe(5.50); // >₹3–₹6 Cr -> +₹0.50 Cr
    expect(getNextMinimumBid(8.00)).toBe(8.75); // >₹6–₹10 Cr -> +₹0.75 Cr
    expect(getNextMinimumBid(12.00)).toBe(13.00); // >₹10–₹15 Cr -> +₹1.00 Cr
  });
});
