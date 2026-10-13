// src/lib/summary/results-calculator.ts
// Pure, deterministic post-auction analytical engine for Mega Auction V3.
// Strictly partitions Mega vs Mini lots, separates active squad from historical events,
// and enforces purse invariants with audit-grade traceability.

export interface RawLotInput {
  id: string;
  lot_index: number;
  status: string; // 'PENDING' | 'GET_READY' | 'ACTIVE' | 'BIDDING' | 'SOLD' | 'UNSOLD' | 'SKIPPED'
  base_price: number; // in Lakhs
  winning_bid?: number | null; // in Lakhs
  winning_team_id?: string | null;
  is_mini_round?: boolean;
  player?: {
    id: string;
    name: string;
    role: string;
    category: string;
    country: string;
    is_overseas: boolean;
    image_url?: string | null;
    base_price?: number;
  } | null;
}

export interface RawTeamInput {
  id: string;
  name: string;
  short_name: string;
  color?: string | null;
  purse: number; // in Lakhs
  initial_purse: number; // in Lakhs
  players_bought: number;
  overseas_count: number;
  is_bot: boolean;
}

export interface RawSquadPlayerInput {
  id: string;
  team_id: string;
  player_id: string;
  lot_id?: string | null;
  purchase_price: number; // in Lakhs
  bought_at?: string | null;
  player?: {
    id: string;
    name: string;
    role: string;
    category: string;
    country: string;
    is_overseas: boolean;
    image_url?: string | null;
    base_price?: number;
  } | null;
  lot?: {
    id: string;
    is_mini_round?: boolean;
  } | null;
}

export interface RawPlayerReleaseInput {
  id: string;
  auction_id: string;
  team_id: string;
  player_id: string;
  refund_amount: number; // in Lakhs
  released_at: string;
  player?: {
    id: string;
    name: string;
    role: string;
    category: string;
    country: string;
    is_overseas: boolean;
    image_url?: string | null;
  } | null;
}

export interface RawMiniSessionInput {
  id: string;
  auction_id: string;
  status: string; // 'SETUP' | 'SELECTION_OPEN' | 'SELECTION_CLOSED' | 'BIDDING' | 'COMPLETED'
  selection_expires_at?: string | null;
  total_lots: number;
  closed_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RawAuctionInput {
  id: string;
  room_id: string;
  status: string;
  total_lots?: number;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  mega_completed_at?: string | null;
  is_unsold_round?: boolean;
}

export interface SummaryPlayerItem {
  id: string;
  squadPlayerId?: string;
  lotId?: string;
  name: string;
  role: string;
  category: string;
  country: string;
  isOverseas: boolean;
  basePriceCr: number;
  basePriceLakhs: number;
  purchasePriceCr: number;
  purchasePriceLakhs: number;
  boughtAt: string;
  isMiniRound: boolean;
  isUnsoldRound: boolean; // Always false; retained for UI contract backward compatibility
  imageUrl?: string;
  teamId: string;
  teamName: string;
  teamColor: string;
}

export interface SummaryLotItem {
  id: string;
  lotIndex: number;
  playerId: string;
  playerName: string;
  role: string;
  category: string;
  country: string;
  isOverseas: boolean;
  basePriceCr: number;
  basePriceLakhs: number;
  winningBidCr: number | null;
  winningBidLakhs: number | null;
  winningTeamId: string | null;
  winningTeamName: string | null;
  winningTeamColor: string | null;
  status: string;
  isMiniRound: boolean;
  isUnsoldRound: boolean; // Always false; retained for backward compatibility
  imageUrl?: string;
}

export interface SummaryReleaseItem {
  id: string;
  auctionId: string;
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  role: string;
  category: string;
  country: string;
  isOverseas: boolean;
  refundAmountLakhs: number;
  refundAmountCr: number;
  releasedAt: string;
  imageUrl?: string;
}

export interface MegaResults {
  totalLots: number;
  soldCount: number;
  unsoldCount: number;
  totalSpendLakhs: number;
  totalSpendCr: number;
  averagePurchasePriceCr: number;
  highestPurchaseCr: number;
  lowestPurchaseCr: number;
  completedAt: string | null;
  soldLots: SummaryLotItem[];
  unsoldLots: SummaryLotItem[];
}

export interface MiniResults {
  hasMiniSession: boolean;
  sessionId: string;
  status: string;
  totalLots: number;
  soldCount: number;
  unsoldCount: number;
  totalSpendLakhs: number;
  totalSpendCr: number;
  averagePurchasePriceCr: number;
  highestPurchaseCr: number;
  lowestPurchaseCr: number;
  completedAt: string | null;
  soldLots: SummaryLotItem[];
  unsoldLots: SummaryLotItem[];
  totalReleases: number;
  totalRefundLakhs: number;
  totalRefundCr: number;
  releases: SummaryReleaseItem[];
}

export interface TeamResultModel {
  id: string;
  name: string;
  shortName: string;
  color: string;
  isBot: boolean;

  // Financial (in Lakhs and Cr)
  initialPurseLakhs: number;
  initialPurseCr: number;
  megaSpendLakhs: number;
  megaSpendCr: number;
  releaseRefundsLakhs: number;
  releaseRefundsCr: number;
  miniSpendLakhs: number;
  miniSpendCr: number;
  grossSpentCr: number;
  totalSpentCr: number; // Net spend: (megaSpend + miniSpend - releaseRefunds) / 100
  finalPurseLakhs: number;
  finalPurseCr: number;
  remainingPurseCr: number;
  expectedFinalPurseLakhs: number;
  expectedFinalPurseCr: number;
  purseDiscrepancyLakhs: number;
  purseDiscrepancyCr: number;
  isPurseConsistent: boolean;

  // Squad Metrics (Active Squad ONLY)
  playersBought: number;
  overseasCount: number;
  avgPurchasePriceCr: number;
  remainingSquadSlots: number;
  remainingOverseasSlots: number;
  maxSquadSize: number;
  maxOverseas: number;
  squad: SummaryPlayerItem[];

  // Historical Breakdown
  megaAcquisitions: SummaryPlayerItem[];
  miniAcquisitions: SummaryPlayerItem[];
  releasedPlayers: SummaryReleaseItem[];
}

export interface CombinedOverview {
  roomCode: string;
  roomName: string;
  auctionId: string;
  status: string;
  megaStatus: string;
  miniStatus: string | null;
  totalLots: number;
  soldCount: number;
  unsoldCount: number;
  megaSoldCount: number;
  miniSoldCount: number;
  round1SoldCount: number; // Backward compatibility alias to megaSoldCount
  round2SoldCount: number; // Backward compatibility alias to miniSoldCount
  totalSpendCr: number; // Gross historical spend
  netSpendCr: number; // Gross spend minus refunds
  totalRefundCr: number;
  averagePurchasePriceCr: number;
  highestPurchaseCr: number;
  lowestPurchaseCr: number;
  activePlayersRostered: number;
  durationMinutes: number;
  createdAt: string;
  completedAt: string | null;
  megaCompletedAt: string | null;
  miniCompletedAt: string | null;
}

export interface CategoryBreakdown {
  category: string;
  count: number;
  totalSpentCr: number;
  percentage: number;
}

export interface RoleBreakdown {
  role: string;
  count: number;
  totalSpentCr: number;
  percentage: number;
}

export interface DomesticVsOverseasBreakdown {
  domesticCount: number;
  domesticSpendCr: number;
  overseasCount: number;
  overseasSpendCr: number;
}

/**
 * Pure function: Maps raw lot to standardized SummaryLotItem
 */
export function mapLotToSummaryItem(lot: RawLotInput, teams: RawTeamInput[]): SummaryLotItem {
  const player = lot.player || ({} as any);
  const team = teams.find((t) => t.id === lot.winning_team_id);
  const winningBidLakhs = lot.status === 'SOLD' && typeof lot.winning_bid === 'number' ? lot.winning_bid : null;
  const basePriceLakhs = lot.base_price || 0;

  return {
    id: lot.id,
    lotIndex: lot.lot_index,
    playerId: player.id || '',
    playerName: player.name || 'Unknown Player',
    role: player.role || 'Batter',
    category: player.category || 'CAPPED',
    country: player.country || 'India',
    isOverseas: Boolean(player.is_overseas),
    basePriceLakhs,
    basePriceCr: basePriceLakhs / 100,
    winningBidLakhs,
    winningBidCr: winningBidLakhs !== null ? winningBidLakhs / 100 : null,
    winningTeamId: lot.winning_team_id || null,
    winningTeamName: team ? team.name : null,
    winningTeamColor: team ? team.color || '#6B7280' : null,
    status: lot.status,
    isMiniRound: Boolean(lot.is_mini_round),
    isUnsoldRound: false, // Authoritative: does not exist on auction_lots
    imageUrl: player.image_url || undefined,
  };
}

/**
 * Pure function: Calculates Mega Auction results.
 * Strictly filters to is_mini_round === false.
 */
export function calculateMegaResults(
  lots: RawLotInput[],
  auction: RawAuctionInput,
  teams: RawTeamInput[]
): MegaResults {
  // Authoritative partition: Mega lots have is_mini_round = false (or undefined treated as false)
  const megaLots = lots.filter((l) => !l.is_mini_round);

  const soldLotsRaw = megaLots.filter((l) => l.status === 'SOLD');
  const unsoldLotsRaw = megaLots.filter((l) => l.status === 'UNSOLD');

  const soldLots = soldLotsRaw.map((l) => mapLotToSummaryItem(l, teams));
  const unsoldLots = unsoldLotsRaw.map((l) => mapLotToSummaryItem(l, teams));

  const totalSpendLakhs = soldLotsRaw.reduce((sum, l) => sum + (l.winning_bid || 0), 0);
  const totalSpendCr = totalSpendLakhs / 100;
  const soldCount = soldLots.length;
  const unsoldCount = unsoldLots.length;
  const averagePurchasePriceCr = soldCount > 0 ? totalSpendCr / soldCount : 0;

  const soldPrices = soldLotsRaw.map((l) => l.winning_bid || 0);
  const highestPurchaseCr = soldPrices.length > 0 ? Math.max(...soldPrices) / 100 : 0;
  const lowestPurchaseCr = soldPrices.length > 0 ? Math.min(...soldPrices) / 100 : 0;

  const completedAt = auction.mega_completed_at || (auction.status === 'COMPLETED' ? auction.completed_at || null : null);

  return {
    totalLots: megaLots.length,
    soldCount,
    unsoldCount,
    totalSpendLakhs,
    totalSpendCr,
    averagePurchasePriceCr,
    highestPurchaseCr,
    lowestPurchaseCr,
    completedAt,
    soldLots,
    unsoldLots,
  };
}

/**
 * Pure function: Calculates Mini Auction results.
 * Strictly filters to is_mini_round === true.
 * Returns null if no Mini Auction session exists.
 */
export function calculateMiniResults(
  miniSession: RawMiniSessionInput | null | undefined,
  lots: RawLotInput[],
  releases: RawPlayerReleaseInput[],
  teams: RawTeamInput[]
): MiniResults | null {
  if (!miniSession) {
    return null;
  }

  // Authoritative partition: Mini lots have is_mini_round = true
  const miniLots = lots.filter((l) => Boolean(l.is_mini_round));

  const soldLotsRaw = miniLots.filter((l) => l.status === 'SOLD');
  const unsoldLotsRaw = miniLots.filter((l) => l.status === 'UNSOLD');

  const soldLots = soldLotsRaw.map((l) => mapLotToSummaryItem(l, teams));
  const unsoldLots = unsoldLotsRaw.map((l) => mapLotToSummaryItem(l, teams));

  const totalSpendLakhs = soldLotsRaw.reduce((sum, l) => sum + (l.winning_bid || 0), 0);
  const totalSpendCr = totalSpendLakhs / 100;
  const soldCount = soldLots.length;
  const unsoldCount = unsoldLots.length;
  const averagePurchasePriceCr = soldCount > 0 ? totalSpendCr / soldCount : 0;

  const soldPrices = soldLotsRaw.map((l) => l.winning_bid || 0);
  const highestPurchaseCr = soldPrices.length > 0 ? Math.max(...soldPrices) / 100 : 0;
  const lowestPurchaseCr = soldPrices.length > 0 ? Math.min(...soldPrices) / 100 : 0;

  // Map Releases
  const summaryReleases: SummaryReleaseItem[] = releases.map((r) => {
    const player = r.player || ({} as any);
    const team = teams.find((t) => t.id === r.team_id);
    const refundLakhs = r.refund_amount || 0;
    return {
      id: r.id,
      auctionId: r.auction_id,
      teamId: r.team_id,
      teamName: team ? team.name : 'Unknown Team',
      playerId: r.player_id,
      playerName: player.name || 'Released Player',
      role: player.role || 'Batter',
      category: player.category || 'CAPPED',
      country: player.country || 'India',
      isOverseas: Boolean(player.is_overseas),
      refundAmountLakhs: refundLakhs,
      refundAmountCr: refundLakhs / 100,
      releasedAt: r.released_at,
      imageUrl: player.image_url || undefined,
    };
  });

  const totalRefundLakhs = summaryReleases.reduce((sum, r) => sum + r.refundAmountLakhs, 0);

  // Total lots for Mini session: use session.total_lots or miniLots.length if larger
  const totalLots = Math.max(miniSession.total_lots || 0, miniLots.length);

  return {
    hasMiniSession: true,
    sessionId: miniSession.id,
    status: miniSession.status,
    totalLots,
    soldCount,
    unsoldCount,
    totalSpendLakhs,
    totalSpendCr,
    averagePurchasePriceCr,
    highestPurchaseCr,
    lowestPurchaseCr,
    completedAt: miniSession.completed_at || null,
    soldLots,
    unsoldLots,
    totalReleases: summaryReleases.length,
    totalRefundLakhs,
    totalRefundCr: totalRefundLakhs / 100,
    releases: summaryReleases,
  };
}

/**
 * Pure function: Verifies team purse invariant.
 * expected_final_purse = initial_purse - mega_spend + release_refunds - mini_spend
 */
export function verifyPurseInvariant(
  initialPurseLakhs: number,
  megaSpendLakhs: number,
  releaseRefundsLakhs: number,
  miniSpendLakhs: number,
  actualPurseLakhs: number
): {
  expectedFinalPurseLakhs: number;
  purseDiscrepancyLakhs: number;
  isPurseConsistent: boolean;
} {
  const expectedFinalPurseLakhs = initialPurseLakhs - megaSpendLakhs + releaseRefundsLakhs - miniSpendLakhs;
  const purseDiscrepancyLakhs = actualPurseLakhs - expectedFinalPurseLakhs;
  return {
    expectedFinalPurseLakhs,
    purseDiscrepancyLakhs,
    isPurseConsistent: purseDiscrepancyLakhs === 0,
  };
}

/**
 * Pure function: Calculates per-team results with complete financial auditing
 * and strict separation between current active squad and historical acquisitions.
 */
export function calculateTeamResults(
  teams: RawTeamInput[],
  lots: RawLotInput[],
  squadPlayers: RawSquadPlayerInput[],
  releases: RawPlayerReleaseInput[],
  settings?: { maxSquadSize?: number; maxOverseas?: number }
): TeamResultModel[] {
  const maxSquadSize = settings?.maxSquadSize || 25;
  const maxOverseas = settings?.maxOverseas || 8;

  return teams.map((team) => {
    // 1. Historical Mega Acquisitions (status = 'SOLD', is_mini_round = false, winning_team_id = team.id)
    const megaSoldLots = lots.filter(
      (l) => l.winning_team_id === team.id && l.status === 'SOLD' && !l.is_mini_round
    );
    const megaSpendLakhs = megaSoldLots.reduce((sum, l) => sum + (l.winning_bid || 0), 0);

    const megaAcquisitions: SummaryPlayerItem[] = megaSoldLots.map((l) => {
      const p = l.player || ({} as any);
      const purchasePriceLakhs = l.winning_bid || 0;
      const basePriceLakhs = l.base_price || 0;
      return {
        id: p.id || l.id,
        lotId: l.id,
        name: p.name || 'Unknown Player',
        role: p.role || 'Batter',
        category: p.category || 'CAPPED',
        country: p.country || 'India',
        isOverseas: Boolean(p.is_overseas),
        basePriceLakhs,
        basePriceCr: basePriceLakhs / 100,
        purchasePriceLakhs,
        purchasePriceCr: purchasePriceLakhs / 100,
        boughtAt: new Date().toISOString(),
        isMiniRound: false,
        isUnsoldRound: false,
        imageUrl: p.image_url || undefined,
        teamId: team.id,
        teamName: team.name,
        teamColor: team.color || '#6B7280',
      };
    });

    // 2. Historical Releases by this team
    const teamReleases = releases.filter((r) => r.team_id === team.id);
    const releaseRefundsLakhs = teamReleases.reduce((sum, r) => sum + (r.refund_amount || 0), 0);

    const releasedPlayers: SummaryReleaseItem[] = teamReleases.map((r) => {
      const p = r.player || ({} as any);
      const refundLakhs = r.refund_amount || 0;
      return {
        id: r.id,
        auctionId: r.auction_id,
        teamId: team.id,
        teamName: team.name,
        playerId: r.player_id,
        playerName: p.name || 'Released Player',
        role: p.role || 'Batter',
        category: p.category || 'CAPPED',
        country: p.country || 'India',
        isOverseas: Boolean(p.is_overseas),
        refundAmountLakhs: refundLakhs,
        refundAmountCr: refundLakhs / 100,
        releasedAt: r.released_at,
        imageUrl: p.image_url || undefined,
      };
    });

    // 3. Historical Mini Acquisitions (status = 'SOLD', is_mini_round = true, winning_team_id = team.id)
    const miniSoldLots = lots.filter(
      (l) => l.winning_team_id === team.id && l.status === 'SOLD' && Boolean(l.is_mini_round)
    );
    const miniSpendLakhs = miniSoldLots.reduce((sum, l) => sum + (l.winning_bid || 0), 0);

    const miniAcquisitions: SummaryPlayerItem[] = miniSoldLots.map((l) => {
      const p = l.player || ({} as any);
      const purchasePriceLakhs = l.winning_bid || 0;
      const basePriceLakhs = l.base_price || 0;
      return {
        id: p.id || l.id,
        lotId: l.id,
        name: p.name || 'Unknown Player',
        role: p.role || 'Batter',
        category: p.category || 'CAPPED',
        country: p.country || 'India',
        isOverseas: Boolean(p.is_overseas),
        basePriceLakhs,
        basePriceCr: basePriceLakhs / 100,
        purchasePriceLakhs,
        purchasePriceCr: purchasePriceLakhs / 100,
        boughtAt: new Date().toISOString(),
        isMiniRound: true,
        isUnsoldRound: false,
        imageUrl: p.image_url || undefined,
        teamId: team.id,
        teamName: team.name,
        teamColor: team.color || '#6B7280',
      };
    });

    // 4. Current Active Squad from squad_players ONLY
    const teamSquadPlayers = squadPlayers.filter((s) => s.team_id === team.id);
    const activeSquad: SummaryPlayerItem[] = teamSquadPlayers.map((item) => {
      const player = item.player || ({} as any);
      const lot = item.lot || ({} as any);
      const purchasePriceLakhs = item.purchase_price || 0;
      const basePriceLakhs = player.base_price || 200;
      return {
        id: player.id || item.id,
        squadPlayerId: item.id,
        lotId: item.lot_id || undefined,
        name: player.name || 'Unknown Player',
        role: player.role || 'Batter',
        category: player.category || 'CAPPED',
        country: player.country || 'India',
        isOverseas: Boolean(player.is_overseas),
        basePriceLakhs,
        basePriceCr: basePriceLakhs / 100,
        purchasePriceLakhs,
        purchasePriceCr: purchasePriceLakhs / 100,
        boughtAt: item.bought_at || new Date().toISOString(),
        isMiniRound: Boolean(lot.is_mini_round),
        isUnsoldRound: false,
        imageUrl: player.image_url || undefined,
        teamId: team.id,
        teamName: team.name,
        teamColor: team.color || '#6B7280',
      };
    });

    // 5. Purse Invariant Verification
    const initialPurseLakhs = team.initial_purse || 12000;
    const actualPurseLakhs = team.purse;
    const { expectedFinalPurseLakhs, purseDiscrepancyLakhs, isPurseConsistent } = verifyPurseInvariant(
      initialPurseLakhs,
      megaSpendLakhs,
      releaseRefundsLakhs,
      miniSpendLakhs,
      actualPurseLakhs
    );

    const playersBought = activeSquad.length;
    const overseasCount = activeSquad.filter((p) => p.isOverseas).length;
    const totalSquadSpendLakhs = activeSquad.reduce((sum, p) => sum + p.purchasePriceLakhs, 0);
    const avgPurchasePriceCr = playersBought > 0 ? (totalSquadSpendLakhs / playersBought) / 100 : 0;

    const grossSpentLakhs = megaSpendLakhs + miniSpendLakhs;
    const netSpentLakhs = grossSpentLakhs - releaseRefundsLakhs;

    return {
      id: team.id,
      name: team.name,
      shortName: team.short_name,
      color: team.color || '#6B7280',
      isBot: Boolean(team.is_bot),
      initialPurseLakhs,
      initialPurseCr: initialPurseLakhs / 100,
      megaSpendLakhs,
      megaSpendCr: megaSpendLakhs / 100,
      releaseRefundsLakhs,
      releaseRefundsCr: releaseRefundsLakhs / 100,
      miniSpendLakhs,
      miniSpendCr: miniSpendLakhs / 100,
      grossSpentCr: grossSpentLakhs / 100,
      totalSpentCr: netSpentLakhs / 100,
      finalPurseLakhs: actualPurseLakhs,
      finalPurseCr: actualPurseLakhs / 100,
      remainingPurseCr: actualPurseLakhs / 100,
      expectedFinalPurseLakhs,
      expectedFinalPurseCr: expectedFinalPurseLakhs / 100,
      purseDiscrepancyLakhs,
      purseDiscrepancyCr: purseDiscrepancyLakhs / 100,
      isPurseConsistent,
      playersBought,
      overseasCount,
      avgPurchasePriceCr,
      remainingSquadSlots: Math.max(0, maxSquadSize - playersBought),
      remainingOverseasSlots: Math.max(0, maxOverseas - overseasCount),
      maxSquadSize,
      maxOverseas,
      squad: activeSquad,
      megaAcquisitions,
      miniAcquisitions,
      releasedPlayers,
    };
  });
}

/**
 * Pure function: Calculates Combined Overview distinguishing historical events from final state.
 */
export function calculateCombinedOverview(
  room: { code: string; name: string },
  auction: RawAuctionInput,
  megaResults: MegaResults,
  miniResults: MiniResults | null,
  activeSquadPlayers: RawSquadPlayerInput[]
): CombinedOverview {
  const miniLots = miniResults ? miniResults.totalLots : 0;
  const miniSold = miniResults ? miniResults.soldCount : 0;
  const miniUnsold = miniResults ? miniResults.unsoldCount : 0;
  const miniSpendLakhs = miniResults ? miniResults.totalSpendLakhs : 0;
  const miniRefundLakhs = miniResults ? miniResults.totalRefundLakhs : 0;

  const totalLots = megaResults.totalLots + miniLots;
  const soldCount = megaResults.soldCount + miniSold;
  const unsoldCount = megaResults.unsoldCount + miniUnsold;

  const totalSpendLakhs = megaResults.totalSpendLakhs + miniSpendLakhs;
  const netSpendLakhs = totalSpendLakhs - miniRefundLakhs;

  const totalSpendCr = totalSpendLakhs / 100;
  const netSpendCr = netSpendLakhs / 100;
  const totalRefundCr = miniRefundLakhs / 100;

  const averagePurchasePriceCr = soldCount > 0 ? totalSpendCr / soldCount : 0;
  const highestPurchaseCr = Math.max(megaResults.highestPurchaseCr, miniResults ? miniResults.highestPurchaseCr : 0);

  // Lowest sold price
  let lowestPurchaseCr = 0;
  if (megaResults.soldCount > 0 && miniSold > 0) {
    lowestPurchaseCr = Math.min(megaResults.lowestPurchaseCr, miniResults!.lowestPurchaseCr);
  } else if (megaResults.soldCount > 0) {
    lowestPurchaseCr = megaResults.lowestPurchaseCr;
  } else if (miniSold > 0) {
    lowestPurchaseCr = miniResults!.lowestPurchaseCr;
  }

  // Duration
  const createdMs = new Date(auction.created_at || Date.now()).getTime();
  const completedMs = auction.completed_at ? new Date(auction.completed_at).getTime() : Date.now();
  const durationMinutes = Math.max(1, Math.round((completedMs - createdMs) / (1000 * 60)));

  return {
    roomCode: room.code,
    roomName: room.name,
    auctionId: auction.id,
    status: auction.status,
    megaStatus: auction.status,
    miniStatus: miniResults ? miniResults.status : null,
    totalLots,
    soldCount,
    unsoldCount,
    megaSoldCount: megaResults.soldCount,
    miniSoldCount: miniSold,
    round1SoldCount: megaResults.soldCount,
    round2SoldCount: miniSold,
    totalSpendCr,
    netSpendCr,
    totalRefundCr,
    averagePurchasePriceCr,
    highestPurchaseCr,
    lowestPurchaseCr,
    activePlayersRostered: activeSquadPlayers.length,
    durationMinutes,
    createdAt: auction.created_at,
    completedAt: auction.completed_at || null,
    megaCompletedAt: megaResults.completedAt,
    miniCompletedAt: miniResults ? miniResults.completedAt : null,
  };
}

/**
 * Pure function: Calculates Top Buys across historical sold lots.
 */
export function calculateTopBuys(
  megaResults: MegaResults,
  miniResults: MiniResults | null,
  limit: number = 5
): SummaryPlayerItem[] {
  const allSoldLots: SummaryLotItem[] = [
    ...megaResults.soldLots,
    ...(miniResults ? miniResults.soldLots : []),
  ];

  return [...allSoldLots]
    .sort((a, b) => (b.winningBidCr || 0) - (a.winningBidCr || 0))
    .slice(0, limit)
    .map((lot) => ({
      id: lot.playerId || lot.id,
      lotId: lot.id,
      name: lot.playerName,
      role: lot.role,
      category: lot.category,
      country: lot.country,
      isOverseas: lot.isOverseas,
      basePriceCr: lot.basePriceCr,
      basePriceLakhs: lot.basePriceLakhs,
      purchasePriceCr: lot.winningBidCr || 0,
      purchasePriceLakhs: lot.winningBidLakhs || 0,
      boughtAt: new Date().toISOString(),
      isMiniRound: lot.isMiniRound,
      isUnsoldRound: false,
      imageUrl: lot.imageUrl,
      teamId: lot.winningTeamId || '',
      teamName: lot.winningTeamName || 'Unknown Team',
      teamColor: lot.winningTeamColor || '#6B7280',
    }));
}

/**
 * Pure function: Computes role, category, and domestic vs overseas breakdowns from active squad.
 */
export function calculateBreakdowns(activeSquad: SummaryPlayerItem[], totalSpendCr?: number) {
  // Use active squad roster spend as denominator so allocations sum to 100% of active squad
  const activeSquadSpendCr = activeSquad.reduce((sum, p) => sum + p.purchasePriceCr, 0);
  const denominator = activeSquadSpendCr > 0 ? activeSquadSpendCr : (typeof totalSpendCr === 'number' && totalSpendCr > 0 ? totalSpendCr : 0);

  // Category Breakdown
  const categoryMap: Record<string, { count: number; spend: number }> = {};
  activeSquad.forEach((p) => {
    const cat = p.category || 'UNCATEGORIZED';
    if (!categoryMap[cat]) categoryMap[cat] = { count: 0, spend: 0 };
    categoryMap[cat].count += 1;
    categoryMap[cat].spend += p.purchasePriceCr;
  });

  const categoryBreakdown: CategoryBreakdown[] = Object.entries(categoryMap).map(([category, val]) => ({
    category,
    count: val.count,
    totalSpentCr: val.spend,
    percentage: denominator > 0 ? Math.round((val.spend / denominator) * 100) : 0,
  }));

  // Role Breakdown
  const roleMap: Record<string, { count: number; spend: number }> = {};
  activeSquad.forEach((p) => {
    const role = p.role || 'ALL-ROUNDER';
    if (!roleMap[role]) roleMap[role] = { count: 0, spend: 0 };
    roleMap[role].count += 1;
    roleMap[role].spend += p.purchasePriceCr;
  });

  const roleBreakdown: RoleBreakdown[] = Object.entries(roleMap).map(([role, val]) => ({
    role,
    count: val.count,
    totalSpentCr: val.spend,
    percentage: denominator > 0 ? Math.round((val.spend / denominator) * 100) : 0,
  }));

  // Domestic vs Overseas Breakdown
  const domesticItems = activeSquad.filter((p) => !p.isOverseas);
  const overseasItems = activeSquad.filter((p) => p.isOverseas);
  const domesticVsOverseas: DomesticVsOverseasBreakdown = {
    domesticCount: domesticItems.length,
    domesticSpendCr: domesticItems.reduce((sum, p) => sum + p.purchasePriceCr, 0),
    overseasCount: overseasItems.length,
    overseasSpendCr: overseasItems.reduce((sum, p) => sum + p.purchasePriceCr, 0),
  };

  return {
    categoryBreakdown,
    roleBreakdown,
    domesticVsOverseas,
  };
}
