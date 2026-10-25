import './setup/e2e-target-guard';
// src/test/e2e/phase1-8-strategic-behaviour.spec.ts
//
// PHASE 1–8: END-TO-END STRATEGIC BEHAVIOUR E2E SPECIFICATION
//
// Verifies the complete decision chain from auction state to runtime bot execution.

import { test, expect } from '@playwright/test';
import {
  evaluateBotsForLot,
  getNextBidAmount,
  AuctionContext,
  DEFAULT_CONTEXT,
  BotDecisionEvidence,
} from '../../lib/auction/server-bot-engine';
import type { V3Team, V3Player } from '../../lib/v3-auction-types';

function makeBot(overrides: Partial<V3Team> = {}): V3Team {
  return {
    id: 'bot-csk',
    name: 'Chennai Super Kings',
    short_name: 'CSK',
    purse: 9000,
    initial_purse: 10000,
    players_bought: 3,
    overseas_count: 1,
    is_bot: true,
    ...overrides,
  };
}

function makeMarqueePlayer(): V3Player {
  return {
    id: 'vk-18',
    name: 'Virat Kohli',
    role: 'BATSMAN',
    category: 'A',
    rating: 97,
    country: 'India',
    age: 35,
    batting_hand: 'Right Handed',
    base_price: 200,
    is_overseas: false,
    image_url: null,
    matches: 252,
    runs: 8004,
    batting_average: 38.7,
    strike_rate: 131.97,
    hundreds: 8,
    fifties: 55,
    highest_score: 113,
    boundaries: 914,
  } as V3Player;
}

test.describe('Phase 1–8 Strategic Behaviour E2E Suite', () => {

  test('E2E Chain: Marquee player evaluated through P2->P8 produces aggressive BID within maximum ceiling', async () => {
    const kohli = makeMarqueePlayer();
    const bot = makeBot();
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    const ctx: AuctionContext = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 20,
      maxOverseas: 8,
      totalLots: 50,
      lotsCompleted: 2,
      lotsRemaining: 47,
      auctionProgress: 0.05,
    };

    const evidence: BotDecisionEvidence[] = [];
    const validBids = evaluateBotsForLot(
      [bot],
      kohli,
      800,
      200,
      undefined,
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    expect(evidence.length).toBe(1);
    const trace = evidence[0]!;

    // Authoritative pipeline validation
    expect(trace.marketValue).toBeGreaterThanOrEqual(2000);
    expect(trace.teamValue).toBeGreaterThan(0);
    expect(trace.maximumBid).toBeGreaterThan(trace.nextRequiredBid!);
    expect(trace.finalAction).toBe('BID');
    expect(trace.decision).toBe('ENTER');
    expect(validBids.length).toBe(1);
    expect(validBids[0]!.nextBidAmount).toBe(trace.bidAmount);
  });

  test('E2E Chain: Bid above maximum ceiling forces PASS and prevents runtime dispatch', async () => {
    const player: V3Player = {
      id: 'p-uncapped',
      name: 'Uncapped Batter',
      role: 'BATSMAN',
      category: 'C',
      country: 'India',
      age: 21,
      batting_hand: 'Right Handed',
      base_price: 30,
      is_overseas: false,
      image_url: null,
      matches: 8,
      runs: 120,
      batting_average: 20,
      strike_rate: 115,
      rating: 74,
    } as V3Player;

    const bot = makeBot({ purse: 3000, players_bought: 8 });
    const allTeams = [bot];
    const teamRosters: Record<string, V3Player[]> = { [bot.id]: [] };

    const ctx: AuctionContext = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 20,
      maxOverseas: 8,
      totalLots: 50,
      lotsCompleted: 15,
      lotsRemaining: 34,
      auctionProgress: 0.3,
    };

    // Current bid driven to 800L, far exceeding uncapped batter's ceiling (~100-200L)
    const evidence: BotDecisionEvidence[] = [];
    const validBids = evaluateBotsForLot(
      [bot],
      player,
      800,
      30,
      'rival',
      'Normal',
      allTeams,
      teamRosters,
      ctx,
      undefined,
      evidence
    );

    expect(evidence.length).toBe(1);
    const trace = evidence[0]!;

    expect(trace.finalAction).toBe('PASS');
    expect(trace.decision).toBe('DROP');
    expect(validBids.length).toBe(0);
  });
});
