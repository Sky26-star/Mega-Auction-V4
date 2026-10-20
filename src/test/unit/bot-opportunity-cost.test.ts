import { describe, it, expect } from 'vitest';
import { evaluateQAndTV } from '@/lib/auction/bot-q-engine';
import { evaluateTacticalDecision } from '@/lib/auction/bot-tactical-engine';
import { evaluateBotsForLot, DEFAULT_CONTEXT, type AuctionContext, type BotDecisionEvidence } from '@/lib/auction/server-bot-engine';
import { type V3Player, type V3Team } from '@/lib/v3-auction-types';

describe('Behavior B6: Opportunity Cost / Alternative Availability', () => {
  // Current candidate: solid Category B batsman (rating 82, base price 100L)
  const currentLot: V3Player & { rating?: number } = {
    id: 'current-lot-1',
    name: 'Category B Batsman',
    role: 'BATSMAN',
    category: 'B',
    country: 'India',
    age: 28,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
    rating: 82,
  };

  // Attractive alternative: high-quality MARQUEE batsman (rating 95, base price 200L)
  const futureAttractiveAlternatives = [
    {
      id: 'marquee-bat-1',
      name: 'Marquee Batsman',
      role: 'BATSMAN',
      category: 'MARQUEE',
      rating: 95,
      base_price: 200,
      is_overseas: false,
    },
  ];

  // Poor alternative: low-tier Category D batsman (rating 60, base price 50L)
  const futurePoorAlternatives = [
    {
      id: 'low-bat-1',
      name: 'Category D Batsman',
      role: 'BATSMAN',
      category: 'D',
      rating: 60,
      base_price: 50,
      is_overseas: false,
    },
  ];

  const futureNoAlternatives: any[] = [];

  const teamState = {
    purse: 5000,
    playersBought: 5,
    overseasCount: 2,
    roleCounts: {},
  };

  const botTeam: V3Team & { auction_id?: string } = {
    id: 'bot-b6-team',
    name: 'Bot B6 Franchise',
    short_name: 'B6F',
    is_bot: true,
    purse: 5000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 2,
    auction_id: 'auction-b6',
  };

  it('1. Authoritative Q/TV engine: TV drops and QSkip rises when attractive alternatives exist', () => {
    // Probed at active market bid 925 (next required bid = 1000)
    const currentBid = 925;

    const qAttr = evaluateQAndTV(currentLot as any, futureAttractiveAlternatives as any, teamState, currentBid, false);
    const qPoor = evaluateQAndTV(currentLot as any, futurePoorAlternatives as any, teamState, currentBid, false);
    const qNone = evaluateQAndTV(currentLot as any, futureNoAlternatives as any, teamState, currentBid, false);

    console.log('\n--- B6 Q/TV ECONOMIC VALUATION CONTRAST ---');
    console.log('B6_ATTRACTIVE_ALTERNATIVE:', {
      QSkip: qAttr.qSkip,
      QBuy: qAttr.qBuyAtRequiredBid,
      TV: qAttr.tv,
      CanonicalDecision: qAttr.decision,
    });
    console.log('B6_POOR_ALTERNATIVE:', {
      QSkip: qPoor.qSkip,
      QBuy: qPoor.qBuyAtRequiredBid,
      TV: qPoor.tv,
      CanonicalDecision: qPoor.decision,
    });
    console.log('B6_NO_ALTERNATIVE:', {
      QSkip: qNone.qSkip,
      QBuy: qNone.qBuyAtRequiredBid,
      TV: qNone.tv,
      CanonicalDecision: qNone.decision,
    });

    // Q_skip contrast: value of preserving purse for attractive future alternative is highest
    expect(qAttr.qSkip).toBeGreaterThan(qPoor.qSkip);
    expect(qPoor.qSkip).toBeGreaterThan(qNone.qSkip);

    // TV contrast: True Value ceiling drops because attractive alternative makes overpaying irrational
    expect(qAttr.tv).toBe(925);
    expect(qPoor.tv).toBe(1075);
    expect(qNone.tv).toBe(1175);

    expect(qAttr.tv).toBeLessThan(qPoor.tv);
    expect(qPoor.tv).toBeLessThan(qNone.tv);

    // Decision at next required bid (1000): PASS vs BID
    expect(qAttr.decision).toBe('PASS');
    expect(qPoor.decision).toBe('BID');
    expect(qNone.decision).toBe('BID');
  });

  it('2. Tactical engine: produces downstream PASS vs BID difference based on TV boundary', () => {
    const currentBid = 925;

    const qAttr = evaluateQAndTV(currentLot as any, futureAttractiveAlternatives as any, teamState, currentBid, false);
    const qPoor = evaluateQAndTV(currentLot as any, futurePoorAlternatives as any, teamState, currentBid, false);
    const qNone = evaluateQAndTV(currentLot as any, futureNoAlternatives as any, teamState, currentBid, false);

    const baseTacticalInput = {
      teamId: botTeam.id,
      auctionId: 'auction-b6',
      lotId: currentLot.id,
      personality: 'BALANCED' as const,
      roleNeed: 'NORMAL' as const,
      strategicPolicy: null,
      brainState: null,
      basePrice: 100,
      remainingSlots: 20,
      purse: 5000,
      remainingTimerMs: 15000,
      initialPurse: 10000,
      auctionProgress: 0.2,
      maxSquadSize: 25,
    };

    const tacticalAttr = evaluateTacticalDecision({
      ...baseTacticalInput,
      qResult: qAttr,
      futurePoolCount: futureAttractiveAlternatives.length,
    });

    const tacticalPoor = evaluateTacticalDecision({
      ...baseTacticalInput,
      qResult: qPoor,
      futurePoolCount: futurePoorAlternatives.length,
    });

    const tacticalNone = evaluateTacticalDecision({
      ...baseTacticalInput,
      qResult: qNone,
      futurePoolCount: 0,
    });

    console.log('\n--- B6 TACTICAL DECISION CONTRAST ---');
    console.log('B6_ATTRACTIVE_ALTERNATIVE:', {
      QSkip: qAttr.qSkip,
      QBuy: qAttr.qBuyAtRequiredBid,
      TV: qAttr.tv,
      TacticalAction: tacticalAttr.action,
      Reason: tacticalAttr.reason,
    });
    console.log('B6_POOR_ALTERNATIVE:', {
      QSkip: qPoor.qSkip,
      QBuy: qPoor.qBuyAtRequiredBid,
      TV: qPoor.tv,
      TacticalAction: tacticalPoor.action,
      Reason: tacticalPoor.reason,
    });
    console.log('B6_NO_ALTERNATIVE:', {
      QSkip: qNone.qSkip,
      QBuy: qNone.qBuyAtRequiredBid,
      TV: qNone.tv,
      TacticalAction: tacticalNone.action,
      Reason: tacticalNone.reason,
    });

    // Attractive alternatives: price (1000) exceeds TV (920) -> PASS
    expect(tacticalAttr.action).toBe('PASS');
    expect(tacticalAttr.reason).toBe('PRICE_EXCEEDS_TV');

    // Poor alternatives: price (1000) is within TV (1070) -> BID
    expect(tacticalPoor.action).toBe('BID');
    expect(tacticalPoor.reason).toBe('TV_FAVORABLE');

    // No alternatives: price (1000) is well within TV (1170) -> BID
    expect(tacticalNone.action).toBe('BID');
    expect(tacticalNone.reason).toBe('TV_FAVORABLE');
  });

  it('3. Server bot engine integration: evaluateBotsForLot emits DROP vs ENTER evidence', () => {
    const currentBid = 925;

    const baseCtx: Omit<AuctionContext, 'futurePlayers'> = {
      ...DEFAULT_CONTEXT,
      maxSquadSize: 25,
      maxOverseas: 8,
      auctionProgress: 0.2,
    };

    // Scenario A: Attractive Alternative
    const evidenceAttr: BotDecisionEvidence[] = [];
    const bidsAttr = evaluateBotsForLot(
      [botTeam],
      currentLot,
      currentBid,
      100,
      undefined,
      'HARD',
      [botTeam],
      { [botTeam.id]: [] },
      { ...baseCtx, futurePlayers: futureAttractiveAlternatives },
      null,
      evidenceAttr,
      'auction-b6'
    );

    // Scenario B: Poor Alternative
    const evidencePoor: BotDecisionEvidence[] = [];
    const bidsPoor = evaluateBotsForLot(
      [botTeam],
      currentLot,
      currentBid,
      100,
      undefined,
      'HARD',
      [botTeam],
      { [botTeam.id]: [] },
      { ...baseCtx, futurePlayers: futurePoorAlternatives },
      null,
      evidencePoor,
      'auction-b6'
    );

    // Scenario C: No Alternative
    const evidenceNone: BotDecisionEvidence[] = [];
    const bidsNone = evaluateBotsForLot(
      [botTeam],
      currentLot,
      currentBid,
      100,
      undefined,
      'HARD',
      [botTeam],
      { [botTeam.id]: [] },
      { ...baseCtx, futurePlayers: futureNoAlternatives },
      null,
      evidenceNone,
      'auction-b6'
    );

    console.log('\n--- B6 SERVER BOT ENGINE END-TO-END CONTRAST ---');
    console.log('B6_ATTRACTIVE_ALTERNATIVE:', {
      Decision: evidenceAttr[0]?.decision,
      Reason: evidenceAttr[0]?.actionReason,
      TV: evidenceAttr[0]?.tv,
      BidsCount: bidsAttr.length,
    });
    console.log('B6_POOR_ALTERNATIVE:', {
      Decision: evidencePoor[0]?.decision,
      Reason: evidencePoor[0]?.actionReason,
      TV: evidencePoor[0]?.tv,
      BidsCount: bidsPoor.length,
      NextBid: bidsPoor[0]?.nextBidAmount,
    });
    console.log('B6_NO_ALTERNATIVE:', {
      Decision: evidenceNone[0]?.decision,
      Reason: evidenceNone[0]?.actionReason,
      TV: evidenceNone[0]?.tv,
      BidsCount: bidsNone.length,
      NextBid: bidsNone[0]?.nextBidAmount,
    });

    // Downstream contract under Phase 4/5/7:
    // With Category B rating 82 (MV 330, TV 410), current bid 950 (next required 1025)
    // exceeds maximum rational ceiling (410L) across all alternative scenarios.
    expect(evidenceAttr[0]?.decision).toBe('DROP');
    expect(evidenceAttr[0]?.actionReason).toBe('PRICE_EXCEEDS_TV');
    expect(evidenceAttr[0]?.tv).toBe(410);
    expect(bidsAttr).toHaveLength(0); // Drops out: price exceeds TV ceiling

    expect(evidencePoor[0]?.decision).toBe('DROP');
    expect(evidencePoor[0]?.actionReason).toContain('exceeds maximum rational bid');
    expect(evidencePoor[0]?.tv).toBe(410);
    expect(bidsPoor).toHaveLength(0); // Drops out: price exceeds TV ceiling

    expect(evidenceNone[0]?.decision).toBe('DROP');
    expect(evidenceNone[0]?.actionReason).toContain('exceeds maximum rational bid');
    expect(evidenceNone[0]?.tv).toBe(410);
    expect(bidsNone).toHaveLength(0); // Drops out: price exceeds TV ceiling
  });
});
