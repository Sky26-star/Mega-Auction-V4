import { describe, it, expect } from 'vitest';
import {
  assemblePlayerContext,
  assemblePlayerQualityContext,
  assemblePlayerQualityResult,
  assembleMarketValueContext,
  assembleTeamNeedContext,
  assembleXIImprovementContext,
  assemblePlayerScarcityContext,
  assembleTeamFitContext,
  assembleFuturePlanContext,
  assemblePursePositionContext,
  assembleAuctionStage,
  assembleOpponentContext,
  assembleHumanAuctionManagerContext
} from '@/lib/auction/human-auction-manager-context';

import type { V3Player, V3Team } from '@/lib/v3-auction-types';
import type { AuctionContext } from '@/lib/auction/server-bot-engine';

describe('Human Auction Manager Context Assembly', () => {
  const mockPlayer: V3Player = {
    id: 'p1',
    name: 'Test Player',
    role: 'BATSMAN',
    category: 'A',
    country: 'India',
    age: 25,
    batting_hand: 'Right',
    base_price: 200,
    is_overseas: false,
    image_url: null,
    rating: 85
  };

  const mockTeam: V3Team = {
    id: 't1',
    name: 'Test Team',
    short_name: 'TST',
    purse: 5000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 2,
    is_bot: true
  };

  const mockAuctionCtx: AuctionContext = {
    maxSquadSize: 25,
    maxOverseas: 8,
    totalLots: 100,
    futurePlayers: [],
    futureByRole: { BATSMAN: 10 },
    futureOverseasCount: 5,
    futureAvgBasePrice: 100,
    futureMinBasePrice: 20,
    teamPurchasePrices: {},
    lotsCompleted: 20,
    lotsRemaining: 80,
    auctionProgress: 0.20,
    futureByRoleAndQuality: {},
    futureOverseasByRole: {}
  };

  describe('PlayerContext Assembly', () => {
    it('extracts exactly the required player fields', () => {
      const ctx = assemblePlayerContext(mockPlayer);
      expect(ctx.id).toBe('p1');
      expect(ctx.name).toBe('Test Player');
      expect(ctx.role).toBe('BATSMAN');
      expect(ctx.rating).toBe(85);
      expect((ctx as any).purse).toBeUndefined();
    });
  });

  describe('PlayerQuality Assembly', () => {
    it('assembles QualityResult from player rating', () => {
      const ctx = assemblePlayerQualityContext(mockPlayer);
      const res = assemblePlayerQualityResult(ctx);
      expect(res.rating).toBe(85);
      expect(res.ratingSource).toBe('STORED_RATING');
    });

    it('falls back to category estimate when rating is missing', () => {
      const p = { ...mockPlayer, rating: undefined as any };
      const ctx = assemblePlayerQualityContext(p);
      const res = assemblePlayerQualityResult(ctx);
      expect(res.rating).toBe(85); // Category A fallback
      expect(res.ratingSource).toBe('CATEGORY_ESTIMATE');
    });
  });

  describe('MarketValue Assembly', () => {
    it('isolates market value context from team details', () => {
      const qualityResult = assemblePlayerQualityResult(assemblePlayerQualityContext(mockPlayer));
      const ctx = assembleMarketValueContext({
        player: mockPlayer,
        quality: qualityResult,
        auctionCtx: mockAuctionCtx
      });
      expect(ctx.player.id).toBe('p1');
      expect(ctx.quality.rating).toBe(85);
      expect(ctx.market?.remainingRolePoolCount).toBe(10);
      expect((ctx as any).teamId).toBeUndefined();
      expect((ctx as any).purse).toBeUndefined();
    });
  });

  describe('TeamNeed Assembly', () => {
    it('maps legacy role need properly', () => {
      const ctx = assembleTeamNeedContext({
        playerRole: 'BATSMAN',
        roster: [],
        maxSquadSize: 25
      });
      // 0 batsman with max 25 -> min target 5 -> 'CRITICAL'
      expect(ctx.level).toBe('CRITICAL');
      expect(ctx.legacyRoleNeed).toBe('CRITICAL');
      expect(ctx.currentRoleCount).toBe(0);
      expect(ctx.requiredRoleCount).toBe(5);
    });
  });

  describe('XIImprovement Assembly', () => {
    it('maps raw rating heuristics correctly', () => {
      const q = assemblePlayerQualityResult(assemblePlayerQualityContext(mockPlayer)); // 85
      const ctx = assembleXIImprovementContext(q);
      expect(ctx.level).toBe('USEFUL_STARTER');
    });
  });

  describe('Scarcity Assembly', () => {
    it('maps future pool counts', () => {
      const ctx = assemblePlayerScarcityContext({
        playerRole: 'BATSMAN',
        auctionCtx: mockAuctionCtx
      });
      expect(ctx.level).toBe('NORMAL');
      expect(ctx.rolePoolRemaining).toBe(10);
    });
  });

  describe('PursePosition Assembly', () => {
    it('calculates min future spend', () => {
      const ctx = assemblePursePositionContext({
        team: mockTeam,
        maxSquadSize: 25
      });
      // 25 - 5 = 20 slots remaining. 20 * 20L = 400L min spend.
      expect(ctx.remainingSquadSlots).toBe(20);
      expect(ctx.minimumRequiredFutureSpend).toBe(400);
      // Purse is 5000, 400 needed -> SAFE
      expect(ctx.health).toBe('SAFE');
    });

    it('identifies DANGEROUS purse health', () => {
      const t = { ...mockTeam, purse: 500, players_bought: 5 }; // 20 slots, 400 needed. 500 < 400 + 200 => DANGEROUS
      const ctx = assemblePursePositionContext({
        team: t,
        maxSquadSize: 25
      });
      expect(ctx.health).toBe('DANGEROUS');
    });
  });

  describe('AuctionStage Assembly', () => {
    it('maps progress to stage', () => {
      expect(assembleAuctionStage({ ...mockAuctionCtx, auctionProgress: 0.1 })).toBe('EARLY');
      expect(assembleAuctionStage({ ...mockAuctionCtx, auctionProgress: 0.5 })).toBe('MID');
      expect(assembleAuctionStage({ ...mockAuctionCtx, auctionProgress: 0.8 })).toBe('LATE');
      expect(assembleAuctionStage({ ...mockAuctionCtx, auctionProgress: 0.95 })).toBe('ENDGAME');
    });
  });

  describe('OpponentContext Assembly', () => {
    it('maps all opponents securely without internal valuations', () => {
      const ctx = assembleOpponentContext({
        allTeams: [mockTeam, { ...mockTeam, id: 't2' }],
        teamRosters: {
          't1': [mockPlayer],
          't2': []
        },
        highestBidderTeamId: 't1'
      });
      expect(ctx.opponents).toHaveLength(2);
      expect(ctx.highestBidderTeamId).toBe('t1');
      const t1Opponent = ctx.opponents.find(o => o.teamId === 't1');
      expect(t1Opponent?.roleCounts[0]?.role).toBe('BATSMAN');
      expect(t1Opponent?.roleCounts[0]?.count).toBe(1);
      expect((t1Opponent as any).valuation).toBeUndefined(); // Should not have leaked bot internal valuation
    });
  });

  describe('Master Envelope Assembly', () => {
    it('assembles full envelope from raw inputs', () => {
      const qCtx = assemblePlayerQualityContext(mockPlayer);
      const qRes = assemblePlayerQualityResult(qCtx);

      const ctx = assembleHumanAuctionManagerContext({
        team: mockTeam,
        player: mockPlayer,
        roster: [],
        allTeams: [mockTeam],
        teamRosters: {},
        maxSquadSize: 25,
        auctionCtx: mockAuctionCtx,
        currentBid: 200,
        nextRequiredBid: 225,
        highestBidderTeamId: null,
        playerQualityResult: qRes,
        marketValueResult: { marketValue: 500 } as any
      });

      expect(ctx.teamId).toBe('t1');
      expect(ctx.player.id).toBe('p1');
      expect(ctx.teamNeed.level).toBe('CRITICAL');
      expect(ctx.purse.health).toBe('SAFE');
      expect(ctx.auctionStage).toBe('EARLY');
      expect(ctx.opponent.opponents).toHaveLength(1);
    });
  });
});
