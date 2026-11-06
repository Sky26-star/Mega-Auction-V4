// src/test/unit/bot-performance-benchmark.test.ts
//
// Performance and Cadence Benchmark for Unified Bot Intelligence System
//
// Target environment: Node worker with ~500ms target cadence.
// Evaluates latency for multi-bot, multi-lot scenarios with saturated pools.

import { describe, it, expect, vi } from 'vitest';
import { evaluateBotsForLot, AuctionContext, DEFAULT_CONTEXT, FuturePlayer } from '@/lib/auction/server-bot-engine';
import type { V3Team, V3Player } from '@/lib/v3-auction-types';

describe('Bot Intelligence Performance Benchmark', () => {
  it('Evaluates a realistic 10-bot auction lot well under the 500ms worker cadence', () => {
    // 10 distinct bots with varying purses and states
    const bots: V3Team[] = Array.from({ length: 10 }, (_, i) => ({
      id: `benchmark-bot-${i + 1}`,
      name: `Benchmark Bot ${i + 1}`,
      short_name: `B${i + 1}`,
      purse: 2000 + i * 500,
      initial_purse: 10000,
      players_bought: 10 + (i % 8),
      overseas_count: i % 4,
      is_bot: true
    }));

    // Large candidate pool (150 future players)
    const roles = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'] as const;
    const categories = ['MARQUEE', 'A', 'B', 'C', 'D'] as const;
    const futurePlayers: FuturePlayer[] = Array.from({ length: 150 }, (_, i) => ({
      player_id: `fp-bench-${i + 1}`,
      role: roles[i % 4]!,
      category: categories[i % 5]!,
      base_price: 20 + (i % 10) * 20,
      is_overseas: i % 3 === 0
    }));

    const futureByRole: Record<string, number> = {
      BATSMAN: 38,
      BOWLER: 38,
      ALL_ROUNDER: 37,
      WICKET_KEEPER: 37
    };

    const ctx: AuctionContext = {
      ...DEFAULT_CONTEXT,
      futurePlayers,
      futureByRole,
      lotsCompleted: 20,
      lotsRemaining: 150,
      auctionProgress: 0.12
    };

    const currentLotPlayer: V3Player = {
      id: 'p-bench-star',
      name: 'Benchmark Superstar',
      role: 'ALL_ROUNDER',
      category: 'MARQUEE',
      country: 'India',
      age: 27,
      batting_hand: 'Right Handed',
      base_price: 200,
      is_overseas: false,
      image_url: null
    };

    // Suppress console I/O during warmup and timed benchmarking so terminal write buffer latency is not measured
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Warmup runs (3 iterations) to allow V8 Turbofan JIT compilation of hot bot evaluation paths
    for (let w = 0; w < 3; w++) {
      evaluateBotsForLot(bots, currentLotPlayer, 300, 200, undefined, 'Normal', bots, {}, ctx, null);
    }

    // Timed benchmark across 10 iterations (representing 10 auction ticks)
    const iterations = 10;
    const lotLatencies: number[] = [];
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const lotStart = performance.now();
      evaluateBotsForLot(bots, currentLotPlayer, 300 + i * 25, 200, bots[i % 10]!.id, 'Normal', bots, {}, ctx, null);
      lotLatencies.push(performance.now() - lotStart);
    }
    const elapsedMs = performance.now() - start;
    errorSpy.mockRestore();
    logSpy.mockRestore();

    const maxMsPerLot = Math.max(...lotLatencies);
    const avgMsPerLot = elapsedMs / iterations;
    const avgMsPerBot = avgMsPerLot / bots.length;

    console.log(`\n======================================================`);
    console.log(`[BOT INTELLIGENCE PERFORMANCE BENCHMARK RESULT]`);
    console.log(`Bots evaluated per lot: ${bots.length}`);
    console.log(`Future candidates pool size: ${futurePlayers.length}`);
    console.log(`Total time for ${iterations} lots: ${elapsedMs.toFixed(2)}ms`);
    console.log(`Average time per lot: ${avgMsPerLot.toFixed(2)}ms`);
    console.log(`Worst lot latency (outlier check): ${maxMsPerLot.toFixed(2)}ms`);
    console.log(`Average time per bot decision: ${avgMsPerBot.toFixed(2)}ms`);
    console.log(`Worker cadence target: 500ms`);
    console.log(`Cadence headroom: ${(500 - avgMsPerLot).toFixed(2)}ms (${((500 - avgMsPerLot) / 500 * 100).toFixed(1)}%)`);
    console.log(`======================================================\n`);

    // Performance regression asserts:
    // 1. Average lot evaluation must be strictly below 100ms (5x faster than 500ms cadence)
    // 2. Average bot decision latency must be strictly below 10ms (100 bots/sec capacity)
    // 3. Outlier protection: slowest single lot evaluation must remain well below 150ms (>70% cadence margin)
    expect(avgMsPerLot).toBeLessThan(100);
    expect(avgMsPerBot).toBeLessThan(10);
    expect(maxMsPerLot).toBeLessThan(150);
  });
});
