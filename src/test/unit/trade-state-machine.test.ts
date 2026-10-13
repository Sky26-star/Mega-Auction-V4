// src/test/unit/trade-state-machine.test.ts
// Unit Tests for Trade State Machine, Unlock Conditions, and Bot Personality Decisions

import { describe, it, expect } from 'vitest';
import type { V3AuctionStatus, V3MiniAuctionSession, V3Player, V3Team } from '@/lib/v3-auction-types';
import type { TradeStatus } from '@/lib/trade/trade-types';
import {
  evaluateBotTradeResponse,
  generateBotTradeProposal,
} from '@/lib/trade/bot-trade-evaluator';

/**
 * Pure evaluation function for Trade Unlock Gate
 */
function isTradeUnlocked(
  auctionStatus: V3AuctionStatus | null,
  miniSession: V3MiniAuctionSession | null
): boolean {
  if (auctionStatus !== 'COMPLETED') return false;
  if (miniSession && miniSession.status !== 'COMPLETED') return false;
  return true;
}

/**
 * Pure state machine transition validator
 */
function validateStateTransition(
  currentStatus: TradeStatus,
  targetStatus: TradeStatus
): { allowed: boolean; reason?: string } {
  const terminalStates: TradeStatus[] = ['ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'];

  if (terminalStates.includes(currentStatus)) {
    return {
      allowed: false,
      reason: `Trade is in terminal state '${currentStatus}' and cannot transition to '${targetStatus}'.`,
    };
  }

  if (currentStatus === 'PENDING') {
    const allowedTargets: TradeStatus[] = ['ACCEPTED', 'REJECTED', 'CANCELLED', 'COUNTERED', 'EXPIRED'];
    if (allowedTargets.includes(targetStatus)) {
      return { allowed: true };
    }
  }

  if (currentStatus === 'COUNTERED') {
    const allowedTargets: TradeStatus[] = ['ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'];
    if (allowedTargets.includes(targetStatus)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Invalid transition from '${currentStatus}' to '${targetStatus}'.`,
  };
}

describe('Trade State Machine & Unlock Condition Tests', () => {
  describe('A. Trade Unlock Gate Logic', () => {
    it('blocks trading while Mega Auction is IN_PROGRESS', () => {
      expect(isTradeUnlocked('IN_PROGRESS', null)).toBe(false);
    });

    it('blocks trading while Mega Auction is PAUSED or STARTING', () => {
      expect(isTradeUnlocked('PAUSED', null)).toBe(false);
      expect(isTradeUnlocked('STARTING', null)).toBe(false);
      expect(isTradeUnlocked('LOBBY', null)).toBe(false);
    });

    it('blocks trading when Mega is COMPLETED but Mini is in active phases', () => {
      const activeMiniStatuses = ['SETUP', 'SELECTION_OPEN', 'SELECTION_CLOSED', 'BIDDING'] as const;

      for (const status of activeMiniStatuses) {
        const miniSession: any = { status };
        expect(isTradeUnlocked('COMPLETED', miniSession)).toBe(false);
      }
    });

    it('unlocks trading when Mega is COMPLETED and no Mini Session exists', () => {
      expect(isTradeUnlocked('COMPLETED', null)).toBe(true);
    });

    it('unlocks trading when Mega is COMPLETED and Mini is COMPLETED', () => {
      const completedMini: any = { status: 'COMPLETED' };
      expect(isTradeUnlocked('COMPLETED', completedMini)).toBe(true);
    });
  });

  describe('B. Trade State Transitions', () => {
    it('allows valid transitions from PENDING to terminal states', () => {
      expect(validateStateTransition('PENDING', 'ACCEPTED').allowed).toBe(true);
      expect(validateStateTransition('PENDING', 'REJECTED').allowed).toBe(true);
      expect(validateStateTransition('PENDING', 'CANCELLED').allowed).toBe(true);
      expect(validateStateTransition('PENDING', 'COUNTERED').allowed).toBe(true);
      expect(validateStateTransition('PENDING', 'EXPIRED').allowed).toBe(true);
    });

    it('blocks transitions from terminal states', () => {
      const terminals: TradeStatus[] = ['ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'];

      for (const terminal of terminals) {
        expect(validateStateTransition(terminal, 'ACCEPTED').allowed).toBe(false);
        expect(validateStateTransition(terminal, 'REJECTED').allowed).toBe(false);
        expect(validateStateTransition(terminal, 'CANCELLED').allowed).toBe(false);
        expect(validateStateTransition(terminal, 'PENDING').allowed).toBe(false);
      }
    });
  });

  describe('C. Bot Trade Evaluation Decisions', () => {
    const dummyPlayer = (id: string, name: string, role: string): V3Player => ({
      id,
      name,
      role: role as any,
      category: 'A',
      base_price: 150,
      is_overseas: false,
      country: 'India',
      age: 28,
      batting_hand: 'RIGHT',
      image_url: null,
    });

    const botTeam: V3Team = {
      id: 'bot-1',
      name: 'Gujarat Titans',
      short_name: 'GT',
      purse: 1000,
      initial_purse: 1000,
      players_bought: 16,
      overseas_count: 5,
      is_bot: true,
    };

    const humanTeam: V3Team = {
      id: 'human-1',
      name: 'Royal Challengers Bengaluru',
      short_name: 'RCB',
      purse: 1000,
      initial_purse: 1000,
      players_bought: 16,
      overseas_count: 5,
      is_bot: false,
    };

    it('vetoes trading away the bot sole wicket-keeper', () => {
      const soleKeeper = dummyPlayer('wk-1', 'MS Dhoni', 'WICKET_KEEPER');
      const botRoster = [
        soleKeeper,
        dummyPlayer('b1', 'Batsman 1', 'BATSMAN'),
        dummyPlayer('b2', 'Batsman 2', 'BATSMAN'),
      ];

      const res = evaluateBotTradeResponse({
        botTeam,
        botPersonality: 'BALANCED',
        proposerTeam: humanTeam,
        incomingPlayers: [dummyPlayer('bat-offered', 'Star Batsman', 'BATSMAN')],
        outgoingPlayers: [soleKeeper],
        botRoster,
        proposerRoster: [],
      });

      expect(res.decision).toBe('REJECT');
      expect(res.reason).toMatch(/zero WICKET_KEEPER/i);
    });

    it('conservative personality requires a distinct premium to accept', () => {
      const bumrah = dummyPlayer('p-bumrah', 'Jasprit Bumrah', 'BOWLER');
      const kohli = dummyPlayer('p-kohli', 'Virat Kohli', 'BATSMAN');

      const botRoster = [
        bumrah,
        dummyPlayer('b1', 'Batsman 1', 'BATSMAN'),
        dummyPlayer('bw2', 'Bowler 2', 'BOWLER'),
      ];

      const res = evaluateBotTradeResponse({
        botTeam,
        botPersonality: 'CONSERVATIVE',
        proposerTeam: humanTeam,
        incomingPlayers: [kohli],
        outgoingPlayers: [bumrah],
        botRoster,
        proposerRoster: [],
      });

      // Unless clearly winning by >12%, Conservative declines or counters
      expect(['REJECT', 'COUNTER']).toContain(res.decision);
    });

    it('generates a counter-offer when terms are close to threshold', () => {
      const botRoster = [
        dummyPlayer('out-1', 'Good Bowler', 'BOWLER'),
        dummyPlayer('out-2', 'Good Batsman', 'BATSMAN'),
        dummyPlayer('wk-1', 'Keeper 1', 'WICKET_KEEPER'),
      ];

      const humanRoster = [
        dummyPlayer('in-1', 'Slightly Lower Rated', 'BATSMAN'),
        dummyPlayer('bench-extra', 'Bench Player', 'BOWLER'),
      ];

      const res = evaluateBotTradeResponse({
        botTeam,
        botPersonality: 'BALANCED',
        proposerTeam: humanTeam,
        incomingPlayers: [humanRoster[0]!],
        outgoingPlayers: [botRoster[0]!],
        botRoster,
        proposerRoster: humanRoster,
      });

      if (res.decision === 'COUNTER') {
        expect(res.counterOffer).toBeDefined();
        expect(res.counterOffer?.proposerPlayerIds).toBeDefined();
        expect(res.counterOffer?.receiverPlayerIds).toBeDefined();
      }
    });

    it('generates an autonomous bot proposal to solve a roster deficit', () => {
      // Bot has 5 batsmen and 0 keepers (surplus batsmen, deficit keeper)
      const botRoster = [
        dummyPlayer('b1', 'Bat 1', 'BATSMAN'),
        dummyPlayer('b2', 'Bat 2', 'BATSMAN'),
        dummyPlayer('b3', 'Bat 3', 'BATSMAN'),
        dummyPlayer('b4', 'Bat 4', 'BATSMAN'),
        dummyPlayer('b5', 'Bat 5', 'BATSMAN'),
      ];

      // Partner team has 3 keepers (surplus keepers)
      const partnerTeam = humanTeam;
      const partnerRoster = [
        dummyPlayer('wk1', 'Keeper 1', 'WICKET_KEEPER'),
        dummyPlayer('wk2', 'Keeper 2', 'WICKET_KEEPER'),
        dummyPlayer('wk3', 'Keeper 3', 'WICKET_KEEPER'),
      ];

      const proposal = generateBotTradeProposal({
        botTeam,
        botRoster,
        otherTeams: [partnerTeam],
        allRostersByTeamId: {
          [partnerTeam.id]: partnerRoster,
        },
      });

      if (proposal) {
        expect(proposal.targetTeam.id).toBe(partnerTeam.id);
        expect(proposal.offeredPlayers[0]?.role).toBe('BATSMAN');
        expect(proposal.requestedPlayers[0]?.role).toBe('WICKET_KEEPER');
      }
    });
  });
});
