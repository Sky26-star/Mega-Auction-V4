// src/test/unit/trade-valuation.test.ts
// Unit Tests for Trade Valuation Engine & Constraints

import { describe, it, expect } from 'vitest';
import {
  calculateRoleMultiplier,
  calculateOverseasMultiplier,
  evaluatePlayerValueForTeam,
  validateTradeConstraints,
  evaluateTradeFairness,
  DEFAULT_MAX_SQUAD_SIZE,
  DEFAULT_MAX_OVERSEAS,
} from '@/lib/trade/trade-valuation-engine';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';

describe('Player Trade Valuation Engine Tests', () => {
  const dummyPlayer = (id: string, name: string, role: string, is_overseas = false): V3Player => ({
    id,
    name,
    role: role as any,
    category: 'A',
    base_price: 200,
    is_overseas,
    country: is_overseas ? 'Australia' : 'India',
    age: 28,
    batting_hand: 'RIGHT',
    image_url: null,
  });

  const dummyTeam = (id: string, name: string, players_bought = 15, overseas_count = 5): V3Team => ({
    id,
    name,
    short_name: name.slice(0, 3).toUpperCase(),
    purse: 1000,
    initial_purse: 1000,
    players_bought,
    overseas_count,
    is_bot: false,
  });

  describe('A. Role Multipliers & Squad Need Context', () => {
    it('applies 1.40x critical premium when team has zero players in that role', () => {
      const roster: V3Player[] = [
        dummyPlayer('p1', 'Batsman 1', 'BATSMAN'),
        dummyPlayer('p2', 'Bowler 1', 'BOWLER'),
      ];

      // WICKET_KEEPER has 0 players in roster
      const multiplier = calculateRoleMultiplier('WICKET_KEEPER', roster);
      expect(multiplier).toBe(1.40);
    });

    it('applies 1.20x premium when team is under ideal starter count', () => {
      // BATSMAN ideal is 4; team has 2
      const roster: V3Player[] = [
        dummyPlayer('p1', 'Batsman 1', 'BATSMAN'),
        dummyPlayer('p2', 'Batsman 2', 'BATSMAN'),
      ];

      const multiplier = calculateRoleMultiplier('BATSMAN', roster);
      expect(multiplier).toBe(1.20);
    });

    it('applies 1.00x baseline when team meets ideal starter count', () => {
      // ALL_ROUNDER ideal is 2; team has 2
      const roster: V3Player[] = [
        dummyPlayer('p1', 'AR 1', 'ALL_ROUNDER'),
        dummyPlayer('p2', 'AR 2', 'ALL_ROUNDER'),
      ];

      const multiplier = calculateRoleMultiplier('ALL_ROUNDER', roster);
      expect(multiplier).toBe(1.00);
    });

    it('applies 0.85x discount when role is saturated with surplus depth', () => {
      // BATSMAN ideal is 4; team has 6
      const roster: V3Player[] = [
        dummyPlayer('p1', 'B1', 'BATSMAN'),
        dummyPlayer('p2', 'B2', 'BATSMAN'),
        dummyPlayer('p3', 'B3', 'BATSMAN'),
        dummyPlayer('p4', 'B4', 'BATSMAN'),
        dummyPlayer('p5', 'B5', 'BATSMAN'),
      ];

      const multiplier = calculateRoleMultiplier('BATSMAN', roster);
      expect(multiplier).toBe(0.85);
    });
  });

  describe('B. Overseas Multiplier & Cap Friction', () => {
    it('does not penalize domestic players regardless of overseas count', () => {
      expect(calculateOverseasMultiplier(false, 8, 8)).toBe(1.0);
    });

    it('does not penalize overseas players when squad has ample overseas room', () => {
      expect(calculateOverseasMultiplier(true, 4, 8)).toBe(1.0);
    });

    it('applies 0.90x friction when consuming the final overseas slot', () => {
      expect(calculateOverseasMultiplier(true, 7, 8)).toBe(0.90);
    });

    it('applies 0.70x heavy penalty if team is already at cap', () => {
      expect(calculateOverseasMultiplier(true, 8, 8)).toBe(0.70);
    });
  });

  describe('C. Trade Constraint Validation', () => {
    const teamA = dummyTeam('team-a', 'Chennai Super Kings', 18, 5);
    const teamB = dummyTeam('team-b', 'Mumbai Indians', 18, 6);

    it('rejects trades with 0 players on either side', () => {
      const res = validateTradeConstraints({
        proposerTeam: teamA,
        receiverTeam: teamB,
        proposerPlayers: [],
        receiverPlayers: [dummyPlayer('p1', 'Rohit Sharma', 'BATSMAN')],
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/must offer between 1 and 3 players/i);
    });

    it('rejects trades exceeding 3 players on either side', () => {
      const p = dummyPlayer('p1', 'Player', 'BATSMAN');
      const res = validateTradeConstraints({
        proposerTeam: teamA,
        receiverTeam: teamB,
        proposerPlayers: [p, p, p, p],
        receiverPlayers: [p],
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/must offer between 1 and 3 players/i);
    });

    it('rejects trading between the same team', () => {
      const p1 = dummyPlayer('p1', 'Player 1', 'BATSMAN');
      const p2 = dummyPlayer('p2', 'Player 2', 'BOWLER');
      const res = validateTradeConstraints({
        proposerTeam: teamA,
        receiverTeam: teamA,
        proposerPlayers: [p1],
        receiverPlayers: [p2],
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/same franchise/i);
    });

    it('rejects trading the same player on both sides', () => {
      const p1 = dummyPlayer('p1', 'Player 1', 'BATSMAN');
      const res = validateTradeConstraints({
        proposerTeam: teamA,
        receiverTeam: teamB,
        proposerPlayers: [p1],
        receiverPlayers: [p1],
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/same player on both sides/i);
    });

    it('rejects trades that cause a team to exceed max_squad_size (25)', () => {
      const fullTeam = dummyTeam('team-full', 'Full Squad', 25, 4);
      const otherTeam = dummyTeam('team-other', 'Other', 20, 4);

      // 1-for-2 trade would push fullTeam to 26
      const res = validateTradeConstraints({
        proposerTeam: otherTeam,
        receiverTeam: fullTeam,
        proposerPlayers: [dummyPlayer('p1', 'P1', 'BATSMAN'), dummyPlayer('p2', 'P2', 'BATSMAN')],
        receiverPlayers: [dummyPlayer('p3', 'P3', 'BATSMAN')],
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/exceed the squad limit/i);
    });

    it('rejects trades that cause a team to exceed max_overseas (8)', () => {
      const cappedTeam = dummyTeam('team-capped', 'Capped Overseas', 18, 8);
      const tradeTeam = dummyTeam('team-trader', 'Trader', 18, 4);

      const res = validateTradeConstraints({
        proposerTeam: tradeTeam,
        receiverTeam: cappedTeam,
        proposerPlayers: [dummyPlayer('os1', 'Overseas 1', 'BATSMAN', true)],
        receiverPlayers: [dummyPlayer('ind1', 'Domestic 1', 'BATSMAN', false)],
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/exceed the overseas player limit/i);
    });

    it('accepts valid 1-for-1, 1-for-2, and 2-for-2 trades within bounds', () => {
      const res1 = validateTradeConstraints({
        proposerTeam: teamA,
        receiverTeam: teamB,
        proposerPlayers: [dummyPlayer('p1', 'P1', 'BATSMAN')],
        receiverPlayers: [dummyPlayer('p2', 'P2', 'BOWLER')],
      });
      expect(res1.valid).toBe(true);

      const res2 = validateTradeConstraints({
        proposerTeam: teamA,
        receiverTeam: teamB,
        proposerPlayers: [dummyPlayer('p1', 'P1', 'BATSMAN')],
        receiverPlayers: [dummyPlayer('p2', 'P2', 'BOWLER'), dummyPlayer('p3', 'P3', 'ALL_ROUNDER')],
      });
      expect(res2.valid).toBe(true);
      expect(res2.proposerNewSquadSize).toBe(19);
      expect(res2.receiverNewSquadSize).toBe(17);
    });
  });

  describe('D. Fair Valuation Calculations', () => {
    const teamA = dummyTeam('team-a', 'Kolkata Knight Riders', 18, 5);
    const teamB = dummyTeam('team-b', 'Delhi Capitals', 18, 4);

    it('evaluates player value with deterministic ratings', () => {
      const kohli = dummyPlayer('p-kohli', 'Virat Kohli', 'BATSMAN');
      const val = evaluatePlayerValueForTeam(kohli, [], 4);
      expect(val).toBeGreaterThan(70);
    });

    it('calculates trade fairness and provides an explainable summary', () => {
      const pA = [dummyPlayer('p1', 'Jasprit Bumrah', 'BOWLER')];
      const pB = [dummyPlayer('p2', 'Virat Kohli', 'BATSMAN')];

      const fairness = evaluateTradeFairness({
        proposerTeam: teamA,
        receiverTeam: teamB,
        proposerPlayers: pA,
        receiverPlayers: pB,
      });

      expect(fairness.fairnessRatio).toBeGreaterThan(0);
      expect(fairness.proposerGivenValue).toBeGreaterThan(0);
      expect(fairness.proposerReceivedValue).toBeGreaterThan(0);
      expect(fairness.explanation).toBeTruthy();
      expect(fairness.acceptanceLikelihood).toBeGreaterThanOrEqual(0);
      expect(fairness.acceptanceLikelihood).toBeLessThanOrEqual(100);
    });
  });
});
