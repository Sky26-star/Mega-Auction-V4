// src/test/unit/player-stats.test.ts
// Unit Tests for Player Career Statistics Data Pipeline Preservation

import { describe, it, expect } from 'vitest';
import type { PlayerData, PlayerStats } from '@/types/player';
import type { QueuedPlayer } from '@/lib/auction/state';

describe('Player Career Statistics Pipeline', () => {
  const sampleDbStats: PlayerStats = {
    matches: 184,
    runs: 5162,
    average: 39.71,
    strikeRate: 151.68,
    hundreds: 3,
    fifties: 40,
    highest: 133,
    wickets: 0,
    economy: 0,
    bestBowling: '',
  };

  const sampleQueuedPlayer: QueuedPlayer = {
    playerId: 'p-ab-de-villiers',
    name: 'AB de Villiers',
    category: 'ICON',
    basePrice: 200,
    auctionOrder: 1,
    status: 'LIVE',
    country: 'South Africa',
    role: 'Batsman',
    stats: sampleDbStats,
  };

  it('1. QueuedPlayer interface preserves stats property correctly', () => {
    expect(sampleQueuedPlayer.stats).toBeDefined();
    expect(sampleQueuedPlayer.stats?.matches).toBe(184);
    expect(sampleQueuedPlayer.stats?.runs).toBe(5162);
    expect(sampleQueuedPlayer.stats?.average).toBe(39.71);
    expect(sampleQueuedPlayer.stats?.strikeRate).toBe(151.68);
    expect(sampleQueuedPlayer.stats?.hundreds).toBe(3);
    expect(sampleQueuedPlayer.stats?.fifties).toBe(40);
    expect(sampleQueuedPlayer.stats?.highest).toBe(133);
  });

  it('2. PlayerData mapping preserves stats for PlayerCard rendering', () => {
    const mappedPlayerData: PlayerData = {
      id: sampleQueuedPlayer.playerId,
      name: sampleQueuedPlayer.name,
      country: sampleQueuedPlayer.country || 'South Africa',
      role: sampleQueuedPlayer.role || 'Batsman',
      category: sampleQueuedPlayer.category,
      basePriceCr: 2.00,
      stats: sampleQueuedPlayer.stats,
    };

    expect(mappedPlayerData.stats).toEqual(sampleDbStats);
    expect(mappedPlayerData.stats?.matches).toBe(184);
    expect(mappedPlayerData.stats?.runs).toBe(5162);
    expect(mappedPlayerData.stats?.average).toBe(39.71);
    expect(mappedPlayerData.stats?.strikeRate).toBe(151.68);
    expect(mappedPlayerData.stats?.hundreds).toBe(3);
    expect(mappedPlayerData.stats?.fifties).toBe(40);
    expect(mappedPlayerData.stats?.highest).toBe(133);
  });
});
