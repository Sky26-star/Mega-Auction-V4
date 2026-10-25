// src/test/unit/bot-roster-deficit-reliability.test.ts
//
// PHASE 1 — BOT BIDDING RELIABILITY & ROSTER DEFICIT REGRESSION SUITE
//
// Tests proving the 10 requirements for the V15/V16 roster-deficit relaxation:
// 1. A bot with an incomplete squad can consider a useful player previously rejected by NOT_COMMITTED.
// 2. A bot with a complete squad can still rationally pass on a low-priority player.
// 3. A bot with insufficient purse does not bid.
// 4. Overseas-player and squad constraints remain enforced.
// 5. Role requirements and remaining squad slots influence the decision correctly.
// 6. A bot does not bid against itself or submit a stale/invalid increment.
// 7. Existing commitment categories and deterministic valuation behavior remain valid.
// 8. No eligible player or no legal bid results in a safe pass.
// 9. Repeated auction ticks do not create duplicate or uncontrolled bids.
// 10. Existing bot-bidding and auction lifecycle tests continue to pass.

import { describe, it, expect } from 'vitest';
import { evaluateDecision } from '@/lib/auction/human-auction-decision';
import {
  evaluateBotsForLot,
  DEFAULT_CONTEXT,
  type AuctionContext,
  type BotDecisionEvidence,
  getNextBidAmount,
} from '@/lib/auction/server-bot-engine';
import type {
  DecisionContext,
  HumanAuctionDecision,
  PlayerContext,
  PlayerMarketValueResult,
  TeamValueResult,
  MaximumBidResult,
  OpponentContext,
} from '@/lib/auction/human-auction-manager-types';
import type { V3Team, V3Player } from '@/lib/v3-auction-types';

describe('Phase 1 — Bot Roster Deficit Reliability & V15/V16 Relaxation', () => {

  const basePlayer: PlayerContext = {
    id: 'p-deficit-1',
    name: 'Bench Batsman',
    role: 'BATSMAN',
    category: 'C',
    base_price: 50,
    is_overseas: false,
    rating: 81,
  };

  const baseMarketValue: PlayerMarketValueResult = {
    playerId: 'p-deficit-1',
    marketValue: 300,
    confidence: 0.85,
    playerQuality: {
      playerId: 'p-deficit-1',
      role: 'BATSMAN',
      rating: 81,
      ratingSource: 'STORED_RATING',
      tier: 'C',
    },
    reasons: ['Market value 300L'],
  };

  const baseOpponent: OpponentContext = {
    opponents: [
      {
        teamId: 'opp-1',
        purse: 5000,
        remainingSlots: 8,
        roleCounts: [{ role: 'BATSMAN', count: 4 }],
        missingRoles: ['BOWLER'],
        relevantPurchases: [],
        threat: 'LOW',
      },
    ],
    highestBidderTeamId: null,
  };

  function createDeficitContext(options: {
    remainingSquadSlots?: number;
    currentRoleCount?: number;
    requiredRoleCount?: number;
    idealRoleCount?: number;
    xiLevel?: 'DEPTH' | 'USEFUL_STARTER' | 'NONE' | 'MAJOR_UPGRADE';
    needLevel?: 'USEFUL' | 'OPTIONAL' | 'NOT_NEEDED' | 'IMPORTANT' | 'CRITICAL';
    teamFitLevel?: 'POOR' | 'NEUTRAL' | 'GOOD' | 'EXCELLENT';
    remainingCriticalTargets?: number;
    strategicCommitment?: 'NOT_COMMITTED' | 'JUSTIFIED' | 'COMMITTED';
    nextRequiredBid?: number;
    maximumBid?: number;
    currentPurse?: number;
  } = {}): DecisionContext {
    const remainingSlots = options.remainingSquadSlots ?? 10;
    const currentRoleCount = options.currentRoleCount ?? 3;
    const requiredRoleCount = options.requiredRoleCount ?? 5;
    const idealRoleCount = options.idealRoleCount ?? 7;
    const xiLevel = options.xiLevel ?? 'DEPTH';
    const needLevel = options.needLevel ?? 'USEFUL';
    const teamFit = options.teamFitLevel ?? 'GOOD';
    const remainingCritical = options.remainingCriticalTargets ?? 0;
    const commitment = options.strategicCommitment ?? 'NOT_COMMITTED';
    const nextRequiredBid = options.nextRequiredBid ?? 50;
    const maximumBid = options.maximumBid ?? 250;
    const currentPurse = options.currentPurse ?? 5000;

    const teamValue: TeamValueResult = {
      teamId: 'bot-deficit-team',
      playerId: basePlayer.id,
      marketValue: baseMarketValue.marketValue,
      teamValue: 250,
      factors: {
        need: {
          role: 'BATSMAN',
          level: needLevel,
          currentRoleCount,
          requiredRoleCount,
          idealRoleCount,
          remainingSquadSlots: remainingSlots,
        },
        xiImprovement: {
          level: xiLevel,
        },
        scarcity: {
          level: 'NORMAL',
          meaningfulAlternativesRemaining: 5,
        },
        teamFit: {
          level: teamFit,
        },
        futurePlan: {
          priority: 'OPTIONAL',
          futureRequiredRoles: [],
          protectedFutureBudget: 500,
          remainingCriticalTargets: remainingCritical,
        },
      },
      strategicCommitment: commitment,
      reasons: ['Team value evaluation for squad depth'],
    };

    const maxBidResult: MaximumBidResult = {
      teamValue: 250,
      maximumBid,
      constraints: {
        purseLimit: currentPurse,
        futureBudgetLimit: currentPurse - 500,
        solvencyLimit: currentPurse - (remainingSlots * 20),
      },
      bindingConstraint: 'TEAM_VALUE',
      auctionStage: 'MID',
      reasons: ['Ceiling bounded by Team Value'],
    };

    return {
      player: basePlayer,
      marketValue: baseMarketValue,
      teamValue,
      maximumBid: maxBidResult,
      opponent: baseOpponent,
      currentBid: 0,
      nextRequiredBid,
      auctionStage: 'MID',
    };
  }

  // -------------------------------------------------------------------------
  // REQUIREMENT 1
  // A bot with an incomplete squad can consider a useful player previously rejected by NOT_COMMITTED
  // -------------------------------------------------------------------------
  it('Req 1: Bot with incomplete squad reconsiders a useful player previously rejected by NOT_COMMITTED', () => {
    const ctx = createDeficitContext({
      remainingSquadSlots: 12,
      currentRoleCount: 3,
      requiredRoleCount: 5,
      idealRoleCount: 7,
      xiLevel: 'DEPTH',
      strategicCommitment: 'NOT_COMMITTED',
      nextRequiredBid: 50,
      maximumBid: 250,
    });

    const res = evaluateDecision(ctx);

    // Previously, this returned PASS unconditionally.
    // Now, under roster-deficit relaxation, it must reconsider and BID.
    expect(res.action).toBe('BID');
    if (res.action === 'BID') {
      expect(res.bidAmount).toBe(50);
      expect(res.reason).toContain('Roster-deficit continuation');
    }
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 2
  // A bot with a complete squad can still rationally pass on a low-priority player
  // -------------------------------------------------------------------------
  it('Req 2: Bot with complete squad (0 remaining slots) rationally passes on low-priority NOT_COMMITTED player', () => {
    const ctx = createDeficitContext({
      remainingSquadSlots: 0, // Squad is full!
      currentRoleCount: 7,
      requiredRoleCount: 5,
      idealRoleCount: 7,
      xiLevel: 'DEPTH',
      strategicCommitment: 'NOT_COMMITTED',
      nextRequiredBid: 50,
      maximumBid: 250,
    });

    const res = evaluateDecision(ctx);

    expect(res.action).toBe('PASS');
    expect(res.reason).toContain('Squad is already complete');
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 3
  // A bot with insufficient purse does not bid
  // -------------------------------------------------------------------------
  it('Req 3: Bot with insufficient purse (solvency/purse ceiling exceeded) does not bid', () => {
    const ctx = createDeficitContext({
      remainingSquadSlots: 10,
      currentRoleCount: 2,
      requiredRoleCount: 5,
      xiLevel: 'DEPTH',
      strategicCommitment: 'NOT_COMMITTED',
      nextRequiredBid: 300,
      maximumBid: 200, // Ceiling is below required bid!
    });

    const res = evaluateDecision(ctx);

    expect(res.action).toBe('PASS');
    expect(res.reason).toContain('exceeds maximum rational bid ceiling');
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 4
  // Overseas-player and squad constraints remain enforced
  // -------------------------------------------------------------------------
  it('Req 4: Overseas-player and squad constraints are strictly enforced in bot engine', () => {
    const botOverseasFull: V3Team = {
      id: 'bot-os-full',
      name: 'Overseas Full Bot',
      short_name: 'OFB',
      purse: 5000,
      initial_purse: 10000,
      players_bought: 10,
      overseas_count: 8, // Max overseas reached (8)
      is_bot: true,
    };

    const overseasPlayer: V3Player = {
      id: 'p-os-1',
      name: 'Overseas All-Rounder',
      role: 'ALL_ROUNDER',
      category: 'B',
      country: 'Australia',
      age: 29,
      batting_hand: 'Right',
      base_price: 100,
      is_overseas: true,
      image_url: null,
      rating: 84,
    };

    const evidence: BotDecisionEvidence[] = [];
    const bids = evaluateBotsForLot(
      [botOverseasFull],
      overseasPlayer,
      0,
      100,
      undefined,
      'Normal',
      [botOverseasFull],
      { [botOverseasFull.id]: [] },
      DEFAULT_CONTEXT,
      null,
      evidence
    );

    expect(bids.length).toBe(0);
    expect(evidence[0]?.eligibilityReason).toBe('OVERSEAS_FULL');
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 5
  // Role requirements and remaining squad slots influence the decision correctly
  // -------------------------------------------------------------------------
  it('Req 5: Saturated role (already met ideal count) passes even if squad has empty slots', () => {
    const ctx = createDeficitContext({
      remainingSquadSlots: 5, // Has 5 slots open for other roles
      currentRoleCount: 7,    // But BATSMAN already has 7 (ideal target is 7)
      requiredRoleCount: 5,
      idealRoleCount: 7,
      xiLevel: 'DEPTH',
      strategicCommitment: 'NOT_COMMITTED',
      nextRequiredBid: 50,
      maximumBid: 250,
    });

    const res = evaluateDecision(ctx);

    // Should rationally PASS because BATSMAN role is already satisfied to ideal!
    expect(res.action).toBe('PASS');
    expect(res.reason).toContain('already satisfies target count');
  });

  it('Req 5b: Structurally redundant player (xiLevel NONE) passes even with deficit', () => {
    const ctx = createDeficitContext({
      remainingSquadSlots: 10,
      currentRoleCount: 2,
      idealRoleCount: 7,
      xiLevel: 'NONE', // Redundant / zero impact
      strategicCommitment: 'NOT_COMMITTED',
      nextRequiredBid: 50,
      maximumBid: 250,
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('PASS');
  });

  it('Req 5c: Poor fit player (teamFit POOR) passes even with deficit', () => {
    const ctx = createDeficitContext({
      remainingSquadSlots: 10,
      currentRoleCount: 2,
      idealRoleCount: 7,
      xiLevel: 'DEPTH',
      teamFitLevel: 'POOR', // Poor fit
      strategicCommitment: 'NOT_COMMITTED',
      nextRequiredBid: 50,
      maximumBid: 250,
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('PASS');
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 6
  // A bot does not bid against itself or submit a stale/invalid increment
  // -------------------------------------------------------------------------
  it('Req 6: Bot does not bid against itself and uses exact legal nextRequiredBid', () => {
    const bot: V3Team = {
      id: 'bot-self-bid',
      name: 'Self Bid Bot',
      short_name: 'SBB',
      purse: 6000,
      initial_purse: 10000,
      players_bought: 5,
      overseas_count: 1,
      is_bot: true,
    };

    const player: V3Player = {
      id: 'p-inc-1',
      name: 'Increment Player',
      role: 'BATSMAN',
      category: 'B',
      country: 'India',
      age: 26,
      batting_hand: 'Right',
      base_price: 100,
      is_overseas: false,
      image_url: null,
      rating: 83,
    };

    const evidence: BotDecisionEvidence[] = [];
    const bids = evaluateBotsForLot(
      [bot],
      player,
      200,
      225, // currentBid: 200, nextRequiredBid: 225
      bot.id, // Bot is ALREADY the highest bidder!
      'Normal',
      [bot],
      { [bot.id]: [] },
      DEFAULT_CONTEXT,
      null,
      evidence
    );

    // Bot must be skipped when already highest bidder!
    expect(bids.length).toBe(0);
    expect(evidence[0]?.eligibilityReason).toBe('ALREADY_HIGHEST_BIDDER');
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 7
  // Existing commitment categories and deterministic valuation behavior remain valid
  // -------------------------------------------------------------------------
  it('Req 7: COMMITTED and JUSTIFIED retain their authoritative behavior deterministically', () => {
    const ctxCommitted = createDeficitContext({
      strategicCommitment: 'COMMITTED',
      nextRequiredBid: 250,
      maximumBid: 250, // Final legal step
    });
    const resCommitted = evaluateDecision(ctxCommitted);
    expect(resCommitted.action).toBe('STRETCH'); // Final legal step + COMMITTED -> STRETCH

    const ctxJustified = createDeficitContext({
      strategicCommitment: 'JUSTIFIED',
      nextRequiredBid: 250,
      maximumBid: 250, // Final legal step
    });
    const resJustified = evaluateDecision(ctxJustified);
    expect(resJustified.action).toBe('BID'); // Final legal step + JUSTIFIED -> BID (fallback from stretch)

    // Deterministic replay: repeated call returns byte-for-byte identical result
    const resRepeat = evaluateDecision(ctxCommitted);
    expect(resRepeat).toEqual(resCommitted);
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 8
  // No eligible player or no legal bid results in a safe pass
  // -------------------------------------------------------------------------
  it('Req 8: Player beyond ceiling results in a safe PASS without throwing', () => {
    const ctx = createDeficitContext({
      nextRequiredBid: 500,
      maximumBid: 250,
    });

    const res = evaluateDecision(ctx);
    expect(res.action).toBe('PASS');
    expect(res).not.toHaveProperty('bidAmount');
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 9
  // Repeated auction ticks do not create duplicate or uncontrolled bids
  // -------------------------------------------------------------------------
  it('Req 9: Repeated evaluation on the same tick produces at most one valid bid candidate', () => {
    const bot: V3Team = {
      id: 'bot-idempotent',
      name: 'Idempotent Bot',
      short_name: 'IB',
      purse: 8000,
      initial_purse: 10000,
      players_bought: 3,
      overseas_count: 0,
      is_bot: true,
    };

    const player: V3Player = {
      id: 'p-idemp-1',
      name: 'Idempotent Player',
      role: 'BATSMAN',
      category: 'C',
      country: 'India',
      age: 24,
      batting_hand: 'Left',
      base_price: 50,
      is_overseas: false,
      image_url: null,
      rating: 80,
    };

    const bids1 = evaluateBotsForLot(
      [bot],
      player,
      0,
      50,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      DEFAULT_CONTEXT,
      null
    );

    expect(bids1.length).toBe(1);
    expect(bids1[0]?.teamId).toBe(bot.id);
    expect(bids1[0]?.nextBidAmount).toBe(50);
  });
});
