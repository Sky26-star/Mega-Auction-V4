// src/test/unit/summary-results.test.ts
// Phase 17B + 17C Post-Auction Results and Team Results Unit & Adversarial Test Suite

import { describe, it, expect, vi } from 'vitest';
import {
  calculateMegaResults,
  calculateMiniResults,
  calculateTeamResults,
  calculateCombinedOverview,
  calculateTopBuys,
  calculateBreakdowns,
  verifyPurseInvariant,
  mapLotToSummaryItem,
  type RawLotInput,
  type RawTeamInput,
  type RawSquadPlayerInput,
  type RawPlayerReleaseInput,
  type RawMiniSessionInput,
  type RawAuctionInput,
  type SummaryPlayerItem,
} from '@/lib/summary/results-calculator';

describe('Phase 17B & 17C: Post-Auction Results and Team Results Suite', () => {
  // Shared Fixtures
  const mockAuction: RawAuctionInput = {
    id: 'auc-101',
    room_id: 'room-101',
    status: 'COMPLETED',
    total_lots: 5,
    created_at: '2026-09-25T10:00:00Z',
    started_at: '2026-09-25T10:05:00Z',
    completed_at: '2026-09-25T11:05:00Z',
    mega_completed_at: '2026-09-25T10:45:00Z',
    is_unsold_round: false,
  };

  const mockRoom = {
    code: 'ROOM99',
    name: 'IPL Mega Auction Arena 2026',
  };

  const mockTeamX: RawTeamInput = {
    id: 'team-x',
    name: 'Chennai Super Kings',
    short_name: 'CSK',
    color: '#FFFF00',
    initial_purse: 12000, // 120 Cr
    purse: 12000,
    players_bought: 0,
    overseas_count: 0,
    is_bot: false,
  };

  const mockTeamY: RawTeamInput = {
    id: 'team-y',
    name: 'Mumbai Indians',
    short_name: 'MI',
    color: '#004BA0',
    initial_purse: 12000, // 120 Cr
    purse: 12000,
    players_bought: 0,
    overseas_count: 0,
    is_bot: true,
  };

  const mockTeams = [mockTeamX, mockTeamY];

  // --------------------------------------------------------------------------
  // TEST A — MEGA ONLY
  // --------------------------------------------------------------------------
  it('TEST A: Mega Only — 5 lots (3 SOLD, 2 UNSOLD), Mini session absent', () => {
    const lots: RawLotInput[] = [
      { id: 'lot-1', lot_index: 0, status: 'SOLD', base_price: 200, winning_bid: 1500, winning_team_id: 'team-x', is_mini_round: false, player: { id: 'p-1', name: 'Player 1', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false } },
      { id: 'lot-2', lot_index: 1, status: 'SOLD', base_price: 150, winning_bid: 800, winning_team_id: 'team-y', is_mini_round: false, player: { id: 'p-2', name: 'Player 2', role: 'Bowler', category: 'CAPPED', country: 'India', is_overseas: false } },
      { id: 'lot-3', lot_index: 2, status: 'UNSOLD', base_price: 200, winning_bid: null, winning_team_id: null, is_mini_round: false, player: { id: 'p-3', name: 'Player 3', role: 'All-Rounder', category: 'CAPPED', country: 'England', is_overseas: true } },
      { id: 'lot-4', lot_index: 3, status: 'SOLD', base_price: 100, winning_bid: 500, winning_team_id: 'team-x', is_mini_round: false, player: { id: 'p-4', name: 'Player 4', role: 'Wicket-Keeper', category: 'CAPPED', country: 'India', is_overseas: false } },
      { id: 'lot-5', lot_index: 4, status: 'UNSOLD', base_price: 100, winning_bid: null, winning_team_id: null, is_mini_round: false, player: { id: 'p-5', name: 'Player 5', role: 'Bowler', category: 'CAPPED', country: 'Australia', is_overseas: true } },
    ];

    const megaResults = calculateMegaResults(lots, mockAuction, mockTeams);
    const miniResults = calculateMiniResults(null, lots, [], mockTeams);

    expect(megaResults.totalLots).toBe(5);
    expect(megaResults.soldCount).toBe(3);
    expect(megaResults.unsoldCount).toBe(2);
    expect(megaResults.totalSpendLakhs).toBe(2800); // 1500 + 800 + 500 = 2800 Lakhs = 28 Cr
    expect(megaResults.totalSpendCr).toBe(28);
    expect(megaResults.averagePurchasePriceCr).toBeCloseTo(28 / 3, 2);
    expect(megaResults.highestPurchaseCr).toBe(15);
    expect(megaResults.lowestPurchaseCr).toBe(5);
    expect(megaResults.completedAt).toBe('2026-09-25T10:45:00Z');

    expect(miniResults).toBeNull(); // Mini not occurred
  });

  // --------------------------------------------------------------------------
  // TEST B — MEGA + MINI ISOLATION
  // --------------------------------------------------------------------------
  it('TEST B: Mega + Mini — Phase-specific totals remain strictly isolated', () => {
    // 10 Mega lots, 3 Mini lots
    const megaLots: RawLotInput[] = Array.from({ length: 10 }).map((_, i) => ({
      id: `mega-lot-${i}`,
      lot_index: i,
      status: i < 7 ? 'SOLD' : 'UNSOLD',
      base_price: 200,
      winning_bid: i < 7 ? 1000 : null,
      winning_team_id: i < 7 ? 'team-x' : null,
      is_mini_round: false,
      player: { id: `mega-p-${i}`, name: `Mega Player ${i}`, role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false },
    }));

    const miniLots: RawLotInput[] = [
      { id: 'mini-lot-1', lot_index: 10, status: 'SOLD', base_price: 100, winning_bid: 300, winning_team_id: 'team-y', is_mini_round: true, player: { id: 'mini-p-1', name: 'Mini Player 1', role: 'Bowler', category: 'CAPPED', country: 'India', is_overseas: false } },
      { id: 'mini-lot-2', lot_index: 11, status: 'SOLD', base_price: 100, winning_bid: 400, winning_team_id: 'team-y', is_mini_round: true, player: { id: 'mini-p-2', name: 'Mini Player 2', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false } },
      { id: 'mini-lot-3', lot_index: 12, status: 'UNSOLD', base_price: 50, winning_bid: null, winning_team_id: null, is_mini_round: true, player: { id: 'mini-p-3', name: 'Mini Player 3', role: 'All-Rounder', category: 'CAPPED', country: 'India', is_overseas: false } },
    ];

    const allLots = [...megaLots, ...miniLots];

    const miniSession: RawMiniSessionInput = {
      id: 'mini-session-1',
      auction_id: mockAuction.id,
      status: 'COMPLETED',
      total_lots: 3,
      completed_at: '2026-09-25T11:05:00Z',
    };

    const megaResults = calculateMegaResults(allLots, mockAuction, mockTeams);
    const miniResults = calculateMiniResults(miniSession, allLots, [], mockTeams);

    // Mega isolation verification
    expect(megaResults.totalLots).toBe(10);
    expect(megaResults.soldCount).toBe(7);
    expect(megaResults.unsoldCount).toBe(3);
    expect(megaResults.totalSpendLakhs).toBe(7000); // 7 * 1000 = 70 Cr
    expect(megaResults.totalSpendCr).toBe(70);

    // Mini isolation verification
    expect(miniResults).not.toBeNull();
    expect(miniResults!.totalLots).toBe(3);
    expect(miniResults!.soldCount).toBe(2);
    expect(miniResults!.unsoldCount).toBe(1);
    expect(miniResults!.totalSpendLakhs).toBe(700); // 300 + 400 = 7 Cr
    expect(miniResults!.totalSpendCr).toBe(7);

    // Combined Overview check
    const combined = calculateCombinedOverview(mockRoom, mockAuction, megaResults, miniResults, []);
    expect(combined.totalLots).toBe(13);
    expect(combined.soldCount).toBe(9);
    expect(combined.unsoldCount).toBe(4);
    expect(combined.megaSoldCount).toBe(7);
    expect(combined.miniSoldCount).toBe(2);
    expect(combined.totalSpendCr).toBe(77); // 70 + 7
  });

  // --------------------------------------------------------------------------
  // TEST C — SOLD + RELEASE + MINI REPURCHASE
  // --------------------------------------------------------------------------
  it('TEST C: Mega SOLD -> Release -> Mini Repurchase with complete provenance and no double counting', () => {
    // Mega lot: Player A bought by Team X for 100 Lakhs (1 Cr)
    const megaLot: RawLotInput = {
      id: 'lot-mega-playerA',
      lot_index: 0,
      status: 'SOLD',
      base_price: 100,
      winning_bid: 100,
      winning_team_id: 'team-x',
      is_mini_round: false,
      player: { id: 'p-alpha', name: 'Player Alpha', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false },
    };

    // Release: Player A released by Team X with 100 Lakhs refund
    const release: RawPlayerReleaseInput = {
      id: 'rel-1',
      auction_id: mockAuction.id,
      team_id: 'team-x',
      player_id: 'p-alpha',
      refund_amount: 100,
      released_at: '2026-09-25T10:50:00Z',
      player: megaLot.player,
    };

    // Mini lot: Player A bought by Team Y for 80 Lakhs (0.8 Cr)
    const miniLot: RawLotInput = {
      id: 'lot-mini-playerA',
      lot_index: 1,
      status: 'SOLD',
      base_price: 50,
      winning_bid: 80,
      winning_team_id: 'team-y',
      is_mini_round: true,
      player: megaLot.player,
    };

    const lots = [megaLot, miniLot];
    const releases = [release];

    // Current active squad in squad_players: owned by Team Y ONLY
    const squadPlayers: RawSquadPlayerInput[] = [
      {
        id: 'squad-row-1',
        team_id: 'team-y',
        player_id: 'p-alpha',
        lot_id: miniLot.id,
        purchase_price: 80,
        bought_at: '2026-09-25T11:00:00Z',
        player: megaLot.player,
        lot: { id: miniLot.id, is_mini_round: true },
      },
    ];

    const teamXState: RawTeamInput = {
      ...mockTeamX,
      initial_purse: 12000,
      purse: 12000, // 12000 - 100 (mega) + 100 (refund) = 12000
      players_bought: 0,
      overseas_count: 0,
    };

    const teamYState: RawTeamInput = {
      ...mockTeamY,
      initial_purse: 12000,
      purse: 11920, // 12000 - 80 = 11920
      players_bought: 1,
      overseas_count: 0,
    };

    const teamResults = calculateTeamResults([teamXState, teamYState], lots, squadPlayers, releases);
    const resultX = teamResults.find((t) => t.id === 'team-x')!;
    const resultY = teamResults.find((t) => t.id === 'team-y')!;

    // Team X Accounting
    expect(resultX.megaSpendLakhs).toBe(100);
    expect(resultX.megaSpendCr).toBe(1.0);
    expect(resultX.releaseRefundsLakhs).toBe(100);
    expect(resultX.releaseRefundsCr).toBe(1.0);
    expect(resultX.miniSpendLakhs).toBe(0);
    expect(resultX.finalPurseLakhs).toBe(12000);
    expect(resultX.isPurseConsistent).toBe(true);
    expect(resultX.squad).toHaveLength(0); // NOT in active squad
    expect(resultX.megaAcquisitions).toHaveLength(1); // Historical Mega acquisition preserved
    expect(resultX.releasedPlayers).toHaveLength(1); // Historical release preserved

    // Team Y Accounting
    expect(resultY.megaSpendLakhs).toBe(0);
    expect(resultY.releaseRefundsLakhs).toBe(0);
    expect(resultY.miniSpendLakhs).toBe(80);
    expect(resultY.miniSpendCr).toBe(0.8);
    expect(resultY.finalPurseLakhs).toBe(11920);
    expect(resultY.isPurseConsistent).toBe(true);
    expect(resultY.squad).toHaveLength(1); // Currently active in squad
    expect(resultY.squad[0]!.id).toBe('p-alpha');
    expect(resultY.miniAcquisitions).toHaveLength(1); // Historical Mini acquisition preserved
  });

  // --------------------------------------------------------------------------
  // TEST D — ZERO LOT MINI
  // --------------------------------------------------------------------------
  it('TEST D: Zero Lot Mini — Mini session exists with total_lots = 0, no crash, no fake lots', () => {
    const miniSession: RawMiniSessionInput = {
      id: 'mini-session-empty',
      auction_id: mockAuction.id,
      status: 'COMPLETED',
      total_lots: 0,
      completed_at: '2026-09-25T11:00:00Z',
    };

    const lots: RawLotInput[] = [
      { id: 'mega-1', lot_index: 0, status: 'SOLD', base_price: 200, winning_bid: 500, winning_team_id: 'team-x', is_mini_round: false, player: { id: 'p-1', name: 'P1', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false } },
    ];

    const megaResults = calculateMegaResults(lots, mockAuction, mockTeams);
    const miniResults = calculateMiniResults(miniSession, lots, [], mockTeams);

    expect(miniResults).not.toBeNull();
    expect(miniResults!.hasMiniSession).toBe(true);
    expect(miniResults!.totalLots).toBe(0);
    expect(miniResults!.soldCount).toBe(0);
    expect(miniResults!.unsoldCount).toBe(0);
    expect(miniResults!.totalSpendLakhs).toBe(0);
    expect(miniResults!.totalSpendCr).toBe(0);
    expect(miniResults!.soldLots).toHaveLength(0);
    expect(miniResults!.unsoldLots).toHaveLength(0);

    // Mega results remain intact
    expect(megaResults.totalLots).toBe(1);
    expect(megaResults.soldCount).toBe(1);
    expect(megaResults.totalSpendCr).toBe(5);
  });

  // --------------------------------------------------------------------------
  // TEST E — NO MINI
  // --------------------------------------------------------------------------
  it('TEST E: No Mini — miniResults is null and not indistinguishable from zero-lot Mini', () => {
    const lots: RawLotInput[] = [
      { id: 'mega-1', lot_index: 0, status: 'SOLD', base_price: 200, winning_bid: 500, winning_team_id: 'team-x', is_mini_round: false, player: { id: 'p-1', name: 'P1', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false } },
    ];

    const miniResults = calculateMiniResults(null, lots, [], mockTeams);
    expect(miniResults).toBeNull();
  });

  // --------------------------------------------------------------------------
  // TEST F — MULTIPLE HISTORICAL LOTS FOR SAME PLAYER
  // --------------------------------------------------------------------------
  it('TEST F: Multiple Historical Lots for Same Player — both lots preserved as separate events', () => {
    const megaLot: RawLotInput = {
      id: 'lot-1',
      lot_index: 0,
      status: 'SOLD',
      base_price: 200,
      winning_bid: 1000,
      winning_team_id: 'team-x',
      is_mini_round: false,
      player: { id: 'p-same', name: 'Same Player', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false },
    };

    const miniLot: RawLotInput = {
      id: 'lot-2',
      lot_index: 1,
      status: 'SOLD',
      base_price: 100,
      winning_bid: 700,
      winning_team_id: 'team-y',
      is_mini_round: true,
      player: { id: 'p-same', name: 'Same Player', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false },
    };

    const lots = [megaLot, miniLot];
    const mega = calculateMegaResults(lots, mockAuction, mockTeams);
    const mini = calculateMiniResults({ id: 's1', auction_id: 'auc-101', status: 'COMPLETED', total_lots: 1 }, lots, [], mockTeams)!;

    expect(mega.soldLots).toHaveLength(1);
    expect(mega.soldLots[0]!.id).toBe('lot-1');
    expect(mega.soldLots[0]!.winningBidLakhs).toBe(1000);

    expect(mini.soldLots).toHaveLength(1);
    expect(mini.soldLots[0]!.id).toBe('lot-2');
    expect(mini.soldLots[0]!.winningBidLakhs).toBe(700);
  });

  // --------------------------------------------------------------------------
  // TEST G — UNSOLD AFTER RELEASE INVARIANT
  // --------------------------------------------------------------------------
  it('TEST G: Mega Lot Status Invariant — A historical SOLD lot NEVER becomes UNSOLD upon release', () => {
    const megaLot: RawLotInput = {
      id: 'lot-m1',
      lot_index: 0,
      status: 'SOLD',
      base_price: 200,
      winning_bid: 500,
      winning_team_id: 'team-x',
      is_mini_round: false,
      player: { id: 'p-released', name: 'Released Player', role: 'Bowler', category: 'CAPPED', country: 'India', is_overseas: false },
    };

    const release: RawPlayerReleaseInput = {
      id: 'rel-1',
      auction_id: mockAuction.id,
      team_id: 'team-x',
      player_id: 'p-released',
      refund_amount: 500,
      released_at: '2026-09-25T10:50:00Z',
    };

    // Even though released and squad_players deleted, lot status in auction_lots remains SOLD
    const mega = calculateMegaResults([megaLot], mockAuction, mockTeams);
    expect(mega.soldCount).toBe(1);
    expect(mega.unsoldCount).toBe(0);
    expect(mega.soldLots[0]!.status).toBe('SOLD');
  });

  // --------------------------------------------------------------------------
  // TEST H — TEAM PURSE INVARIANT
  // --------------------------------------------------------------------------
  it('TEST H: Team Purse Invariant — initial - megaSpend + refunds - miniSpend == teams.purse', () => {
    // Expected purse formula test
    const inv1 = verifyPurseInvariant(12000, 3000, 500, 1000, 8500); // 12000 - 3000 + 500 - 1000 = 8500
    expect(inv1.isPurseConsistent).toBe(true);
    expect(inv1.purseDiscrepancyLakhs).toBe(0);
    expect(inv1.expectedFinalPurseLakhs).toBe(8500);

    // Mismatch detection
    const inv2 = verifyPurseInvariant(12000, 3000, 500, 1000, 9000); // Mismatch by +500
    expect(inv2.isPurseConsistent).toBe(false);
    expect(inv2.purseDiscrepancyLakhs).toBe(500);
  });

  // --------------------------------------------------------------------------
  // TEST I — CURRENT SQUAD VS HISTORICAL ACQUISITIONS
  // --------------------------------------------------------------------------
  it('TEST I: Current Squad vs Historical Acquisitions — released player does not appear in active squad', () => {
    const lot: RawLotInput = {
      id: 'lot-x1',
      lot_index: 0,
      status: 'SOLD',
      base_price: 200,
      winning_bid: 400,
      winning_team_id: 'team-x',
      is_mini_round: false,
      player: { id: 'p-rel', name: 'Rel Player', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false },
    };

    const release: RawPlayerReleaseInput = {
      id: 'rel-1',
      auction_id: mockAuction.id,
      team_id: 'team-x',
      player_id: 'p-rel',
      refund_amount: 400,
      released_at: '2026-09-25T10:50:00Z',
    };

    // Active squad in squad_players is EMPTY
    const activeSquad: RawSquadPlayerInput[] = [];

    const teamResults = calculateTeamResults([mockTeamX], [lot], activeSquad, [release]);
    const teamX = teamResults[0]!;

    expect(teamX.squad).toHaveLength(0); // Not in current active squad
    expect(teamX.megaAcquisitions).toHaveLength(1); // Historical purchase IS preserved
    expect(teamX.releasedPlayers).toHaveLength(1); // Release record IS preserved
  });

  // --------------------------------------------------------------------------
  // TEST J — ZERO SPEND
  // --------------------------------------------------------------------------
  it('TEST J: Zero Spend — When no sold lots, spend is 0 and not null, undefined, or NaN', () => {
    const lots: RawLotInput[] = [
      { id: 'lot-u1', lot_index: 0, status: 'UNSOLD', base_price: 200, winning_bid: null, winning_team_id: null, is_mini_round: false },
      { id: 'lot-u2', lot_index: 1, status: 'UNSOLD', base_price: 100, winning_bid: null, winning_team_id: null, is_mini_round: false },
    ];

    const mega = calculateMegaResults(lots, mockAuction, mockTeams);
    expect(mega.totalSpendLakhs).toBe(0);
    expect(mega.totalSpendCr).toBe(0);
    expect(mega.averagePurchasePriceCr).toBe(0);
    expect(mega.highestPurchaseCr).toBe(0);
    expect(mega.lowestPurchaseCr).toBe(0);
    expect(Number.isNaN(mega.totalSpendCr)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST L — LEGACY BUG REGRESSION (is_unsold_round removal)
  // --------------------------------------------------------------------------
  it('TEST L: Legacy Bug Regression — lot mapping does not depend on auction_lots.is_unsold_round', () => {
    const rawLotWithoutUnsoldRound: RawLotInput = {
      id: 'lot-real',
      lot_index: 0,
      status: 'SOLD',
      base_price: 200,
      winning_bid: 300,
      winning_team_id: 'team-x',
      is_mini_round: false,
      player: { id: 'p-1', name: 'Real Player', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false },
    };

    const item = mapLotToSummaryItem(rawLotWithoutUnsoldRound, mockTeams);
    expect(item.isUnsoldRound).toBe(false);
    expect(item.isMiniRound).toBe(false);
    expect(item.winningBidLakhs).toBe(300);
  });

  // --------------------------------------------------------------------------
  // TEST M — MEGA / MINI CONTAMINATION
  // --------------------------------------------------------------------------
  it('TEST M: Mega/Mini Contamination — asymmetric prices do not bleed across phases', () => {
    const lots: RawLotInput[] = [
      { id: 'mega-expensive', lot_index: 0, status: 'SOLD', base_price: 200, winning_bid: 2500, winning_team_id: 'team-x', is_mini_round: false, player: { id: 'p-exp', name: 'Expensive Player', role: 'Batter', category: 'MARQUEE', country: 'India', is_overseas: false } },
      { id: 'mini-cheap', lot_index: 1, status: 'SOLD', base_price: 20, winning_bid: 20, winning_team_id: 'team-y', is_mini_round: true, player: { id: 'p-chp', name: 'Budget Player', role: 'Bowler', category: 'D', country: 'India', is_overseas: false } },
    ];

    const mega = calculateMegaResults(lots, mockAuction, mockTeams);
    const mini = calculateMiniResults({ id: 's1', auction_id: 'auc-101', status: 'COMPLETED', total_lots: 1 }, lots, [], mockTeams)!;

    expect(mega.totalSpendCr).toBe(25);
    expect(mega.averagePurchasePriceCr).toBe(25);
    expect(mega.highestPurchaseCr).toBe(25);

    expect(mini.totalSpendCr).toBe(0.2);
    expect(mini.averagePurchasePriceCr).toBe(0.2);
    expect(mini.highestPurchaseCr).toBe(0.2);
  });

  // --------------------------------------------------------------------------
  // TEST N — TEAM WITH RELEASE ACCOUNTING
  // --------------------------------------------------------------------------
  it('TEST N: Team with Release Accounting — refund is strictly credited to releasing team', () => {
    const releases: RawPlayerReleaseInput[] = [
      { id: 'rel-x', auction_id: mockAuction.id, team_id: 'team-x', player_id: 'p-rel-x', refund_amount: 800, released_at: '2026-09-25T10:50:00Z' },
    ];

    const results = calculateTeamResults(mockTeams, [], [], releases);
    const resultX = results.find((t) => t.id === 'team-x')!;
    const resultY = results.find((t) => t.id === 'team-y')!;

    expect(resultX.releaseRefundsLakhs).toBe(800);
    expect(resultX.releaseRefundsCr).toBe(8);
    expect(resultY.releaseRefundsLakhs).toBe(0);
    expect(resultY.releaseRefundsCr).toBe(0);
  });

  // --------------------------------------------------------------------------
  // TEST O — TEAM WITH MINI PURCHASE ACCOUNTING
  // --------------------------------------------------------------------------
  it('TEST O: Team with Mini Purchase Accounting — Mini spend strictly belongs to winning_team_id', () => {
    const miniLot: RawLotInput = {
      id: 'mini-1',
      lot_index: 0,
      status: 'SOLD',
      base_price: 50,
      winning_bid: 350,
      winning_team_id: 'team-y',
      is_mini_round: true,
      player: { id: 'p-mini-1', name: 'Mini Buy', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false },
    };

    const results = calculateTeamResults(mockTeams, [miniLot], [], []);
    const resultX = results.find((t) => t.id === 'team-x')!;
    const resultY = results.find((t) => t.id === 'team-y')!;

    expect(resultX.miniSpendLakhs).toBe(0);
    expect(resultY.miniSpendLakhs).toBe(350);
    expect(resultY.miniSpendCr).toBe(3.5);
  });

  // --------------------------------------------------------------------------
  // ADVERSARIAL VALIDATION: Edge cases
  // --------------------------------------------------------------------------
  describe('Adversarial Edge Cases', () => {
    it('handles all lots UNSOLD gracefully', () => {
      const allUnsold: RawLotInput[] = [
        { id: 'u1', lot_index: 0, status: 'UNSOLD', base_price: 200, winning_bid: null, winning_team_id: null, is_mini_round: false },
        { id: 'u2', lot_index: 1, status: 'UNSOLD', base_price: 150, winning_bid: null, winning_team_id: null, is_mini_round: false },
      ];
      const mega = calculateMegaResults(allUnsold, mockAuction, mockTeams);
      expect(mega.soldCount).toBe(0);
      expect(mega.unsoldCount).toBe(2);
      expect(mega.totalSpendCr).toBe(0);
      expect(mega.averagePurchasePriceCr).toBe(0);
      expect(mega.highestPurchaseCr).toBe(0);
      expect(mega.lowestPurchaseCr).toBe(0);
    });

    it('handles all lots SOLD gracefully', () => {
      const allSold: RawLotInput[] = [
        { id: 's1', lot_index: 0, status: 'SOLD', base_price: 200, winning_bid: 1000, winning_team_id: 'team-x', is_mini_round: false },
        { id: 's2', lot_index: 1, status: 'SOLD', base_price: 150, winning_bid: 500, winning_team_id: 'team-y', is_mini_round: false },
      ];
      const mega = calculateMegaResults(allSold, mockAuction, mockTeams);
      expect(mega.soldCount).toBe(2);
      expect(mega.unsoldCount).toBe(0);
      expect(mega.totalSpendCr).toBe(15);
      expect(mega.highestPurchaseCr).toBe(10);
      expect(mega.lowestPurchaseCr).toBe(5);
    });

    it('calculates topBuys sorted strictly by highest bid', () => {
      const lots: RawLotInput[] = [
        { id: 'l1', lot_index: 0, status: 'SOLD', base_price: 200, winning_bid: 800, winning_team_id: 'team-x', is_mini_round: false, player: { id: 'p1', name: 'P1', role: 'Batter', category: 'CAPPED', country: 'India', is_overseas: false } },
        { id: 'l2', lot_index: 1, status: 'SOLD', base_price: 200, winning_bid: 2400, winning_team_id: 'team-y', is_mini_round: false, player: { id: 'p2', name: 'P2', role: 'Bowler', category: 'CAPPED', country: 'India', is_overseas: false } },
        { id: 'l3', lot_index: 2, status: 'SOLD', base_price: 100, winning_bid: 1200, winning_team_id: 'team-x', is_mini_round: true, player: { id: 'p3', name: 'P3', role: 'All-Rounder', category: 'CAPPED', country: 'India', is_overseas: false } },
      ];

      const mega = calculateMegaResults(lots, mockAuction, mockTeams);
      const mini = calculateMiniResults({ id: 's1', auction_id: 'auc-101', status: 'COMPLETED', total_lots: 1 }, lots, [], mockTeams);
      const topBuys = calculateTopBuys(mega, mini, 2);

      expect(topBuys).toHaveLength(2);
      expect(topBuys[0]!.name).toBe('P2');
      expect(topBuys[0]!.purchasePriceCr).toBe(24);
      expect(topBuys[1]!.name).toBe('P3');
      expect(topBuys[1]!.purchasePriceCr).toBe(12);
    });

    it('calculates breakdowns without NaN or division by zero when spend is zero', () => {
      const breakdowns = calculateBreakdowns([], 0);
      expect(breakdowns.categoryBreakdown).toHaveLength(0);
      expect(breakdowns.roleBreakdown).toHaveLength(0);
      expect(breakdowns.domesticVsOverseas.domesticCount).toBe(0);
      expect(breakdowns.domesticVsOverseas.overseasCount).toBe(0);
      expect(breakdowns.domesticVsOverseas.domesticSpendCr).toBe(0);
      expect(breakdowns.domesticVsOverseas.overseasSpendCr).toBe(0);
    });

    it('calculates active roster allocation percentages using active roster spend instead of gross historical turnover', () => {
      // Scenario: Player A bought for 100 Lakhs (1.00 Cr) and released; Player B bought for 50 Lakhs (0.50 Cr) and remains active
      const activeSquad: SummaryPlayerItem[] = [
        {
          id: 'p-b',
          name: 'Player B',
          role: 'Batter',
          category: 'CAPPED',
          country: 'India',
          isOverseas: false,
          basePriceCr: 0.5,
          basePriceLakhs: 50,
          purchasePriceCr: 0.5,
          purchasePriceLakhs: 50,
          boughtAt: '2026-09-27T00:00:00Z',
          isMiniRound: false,
          isUnsoldRound: false,
          teamId: 't-1',
          teamName: 'Team 1',
          teamColor: '#000000',
        },
      ];

      // Gross historical turnover was 1.50 Cr (1.00 Cr for A + 0.50 Cr for B)
      const grossTurnoverCr = 1.5;
      const breakdowns = calculateBreakdowns(activeSquad, grossTurnoverCr);

      // Player B should represent 100% of the active category and role allocations, not 33% (0.5 / 1.5)
      expect(breakdowns.categoryBreakdown).toHaveLength(1);
      expect(breakdowns.categoryBreakdown[0]!.category).toBe('CAPPED');
      expect(breakdowns.categoryBreakdown[0]!.totalSpentCr).toBe(0.5);
      expect(breakdowns.categoryBreakdown[0]!.percentage).toBe(100);

      expect(breakdowns.roleBreakdown).toHaveLength(1);
      expect(breakdowns.roleBreakdown[0]!.role).toBe('Batter');
      expect(breakdowns.roleBreakdown[0]!.totalSpentCr).toBe(0.5);
      expect(breakdowns.roleBreakdown[0]!.percentage).toBe(100);
    });
  });
});
