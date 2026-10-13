import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBotMemory,
  recordBotBidObservation,
  syncBotMemoryWithState,
  clearAuctionMemory,
  clearBotMemory,
  clearInactiveAuctionMemory
} from '../../lib/auction/bot-brain-memory';

describe('Bot Brain Memory', () => {
  const auctionId = 'auction-123';
  const team1 = 'team-1';
  const team2 = 'team-2';

  beforeEach(() => {
    clearAuctionMemory(auctionId);
  });

  it('initializes memory correctly and isolates by team', () => {
    const mem1 = getBotMemory(auctionId, team1);
    const mem2 = getBotMemory(auctionId, team2);

    expect(mem1).toBeDefined();
    expect(mem2).toBeDefined();
    expect(mem1.teamId).toBe(team1);
    expect(mem2.teamId).toBe(team2);
    
    // Mutation isolation check
    mem1.lotsSinceLastPurchase = 5;
    expect(mem2.lotsSinceLastPurchase).toBe(0);
  });

  it('records bid observations safely', () => {
    recordBotBidObservation(auctionId, team1, 'player-A', 200);
    let mem = getBotMemory(auctionId, team1);
    
    expect(mem.observedBids['player-A']).toBeDefined();
    expect(mem.observedBids['player-A']!.highestBid).toBe(200);

    // Should update to higher bid
    recordBotBidObservation(auctionId, team1, 'player-A', 250);
    mem = getBotMemory(auctionId, team1);
    expect(mem.observedBids['player-A']!.highestBid).toBe(250);

    // Should NOT update to lower bid
    recordBotBidObservation(auctionId, team1, 'player-A', 220);
    mem = getBotMemory(auctionId, team1);
    expect(mem.observedBids['player-A']!.highestBid).toBe(250);
  });

  it('syncs correctly with authoritative state (purchases and lotsSinceLastPurchase)', () => {
    let mem = getBotMemory(auctionId, team1);
    expect(mem.lotsSinceLastPurchase).toBe(0);

    // Simulate tick 1: new lot transitions
    mem = syncBotMemoryWithState(auctionId, team1, 'lot-1', []);
    expect(mem.lotsSinceLastPurchase).toBe(0); // Only increments on subsequent transitions

    // Simulate tick 2: another lot transitions
    mem = syncBotMemoryWithState(auctionId, team1, 'lot-2', []);
    expect(mem.lotsSinceLastPurchase).toBe(1);

    // Simulate lot-2 completing and being sold to team1
    const completedLots = [{
      id: 'lot-2',
      status: 'SOLD',
      player_id: 'player-B',
      winning_team_id: team1,
      winning_bid: 500,
      players: { role: 'BATSMAN' }
    }];

    mem = syncBotMemoryWithState(auctionId, team1, 'lot-3', completedLots);
    expect(mem.lotsSinceLastPurchase).toBe(0); // Reset on purchase
    expect(mem.purchases.length).toBe(1);
    expect(mem.purchases[0]!.playerId).toBe('player-B');
    expect(mem.purchases[0]!.amount).toBe(500);
  });

  it('syncs correctly with authoritative state (failed targets)', () => {
    // Simulate previous initialization tick so memory is ready
    syncBotMemoryWithState(auctionId, team1, 'lot-3', []);

    // team1 bids on player-C
    recordBotBidObservation(auctionId, team1, 'player-C', 300);

    const completedLots = [{
      id: 'lot-4',
      status: 'SOLD',
      player_id: 'player-C',
      winning_team_id: team2, // team2 won
      winning_bid: 350,
      players: { role: 'BOWLER' }
    }];

    const mem = syncBotMemoryWithState(auctionId, team1, 'lot-5', completedLots);
    
    // team1 should record a failed target because it bid but lost
    expect(mem.failedTargets.length).toBe(1);
    expect(mem.failedTargets[0]!.playerId).toBe('player-C');
    expect(mem.failedTargets[0]!.finalBid).toBe(350);
    expect(mem.failedTargets[0]!.winnerId).toBe(team2);
  });

  it('is idempotent on repeated syncs for the same lot', () => {
    // Initialize memory before adding events
    syncBotMemoryWithState(auctionId, team1, 'lot-5', []);

    recordBotBidObservation(auctionId, team1, 'player-D', 100);

    const completedLots = [{
      id: 'lot-6',
      status: 'SOLD',
      player_id: 'player-D',
      winning_team_id: team2,
      winning_bid: 150,
      players: { role: 'ALL_ROUNDER' }
    }];

    // Simulate a previous tick where lot-6 was active
    syncBotMemoryWithState(auctionId, team1, 'lot-6', []);

    // Tick N (transition to lot-7)
    let mem = syncBotMemoryWithState(auctionId, team1, 'lot-7', completedLots);
    expect(mem.failedTargets.length).toBe(1);

    // Tick N+1 (same state)
    mem = syncBotMemoryWithState(auctionId, team1, 'lot-7', completedLots);
    expect(mem.failedTargets.length).toBe(1); // Should not double-count
    expect(mem.lotsSinceLastPurchase).toBe(2); // lot-6 and lot-7 were active
  });

  it('clears memory properly', () => {
    recordBotBidObservation(auctionId, team1, 'player-A', 200);
    expect(getBotMemory(auctionId, team1).observedBids['player-A']).toBeDefined();

    clearBotMemory(auctionId, team1);
    expect(getBotMemory(auctionId, team1).observedBids['player-A']).toBeUndefined();
  });

  it('handles cold start baseline without generating events', () => {
    const historicalLots = [
      { id: 'lot-old-1', status: 'SOLD', player_id: 'player-X', winning_team_id: team1, winning_bid: 100, players: { role: 'BATSMAN' } },
      { id: 'lot-old-2', status: 'SOLD', player_id: 'player-Y', winning_team_id: team2, winning_bid: 200, players: { role: 'BOWLER' } }
    ];
    
    // Memory initialized and synced for the first time
    const mem = syncBotMemoryWithState(auctionId, team1, 'lot-new-1', historicalLots);
    
    expect(mem.isInitialized).toBe(true);
    expect(mem.purchases.length).toBe(0);
    expect(mem.failedTargets.length).toBe(0);
    expect(mem.processedCompletedLots.has('lot-old-1')).toBe(true);
    expect(mem.processedCompletedLots.has('lot-old-2')).toBe(true);
  });

  it('clears inactive auctions properly', () => {
    const auctionActive = 'auction-active';
    const auctionInactive = 'auction-inactive';
    
    // Initialize both
    getBotMemory(auctionActive, team1);
    getBotMemory(auctionInactive, team1);
    
    // Clear only inactive
    const activeIds = new Set([auctionActive]);
    clearInactiveAuctionMemory(activeIds);
    
    // We can test this by checking if clearing removed it from cache without re-initializing it,
    // but `getBotMemory` re-initializes. We can simulate it by spying, or by setting a property
    // and seeing if it was reset by re-initialization.
    
    // Modify active and inactive
    getBotMemory(auctionActive, team1).lotsSinceLastPurchase = 5;
    getBotMemory(auctionInactive, team1).lotsSinceLastPurchase = 5;
    
    clearInactiveAuctionMemory(activeIds);
    
    // Active should retain modifications
    expect(getBotMemory(auctionActive, team1).lotsSinceLastPurchase).toBe(5);
    
    // Inactive should have been cleared, so calling getBotMemory re-initializes to 0
    expect(getBotMemory(auctionInactive, team1).lotsSinceLastPurchase).toBe(0);
  });
});
