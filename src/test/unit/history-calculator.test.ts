// src/test/unit/history-calculator.test.ts
// Phase 17D (Player History) & Phase 17E (Auction History) Comprehensive Test Suite

import { describe, it, expect } from 'vitest';
import {
  calculatePlayerAuctionHistory,
  calculateAuctionHistoryRecord,
} from '@/lib/history/history-calculator';
import type {
  RawLotInput,
  RawTeamInput,
  RawSquadPlayerInput,
  RawPlayerReleaseInput,
  RawMiniSessionInput,
  RawAuctionInput,
} from '@/lib/summary/results-calculator';

describe('Phase 17D: Player History Lifecycle & Integrity Suite', () => {
  const mockTeamX: RawTeamInput = {
    id: 'team-x',
    name: 'Chennai Super Kings',
    short_name: 'CSK',
    color: '#FFFF00',
    initial_purse: 12000,
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
    initial_purse: 12000,
    purse: 11920,
    players_bought: 1,
    overseas_count: 0,
    is_bot: true,
  };

  const mockTeams = [mockTeamX, mockTeamY];

  const dummyPlayer = {
    id: 'p-alpha',
    name: 'Player Alpha',
    role: 'Batter',
    category: 'CAPPED',
    country: 'India',
    is_overseas: false,
    base_price: 200,
  };

  // --------------------------------------------------------------------------
  // SCENARIO A: Mega Sold -> Released -> Mini Repurchased (Canonical Test)
  // --------------------------------------------------------------------------
  it('Scenario A: Mega Sold (100) -> Released (100) -> Mini Acquired (80) -> Final Owner Team Y', () => {
    const megaLot: RawLotInput = {
      id: 'lot-mega-1',
      lot_index: 0,
      status: 'SOLD',
      base_price: 200,
      winning_bid: 10000, // ₹100.00 Cr
      winning_team_id: 'team-x',
      is_mini_round: false,
      player: dummyPlayer,
    };

    const release: RawPlayerReleaseInput = {
      id: 'rel-1',
      auction_id: 'auc-1',
      team_id: 'team-x',
      player_id: 'p-alpha',
      refund_amount: 10000, // ₹100.00 Cr refund
      released_at: '2026-09-25T11:00:00Z',
    };

    const miniLot: RawLotInput = {
      id: 'lot-mini-1',
      lot_index: 10,
      status: 'SOLD',
      base_price: 100,
      winning_bid: 8000, // ₹80.00 Cr
      winning_team_id: 'team-y',
      is_mini_round: true,
      player: dummyPlayer,
    };

    const activeSquad: RawSquadPlayerInput[] = [
      {
        id: 'squad-1',
        team_id: 'team-y',
        player_id: 'p-alpha',
        lot_id: 'lot-mini-1',
        purchase_price: 8000,
        bought_at: '2026-09-25T11:30:00Z',
        player: dummyPlayer,
        lot: { id: 'lot-mini-1', is_mini_round: true },
      },
    ];

    const history = calculatePlayerAuctionHistory(
      dummyPlayer,
      [megaLot, miniLot],
      activeSquad,
      [release],
      mockTeams
    );

    // 1. Ownership Invariant: Owned by Team Y, NOT Team X
    expect(history.currentOwnership.isCurrentlyOwned).toBe(true);
    expect(history.currentOwnership.currentTeamId).toBe('team-y');
    expect(history.currentOwnership.currentTeamName).toBe('Mumbai Indians');
    expect(history.currentOwnership.purchasePriceCr).toBe(80);
    expect(history.currentOwnership.acquiredVia).toBe('MINI');

    // 2. Financial Semantics Invariant
    // Gross Historical Acquisition Value = 100 + 80 = 180 Cr
    expect(history.financialSummary.grossAcquisitionValueCr).toBe(180);
    // Release Refunds = 100 Cr
    expect(history.financialSummary.totalReleaseRefundsCr).toBe(100);
    // Net Capital Spend = 180 - 100 = 80 Cr
    expect(history.financialSummary.netCapitalSpendCr).toBe(80);
    // Active Roster Value = 80 Cr
    expect(history.financialSummary.currentRosterValueCr).toBe(80);

    // 3. Historical Provenance Invariant
    expect(history.megaAcquisitions).toHaveLength(1);
    expect(history.megaAcquisitions[0]!.teamId).toBe('team-x');
    expect(history.megaAcquisitions[0]!.amountCr).toBe(100);

    expect(history.releases).toHaveLength(1);
    expect(history.releases[0]!.teamId).toBe('team-x');
    expect(history.releases[0]!.amountCr).toBe(100);

    expect(history.miniAcquisitions).toHaveLength(1);
    expect(history.miniAcquisitions[0]!.teamId).toBe('team-y');
    expect(history.miniAcquisitions[0]!.amountCr).toBe(80);

    // Timeline ordering
    expect(history.timeline).toHaveLength(3);
    expect(history.timeline[0]!.eventType).toBe('MEGA_ACQUISITION');
    expect(history.timeline[1]!.eventType).toBe('RELEASE');
    expect(history.timeline[2]!.eventType).toBe('MINI_ACQUISITION');
  });

  // --------------------------------------------------------------------------
  // SCENARIO B: Mega Sold -> Partial Release / Release with Difference
  // --------------------------------------------------------------------------
  it('Scenario B: Mega Sold (100) -> Released (50) -> Unowned -> Net spend = 50', () => {
    const megaLot: RawLotInput = {
      id: 'lot-mega-b',
      lot_index: 0,
      status: 'SOLD',
      base_price: 200,
      winning_bid: 10000,
      winning_team_id: 'team-x',
      is_mini_round: false,
      player: dummyPlayer,
    };

    const release: RawPlayerReleaseInput = {
      id: 'rel-b',
      auction_id: 'auc-1',
      team_id: 'team-x',
      player_id: 'p-alpha',
      refund_amount: 5000, // 50 Cr refund
      released_at: '2026-09-25T11:00:00Z',
    };

    const history = calculatePlayerAuctionHistory(
      dummyPlayer,
      [megaLot],
      [], // No active squad row
      [release],
      mockTeams
    );

    expect(history.currentOwnership.isCurrentlyOwned).toBe(false);
    expect(history.currentOwnership.currentTeamId).toBeNull();
    expect(history.financialSummary.grossAcquisitionValueCr).toBe(100);
    expect(history.financialSummary.totalReleaseRefundsCr).toBe(50);
    expect(history.financialSummary.netCapitalSpendCr).toBe(50);
    expect(history.financialSummary.currentRosterValueCr).toBe(0);
  });

  // --------------------------------------------------------------------------
  // SCENARIO C: Mega Sold -> No Release -> Still Owned by Team X
  // --------------------------------------------------------------------------
  it('Scenario C: Mega Sold (100) -> No Release -> Current Owner Team X', () => {
    const megaLot: RawLotInput = {
      id: 'lot-mega-c',
      lot_index: 0,
      status: 'SOLD',
      base_price: 200,
      winning_bid: 10000,
      winning_team_id: 'team-x',
      is_mini_round: false,
      player: dummyPlayer,
    };

    const activeSquad: RawSquadPlayerInput[] = [
      {
        id: 'squad-c',
        team_id: 'team-x',
        player_id: 'p-alpha',
        lot_id: 'lot-mega-c',
        purchase_price: 10000,
        bought_at: '2026-09-25T10:15:00Z',
        player: dummyPlayer,
        lot: { id: 'lot-mega-c', is_mini_round: false },
      },
    ];

    const history = calculatePlayerAuctionHistory(
      dummyPlayer,
      [megaLot],
      activeSquad,
      [],
      mockTeams
    );

    expect(history.currentOwnership.isCurrentlyOwned).toBe(true);
    expect(history.currentOwnership.currentTeamId).toBe('team-x');
    expect(history.currentOwnership.acquiredVia).toBe('MEGA');
    expect(history.financialSummary.grossAcquisitionValueCr).toBe(100);
    expect(history.financialSummary.totalReleaseRefundsCr).toBe(0);
    expect(history.financialSummary.netCapitalSpendCr).toBe(100);
    expect(history.financialSummary.currentRosterValueCr).toBe(100);
  });

  // --------------------------------------------------------------------------
  // SCENARIO: Player Never Auctioned
  // --------------------------------------------------------------------------
  it('handles player never auctioned with clean zero defaults', () => {
    const history = calculatePlayerAuctionHistory(
      dummyPlayer,
      [],
      [],
      [],
      mockTeams
    );

    expect(history.currentOwnership.isCurrentlyOwned).toBe(false);
    expect(history.timeline).toHaveLength(0);
    expect(history.financialSummary.grossAcquisitionValueCr).toBe(0);
    expect(history.financialSummary.totalReleaseRefundsCr).toBe(0);
    expect(history.financialSummary.netCapitalSpendCr).toBe(0);
  });

  // --------------------------------------------------------------------------
  // SCENARIO: Mega Unsold Event
  // --------------------------------------------------------------------------
  it('records MEGA_UNSOLD event without inventing acquisitions or spend', () => {
    const unsoldLot: RawLotInput = {
      id: 'lot-unsold',
      lot_index: 2,
      status: 'UNSOLD',
      base_price: 200,
      winning_bid: null,
      winning_team_id: null,
      is_mini_round: false,
      player: dummyPlayer,
    };

    const history = calculatePlayerAuctionHistory(
      dummyPlayer,
      [unsoldLot],
      [],
      [],
      mockTeams
    );

    expect(history.currentOwnership.isCurrentlyOwned).toBe(false);
    expect(history.timeline).toHaveLength(1);
    expect(history.timeline[0]!.eventType).toBe('MEGA_UNSOLD');
    expect(history.financialSummary.grossAcquisitionValueCr).toBe(0);
    expect(history.megaAcquisitions).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // SCENARIO: Mini-Only Acquisition
  // --------------------------------------------------------------------------
  it('correctly tracks player who enters and is acquired exclusively in Mini Auction', () => {
    const miniLot: RawLotInput = {
      id: 'lot-mini-only',
      lot_index: 5,
      status: 'SOLD',
      base_price: 50,
      winning_bid: 120, // 1.20 Cr
      winning_team_id: 'team-y',
      is_mini_round: true,
      player: dummyPlayer,
    };

    const squad: RawSquadPlayerInput[] = [
      {
        id: 'sq-mini',
        team_id: 'team-y',
        player_id: 'p-alpha',
        lot_id: 'lot-mini-only',
        purchase_price: 120,
        player: dummyPlayer,
        lot: { id: 'lot-mini-only', is_mini_round: true },
      },
    ];

    const history = calculatePlayerAuctionHistory(
      dummyPlayer,
      [miniLot],
      squad,
      [],
      mockTeams
    );

    expect(history.currentOwnership.isCurrentlyOwned).toBe(true);
    expect(history.currentOwnership.acquiredVia).toBe('MINI');
    expect(history.megaAcquisitions).toHaveLength(0);
    expect(history.miniAcquisitions).toHaveLength(1);
    expect(history.financialSummary.grossAcquisitionValueCr).toBe(1.2);
    expect(history.financialSummary.netCapitalSpendCr).toBe(1.2);
  });

  // --------------------------------------------------------------------------
  // SCENARIO D: Player Unsold in Mega, then Sold in Mini
  // --------------------------------------------------------------------------
  it('Scenario D: Player Unsold in Mega, then Sold in Mini produces no fake Mega purchase', () => {
    const megaUnsoldLot: RawLotInput = {
      id: 'lot-mega-unsold',
      lot_index: 1,
      status: 'UNSOLD',
      base_price: 200,
      winning_bid: null,
      winning_team_id: null,
      is_mini_round: false,
      player: dummyPlayer,
    };

    const miniSoldLot: RawLotInput = {
      id: 'lot-mini-sold',
      lot_index: 15,
      status: 'SOLD',
      base_price: 150,
      winning_bid: 150, // 1.50 Cr
      winning_team_id: 'team-x',
      is_mini_round: true,
      player: dummyPlayer,
    };

    const squad: RawSquadPlayerInput[] = [
      {
        id: 'sq-d',
        team_id: 'team-x',
        player_id: 'p-alpha',
        lot_id: 'lot-mini-sold',
        purchase_price: 150,
        bought_at: '2026-09-25T11:45:00Z',
        player: dummyPlayer,
        lot: { id: 'lot-mini-sold', is_mini_round: true },
      },
    ];

    const history = calculatePlayerAuctionHistory(
      dummyPlayer,
      [megaUnsoldLot, miniSoldLot],
      squad,
      [],
      mockTeams
    );

    // Timeline must preserve both events without converting UNSOLD into a purchase
    expect(history.timeline).toHaveLength(2);
    expect(history.timeline[0]!.eventType).toBe('MEGA_UNSOLD');
    expect(history.timeline[0]!.amountCr).toBe(0);
    expect(history.timeline[1]!.eventType).toBe('MINI_ACQUISITION');
    expect(history.timeline[1]!.amountCr).toBe(1.5);

    // No fake Mega purchase
    expect(history.megaAcquisitions).toHaveLength(0);
    expect(history.miniAcquisitions).toHaveLength(1);

    // Ownership & Financials
    expect(history.currentOwnership.isCurrentlyOwned).toBe(true);
    expect(history.currentOwnership.currentTeamId).toBe('team-x');
    expect(history.currentOwnership.acquiredVia).toBe('MINI');
    expect(history.financialSummary.grossAcquisitionValueCr).toBe(1.5);
    expect(history.financialSummary.totalReleaseRefundsCr).toBe(0);
    expect(history.financialSummary.netCapitalSpendCr).toBe(1.5);
    expect(history.financialSummary.currentRosterValueCr).toBe(1.5);
  });

  // --------------------------------------------------------------------------
  // SCENARIO D2: Player Unsold in Mega and Unsold in Mini
  // --------------------------------------------------------------------------
  it('Scenario D2: Player Unsold in Mega and Unsold in Mini remains Free Agent with 0 spend', () => {
    const megaUnsold: RawLotInput = {
      id: 'lot-mega-unsold-2',
      lot_index: 3,
      status: 'UNSOLD',
      base_price: 200,
      winning_bid: null,
      winning_team_id: null,
      is_mini_round: false,
      player: dummyPlayer,
    };

    const miniUnsold: RawLotInput = {
      id: 'lot-mini-unsold-2',
      lot_index: 22,
      status: 'UNSOLD',
      base_price: 100,
      winning_bid: null,
      winning_team_id: null,
      is_mini_round: true,
      player: dummyPlayer,
    };

    const history = calculatePlayerAuctionHistory(
      dummyPlayer,
      [megaUnsold, miniUnsold],
      [],
      [],
      mockTeams
    );

    expect(history.currentOwnership.isCurrentlyOwned).toBe(false);
    expect(history.currentOwnership.currentTeamId).toBeNull();
    expect(history.timeline).toHaveLength(2);
    expect(history.timeline[0]!.eventType).toBe('MEGA_UNSOLD');
    expect(history.timeline[1]!.eventType).toBe('MINI_UNSOLD');
    expect(history.megaAcquisitions).toHaveLength(0);
    expect(history.miniAcquisitions).toHaveLength(0);
    expect(history.financialSummary.grossAcquisitionValueCr).toBe(0);
    expect(history.financialSummary.totalReleaseRefundsCr).toBe(0);
    expect(history.financialSummary.netCapitalSpendCr).toBe(0);
  });

  // --------------------------------------------------------------------------
  // SCENARIO I: Multiple Historical Acquisitions by Same Franchise
  // --------------------------------------------------------------------------
  it('Scenario I: Multiple Historical Acquisitions (Mega Sold -> Released -> Mini Repurchased by Team X)', () => {
    const megaLot: RawLotInput = {
      id: 'lot-mega-churn',
      lot_index: 0,
      status: 'SOLD',
      base_price: 200,
      winning_bid: 12000, // 120 Cr
      winning_team_id: 'team-x',
      is_mini_round: false,
      player: dummyPlayer,
    };

    const release: RawPlayerReleaseInput = {
      id: 'rel-churn',
      auction_id: 'auc-1',
      team_id: 'team-x',
      player_id: 'p-alpha',
      refund_amount: 12000,
      released_at: '2026-09-25T11:00:00Z',
    };

    const miniLot: RawLotInput = {
      id: 'lot-mini-churn',
      lot_index: 12,
      status: 'SOLD',
      base_price: 150,
      winning_bid: 9500, // 95 Cr
      winning_team_id: 'team-x',
      is_mini_round: true,
      player: dummyPlayer,
    };

    const squad: RawSquadPlayerInput[] = [
      {
        id: 'sq-churn',
        team_id: 'team-x',
        player_id: 'p-alpha',
        lot_id: 'lot-mini-churn',
        purchase_price: 9500,
        bought_at: '2026-09-25T11:45:00Z',
        player: dummyPlayer,
        lot: { id: 'lot-mini-churn', is_mini_round: true },
      },
    ];

    const history = calculatePlayerAuctionHistory(
      dummyPlayer,
      [megaLot, miniLot],
      squad,
      [release],
      mockTeams
    );

    // Both distinct historical acquisitions must be preserved
    expect(history.megaAcquisitions).toHaveLength(1);
    expect(history.megaAcquisitions[0]!.amountCr).toBe(120);
    expect(history.miniAcquisitions).toHaveLength(1);
    expect(history.miniAcquisitions[0]!.amountCr).toBe(95);
    expect(history.releases).toHaveLength(1);
    expect(history.releases[0]!.amountCr).toBe(120);

    // Financial semantics: 120 + 95 = 215 Cr Gross; 120 Cr Refund; 95 Cr Net Spend
    expect(history.financialSummary.grossAcquisitionValueCr).toBe(215);
    expect(history.financialSummary.totalReleaseRefundsCr).toBe(120);
    expect(history.financialSummary.netCapitalSpendCr).toBe(95);
    expect(history.financialSummary.currentRosterValueCr).toBe(95);

    // Current ownership
    expect(history.currentOwnership.isCurrentlyOwned).toBe(true);
    expect(history.currentOwnership.currentTeamId).toBe('team-x');
    expect(history.currentOwnership.acquiredVia).toBe('MINI');
  });
});

describe('Phase 17E: Auction History Lifecycle & Semantics Suite', () => {
  const mockRoom = {
    id: 'room-101',
    code: 'ROOM101',
    name: 'Premier Mega Auction Arena',
  };

  const mockAuction: RawAuctionInput = {
    id: 'auc-101',
    room_id: 'room-101',
    status: 'COMPLETED',
    total_lots: 10,
    created_at: '2026-09-25T10:00:00Z',
    started_at: '2026-09-25T10:05:00Z',
    completed_at: '2026-09-25T12:05:00Z',
    mega_completed_at: '2026-09-25T11:15:00Z',
  };

  const mockTeamA: RawTeamInput = {
    id: 'team-a',
    name: 'Team Alpha',
    short_name: 'TMA',
    color: '#FF0000',
    initial_purse: 12000,
    purse: 9000, // 12000 - 3500 + 500 = 9000
    players_bought: 1,
    overseas_count: 0,
    is_bot: false,
  };

  const mockTeamB: RawTeamInput = {
    id: 'team-b',
    name: 'Team Beta',
    short_name: 'TMB',
    color: '#00FF00',
    initial_purse: 12000,
    purse: 10000, // 12000 - 2000 = 10000
    players_bought: 1,
    overseas_count: 0,
    is_bot: true,
  };

  const mockTeams = [mockTeamA, mockTeamB];

  // --------------------------------------------------------------------------
  // AUCTION SCENARIO: Complete Mega + Mini with Release
  // --------------------------------------------------------------------------
  it('calculates full historical auction record with distinct Mega, Mini, and financial semantics', () => {
    const lots: RawLotInput[] = [
      // Mega lots
      { id: 'l1', lot_index: 0, status: 'SOLD', base_price: 200, winning_bid: 3500, winning_team_id: 'team-a', is_mini_round: false },
      { id: 'l2', lot_index: 1, status: 'UNSOLD', base_price: 150, winning_bid: null, winning_team_id: null, is_mini_round: false },
      // Mini lots
      { id: 'l3', lot_index: 2, status: 'SOLD', base_price: 100, winning_bid: 2000, winning_team_id: 'team-b', is_mini_round: true },
      { id: 'l4', lot_index: 3, status: 'UNSOLD', base_price: 50, winning_bid: null, winning_team_id: null, is_mini_round: true },
    ];

    const releases: RawPlayerReleaseInput[] = [
      { id: 'rel-1', auction_id: 'auc-101', team_id: 'team-a', player_id: 'p-1', refund_amount: 500, released_at: '2026-09-25T11:20:00Z' },
    ];

    const squad: RawSquadPlayerInput[] = [
      { id: 'sq-1', team_id: 'team-a', player_id: 'p-stay', purchase_price: 3000 },
      { id: 'sq-2', team_id: 'team-b', player_id: 'p-mini', purchase_price: 2000 },
    ];

    const miniSession: RawMiniSessionInput = {
      id: 'mini-ses-1',
      auction_id: 'auc-101',
      status: 'COMPLETED',
      total_lots: 2,
      completed_at: '2026-09-25T12:00:00Z',
    };

    const record = calculateAuctionHistoryRecord(
      mockRoom,
      mockAuction,
      lots,
      mockTeams,
      squad,
      releases,
      miniSession
    );

    // 1. Identity & Duration
    expect(record.auctionId).toBe('auc-101');
    expect(record.roomCode).toBe('ROOM101');
    expect(record.durationMinutes).toBe(125); // 10:00 to 12:05

    // 2. Mega Phase isolation
    expect(record.megaPhase.totalLots).toBe(2);
    expect(record.megaPhase.soldCount).toBe(1);
    expect(record.megaPhase.unsoldCount).toBe(1);
    expect(record.megaPhase.grossSpendCr).toBe(35); // 3500 Lakhs = 35 Cr

    // 3. Mini Phase isolation
    expect(record.miniPhase).not.toBeNull();
    expect(record.miniPhase!.totalLots).toBe(2);
    expect(record.miniPhase!.soldCount).toBe(1);
    expect(record.miniPhase!.unsoldCount).toBe(1);
    expect(record.miniPhase!.grossSpendCr).toBe(20); // 2000 Lakhs = 20 Cr
    expect(record.miniPhase!.totalRefundCr).toBe(5); // 500 Lakhs = 5 Cr

    // 4. Financial Semantics Invariants
    // Gross Historical Acquisition Value = 35 + 20 = 55 Cr
    expect(record.financials.grossHistoricalAcquisitionValueCr).toBe(55);
    // Release Refunds = 5 Cr
    expect(record.financials.totalReleaseRefundsCr).toBe(5);
    // Net Capital Spend = 55 - 5 = 50 Cr
    expect(record.financials.netCapitalSpendCr).toBe(50);
    // Active Roster Value = 30 + 20 = 50 Cr
    expect(record.financials.activeRosterValueCr).toBe(50);
    // Remaining Purse Sum = 90 + 100 = 190 Cr
    expect(record.financials.totalRemainingPurseCr).toBe(190);

    // 5. Team Summaries Invariant Check
    expect(record.teams[0]!.isPurseConsistent).toBe(true);
    expect(record.teams[1]!.isPurseConsistent).toBe(true);
  });

  // --------------------------------------------------------------------------
  // SCENARIO D: Zero Lot Mini in Auction History
  // --------------------------------------------------------------------------
  it('Scenario D: Mini session with zero lots does not invent purchases or crash', () => {
    const lots: RawLotInput[] = [
      { id: 'l1', lot_index: 0, status: 'SOLD', base_price: 200, winning_bid: 1000, winning_team_id: 'team-a', is_mini_round: false },
    ];

    const miniSession: RawMiniSessionInput = {
      id: 'mini-zero',
      auction_id: 'auc-101',
      status: 'COMPLETED',
      total_lots: 0,
      completed_at: '2026-09-25T11:30:00Z',
    };

    const record = calculateAuctionHistoryRecord(
      mockRoom,
      mockAuction,
      lots,
      mockTeams,
      [],
      [],
      miniSession
    );

    expect(record.miniPhase).not.toBeNull();
    expect(record.miniPhase!.totalLots).toBe(0);
    expect(record.miniPhase!.soldCount).toBe(0);
    expect(record.miniPhase!.grossSpendCr).toBe(0);
    expect(record.financials.grossHistoricalAcquisitionValueCr).toBe(10);
    expect(record.financials.netCapitalSpendCr).toBe(10);
  });

  // --------------------------------------------------------------------------
  // SCENARIO E: All Lots Unsold
  // --------------------------------------------------------------------------
  it('Scenario E: All lots unsold produces 0 spend and 0 acquisitions', () => {
    const lots: RawLotInput[] = [
      { id: 'u1', lot_index: 0, status: 'UNSOLD', base_price: 200, winning_bid: null, winning_team_id: null, is_mini_round: false },
      { id: 'u2', lot_index: 1, status: 'UNSOLD', base_price: 100, winning_bid: null, winning_team_id: null, is_mini_round: false },
    ];

    const record = calculateAuctionHistoryRecord(
      mockRoom,
      mockAuction,
      lots,
      mockTeams,
      [],
      [],
      null
    );

    expect(record.megaPhase.soldCount).toBe(0);
    expect(record.megaPhase.unsoldCount).toBe(2);
    expect(record.financials.grossHistoricalAcquisitionValueCr).toBe(0);
    expect(record.financials.netCapitalSpendCr).toBe(0);
    expect(record.miniPhase).toBeNull();
  });

  // --------------------------------------------------------------------------
  // SCENARIO F: All Lots Sold
  // --------------------------------------------------------------------------
  it('Scenario F: All lots sold correctly counts 100% sold and 0 unsold', () => {
    const lots: RawLotInput[] = [
      { id: 's1', lot_index: 0, status: 'SOLD', base_price: 200, winning_bid: 2500, winning_team_id: 'team-a', is_mini_round: false },
      { id: 's2', lot_index: 1, status: 'SOLD', base_price: 150, winning_bid: 1500, winning_team_id: 'team-b', is_mini_round: false },
    ];

    const record = calculateAuctionHistoryRecord(
      mockRoom,
      mockAuction,
      lots,
      mockTeams,
      [],
      [],
      null
    );

    expect(record.megaPhase.soldCount).toBe(2);
    expect(record.megaPhase.unsoldCount).toBe(0);
    expect(record.financials.grossHistoricalAcquisitionValueCr).toBe(40);
  });
});
