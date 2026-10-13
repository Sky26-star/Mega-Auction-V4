// src/lib/summary/loader.ts
// Authoritative Data Loader for Post-Auction Summary & Roster Analysis (/rooms/[id]/summary)
// Source-of-truth preserving read & analysis layer over auctions, auction_lots, squad_players, player_releases, and teams.

import { createClient } from '../supabase/client';
import { getCurrentProfile } from '../auth';
import {
  calculateMegaResults,
  calculateMiniResults,
  calculateTeamResults,
  calculateCombinedOverview,
  calculateTopBuys,
  calculateBreakdowns,
  mapLotToSummaryItem,
  type RawLotInput,
  type RawTeamInput,
  type RawSquadPlayerInput,
  type RawPlayerReleaseInput,
  type RawMiniSessionInput,
  type RawAuctionInput,
  type MegaResults,
  type MiniResults,
  type TeamResultModel,
  type CombinedOverview,
  type SummaryPlayerItem,
  type SummaryLotItem,
  type SummaryReleaseItem,
  type CategoryBreakdown,
  type RoleBreakdown,
  type DomesticVsOverseasBreakdown,
} from './results-calculator';

// Re-export analytical types for consumers
export type {
  MegaResults,
  MiniResults,
  TeamResultModel,
  CombinedOverview,
  SummaryPlayerItem,
  SummaryLotItem,
  SummaryReleaseItem,
  CategoryBreakdown,
  RoleBreakdown,
  DomesticVsOverseasBreakdown,
};

// Aliases for backward compatibility with existing summary UI components
export type SummaryTeamData = TeamResultModel;
export type SummaryOverview = CombinedOverview;

export interface AuctionSummaryData {
  overview: CombinedOverview;
  teams: TeamResultModel[];
  topBuys: SummaryPlayerItem[];
  unsoldLots: {
    id: string;
    playerId?: string;
    lotIndex: number;
    playerName: string;
    role: string;
    category: string;
    country: string;
    isOverseas: boolean;
    basePriceCr: number;
    isUnsoldRound: boolean;
    isMiniRound: boolean;
    imageUrl?: string;
  }[];
  categoryBreakdown: CategoryBreakdown[];
  roleBreakdown: RoleBreakdown[];
  domesticVsOverseas: DomesticVsOverseasBreakdown;
  isAuthorized: boolean;
  currentUserId?: string;
  hostId?: string;

  // Dedicated phase results
  megaResults: MegaResults;
  miniResults: MiniResults | null;
  combinedOverview: CombinedOverview;
  teamResults: TeamResultModel[];

  // Authoritative Mini Auction orchestration
  miniSession: RawMiniSessionInput | null;
  auctionId: string;
  isHost: boolean;
  auctionStatus: string;
}

export async function loadAuctionSummaryData(
  roomId: string
): Promise<{ data: AuctionSummaryData | null; error: string | null }> {
  const supabase = createClient();
  const profile = await getCurrentProfile().catch(() => null);

  if (!profile) {
    return { data: null, error: 'AUTH_REQUIRED: You must be logged in to view auction summaries.' };
  }

  // 1. Fetch Room Data
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, code, name, host_id, settings')
    .eq('id', roomId)
    .maybeSingle();

  if (roomError) {
    return { data: null, error: `ROOM_FETCH_FAILED: ${roomError.message}` };
  }
  if (!room) {
    return { data: null, error: 'ROOM_NOT_FOUND: Room does not exist or has been deleted.' };
  }

  // 2. Security Check: Participant Authorization
  const { data: participant, error: partError } = await supabase
    .from('room_participants')
    .select('id')
    .eq('room_id', roomId)
    .eq('user_id', profile.id)
    .maybeSingle();

  if (partError) {
    return { data: null, error: `AUTH_CHECK_FAILED: ${partError.message}` };
  }

  const isHost = room.host_id === profile.id;
  if (!participant && !isHost) {
    return { data: null, error: 'UNAUTHORIZED: You must be a room participant or host to view this auction summary.' };
  }

  // 3. Fetch Auction Record
  const { data: auction, error: aucError } = await supabase
    .from('auctions')
    .select('id, room_id, status, total_lots, created_at, started_at, completed_at, mega_completed_at, is_unsold_round')
    .eq('room_id', roomId)
    .maybeSingle();

  if (aucError) {
    return { data: null, error: `AUCTION_FETCH_FAILED: ${aucError.message}` };
  }
  if (!auction) {
    return { data: null, error: 'AUCTION_NOT_FOUND: Auction has not been initialized for this room.' };
  }

  // 4. Parallel Independent Authoritative Reads (No N+1, no duplicate queries)
  const [teamsRes, squadRes, lotsRes, releasesRes, miniSessionRes] = await Promise.all([
    supabase
      .from('teams')
      .select('id, name, short_name, color, purse, initial_purse, players_bought, overseas_count, is_bot')
      .eq('auction_id', auction.id)
      .order('name', { ascending: true }),

    supabase
      .from('squad_players')
      .select(`
        id,
        team_id,
        player_id,
        lot_id,
        purchase_price,
        bought_at,
        player:players (id, name, role, category, country, is_overseas, base_price, image_url),
        lot:auction_lots (id, is_mini_round)
      `)
      .eq('auction_id', auction.id)
      .order('purchase_price', { ascending: false }),

    supabase
      .from('auction_lots')
      .select(`
        id,
        lot_index,
        status,
        base_price,
        winning_bid,
        winning_team_id,
        is_mini_round,
        player:players (id, name, role, category, country, is_overseas, image_url)
      `)
      .eq('auction_id', auction.id)
      .order('lot_index', { ascending: true }),

    supabase
      .from('player_releases')
      .select(`
        id,
        auction_id,
        team_id,
        player_id,
        refund_amount,
        released_at,
        player:players (id, name, role, category, country, is_overseas, image_url)
      `)
      .eq('auction_id', auction.id)
      .order('released_at', { ascending: true }),

    supabase
      .from('mini_auction_sessions')
      .select('id, auction_id, status, selection_expires_at, total_lots, closed_at, completed_at, created_at, updated_at')
      .eq('auction_id', auction.id)
      .maybeSingle()
  ]);

  // Strict Error Guard (Test K: Never silently convert database errors into fake empty results)
  if (teamsRes.error) {
    return { data: null, error: `TEAMS_FETCH_ERROR: ${teamsRes.error.message}` };
  }
  if (squadRes.error) {
    return { data: null, error: `SQUAD_FETCH_ERROR: ${squadRes.error.message}` };
  }
  if (lotsRes.error) {
    return { data: null, error: `LOTS_FETCH_ERROR: ${lotsRes.error.message}` };
  }
  if (releasesRes.error) {
    return { data: null, error: `RELEASES_FETCH_ERROR: ${releasesRes.error.message}` };
  }
  if (miniSessionRes.error && miniSessionRes.error.code !== 'PGRST116') {
    return { data: null, error: `MINI_SESSION_FETCH_ERROR: ${miniSessionRes.error.message}` };
  }

  const rawTeams: RawTeamInput[] = teamsRes.data || [];
  const rawSquad: RawSquadPlayerInput[] = (squadRes.data || []) as any;
  const rawLots: RawLotInput[] = (lotsRes.data || []) as any;
  const rawReleases: RawPlayerReleaseInput[] = (releasesRes.data || []) as any;
  const rawMiniSession: RawMiniSessionInput | null = miniSessionRes.data || null;

  const maxSquadSize = room.settings?.max_squad_size || 25;
  const maxOverseas = room.settings?.max_overseas || 8;

  // 5. Compute Phase-Isolated Results via Pure Analytical Engine
  const megaResults = calculateMegaResults(rawLots, auction as RawAuctionInput, rawTeams);
  const miniResults = calculateMiniResults(rawMiniSession, rawLots, rawReleases, rawTeams);
  const teamResults = calculateTeamResults(rawTeams, rawLots, rawSquad, rawReleases, {
    maxSquadSize,
    maxOverseas,
  });

  const combinedOverview = calculateCombinedOverview(
    room,
    auction as RawAuctionInput,
    megaResults,
    miniResults,
    rawSquad
  );

  const topBuys = calculateTopBuys(megaResults, miniResults, 5);

  // Unsold lots catalog (Mega + Mini, preserving lot identity and phase tag)
  const allUnsoldLots = rawLots
    .filter((l) => l.status === 'UNSOLD')
    .map((l) => {
      const summaryItem = mapLotToSummaryItem(l, rawTeams);
      return {
        id: summaryItem.id,
        playerId: summaryItem.playerId,
        lotIndex: summaryItem.lotIndex,
        playerName: summaryItem.playerName,
        role: summaryItem.role,
        category: summaryItem.category,
        country: summaryItem.country,
        isOverseas: summaryItem.isOverseas,
        basePriceCr: summaryItem.basePriceCr,
        isUnsoldRound: false,
        isMiniRound: summaryItem.isMiniRound,
        imageUrl: summaryItem.imageUrl,
      };
    });

  // Active squad roster items for breakdowns
  const allActiveSquadItems: SummaryPlayerItem[] = teamResults.flatMap((t) => t.squad);

  // Breakdown Analytics
  const { categoryBreakdown, roleBreakdown, domesticVsOverseas } = calculateBreakdowns(
    allActiveSquadItems,
    combinedOverview.totalSpendCr
  );

  return {
    data: {
      overview: combinedOverview,
      teams: teamResults,
      topBuys,
      unsoldLots: allUnsoldLots,
      categoryBreakdown,
      roleBreakdown,
      domesticVsOverseas,
      isAuthorized: true,
      currentUserId: profile.id,
      hostId: room.host_id,
      megaResults,
      miniResults,
      combinedOverview,
      teamResults,
      miniSession: rawMiniSession,
      auctionId: auction.id,
      isHost,
      auctionStatus: auction.status,
    },
    error: null,
  };
}
