import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBotMemory,
  recordBotBidObservation,
  recordRivalBidObservation,
  syncBotMemoryWithState,
  clearAuctionMemory,
  clearBotMemory
} from '@/lib/auction/bot-brain-memory';
import {
  replanBotState,
  getBotBrainState,
  clearBrainStateCache
} from '@/lib/auction/bot-brain-state';
import {
  evaluateBotsForLot,
  DEFAULT_CONTEXT,
  type AuctionContext,
  type BotDecisionEvidence,
  getRoleNeed,
  computeFutureQualityMap
} from '@/lib/auction/server-bot-engine';
import {
  evaluateTacticalDecision,
  evaluatePursePacing,
  type TacticalInputContext
} from '@/lib/auction/bot-tactical-engine';
import { evaluateQAndTV } from '@/lib/auction/bot-q-engine';
import { type V3Player, type V3Team } from '@/lib/v3-auction-types';

describe('B1–B17 Cross-Behavior Integration Gate', () => {
  const auctionId = 'auction-gate-b1-b17';
  const auctionId2 = 'auction-gate-secondary';
  const botTeamAlpha = 'bot-team-alpha';
  const botTeamBeta = 'bot-team-beta';
  const botTeamGamma = 'bot-team-gamma';
  const rivalTeamId = 'rival-team-omega';

  beforeEach(() => {
    clearAuctionMemory(auctionId);
    clearAuctionMemory(auctionId2);
    clearBrainStateCache();
  });

  const makePlayer = (id: string, overrides: Partial<V3Player> = {}): V3Player => ({
    id,
    name: `Player ${id}`,
    role: 'BATSMAN',
    category: 'B',
    country: 'India',
    age: 26,
    batting_hand: 'Right Handed',
    base_price: 100,
    is_overseas: false,
    image_url: null,
    rating: 85,
    created_at: new Date().toISOString(),
    ...overrides
  });

  const makeBot = (id: string, overrides: Partial<V3Team> = {}): V3Team => ({
    id,
    name: `Franchise ${id}`,
    short_name: id.slice(0, 4).toUpperCase(),
    is_bot: true,
    purse: 8000,
    initial_purse: 10000,
    players_bought: 5,
    overseas_count: 2,
    ...overrides
  });

  // ============================================================
  // 1. B1 DYNAMIC ROLE NEED + B2 SCARCITY + B10 PURSE HEALTH
  // ============================================================
  it('1. B1 Role Need + B2 Scarcity + B10 Purse Health: Critical need & high scarcity bid within TV, bounded by purse solvency', () => {
    const wkPlayer = makePlayer('gate-wk-1', { role: 'WICKET_KEEPER', base_price: 100 });
    
    // Bot with 0 WKs has CRITICAL role need (B1)
    const bot = makeBot(botTeamAlpha, { purse: 6000, players_bought: 5 });
    const { need } = getRoleNeed('WICKET_KEEPER', 0, 20, 25);
    expect(need).toBe('CRITICAL');

    // Dwindling future pool of WKs creates high role scarcity (B2)
    const scarceFuturePool = [
      { player_id: 'future-bowler', role: 'BOWLER', category: 'C', base_price: 50, is_overseas: false }
    ];

    // Case A: Healthy purse -> B1 + B2 produces enthusiastic entry within TV, solvent (B10)
    const qHealthy = evaluateQAndTV(
      wkPlayer,
      scarceFuturePool,
      { purse: bot.purse, playersBought: bot.players_bought, overseasCount: bot.overseas_count, roleCounts: { WICKET_KEEPER: 0 } },
      200,
      false,
      { maxSquadSize: 25, maxOverseas: 8 }
    );
    expect(qHealthy.isLegal).toBe(true);
    expect(qHealthy.nextRequiredBid).toBeLessThanOrEqual(qHealthy.tv);

    const evidenceHealthy: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      wkPlayer,
      200,
      100,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      { ...DEFAULT_CONTEXT, futurePlayers: scarceFuturePool as any },
      null,
      evidenceHealthy,
      auctionId
    );
    expect(evidenceHealthy[0]!.decision).toBe('ENTER');
    expect(evidenceHealthy[0]!.valuation).toBeGreaterThanOrEqual(225);

    // Case B: Constrained purse violating minimum squad reserve -> B10 solvency overrides B1 + B2
    // 500L purse with 20 slots remaining: 500 - 225 = 275L < 19 * 20L = 380L reserve!
    const insolventBot = makeBot(botTeamAlpha, { purse: 500, players_bought: 5 });
    const evidenceInsolvent: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [insolventBot],
      wkPlayer,
      200,
      100,
      undefined,
      'Normal',
      [insolventBot],
      { [insolventBot.id]: [] },
      { ...DEFAULT_CONTEXT, futurePlayers: scarceFuturePool as any },
      null,
      evidenceInsolvent,
      auctionId
    );
    expect(evidenceInsolvent[0]!.decision).toBe('DROP');
    expect(evidenceInsolvent[0]!.actionReason).toBe('PURSE_INSOLVENCY');
  });

  // ============================================================
  // 2. B3 PURSE PACING + B6 OPPORTUNITY COST
  // ============================================================
  it('2. B3 Purse Pacing + B6 Opportunity Cost: Plentiful alternatives elevate Q_skip and trigger early preservation PASS', () => {
    const candidateBatsman = makePlayer('gate-bat-pacing', { role: 'BATSMAN', base_price: 100 });
    const bot = makeBot(botTeamAlpha, { purse: 4000, players_bought: 5, personality: 'BALANCED' } as any);

    // Existing roster already satisfies baseline batsman target, so roleNeed is NORMAL (non-critical)
    const existingRoster: V3Player[] = [
      makePlayer('roster-b1', { role: 'BATSMAN', base_price: 100 }),
      makePlayer('roster-b2', { role: 'BATSMAN', base_price: 100 }),
      makePlayer('roster-b3', { role: 'BATSMAN', base_price: 100 }),
      makePlayer('roster-b4', { role: 'BATSMAN', base_price: 50 }),
      makePlayer('roster-b5', { role: 'BATSMAN', base_price: 50 })
    ];

    // Plentiful high-quality alternatives in future pool
    const plentifulPool = Array.from({ length: 40 }, (_, i) => ({
      player_id: `future-alt-${i}`,
      role: 'BATSMAN',
      category: 'B',
      base_price: 100,
      is_overseas: false
    }));

    // B6: High opportunity cost of skipping (qSkip is high because waiting is favorable)
    const qEarly = evaluateQAndTV(
      candidateBatsman,
      plentifulPool,
      { purse: bot.purse, playersBought: bot.players_bought, overseasCount: bot.overseas_count, roleCounts: { BATSMAN: 5 } },
      700, // Elevated bid
      false,
      { maxSquadSize: 25, maxOverseas: 8 }
    );
    expect(qEarly.qSkip).toBeGreaterThan(100);

    // B3: Early auction stage pacing preserves capital
    const pacing = evaluatePursePacing({
      purse: bot.purse,
      remainingSlots: 20,
      auctionProgress: 0.0,
      futurePoolCount: plentifulPool.length,
      nextRequiredBid: qEarly.nextRequiredBid,
      roleNeed: 'NORMAL'
    });
    expect(pacing.pacingState).toBe('EARLY_PRESERVATION');
    expect(pacing.shouldPass).toBe(true);

    const evidence: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      candidateBatsman,
      700,
      100,
      'other-bidder',
      'Normal',
      [bot, { id: 'other-bidder' } as V3Team],
      { [bot.id]: existingRoster },
      { ...DEFAULT_CONTEXT, auctionProgress: 0.0, futurePlayers: plentifulPool as any },
      null,
      evidence,
      auctionId
    );
    expect(evidence[0]!.decision).toBe('DROP');
    expect(evidence[0]!.actionReason).toBe('EARLY_RESOURCE_PRESERVATION');
  });

  // ============================================================
  // 3. B4 LATE EMERGENCY + B6 OPPORTUNITY COST + B13 ONE-LAST-BID
  // ============================================================
  it('3. B4 Late Emergency + B6 Opportunity Cost + B13 One-Last-Bid: Dwindling pool enables bounded stretch on critical gap', () => {
    const criticalWk = makePlayer('gate-emergency-wk', { role: 'WICKET_KEEPER', base_price: 100 });
    const bot = makeBot(botTeamAlpha, { purse: 6000, players_bought: 20, personality: 'AGGRESSIVE' } as any);

    // Exhausted future pool (B6: qSkip low, alternative options gone)
    const exhaustedPool: any[] = [];

    // Stopping point at TV limit (1175)
    const qStoppingPoint = {
      tv: 1175,
      nextRequiredBid: 1175,
      currentBid: 1075,
      qSkip: 120,
      qBuyAtRequiredBid: 145,
      qBuyBase: 160,
      qDelta: 25,
      decision: 'BID' as const,
      isLegal: true,
      ladderEvaluated: [1175]
    };

    const brainState = {
      beliefs: { rivalAggression: 0.2, marketInflation: 0.3, roleScarcityPanic: 1.0, estimatedSquadQuality: 0.6 },
      memory: getBotMemory(auctionId, bot.id),
      plan: { strategicFocus: 'FILL_GAPS' as const, urgency: 0.9, budgetAllocation: {} as any, willSacrificeOverseasForQuality: false }
    };

    // B4 Late Emergency + B13 triggers CRITICAL_GAP_STRETCH (One-Last-Bid)
    const tactical = evaluateTacticalDecision({
      teamId: bot.id,
      auctionId,
      lotId: criticalWk.id,
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      brainState: brainState as any,
      basePrice: 100,
      remainingSlots: 5,
      purse: 6000,
      remainingTimerMs: 15000,
      initialPurse: 10000,
      auctionProgress: 0.90, // Late auction (B4)
      futurePoolCount: 0,
      maxSquadSize: 25,
      qResult: qStoppingPoint as any
    });

    expect(tactical.action).toBe('STRETCH');
    expect(tactical.reason).toBe('CRITICAL_GAP_STRETCH');
    expect(tactical.bidAmount).toBe(1175);
    expect(tactical.bidAmount).toBeLessThanOrEqual(tactical.tv); // TV ceiling preserved
  });

  // ============================================================
  // 4. B8 RIVAL BAITING + B11 RIVAL INTIMIDATION + B12 PRICE PRESSURE
  // ============================================================
  it('4. B8 Baiting + B11 Intimidation + B12 Price Pressure: Personality-driven tactical passes under high rival pressure', () => {
    const candidateLot = makePlayer('gate-pressure-lot', { base_price: 200 });

    const qMarginal = {
      currentBid: 600,
      nextRequiredBid: 650,
      tv: 1000,
      qSkip: 220,
      qBuyAtRequiredBid: 225, // Marginal surplus: qBuy < qSkip * 1.10 (242)
      qBuyBase: 250,
      qDelta: 5,
      decision: 'BID' as const,
      isLegal: true,
      ladderEvaluated: [650]
    };

    // High rival aggression state (>0.75) and high market inflation (2.0)
    const highPressureBrainState = {
      beliefs: { rivalAggression: 0.85, marketInflation: 2.0, roleScarcityPanic: 0.3, estimatedSquadQuality: 0.5 },
      memory: getBotMemory(auctionId, 'test'),
      plan: { strategicFocus: 'BUILD_CORE' as const, urgency: 0.3, budgetAllocation: {} as any, willSacrificeOverseasForQuality: false }
    };

    const baseInput: TacticalInputContext = {
      teamId: 'test-team',
      auctionId,
      lotId: candidateLot.id,
      personality: 'BALANCED',
      roleNeed: 'NORMAL',
      brainState: highPressureBrainState as any,
      basePrice: 200,
      remainingSlots: 20,
      purse: 4000, // Avg per slot: 200L. Required bid 650L > 200L -> material drain
      remainingTimerMs: 15000,
      initialPurse: 10000,
      auctionProgress: 0.40,
      futurePoolCount: 10,
      maxSquadSize: 25,
      qResult: qMarginal as any
    };

    // Personality 1: OPPORTUNISTIC -> B8 RIVAL_BAIT_DROP
    const decB8 = evaluateTacticalDecision({ ...baseInput, personality: 'OPPORTUNISTIC' });
    expect(decB8.action).toBe('PASS');
    expect(decB8.reason).toBe('RIVAL_BAIT_DROP');

    // Personality 2: CONSERVATIVE -> B11 RIVAL_INTIMIDATION
    const decB11 = evaluateTacticalDecision({ ...baseInput, personality: 'CONSERVATIVE' });
    expect(decB11.action).toBe('PASS');
    expect(decB11.reason).toBe('RIVAL_INTIMIDATION');

    // Personality 3: BALANCED -> B12 PRICE_PRESSURE_PURSE_DRAIN
    const decB12 = evaluateTacticalDecision({ ...baseInput, personality: 'BALANCED' });
    expect(decB12.action).toBe('PASS');
    expect(decB12.reason).toBe('PRICE_PRESSURE_PURSE_DRAIN');
  });

  // ============================================================
  // 5. B13 ONE-LAST-BID + B10 PURSE HEALTH + TV CEILING
  // ============================================================
  it('5. B13 One-Last-Bid + B10 Purse Health + TV Ceiling: B13 strictly respects purse solvency and TV boundary', () => {
    const lotId = 'gate-b13-solvency';

    // Sub-case A: Bid exceeding TV is strictly rejected
    const decExceedsTv = evaluateTacticalDecision({
      teamId: botTeamAlpha,
      auctionId,
      lotId,
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      brainState: null,
      basePrice: 100,
      remainingSlots: 5,
      purse: 5000,
      remainingTimerMs: 15000,
      initialPurse: 10000,
      maxSquadSize: 25,
      qResult: { tv: 1000, nextRequiredBid: 1075, currentBid: 1000, qSkip: 100, qBuyAtRequiredBid: 90, qBuyBase: 120, qDelta: -10, decision: 'PASS', isLegal: true, ladderEvaluated: [1075] } as any
    });
    expect(decExceedsTv.action).toBe('PASS');
    expect(decExceedsTv.reason).toBe('PRICE_EXCEEDS_TV');

    // Sub-case B: Solvency failure overrides B13
    // Purse 800L for 5 slots: 800 - 750 = 50L < 4 * 20L = 80L reserve -> Solvency failure!
    const decInsolvent = evaluateTacticalDecision({
      teamId: botTeamAlpha,
      auctionId,
      lotId,
      personality: 'AGGRESSIVE',
      roleNeed: 'CRITICAL',
      brainState: null,
      basePrice: 100,
      remainingSlots: 5,
      purse: 800,
      remainingTimerMs: 15000,
      initialPurse: 10000,
      maxSquadSize: 25,
      qResult: { tv: 800, nextRequiredBid: 750, currentBid: 700, qSkip: 100, qBuyAtRequiredBid: 110, qBuyBase: 120, qDelta: 10, decision: 'BID', isLegal: true, ladderEvaluated: [750] } as any
    });
    expect(decInsolvent.action).toBe('PASS');
    expect(decInsolvent.reason).toBe('PURSE_INSOLVENCY');
  });

  // ============================================================
  // 6. B14 LATE ENTRY REVERSAL + B17 MEMORY CAPTURE / REPLANNING
  // ============================================================
  it('6. B14 Late Entry Reversal + B17 Memory: Event capture and replanning cause valid PASS -> BID reversal', () => {
    const candidatePlayer = makePlayer('gate-reversal-p1', { base_price: 100 });
    const bot = makeBot(botTeamAlpha, { purse: 4000, players_bought: 5, personality: 'BALANCED' } as any);
    const allTeams = [bot, { id: rivalTeamId } as V3Team];
    const existingRoster: V3Player[] = [
      makePlayer('rev-b1', { role: 'BATSMAN', base_price: 100 }),
      makePlayer('rev-b2', { role: 'BATSMAN', base_price: 100 }),
      makePlayer('rev-b3', { role: 'BATSMAN', base_price: 100 }),
      makePlayer('rev-b4', { role: 'BATSMAN', base_price: 50 }),
      makePlayer('rev-b5', { role: 'BATSMAN', base_price: 50 })
    ];
    const teamRosters = { [bot.id]: existingRoster };

    // Initial state: 50 future alternatives -> early preservation PASS
    const plentifulPool = Array.from({ length: 50 }, (_, i) => ({
      player_id: `alt-${i}`,
      role: 'BATSMAN',
      category: 'B',
      base_price: 100,
      is_overseas: false
    }));

    const evidenceEarly: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      candidatePlayer,
      700,
      100,
      rivalTeamId,
      'Normal',
      allTeams,
      teamRosters,
      { ...DEFAULT_CONTEXT, auctionProgress: 0.0, futurePlayers: plentifulPool as any },
      null,
      evidenceEarly,
      auctionId
    );
    expect(evidenceEarly[0]!.decision).toBe('DROP');
    expect(evidenceEarly[0]!.actionReason).toBe('EARLY_RESOURCE_PRESERVATION');

    // B17: Rival purchases completed, captured in memory
    const completedLots = Array.from({ length: 48 }, (_, i) => ({
      id: `lot-comp-${i}`,
      status: 'SOLD',
      player_id: `alt-${i}`,
      winning_team_id: rivalTeamId,
      winning_bid: 500,
      players: { role: 'BATSMAN' }
    }));
    syncBotMemoryWithState(auctionId, bot.id, 'lot-reversal-gate', []);
    const memAfter = syncBotMemoryWithState(auctionId, bot.id, candidatePlayer.id, completedLots);
    expect(memAfter.rivalPurchases.length).toBe(48);

    // B14: Dwindling future alternatives (only 2 left) & late stage triggers reversal to ENTER
    const exhaustedPool = [
      { player_id: 'alt-48', role: 'BATSMAN', category: 'C', base_price: 50, is_overseas: false },
      { player_id: 'alt-49', role: 'BOWLER', category: 'C', base_price: 50, is_overseas: false },
    ];

    const evidenceLate: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [bot],
      candidatePlayer,
      700,
      100,
      rivalTeamId,
      'Normal',
      allTeams,
      teamRosters,
      { ...DEFAULT_CONTEXT, auctionProgress: 0.85, futurePlayers: exhaustedPool as any },
      null,
      evidenceLate,
      auctionId
    );
    expect(evidenceLate[0]!.decision).toBe('ENTER');
    expect(evidenceLate[0]!.actionReason).toBe('TV_FAVORABLE');
    expect(evidenceLate[0]!.pacingState).toBe('LATE_RELEASE');
  });

  // ============================================================
  // 7. B15 STRATEGIC IMPERFECTION MUST NEVER VIOLATE HARD CONSTRAINTS
  // ============================================================
  it('7. B15 Strategic Imperfection: Never bypasses purse insolvency, squad full, overseas cap, or TV limit', () => {
    const overseasPlayer = makePlayer('gate-overseas-p1', { is_overseas: true, base_price: 100 });
    const domesticPlayer = makePlayer('gate-domestic-p1', { is_overseas: false, base_price: 100 });

    // Condition 1: Overseas cap reached (8/8)
    const botOverseasFull = makeBot(botTeamAlpha, { overseas_count: 8, players_bought: 10 });
    const evidenceOverseas: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [botOverseasFull],
      overseasPlayer,
      100,
      100,
      undefined,
      'Normal',
      [botOverseasFull],
      { [botOverseasFull.id]: [] },
      DEFAULT_CONTEXT,
      null,
      evidenceOverseas,
      auctionId
    );
    expect(evidenceOverseas[0]!.decision).toBe('REJECTED_ELIGIBILITY');
    expect(evidenceOverseas[0]!.eligibilityReason).toBe('OVERSEAS_FULL');

    // Condition 2: Squad capacity reached (25/25)
    const botSquadFull = makeBot(botTeamBeta, { players_bought: 25 });
    const evidenceSquad: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [botSquadFull],
      domesticPlayer,
      100,
      100,
      undefined,
      'Normal',
      [botSquadFull],
      { [botSquadFull.id]: [] },
      DEFAULT_CONTEXT,
      null,
      evidenceSquad,
      auctionId
    );
    expect(evidenceSquad[0]!.decision).toBe('REJECTED_ELIGIBILITY');
    expect(evidenceSquad[0]!.eligibilityReason).toBe('SQUAD_FULL');

    // Condition 3: Insufficient purse
    const botPurseEmpty = makeBot(botTeamGamma, { purse: 0 });
    const evidencePurse: BotDecisionEvidence[] = [];
    evaluateBotsForLot(
      [botPurseEmpty],
      domesticPlayer,
      100,
      100,
      undefined,
      'Normal',
      [botPurseEmpty],
      { [botPurseEmpty.id]: [] },
      DEFAULT_CONTEXT,
      null,
      evidencePurse,
      auctionId
    );
    expect(evidencePurse[0]!.decision).toBe('REJECTED_ELIGIBILITY');
    expect(evidencePurse[0]!.eligibilityReason).toBe('PURSE_INSUFFICIENT');
  });

  // ============================================================
  // 8. B16 DYNAMIC HUMAN-REACTION DELAY
  // ============================================================
  it('8. B16 Reaction Delay: Delays remain bounded by timer expiration and preserve economic authority', () => {
    const candidatePlayer = makePlayer('gate-delay-p1', { base_price: 100 });
    const bot = makeBot(botTeamAlpha, { purse: 6000 });

    // Urgent timer (only 800ms remaining): delay must clamp safely without timing out
    const urgentTimerExpiry = new Date(Date.now() + 800).toISOString();
    const evidenceUrgent: BotDecisionEvidence[] = [];
    const bidsUrgent = evaluateBotsForLot(
      [bot],
      candidatePlayer,
      200,
      100,
      undefined,
      'Normal',
      [bot],
      { [bot.id]: [] },
      DEFAULT_CONTEXT,
      urgentTimerExpiry,
      evidenceUrgent,
      auctionId
    );

    expect(bidsUrgent.length).toBe(1);
    expect(bidsUrgent[0]!.delayMs).toBeLessThanOrEqual(800);
    expect(bidsUrgent[0]!.delayMs).toBeGreaterThanOrEqual(400); // Clamped safely to avoid timeout
    expect(bidsUrgent[0]!.nextBidAmount).toBe(225); // Economic legality untouched
  });

  // ============================================================
  // 9. B17 MEMORY ISOLATION PER AUCTION / TEAM
  // ============================================================
  it('9. B17 Memory Isolation: Zero leakage across bots or auctions', () => {
    // Record events in Auction 1 for Bot Alpha
    recordBotBidObservation(auctionId, botTeamAlpha, 'player-A1', 400);
    recordRivalBidObservation(auctionId, botTeamAlpha, 'player-A1', rivalTeamId, 500);

    // Record events in Auction 2 for Bot Beta
    recordBotBidObservation(auctionId2, botTeamBeta, 'player-B2', 800);

    // Verify Bot Alpha in Auction 1
    const memAlpha1 = getBotMemory(auctionId, botTeamAlpha);
    expect(memAlpha1.observedBids['player-A1']?.highestBid).toBe(400);
    expect(memAlpha1.observedRivalBids['player-A1']?.highestBid).toBe(500);
    expect(memAlpha1.observedBids['player-B2']).toBeUndefined();

    // Verify Bot Beta in Auction 1 is completely clean
    const memBeta1 = getBotMemory(auctionId, botTeamBeta);
    expect(memBeta1.observedBids['player-A1']).toBeUndefined();
    expect(memBeta1.observedBids['player-B2']).toBeUndefined();

    // Verify Bot Alpha in Auction 2 is completely clean
    const memAlpha2 = getBotMemory(auctionId2, botTeamAlpha);
    expect(memAlpha2.observedBids['player-A1']).toBeUndefined();

    // Clear Auction 1 memory only
    clearAuctionMemory(auctionId);
    expect(getBotMemory(auctionId, botTeamAlpha).observedBids['player-A1']).toBeUndefined();
    // Auction 2 memory remains intact
    expect(getBotMemory(auctionId2, botTeamBeta).observedBids['player-B2']?.highestBid).toBe(800);
  });

  // ============================================================
  // 10. DETERMINISTIC REPLAY
  // ============================================================
  it('10. Deterministic Replay: Identical initial state + public event history produces byte-for-byte identical decisions', () => {
    const candidatePlayer = makePlayer('gate-determinism-p1', { base_price: 200, category: 'B' });
    const bot = makeBot('bot-deterministic', { purse: 6000, initial_purse: 10000, personality: 'OPPORTUNISTIC' } as any);
    const rival = makeBot(rivalTeamId, { purse: 8000 });

    const runEvaluation = (iterAuctionId: string) => {
      clearAuctionMemory(iterAuctionId);
      clearBrainStateCache();

      // Step 1: Initial opening bid
      const ev1: BotDecisionEvidence[] = [];
      const bids1 = evaluateBotsForLot(
        [bot],
        candidatePlayer,
        200,
        200,
        undefined,
        'Normal',
        [bot, rival],
        { [bot.id]: [], [rival.id]: [] },
        DEFAULT_CONTEXT,
        null,
        ev1,
        iterAuctionId
      );

      // Step 2: Rival bids 600 (captured in memory)
      recordRivalBidObservation(iterAuctionId, bot.id, candidatePlayer.id, rival.id, 600);
      replanBotState({
        auctionId: iterAuctionId,
        teamId: bot.id,
        bot,
        botRoster: [],
        currentBid: 600,
        basePrice: 200,
        playerRole: candidatePlayer.role,
        playerIsOverseas: candidatePlayer.is_overseas,
        allTeams: [bot, rival],
        teamRosters: { [bot.id]: [], [rival.id]: [] },
        ctx: DEFAULT_CONTEXT
      });

      // Step 3: Re-evaluation
      const ev2: BotDecisionEvidence[] = [];
      const bids2 = evaluateBotsForLot(
        [bot],
        candidatePlayer,
        600,
        200,
        rival.id,
        'Normal',
        [bot, rival],
        { [bot.id]: [], [rival.id]: [] },
        DEFAULT_CONTEXT,
        null,
        ev2,
        iterAuctionId
      );

      return {
        initialDecision: ev1[0]?.decision,
        initialNextBid: bids1[0]?.nextBidAmount,
        initialDelay: bids1[0]?.delayMs,
        replanDecision: ev2[0]?.decision,
        replanReason: ev2[0]?.actionReason,
        replanBidsCount: bids2.length
      };
    };

    const run1 = runEvaluation('auction-det-replay');
    const run2 = runEvaluation('auction-det-replay');

    // 100% deterministic reproducibility across separate auction runs
    expect(run1.initialDecision).toBe(run2.initialDecision);
    expect(run1.initialNextBid).toBe(run2.initialNextBid);
    expect(run1.initialDelay).toBe(run2.initialDelay);
    expect(run1.replanDecision).toBe(run2.replanDecision);
    expect(run1.replanReason).toBe(run2.replanReason);
    expect(run1.replanBidsCount).toBe(run2.replanBidsCount);
  });
});
