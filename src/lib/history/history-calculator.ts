// src/lib/history/history-calculator.ts
// Pure, deterministic historical analytical engine for Mega Auction V3 (Phase 17D + 17E).
// Reconstructs complete player lifecycles and auction history with rigorous financial semantics:
// - Gross Historical Acquisition Value (Total winning bid commitments)
// - Release Refunds (Capital credited back upon player releases)
// - Net Capital Spend (Gross acquisitions minus release refunds)

import type {
  RawLotInput,
  RawTeamInput,
  RawSquadPlayerInput,
  RawPlayerReleaseInput,
  RawMiniSessionInput,
  RawAuctionInput,
} from '../summary/results-calculator';

export type PlayerLifecycleEventType =
  | 'MEGA_NOMINATION'
  | 'MEGA_ACQUISITION'
  | 'MEGA_UNSOLD'
  | 'RELEASE'
  | 'MINI_SELECTION'
  | 'MINI_ACQUISITION'
  | 'MINI_UNSOLD';

export interface PlayerHistoryEvent {
  id: string;
  eventType: PlayerLifecycleEventType;
  timestamp: string;
  phase: 'MEGA' | 'MINI' | 'INTERIM';
  description: string;
  amountLakhs: number; // Winning bid or refund amount
  amountCr: number;
  teamId?: string | null;
  teamName?: string | null;
  teamColor?: string | null;
  lotId?: string | null;
  lotIndex?: number | null;
  basePriceCr?: number | null;
}

export interface PlayerOwnershipState {
  isCurrentlyOwned: boolean;
  currentTeamId: string | null;
  currentTeamName: string | null;
  currentTeamColor: string | null;
  purchasePriceLakhs: number | null;
  purchasePriceCr: number | null;
  acquiredVia: 'MEGA' | 'MINI' | null;
  boughtAt: string | null;
}

export interface PlayerFinancialSummary {
  grossAcquisitionValueLakhs: number;
  grossAcquisitionValueCr: number;
  totalReleaseRefundsLakhs: number;
  totalReleaseRefundsCr: number;
  netCapitalSpendLakhs: number;
  netCapitalSpendCr: number;
  currentRosterValueCr: number;
}

export interface PlayerAuctionHistoryRecord {
  player: {
    id: string;
    name: string;
    role: string;
    category: string;
    country: string;
    isOverseas: boolean;
    basePriceCr: number;
    basePriceLakhs: number;
    imageUrl?: string;
  };
  currentOwnership: PlayerOwnershipState;
  financialSummary: PlayerFinancialSummary;
  timeline: PlayerHistoryEvent[];
  megaAcquisitions: PlayerHistoryEvent[];
  miniAcquisitions: PlayerHistoryEvent[];
  releases: PlayerHistoryEvent[];
}

export interface HistoricalAuctionPhaseMetrics {
  totalLots: number;
  soldCount: number;
  unsoldCount: number;
  grossSpendLakhs: number;
  grossSpendCr: number;
  completedAt: string | null;
}

export interface HistoricalAuctionRecord {
  auctionId: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  status: string;
  durationMinutes: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  megaCompletedAt: string | null;

  // Phase Metrics
  megaPhase: HistoricalAuctionPhaseMetrics;
  miniPhase: (HistoricalAuctionPhaseMetrics & {
    hasMiniSession: boolean;
    miniSessionId: string | null;
    miniStatus: string | null;
    totalReleases: number;
    totalRefundLakhs: number;
    totalRefundCr: number;
  }) | null;

  // Explicit Financial Semantics
  financials: {
    grossHistoricalAcquisitionValueLakhs: number;
    grossHistoricalAcquisitionValueCr: number;
    totalReleaseRefundsLakhs: number;
    totalReleaseRefundsCr: number;
    netCapitalSpendLakhs: number;
    netCapitalSpendCr: number;
    activeRosterValueLakhs: number;
    activeRosterValueCr: number;
    totalRemainingPurseLakhs: number;
    totalRemainingPurseCr: number;
  };

  // Participating Teams Summary
  teams: {
    id: string;
    name: string;
    shortName: string;
    color: string;
    isBot: boolean;
    initialPurseCr: number;
    megaSpendCr: number;
    releaseRefundsCr: number;
    miniSpendCr: number;
    grossSpentCr: number;
    netCapitalSpendCr: number;
    finalPurseCr: number;
    activeSquadCount: number;
    isPurseConsistent: boolean;
  }[];

  // Top Purchases
  topPurchases: {
    lotId: string;
    playerId: string;
    playerName: string;
    teamName: string;
    teamColor: string;
    phase: 'MEGA' | 'MINI';
    purchasePriceCr: number;
  }[];
}

/**
 * Phase 17D: Pure function to reconstruct the complete lifecycle history of a player.
 * Preserves historical acquisitions, releases/refunds, and distinguishes current active ownership.
 */
export function calculatePlayerAuctionHistory(
  player: {
    id: string;
    name: string;
    role?: string;
    category?: string;
    country?: string;
    is_overseas?: boolean;
    base_price?: number;
    image_url?: string | null;
  },
  lots: RawLotInput[],
  squadPlayers: RawSquadPlayerInput[],
  releases: RawPlayerReleaseInput[],
  teams: RawTeamInput[]
): PlayerAuctionHistoryRecord {
  const playerId = player.id;
  const basePriceLakhs = player.base_price || 200;

  // Filter lots belonging to this player
  const playerLots = lots.filter(
    (l) => (l.player?.id === playerId) || ((l as any).player_id === playerId)
  );

  // Filter releases belonging to this player
  const playerReleases = releases.filter(
    (r) => r.player_id === playerId || r.player?.id === playerId
  );

  // Filter active squad rows for this player
  const activeSquadRow = squadPlayers.find(
    (s) => s.player_id === playerId || s.player?.id === playerId
  );

  const timeline: PlayerHistoryEvent[] = [];
  const megaAcquisitions: PlayerHistoryEvent[] = [];
  const miniAcquisitions: PlayerHistoryEvent[] = [];
  const mappedReleases: PlayerHistoryEvent[] = [];

  let grossAcquisitionValueLakhs = 0;
  let totalReleaseRefundsLakhs = 0;

  // 1. Process Mega Lots
  const megaLots = playerLots.filter((l) => !l.is_mini_round);
  megaLots.forEach((lot) => {
    const lotBasePriceCr = (lot.base_price || basePriceLakhs) / 100;
    const team = teams.find((t) => t.id === lot.winning_team_id);

    if (lot.status === 'SOLD') {
      const winningBidLakhs = lot.winning_bid || 0;
      grossAcquisitionValueLakhs += winningBidLakhs;

      const event: PlayerHistoryEvent = {
        id: `event-${lot.id}`,
        eventType: 'MEGA_ACQUISITION',
        timestamp: (lot as any).created_at || new Date().toISOString(),
        phase: 'MEGA',
        description: `Acquired by ${team?.name || 'Unknown Team'} in Mega Auction for ₹${(winningBidLakhs / 100).toFixed(2)} Cr`,
        amountLakhs: winningBidLakhs,
        amountCr: winningBidLakhs / 100,
        teamId: lot.winning_team_id || null,
        teamName: team?.name || null,
        teamColor: team?.color || '#6B7280',
        lotId: lot.id,
        lotIndex: lot.lot_index,
        basePriceCr: lotBasePriceCr,
      };

      timeline.push(event);
      megaAcquisitions.push(event);
    } else if (lot.status === 'UNSOLD') {
      const event: PlayerHistoryEvent = {
        id: `event-${lot.id}`,
        eventType: 'MEGA_UNSOLD',
        timestamp: (lot as any).created_at || new Date().toISOString(),
        phase: 'MEGA',
        description: `Passed UNSOLD in Mega Auction at base price ₹${lotBasePriceCr.toFixed(2)} Cr`,
        amountLakhs: 0,
        amountCr: 0,
        lotId: lot.id,
        lotIndex: lot.lot_index,
        basePriceCr: lotBasePriceCr,
      };

      timeline.push(event);
    }
  });

  // 2. Process Releases
  playerReleases.forEach((rel) => {
    const refundLakhs = rel.refund_amount || 0;
    totalReleaseRefundsLakhs += refundLakhs;
    const releasingTeam = teams.find((t) => t.id === rel.team_id);

    const event: PlayerHistoryEvent = {
      id: `event-${rel.id}`,
      eventType: 'RELEASE',
      timestamp: rel.released_at,
      phase: 'INTERIM',
      description: `Released by ${releasingTeam?.name || 'Releasing Team'} with ₹${(refundLakhs / 100).toFixed(2)} Cr purse refund`,
      amountLakhs: refundLakhs,
      amountCr: refundLakhs / 100,
      teamId: rel.team_id,
      teamName: releasingTeam?.name || null,
      teamColor: releasingTeam?.color || '#6B7280',
    };

    timeline.push(event);
    mappedReleases.push(event);
  });

  // 3. Process Mini Lots
  const miniLots = playerLots.filter((l) => Boolean(l.is_mini_round));
  miniLots.forEach((lot) => {
    const lotBasePriceCr = (lot.base_price || basePriceLakhs) / 100;
    const team = teams.find((t) => t.id === lot.winning_team_id);

    if (lot.status === 'SOLD') {
      const winningBidLakhs = lot.winning_bid || 0;
      grossAcquisitionValueLakhs += winningBidLakhs;

      const event: PlayerHistoryEvent = {
        id: `event-${lot.id}`,
        eventType: 'MINI_ACQUISITION',
        timestamp: (lot as any).created_at || new Date().toISOString(),
        phase: 'MINI',
        description: `Acquired by ${team?.name || 'Unknown Team'} in Mini Auction for ₹${(winningBidLakhs / 100).toFixed(2)} Cr`,
        amountLakhs: winningBidLakhs,
        amountCr: winningBidLakhs / 100,
        teamId: lot.winning_team_id || null,
        teamName: team?.name || null,
        teamColor: team?.color || '#6B7280',
        lotId: lot.id,
        lotIndex: lot.lot_index,
        basePriceCr: lotBasePriceCr,
      };

      timeline.push(event);
      miniAcquisitions.push(event);
    } else if (lot.status === 'UNSOLD') {
      const event: PlayerHistoryEvent = {
        id: `event-${lot.id}`,
        eventType: 'MINI_UNSOLD',
        timestamp: (lot as any).created_at || new Date().toISOString(),
        phase: 'MINI',
        description: `Passed UNSOLD in Mini Auction at base price ₹${lotBasePriceCr.toFixed(2)} Cr`,
        amountLakhs: 0,
        amountCr: 0,
        lotId: lot.id,
        lotIndex: lot.lot_index,
        basePriceCr: lotBasePriceCr,
      };

      timeline.push(event);
    }
  });

  // 4. Current Active Ownership State (strictly from squadPlayers)
  let currentOwnership: PlayerOwnershipState;
  if (activeSquadRow) {
    const owningTeam = teams.find((t) => t.id === activeSquadRow.team_id);
    const purchaseLakhs = activeSquadRow.purchase_price || 0;
    const isMiniAcquisition = Boolean(activeSquadRow.lot?.is_mini_round);

    currentOwnership = {
      isCurrentlyOwned: true,
      currentTeamId: activeSquadRow.team_id,
      currentTeamName: owningTeam?.name || 'Current Franchise',
      currentTeamColor: owningTeam?.color || '#6B7280',
      purchasePriceLakhs: purchaseLakhs,
      purchasePriceCr: purchaseLakhs / 100,
      acquiredVia: isMiniAcquisition ? 'MINI' : 'MEGA',
      boughtAt: activeSquadRow.bought_at || null,
    };
  } else {
    currentOwnership = {
      isCurrentlyOwned: false,
      currentTeamId: null,
      currentTeamName: null,
      currentTeamColor: null,
      purchasePriceLakhs: null,
      purchasePriceCr: null,
      acquiredVia: null,
      boughtAt: null,
    };
  }

  // 5. Strict Financial Summary
  const netCapitalSpendLakhs = grossAcquisitionValueLakhs - totalReleaseRefundsLakhs;
  const financialSummary: PlayerFinancialSummary = {
    grossAcquisitionValueLakhs,
    grossAcquisitionValueCr: grossAcquisitionValueLakhs / 100,
    totalReleaseRefundsLakhs,
    totalReleaseRefundsCr: totalReleaseRefundsLakhs / 100,
    netCapitalSpendLakhs,
    netCapitalSpendCr: netCapitalSpendLakhs / 100,
    currentRosterValueCr: currentOwnership.purchasePriceCr || 0,
  };

  return {
    player: {
      id: player.id,
      name: player.name || 'Unknown Player',
      role: player.role || 'Batter',
      category: player.category || 'CAPPED',
      country: player.country || 'India',
      isOverseas: Boolean(player.is_overseas),
      basePriceLakhs,
      basePriceCr: basePriceLakhs / 100,
      imageUrl: player.image_url || undefined,
    },
    currentOwnership,
    financialSummary,
    timeline,
    megaAcquisitions,
    miniAcquisitions,
    releases: mappedReleases,
  };
}

/**
 * Phase 17E: Pure function to calculate an auction's authoritative historical summary record.
 */
export function calculateAuctionHistoryRecord(
  room: { id: string; code: string; name: string },
  auction: RawAuctionInput,
  lots: RawLotInput[],
  teams: RawTeamInput[],
  squadPlayers: RawSquadPlayerInput[],
  releases: RawPlayerReleaseInput[],
  miniSession: RawMiniSessionInput | null | undefined
): HistoricalAuctionRecord {
  // Mega Phase
  const megaLots = lots.filter((l) => !l.is_mini_round);
  const megaSold = megaLots.filter((l) => l.status === 'SOLD');
  const megaUnsold = megaLots.filter((l) => l.status === 'UNSOLD');
  const megaGrossSpendLakhs = megaSold.reduce((sum, l) => sum + (l.winning_bid || 0), 0);

  const megaPhase: HistoricalAuctionPhaseMetrics = {
    totalLots: megaLots.length,
    soldCount: megaSold.length,
    unsoldCount: megaUnsold.length,
    grossSpendLakhs: megaGrossSpendLakhs,
    grossSpendCr: megaGrossSpendLakhs / 100,
    completedAt: auction.mega_completed_at || (auction.status === 'COMPLETED' ? auction.completed_at || null : null),
  };

  // Mini Phase
  let miniPhase: HistoricalAuctionRecord['miniPhase'] = null;
  let miniGrossSpendLakhs = 0;
  let totalReleaseRefundsLakhs = 0;

  if (miniSession) {
    const miniLots = lots.filter((l) => Boolean(l.is_mini_round));
    const miniSold = miniLots.filter((l) => l.status === 'SOLD');
    const miniUnsold = miniLots.filter((l) => l.status === 'UNSOLD');
    miniGrossSpendLakhs = miniSold.reduce((sum, l) => sum + (l.winning_bid || 0), 0);
    totalReleaseRefundsLakhs = releases.reduce((sum, r) => sum + (r.refund_amount || 0), 0);

    miniPhase = {
      hasMiniSession: true,
      miniSessionId: miniSession.id,
      miniStatus: miniSession.status,
      totalLots: Math.max(miniSession.total_lots || 0, miniLots.length),
      soldCount: miniSold.length,
      unsoldCount: miniUnsold.length,
      grossSpendLakhs: miniGrossSpendLakhs,
      grossSpendCr: miniGrossSpendLakhs / 100,
      totalReleases: releases.length,
      totalRefundLakhs: totalReleaseRefundsLakhs,
      totalRefundCr: totalReleaseRefundsLakhs / 100,
      completedAt: miniSession.completed_at || null,
    };
  }

  // Combined Financials
  const grossHistoricalAcquisitionValueLakhs = megaGrossSpendLakhs + miniGrossSpendLakhs;
  const netCapitalSpendLakhs = grossHistoricalAcquisitionValueLakhs - totalReleaseRefundsLakhs;
  const activeRosterValueLakhs = squadPlayers.reduce((sum, s) => sum + (s.purchase_price || 0), 0);
  const totalRemainingPurseLakhs = teams.reduce((sum, t) => sum + (t.purse || 0), 0);

  // Teams Financial Summaries
  const teamSummaries = teams.map((team) => {
    const teamMegaSold = megaSold.filter((l) => l.winning_team_id === team.id);
    const teamMiniSold = lots.filter((l) => l.winning_team_id === team.id && l.status === 'SOLD' && Boolean(l.is_mini_round));
    const teamReleases = releases.filter((r) => r.team_id === team.id);
    const teamSquad = squadPlayers.filter((s) => s.team_id === team.id);

    const teamMegaSpendLakhs = teamMegaSold.reduce((sum, l) => sum + (l.winning_bid || 0), 0);
    const teamMiniSpendLakhs = teamMiniSold.reduce((sum, l) => sum + (l.winning_bid || 0), 0);
    const teamRefundsLakhs = teamReleases.reduce((sum, r) => sum + (r.refund_amount || 0), 0);

    const initialLakhs = team.initial_purse || 12000;
    const expectedFinalPurseLakhs = initialLakhs - teamMegaSpendLakhs + teamRefundsLakhs - teamMiniSpendLakhs;
    const isPurseConsistent = team.purse === expectedFinalPurseLakhs;

    return {
      id: team.id,
      name: team.name,
      shortName: team.short_name,
      color: team.color || '#6B7280',
      isBot: Boolean(team.is_bot),
      initialPurseCr: initialLakhs / 100,
      megaSpendCr: teamMegaSpendLakhs / 100,
      releaseRefundsCr: teamRefundsLakhs / 100,
      miniSpendCr: teamMiniSpendLakhs / 100,
      grossSpentCr: (teamMegaSpendLakhs + teamMiniSpendLakhs) / 100,
      netCapitalSpendCr: (teamMegaSpendLakhs + teamMiniSpendLakhs - teamRefundsLakhs) / 100,
      finalPurseCr: team.purse / 100,
      activeSquadCount: teamSquad.length,
      isPurseConsistent,
    };
  });

  // Top Purchases (Mega + Mini)
  const allSoldLots = lots.filter((l) => l.status === 'SOLD');
  const topPurchases = [...allSoldLots]
    .sort((a, b) => (b.winning_bid || 0) - (a.winning_bid || 0))
    .slice(0, 5)
    .map((lot) => {
      const player = lot.player || ({} as any);
      const team = teams.find((t) => t.id === lot.winning_team_id);
      return {
        lotId: lot.id,
        playerId: player.id || '',
        playerName: player.name || 'Unknown Player',
        teamName: team?.name || 'Unknown Team',
        teamColor: team?.color || '#6B7280',
        phase: lot.is_mini_round ? ('MINI' as const) : ('MEGA' as const),
        purchasePriceCr: (lot.winning_bid || 0) / 100,
      };
    });

  // Duration
  const createdMs = new Date(auction.created_at || Date.now()).getTime();
  const completedMs = auction.completed_at ? new Date(auction.completed_at).getTime() : Date.now();
  const durationMinutes = Math.max(1, Math.round((completedMs - createdMs) / (1000 * 60)));

  return {
    auctionId: auction.id,
    roomId: room.id,
    roomCode: room.code,
    roomName: room.name,
    status: auction.status,
    durationMinutes,
    createdAt: auction.created_at,
    startedAt: auction.started_at || null,
    completedAt: auction.completed_at || null,
    megaCompletedAt: auction.mega_completed_at || null,
    megaPhase,
    miniPhase,
    financials: {
      grossHistoricalAcquisitionValueLakhs,
      grossHistoricalAcquisitionValueCr: grossHistoricalAcquisitionValueLakhs / 100,
      totalReleaseRefundsLakhs,
      totalReleaseRefundsCr: totalReleaseRefundsLakhs / 100,
      netCapitalSpendLakhs,
      netCapitalSpendCr: netCapitalSpendLakhs / 100,
      activeRosterValueLakhs,
      activeRosterValueCr: activeRosterValueLakhs / 100,
      totalRemainingPurseLakhs,
      totalRemainingPurseCr: totalRemainingPurseLakhs / 100,
    },
    teams: teamSummaries,
    topPurchases,
  };
}
