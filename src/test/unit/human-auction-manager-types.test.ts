import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  HumanAuctionManagerContext,
  HumanAuctionDecision,
  MaximumBidResult,
  PlayerContext,
  PlayerQualityResult,
  PlayerMarketValueResult,
  PurseHealth,
  PursePositionContext,
  TeamValueResult,
  TeamValueFactors,
  MarketValueContext,
  StrategicCommitment,
} from '@/lib/auction/human-auction-manager-types';

// Contract-only tests: these verify the SHAPE of the Phase 1 types.
// No bidding behaviour is exercised because none is implemented.

const player: PlayerContext = {
  id: 'p-1',
  name: 'Test Batsman',
  role: 'BATSMAN',
  category: 'MARQUEE',
  base_price: 200,
  is_overseas: false,
  rating: 94,
};

const quality: PlayerQualityResult = {
  playerId: 'p-1',
  role: 'BATSMAN',
  rating: 94,
  ratingSource: 'STORED_RATING',
  tier: 'MARQUEE',
};

const marketValue: PlayerMarketValueResult = {
  playerId: 'p-1',
  marketValue: 1000,
  confidence: 0.8,
  playerQuality: quality,
  reasons: ['contract fixture'],
};

const factors: TeamValueFactors = {
  need: {
    role: 'BATSMAN',
    level: 'CRITICAL',
    currentRoleCount: 0,
    requiredRoleCount: 5,
    remainingSquadSlots: 25,
    bestXIRequirement: null,
    legacyRoleNeed: 'CRITICAL',
  },
  xiImprovement: { level: 'TRANSFORMATIVE' },
  scarcity: {
    level: 'VERY_SCARCE',
    meaningfulAlternativesRemaining: 0,
    alternativeAvailability: 'NO_MEANINGFUL_ALTERNATIVE',
  },
  teamFit: { level: 'EXCELLENT', structuralFit: 'EXACT_PRIMARY_TARGET' },
  futurePlan: {
    priority: 'MUST_HAVE',
    futureRequiredRoles: [{ role: 'BOWLER', count: 6 }],
    protectedFutureBudget: 3000,
    remainingCriticalTargets: 2,
  },
};

const makePurse = (health: PurseHealth): PursePositionContext => ({
  currentPurse: 10000,
  initialPurse: 10000,
  remainingSquadSlots: 25,
  minimumRequiredFutureSpend: 480,
  protectedFutureBudget: 3000,
  health,
});

const makeContext = (health: PurseHealth = 'SAFE'): HumanAuctionManagerContext => ({
  teamId: 'team-a',
  player,
  playerQuality: quality,
  marketValue,
  teamNeed: factors.need,
  xiImprovement: factors.xiImprovement,
  scarcity: factors.scarcity,
  teamFit: factors.teamFit,
  futurePlan: factors.futurePlan,
  purse: makePurse(health),
  opponent: { opponents: [], highestBidderTeamId: null },
  auctionStage: 'EARLY',
  currentBid: 1300,
  nextRequiredBid: 1400,
});

const base = {
  playerId: 'p-1',
  teamId: 'team-a',
  maximumBid: 1500,
  teamValue: 1500,
  marketValue: 1000,
  factors: [],
} as const;

describe('Human Auction Manager — Phase 1 contracts', () => {
  it('1. context can represent a CRITICAL role need', () => {
    expect(makeContext().teamNeed.level).toBe('CRITICAL');
  });

  it('2. context can represent VERY_SCARCE alternatives', () => {
    expect(makeContext().scarcity.level).toBe('VERY_SCARCE');
    expect(makeContext().scarcity.meaningfulAlternativesRemaining).toBe(0);
  });

  it('3. context can represent SAFE / TIGHT / DANGEROUS purse states', () => {
    const states: PurseHealth[] = ['SAFE', 'TIGHT', 'DANGEROUS'];
    expect(states.map((s) => makeContext(s).purse.health)).toEqual(states);
  });

  it('4. decision union distinguishes BID / STRETCH / PASS', () => {
    const decisions: HumanAuctionDecision[] = [
      { ...base, action: 'BID', bidAmount: 1400, reason: 'Critical role + strong XI improvement + price below maximum bid' },
      { ...base, action: 'STRETCH', bidAmount: 1500, reason: 'Critical role + very scarce alternatives + future squad remains viable' },
      { ...base, action: 'PASS', reason: 'Current bid exceeds maximum strategic value' },
    ];
    expect(decisions.map((d) => d.action)).toEqual(['BID', 'STRETCH', 'PASS']);
  });

  it('5. BID / STRETCH decisions carry a bid amount (PASS does not)', () => {
    const make = (): HumanAuctionDecision => ({ ...base, action: 'BID', bidAmount: 1400, reason: 'r' });
    const d = make();
    expect(d.action !== 'PASS' && d.bidAmount).toBe(1400);
    expectTypeOf<Extract<HumanAuctionDecision, { action: 'BID' }>>().toHaveProperty('bidAmount');
    expectTypeOf<Extract<HumanAuctionDecision, { action: 'STRETCH' }>>().toHaveProperty('bidAmount');
    expectTypeOf<Extract<HumanAuctionDecision, { action: 'PASS' }>>().not.toHaveProperty('bidAmount');
  });

  it('6. PASS decision carries a reason', () => {
    const d: HumanAuctionDecision = {
      ...base,
      action: 'PASS',
      reason: 'Current bid exceeds maximum strategic value',
      factors: [{ kind: 'PRICE_VS_MAXIMUM', detail: '1600 > 1500' }],
    };
    expect(d.reason).toBe('Current bid exceeds maximum strategic value');
    expect(d.factors[0]?.kind).toBe('PRICE_VS_MAXIMUM');
  });

  it('7. MaximumBidResult represents purse / future-budget / solvency constraints', () => {
    const result: MaximumBidResult = {
      teamValue: 1500,
      maximumBid: 1100,
      constraints: { purseLimit: 10000, futureBudgetLimit: 1100, solvencyLimit: 9520 },
      bindingConstraint: 'FUTURE_BUDGET',
      auctionStage: 'EARLY',
      reasons: ['future budget protected'],
    };
    expect(result.constraints.futureBudgetLimit).toBe(1100);
    expect(result.bindingConstraint).toBe('FUTURE_BUDGET');
    expectTypeOf<MaximumBidResult>().not.toHaveProperty('stretchAllowed');
  });

  it('stage boundaries: market value stage cannot see team/purse/opponent data', () => {
    expectTypeOf<MarketValueContext>().not.toHaveProperty('purse');
    expectTypeOf<MarketValueContext>().not.toHaveProperty('teamNeed');
    expectTypeOf<MarketValueContext>().not.toHaveProperty('opponent');
    expectTypeOf<TeamValueResult>().not.toHaveProperty('maximumBid');
  });

  it('8. TeamValueResult contract includes authoritative StrategicCommitment', () => {
    expectTypeOf<TeamValueResult>().toHaveProperty('strategicCommitment');
    expectTypeOf<TeamValueResult['strategicCommitment']>().toEqualTypeOf<StrategicCommitment>();
  });
});
