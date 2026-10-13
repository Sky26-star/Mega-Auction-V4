// src/lib/history/loader.ts
// Authoritative Data Loader for Player History (17D) and Auction History (17E).
// Reads authoritative database tables and delegates analytical compilation to history-calculator.ts.

import { createClient } from '../supabase/client';
import { getCurrentProfile } from '../auth';
import {
  calculatePlayerAuctionHistory,
  calculateAuctionHistoryRecord,
  type PlayerAuctionHistoryRecord,
  type HistoricalAuctionRecord,
} from './history-calculator';
import type {
  RawLotInput,
  RawTeamInput,
  RawSquadPlayerInput,
  RawPlayerReleaseInput,
  RawMiniSessionInput,
  RawAuctionInput,
} from '../summary/results-calculator';

export type { PlayerAuctionHistoryRecord, HistoricalAuctionRecord };

/**
 * Phase 17D: Loads complete authoritative lifecycle history for a single player in a given room/auction.
 */
export async function loadPlayerAuctionHistory(
  roomId: string,
  playerId: string
): Promise<{ data: PlayerAuctionHistoryRecord | null; error: string | null }> {
  const supabase = createClient();
  const profile = await getCurrentProfile().catch(() => null);

  if (!profile) {
    return { data: null, error: 'AUTH_REQUIRED: You must be logged in to view player history.' };
  }

  // 1. Fetch Room & Participant Check
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, code, name, host_id')
    .eq('id', roomId)
    .maybeSingle();

  if (roomError || !room) {
    return { data: null, error: 'ROOM_NOT_FOUND: Room does not exist or has been deleted.' };
  }

  const { data: participant } = await supabase
    .from('room_participants')
    .select('id')
    .eq('room_id', roomId)
    .eq('user_id', profile.id)
    .maybeSingle();

  const isHost = room.host_id === profile.id;
  if (!participant && !isHost) {
    return { data: null, error: 'UNAUTHORIZED: You must be a room participant or host to view history.' };
  }

  // 2. Fetch Auction
  const { data: auction, error: aucError } = await supabase
    .from('auctions')
    .select('id, room_id, status')
    .eq('room_id', roomId)
    .maybeSingle();

  if (aucError || !auction) {
    return { data: null, error: 'AUCTION_NOT_FOUND: Auction has not been initialized for this room.' };
  }

  // 3. Parallel Fetch for Player Bio, Lots, Squad, Releases, Teams
  const [playerRes, lotsRes, squadRes, releasesRes, teamsRes] = await Promise.all([
    supabase
      .from('players')
      .select('id, name, role, category, country, base_price, is_overseas, image_url')
      .eq('id', playerId)
      .maybeSingle(),

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
        created_at,
        player:players (id, name, role, category, country, is_overseas, image_url)
      `)
      .eq('auction_id', auction.id)
      .eq('player_id', playerId)
      .order('lot_index', { ascending: true }),

    supabase
      .from('squad_players')
      .select(`
        id,
        team_id,
        player_id,
        lot_id,
        purchase_price,
        bought_at,
        player:players (id, name, role, category, country, is_overseas, image_url),
        lot:auction_lots (id, is_mini_round)
      `)
      .eq('auction_id', auction.id)
      .eq('player_id', playerId)
      .maybeSingle(),

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
      .eq('player_id', playerId)
      .order('released_at', { ascending: true }),

    supabase
      .from('teams')
      .select('id, name, short_name, color, purse, initial_purse, players_bought, overseas_count, is_bot')
      .eq('auction_id', auction.id),
  ]);

  if (playerRes.error || !playerRes.data) {
    return { data: null, error: 'PLAYER_NOT_FOUND: Player record does not exist.' };
  }
  if (lotsRes.error) {
    return { data: null, error: `LOTS_FETCH_ERROR: ${lotsRes.error.message}` };
  }
  if (squadRes.error && squadRes.error.code !== 'PGRST116') {
    return { data: null, error: `SQUAD_FETCH_ERROR: ${squadRes.error.message}` };
  }
  if (releasesRes.error) {
    return { data: null, error: `RELEASES_FETCH_ERROR: ${releasesRes.error.message}` };
  }
  if (teamsRes.error) {
    return { data: null, error: `TEAMS_FETCH_ERROR: ${teamsRes.error.message}` };
  }

  const rawPlayer = playerRes.data;
  const rawLots: RawLotInput[] = (lotsRes.data || []) as any;
  const rawSquad: RawSquadPlayerInput[] = squadRes.data ? [(squadRes.data as any)] : [];
  const rawReleases: RawPlayerReleaseInput[] = (releasesRes.data || []) as any;
  const rawTeams: RawTeamInput[] = teamsRes.data || [];

  const history = calculatePlayerAuctionHistory(
    rawPlayer,
    rawLots,
    rawSquad,
    rawReleases,
    rawTeams
  );

  return { data: history, error: null };
}

/**
 * Phase 17E: Loads authoritative historical record for a completed auction.
 */
export async function loadAuctionHistoryRecord(
  roomId: string
): Promise<{ data: HistoricalAuctionRecord | null; error: string | null }> {
  const supabase = createClient();
  const profile = await getCurrentProfile().catch(() => null);

  if (!profile) {
    return { data: null, error: 'AUTH_REQUIRED: You must be logged in to view auction history.' };
  }

  // 1. Fetch Room Data
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, code, name, host_id, settings')
    .eq('id', roomId)
    .maybeSingle();

  if (roomError || !room) {
    return { data: null, error: 'ROOM_NOT_FOUND: Room does not exist or has been deleted.' };
  }

  // 2. Participant Check
  const { data: participant } = await supabase
    .from('room_participants')
    .select('id')
    .eq('room_id', roomId)
    .eq('user_id', profile.id)
    .maybeSingle();

  const isHost = room.host_id === profile.id;
  if (!participant && !isHost) {
    return { data: null, error: 'UNAUTHORIZED: You must be a room participant or host to view history.' };
  }

  // 3. Fetch Auction Record
  const { data: auction, error: aucError } = await supabase
    .from('auctions')
    .select('id, room_id, status, total_lots, created_at, started_at, completed_at, mega_completed_at, is_unsold_round')
    .eq('room_id', roomId)
    .maybeSingle();

  if (aucError || !auction) {
    return { data: null, error: 'AUCTION_NOT_FOUND: Auction has not been initialized for this room.' };
  }

  // 4. Parallel Independent Reads
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
      .eq('auction_id', auction.id),

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
        created_at,
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
      .maybeSingle(),
  ]);

  if (teamsRes.error) return { data: null, error: `TEAMS_FETCH_ERROR: ${teamsRes.error.message}` };
  if (squadRes.error) return { data: null, error: `SQUAD_FETCH_ERROR: ${squadRes.error.message}` };
  if (lotsRes.error) return { data: null, error: `LOTS_FETCH_ERROR: ${lotsRes.error.message}` };
  if (releasesRes.error) return { data: null, error: `RELEASES_FETCH_ERROR: ${releasesRes.error.message}` };
  if (miniSessionRes.error && miniSessionRes.error.code !== 'PGRST116') {
    return { data: null, error: `MINI_SESSION_FETCH_ERROR: ${miniSessionRes.error.message}` };
  }

  const rawTeams: RawTeamInput[] = teamsRes.data || [];
  const rawSquad: RawSquadPlayerInput[] = (squadRes.data || []) as any;
  const rawLots: RawLotInput[] = (lotsRes.data || []) as any;
  const rawReleases: RawPlayerReleaseInput[] = (releasesRes.data || []) as any;
  const rawMiniSession: RawMiniSessionInput | null = miniSessionRes.data || null;

  const record = calculateAuctionHistoryRecord(
    room,
    auction as RawAuctionInput,
    rawLots,
    rawTeams,
    rawSquad,
    rawReleases,
    rawMiniSession
  );

  return { data: record, error: null };
}

/**
 * Phase 17E: Loads list of completed historical auctions for the current user.
 */
export async function loadUserCompletedAuctionsList(): Promise<{
  data: {
    auctionId: string;
    roomId: string;
    roomCode: string;
    roomName: string;
    status: string;
    completedAt: string | null;
    megaCompletedAt: string | null;
    totalLots: number;
    soldLots: number;
    grossSpendCr: number;
    netCapitalSpendCr: number;
    isHost: boolean;
  }[] | null;
  error: string | null;
}> {
  const supabase = createClient();
  const profile = await getCurrentProfile().catch(() => null);

  if (!profile) {
    return { data: null, error: 'AUTH_REQUIRED: You must be logged in to view auction history.' };
  }

  // Fetch rooms user participated in
  const { data: participantData } = await supabase
    .from('room_participants')
    .select('room_id')
    .eq('user_id', profile.id);

  const roomIds = (participantData || []).map((p: { room_id: string }) => p.room_id);

  let query = supabase
    .from('rooms')
    .select(`
      id,
      code,
      name,
      status,
      host_id,
      created_at,
      auctions (id, status, completed_at, mega_completed_at, total_lots)
    `)
    .order('created_at', { ascending: false });

  if (roomIds.length > 0) {
    query = query.or(`host_id.eq.${profile.id},id.in.(${roomIds.join(',')})`);
  } else {
    query = query.eq('host_id', profile.id);
  }

  const { data: rooms, error } = await query;
  if (error) {
    return { data: null, error: `ROOMS_FETCH_ERROR: ${error.message}` };
  }

  // Filter completed rooms/auctions
  const completedRooms = (rooms || []).filter((r: any) => {
    const auc = Array.isArray(r.auctions) ? r.auctions[0] : r.auctions;
    return r.status === 'COMPLETED' || auc?.status === 'COMPLETED';
  });

  const auctionIds = completedRooms
    .map((r: any) => (Array.isArray(r.auctions) ? r.auctions[0]?.id : r.auctions?.id))
    .filter(Boolean);

  // Fetch lots and releases for these auctions to compute gross vs net accurately
  let lotsData: any[] = [];
  let releasesData: any[] = [];

  if (auctionIds.length > 0) {
    const [lotsRes, relRes] = await Promise.all([
      supabase
        .from('auction_lots')
        .select('auction_id, status, winning_bid')
        .in('auction_id', auctionIds)
        .eq('status', 'SOLD'),
      supabase
        .from('player_releases')
        .select('auction_id, refund_amount')
        .in('auction_id', auctionIds),
    ]);

    lotsData = lotsRes.data || [];
    releasesData = relRes.data || [];
  }

  const result = completedRooms.map((room: any) => {
    const auc = Array.isArray(room.auctions) ? room.auctions[0] : room.auctions;
    const auctionId = auc?.id || '';

    const soldLots = lotsData.filter((l) => l.auction_id === auctionId);
    const releases = releasesData.filter((r) => r.auction_id === auctionId);

    const grossSpendLakhs = soldLots.reduce((sum, l) => sum + (l.winning_bid || 0), 0);
    const refundsLakhs = releases.reduce((sum, r) => sum + (r.refund_amount || 0), 0);
    const netSpendLakhs = grossSpendLakhs - refundsLakhs;

    return {
      auctionId,
      roomId: room.id,
      roomCode: room.code,
      roomName: room.name,
      status: auc?.status || room.status,
      completedAt: auc?.completed_at || null,
      megaCompletedAt: auc?.mega_completed_at || null,
      totalLots: auc?.total_lots || soldLots.length,
      soldLots: soldLots.length,
      grossSpendCr: grossSpendLakhs / 100,
      netCapitalSpendCr: netSpendLakhs / 100,
      isHost: room.host_id === profile.id,
    };
  });

  return { data: result, error: null };
}
