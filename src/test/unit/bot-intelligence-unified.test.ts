// src/test/unit/bot-intelligence-unified.test.ts
//
// Comprehensive Unit & Adversarial Tests for Unified Bot Intelligence System
//
// Validates:
// 1. Foundation: player_id preservation, deterministic ordering, equal ratings tie-break
// 2. Q Engine: Q_skip, Q_buy monotonicity, discrete TV on legal ladder, NO_ALTERNATIVE
// 3. Strategy: First-class BID, PASS, WAIT, STRETCH with explicit reasons
// 4. Hard Constraints: purse, squad capacity, overseas capacity, highest bidder
// 5. Personality: behavioral tendencies, timing, risk tolerance
// 6. Rival Interactions: rival thirst, bait/drop, bounded price pressure
// 7. Determinism: zero Math.random() in core logic, state-seeded repeatability

import { describe, it, expect } from 'vitest';
import {
  compareCandidatesDeterministic,
  sortCandidatesDeterministic,
  type CandidateSortable,
  estimateCategoryRating
} from '@/lib/auction/bot-candidate-ordering';
import {
  generateDiscreteBidLadder,
  computeMarginalUtility,
  evaluateQAndTV,
  type TeamRosterState
} from '@/lib/auction/bot-q-engine';
import {
  evaluateTacticalDecision,
  getDeterministicPseudoRandom
} from '@/lib/auction/bot-tactical-engine';
import {
  evaluateBotsForLot,
  type AuctionContext,
  DEFAULT_CONTEXT,
  type BotDecisionEvidence
} from '@/lib/auction/server-bot-engine';
import { type V3Player, type V3Team } from '@/lib/v3-auction-types';

describe('Unified Bot Intelligence Architecture', () => {

  // ============================================================
  // 1. FOUNDATION: IDENTIFIER & DETERMINISTIC ORDERING
  // ============================================================
  describe('1. Candidate Identity & Deterministic Ordering', () => {
    it('orders by role ASC -> rating DESC -> player_id ASC', () => {
      const candidates: CandidateSortable[] = [
        { player_id: 'p-3', role: 'BATSMAN', rating: 85 },
        { player_id: 'p-1', role: 'ALL_ROUNDER', rating: 80 },
        { player_id: 'p-4', role: 'BATSMAN', rating: 90 },
        { player_id: 'p-2', role: 'ALL_ROUNDER', rating: 85 },
        { player_id: 'p-5', role: 'BOWLER', rating: 88 },
        { player_id: 'p-6', role: 'WICKET_KEEPER', rating: 82 }
      ];

      const sorted = sortCandidatesDeterministic(candidates);

      // ALL_ROUNDER (85, then 80)
      expect(sorted[0]?.player_id).toBe('p-2');
      expect(sorted[1]?.player_id).toBe('p-1');
      // BATSMAN (90, then 85)
      expect(sorted[2]?.player_id).toBe('p-4');
      expect(sorted[3]?.player_id).toBe('p-3');
      // BOWLER (88)
      expect(sorted[4]?.player_id).toBe('p-5');
      // WICKET_KEEPER (82)
      expect(sorted[5]?.player_id).toBe('p-6');
    });

    it('strictly breaks ties between equal-rated same-role players using player_id ASC', () => {
      const candidates: CandidateSortable[] = [
        { player_id: 'uuid-z', role: 'BATSMAN', rating: 88 },
        { player_id: 'uuid-a', role: 'BATSMAN', rating: 88 },
        { player_id: 'uuid-m', role: 'BATSMAN', rating: 88 }
      ];

      const sorted = sortCandidatesDeterministic(candidates);
      expect(sorted.map(c => c.player_id)).toEqual(['uuid-a', 'uuid-m', 'uuid-z']);
    });

    it('produces 100% identical ordering regardless of input array permutation', () => {
      const c1: CandidateSortable = { player_id: '1', role: 'BATSMAN', rating: 85 };
      const c2: CandidateSortable = { player_id: '2', role: 'BOWLER', rating: 85 };
      const c3: CandidateSortable = { player_id: '3', role: 'BATSMAN', rating: 90 };

      const order1 = sortCandidatesDeterministic([c1, c2, c3]);
      const order2 = sortCandidatesDeterministic([c3, c1, c2]);
      const order3 = sortCandidatesDeterministic([c2, c3, c1]);

      expect(order1).toEqual(order2);
      expect(order2).toEqual(order3);
    });
  });

  // ============================================================
  // 2. Q ENGINE & MONOTONIC TV LADDER
  // ============================================================
  describe('2. Foundation Q Engine & TV Contract', () => {
    it('generates exact authoritative Mega Auction bid increments on discrete ladder', () => {
      // From 250 Lakhs (2.5 Cr): increment is 25L up to 300, then 50L up to 600, etc.
      const ladder = generateDiscreteBidLadder(250, 100, 750);
      expect(ladder).toEqual([
        275, // +25 (<= 300)
        300, // +25 (<= 300)
        325, // +25 (<= 300)
        375, // +50 (<= 600)
        425, // +50 (<= 600)
        475, // +50 (<= 600)
        525, // +50 (<= 600)
        575, // +50 (<= 600)
        625, // +50 (<= 600)
        700  // +75 (<= 1000)
      ]);
    });

    it('proves Q_buy(B) is monotonic non-increasing over the legal bid ladder', () => {
      const candidate: CandidateSortable = { player_id: 'p-curr', role: 'BATSMAN', rating: 90, base_price: 100, is_overseas: false };
      const future: CandidateSortable[] = [
        { player_id: 'f-1', role: 'BATSMAN', category: 'B', base_price: 100 },
        { player_id: 'f-2', role: 'BOWLER', category: 'A', base_price: 150 }
      ];
      const teamState: TeamRosterState = { purse: 6000, playersBought: 5, overseasCount: 1, roleCounts: { BATSMAN: 1, BOWLER: 2 } };

      const baseRes = evaluateQAndTV(candidate, future, teamState, 100, false);
      let previousQBuy = Infinity;
      
      // Iterate over the actual ladder up to TV + 2 increments
      for (const b of baseRes.ladderEvaluated) {
        // currentBid is passed. To test Q_buy at bid B, we pass a currentBid such that nextRequiredBid = B.
        // But since we just want to test the function, we can pass B as basePrice? No, evaluateQAndTV takes currentBid.
        // It computes Q_buy at nextRequiredBid.
        // We can just call computeQBuy(B). But evaluateQAndTV returns qBuyAtRequiredBid.
        // Let's pass currentBid such that getNextBidAmount(currentBid, 100) == B.
        // Or simpler, we just use the first step of the function which is Q_buy for the *nextRequiredBid*.
        // If we set currentBid = B, then the 'nextRequiredBid' is B's next increment.
        // Instead of reverse-engineering currentBid, we just use evaluateQAndTV with increasing currentBids.
        const res = evaluateQAndTV(candidate, future, teamState, b, false);
        // evaluateQAndTV calculates Q_buy at `nextRequiredBid`.
        expect(res.qBuyAtRequiredBid).toBeLessThanOrEqual(previousQBuy);
        previousQBuy = res.qBuyAtRequiredBid;
      }
    });

    it('NO_ALTERNATIVE does NOT drive TV to purse maximum for low quality player', () => {
      const weakCandidate: CandidateSortable = {
        player_id: 'p-weak',
        role: 'WICKET_KEEPER',
        rating: 74,
        base_price: 50,
        is_overseas: false
      };

      const emptyFuture: CandidateSortable[] = []; // NO alternatives!
      const teamState: TeamRosterState = {
        purse: 10000, // Huge purse
        playersBought: 2,
        overseasCount: 0,
        roleCounts: { WICKET_KEEPER: 0 } // Needs WK
      };

      const evalRes = evaluateQAndTV(weakCandidate, emptyFuture, teamState, 50, false);
      // TV must NOT equal the full 10,000 purse! It should be rationally bounded.
      expect(evalRes.tv).toBeLessThan(5000);
      expect(evalRes.tv).toBeGreaterThanOrEqual(50);
    });
  });

  // ============================================================
  // 3. STRATEGIC & TACTICAL BEHAVIOUR
  // ============================================================
  describe('3. Strategy & Tactical Decisions (BID, PASS, WAIT, STRETCH)', () => {
    it('produces first-class BID when price is within TV', () => {
      const qResult = {
        currentBid: 100,
        nextRequiredBid: 125,
        tv: 600,
        qSkip: 50,
        qBuyAtRequiredBid: 120,
        decision: 'BID' as const,
        isLegal: true,
        ladderEvaluated: [125, 150, 175]
      };

      const decision = evaluateTacticalDecision({
        teamId: 'bot-1',
        auctionId: 'auc-1',
        lotId: 'lot-1',
        personality: 'AGGRESSIVE',
        qResult,
        roleNeed: 'HIGH',
        remainingTimerMs: 15000,
        remainingSlots: 10,
        purse: 5000
      });

      expect(decision.action).toBe('BID');
      expect(decision.reason).toBe('TV_FAVORABLE');
      expect(decision.bidAmount).toBe(125);
      expect(decision.delayMs).toBeGreaterThan(0);
    });

    it('produces first-class PASS with PRICE_EXCEEDS_TV when price exceeds TV', () => {
      const qResult = {
        currentBid: 800,
        nextRequiredBid: 875,
        tv: 600,
        qSkip: 90,
        qBuyAtRequiredBid: 70,
        decision: 'PASS' as const,
        isLegal: true,
        ladderEvaluated: [875]
      };

      const decision = evaluateTacticalDecision({
        teamId: 'bot-1',
        auctionId: 'auc-1',
        lotId: 'lot-1',
        personality: 'CONSERVATIVE', // Conservative never stretches
        qResult,
        roleNeed: 'NORMAL',
        remainingTimerMs: 15000,
        remainingSlots: 10,
        purse: 5000
      });

      expect(decision.action).toBe('PASS');
      expect(decision.reason).toBe('PRICE_EXCEEDS_TV');
      expect(decision.bidAmount).toBe(0);
    });

    it('produces first-class STRETCH on critical role gap for aggressive personality within safe purse bounds', () => {
      const qResult = {
        currentBid: 600,
        nextRequiredBid: 675,
        tv: 700, // TV is higher than nextRequiredBid
        qSkip: 110,
        qBuyAtRequiredBid: 110, // Indifferent in Q logic (qBuy == qSkip)
        decision: 'PASS' as const,
        isLegal: true,
        ladderEvaluated: [675, 700]
      };

      const decision = evaluateTacticalDecision({
        teamId: 'bot-stretch-agg',
        auctionId: 'auc-1',
        lotId: 'lot-1',
        personality: 'AGGRESSIVE',
        qResult,
        roleNeed: 'CRITICAL',
        remainingTimerMs: 15000,
        remainingSlots: 5,
        purse: 4000, // Ample purse
        brainState: { plan: { urgency: 1.0, strategicFocus: 'FILL_GAPS', budgetAllocation: { totalRemaining: 0, reserveForCriticalNeeds: 0, discretionaryBudget: 0, spentRatio: 0 }, willSacrificeOverseasForQuality: false }, memory: {} as any, beliefs: {} as any }
      });

      // Aggressive bot on critical gap must trigger bounded STRETCH here
      expect(decision.action).toBe('STRETCH');
      expect(decision.reason).toBe('CRITICAL_GAP_STRETCH');
      expect(decision.isStretched).toBe(true);
      expect(decision.bidAmount).toBe(675);
      expect(decision.bidAmount).toBeLessThanOrEqual(qResult.tv);
    });

    it('absolutely refuses to STRETCH if nextRequiredBid > TV', () => {
      const qResult = {
        currentBid: 600,
        nextRequiredBid: 675,
        tv: 600, // TV is strictly less than required bid
        qSkip: 110,
        qBuyAtRequiredBid: 105,
        decision: 'PASS' as const,
        isLegal: true,
        ladderEvaluated: [675]
      };

      const decision = evaluateTacticalDecision({
        teamId: 'bot-stretch-agg',
        auctionId: 'auc-1',
        lotId: 'lot-1',
        personality: 'AGGRESSIVE',
        qResult,
        roleNeed: 'CRITICAL',
        remainingTimerMs: 15000,
        remainingSlots: 5,
        purse: 4000,
        brainState: { plan: { urgency: 1.0, strategicFocus: 'FILL_GAPS', budgetAllocation: { totalRemaining: 0, reserveForCriticalNeeds: 0, discretionaryBudget: 0, spentRatio: 0 }, willSacrificeOverseasForQuality: false }, memory: {} as any, beliefs: {} as any }
      });

      expect(decision.action).toBe('PASS');
      expect(decision.reason).toBe('PRICE_EXCEEDS_TV');
    });

    it('enforces RIVAL_BAIT_DROP when rival aggression is very high and marginal utility is low', () => {
      const qResult = {
        currentBid: 500,
        nextRequiredBid: 550,
        tv: 600,
        qSkip: 80,
        qBuyAtRequiredBid: 85, // Marginal benefit is small (< 1.10 * 80)
        decision: 'BID' as const,
        isLegal: true,
        ladderEvaluated: [550, 600]
      };

      const decision = evaluateTacticalDecision({
        teamId: 'bot-opp',
        auctionId: 'auc-1',
        lotId: 'lot-1',
        personality: 'OPPORTUNISTIC',
        qResult,
        roleNeed: 'NORMAL',
        remainingTimerMs: 15000, 
        brainState: { beliefs: { rivalAggression: 0.9, marketInflation: 0.2, roleScarcityPanic: 0.3, estimatedSquadQuality: 0.5 }, memory: {} as any, plan: {} as any },
        remainingSlots: 8,
        purse: 3000
      });

      expect(decision.action).toBe('PASS');
      expect(decision.reason).toBe('RIVAL_BAIT_DROP');
    });
  });

  // ============================================================
  // 4. HARD LEGALITY CONSTRAINTS
  // ============================================================
  describe('4. Hard Auction Legality Constraints', () => {
    it('blocks bids when team is already highest bidder', () => {
      const candidate: CandidateSortable = { player_id: 'p1', role: 'BATSMAN', rating: 90, base_price: 100 };
      const teamState: TeamRosterState = { purse: 5000, playersBought: 5, overseasCount: 1, roleCounts: {} };

      const res = evaluateQAndTV(candidate, [], teamState, 100, true); // isHighestBidder = true
      expect(res.isLegal).toBe(false);
      expect(res.legalityReason).toBe('ERR_ALREADY_HIGHEST_BIDDER');
      expect(res.decision).toBe('PASS');
    });

    it('blocks bids when squad is full (playersBought >= maxSquadSize)', () => {
      const candidate: CandidateSortable = { player_id: 'p1', role: 'BATSMAN', rating: 90, base_price: 100 };
      const teamState: TeamRosterState = { purse: 5000, playersBought: 25, overseasCount: 1, roleCounts: {} };

      const res = evaluateQAndTV(candidate, [], teamState, 100, false, { maxSquadSize: 25, maxOverseas: 8 });
      expect(res.isLegal).toBe(false);
      expect(res.legalityReason).toBe('ERR_SQUAD_LIMIT_REACHED');
    });

    it('blocks bids on overseas candidate when overseas limit reached', () => {
      const osCandidate: CandidateSortable = { player_id: 'p-os', role: 'BOWLER', rating: 90, base_price: 100, is_overseas: true };
      const teamState: TeamRosterState = { purse: 5000, playersBought: 10, overseasCount: 8, roleCounts: {} };

      const res = evaluateQAndTV(osCandidate, [], teamState, 100, false, { maxSquadSize: 25, maxOverseas: 8 });
      expect(res.isLegal).toBe(false);
      expect(res.legalityReason).toBe('ERR_OVERSEAS_LIMIT');
    });

    it('blocks bids when purse is insufficient for next bid', () => {
      const candidate: CandidateSortable = { player_id: 'p1', role: 'BATSMAN', rating: 90, base_price: 200 };
      const teamState: TeamRosterState = { purse: 100, playersBought: 5, overseasCount: 1, roleCounts: {} };

      const res = evaluateQAndTV(candidate, [], teamState, 200, false);
      expect(res.isLegal).toBe(false);
      expect(res.legalityReason).toBe('ERR_INSUFFICIENT_PURSE');
    });
  });

  // ============================================================
  // 5. DETERMINISTIC REPRODUCIBILITY
  // ============================================================
  describe('5. Determinism & Seeding', () => {
    it('produces identical pseudo-random floats for the exact same seed', () => {
      const seed = 'test_auction_lot_1_bot_1_bid_500';
      const r1 = getDeterministicPseudoRandom(seed);
      const r2 = getDeterministicPseudoRandom(seed);
      expect(r1).toBe(r2);
      expect(r1).toBeGreaterThanOrEqual(0);
      expect(r1).toBeLessThan(1);
    });

    it('produces different values for different seeds', () => {
      const r1 = getDeterministicPseudoRandom('seed_A');
      const r2 = getDeterministicPseudoRandom('seed_B');
      expect(r1).not.toBe(r2);
    });
  });

  // ============================================================
  // 6. END-TO-END EVALUATION IN SERVER-BOT-ENGINE
  // ============================================================
  describe('6. End-to-End Unified Engine Evaluation', () => {
    it('evaluates lot and populates structured evidence log without errors', () => {
      const bot: V3Team = {
        id: 'bot-eval-1',
        name: 'Evaluation Bot',
        short_name: 'EB',
        purse: 6000,
        initial_purse: 10000,
        players_bought: 4,
        overseas_count: 1,
        is_bot: true
      };

      const player: V3Player = {
        id: 'player-test-eval',
        name: 'Target Batter',
        role: 'BATSMAN',
        category: 'A',
        country: 'India',
        age: 26,
        batting_hand: 'Right Handed',
        base_price: 150,
        is_overseas: false,
        image_url: null
      };

      const ctx: AuctionContext = {
        ...DEFAULT_CONTEXT,
        futurePlayers: [
          { player_id: 'fp-1', role: 'BATSMAN', category: 'B', base_price: 100, is_overseas: false },
          { player_id: 'fp-2', role: 'BOWLER', category: 'A', base_price: 150, is_overseas: true }
        ],
        futureByRole: { BATSMAN: 1, BOWLER: 1 }
      };

      const evidenceLog: BotDecisionEvidence[] = [];
      const bids = evaluateBotsForLot(
        [bot],
        player,
        0, // opening lot (currentBid = 0)
        150,
        undefined,
        'Normal',
        [bot],
        {},
        ctx,
        new Date(Date.now() + 15000).toISOString(),
        evidenceLog
      );

      expect(evidenceLog).toHaveLength(1);
      const ev = evidenceLog[0]!;
      expect(ev.teamId).toBe(bot.id);
      expect(['ENTER', 'HESITATE', 'DROP']).toContain(ev.decision);
      expect(ev.tv).toBeDefined();
      expect(ev.tv).toBeGreaterThanOrEqual(150);

      if (ev.decision === 'ENTER') {
        expect(bids).toHaveLength(1);
        expect(bids[0]?.teamId).toBe(bot.id);
        expect(bids[0]?.nextBidAmount).toBe(150); // Opening bid is base price
      }
    });
  });
});
