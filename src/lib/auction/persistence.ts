// src/lib/auction/persistence.ts
// Supabase Database Authoritative Persistence Bridge for Mega Auction V2

import { createClient } from '../supabase/client';
import { AuctionState, QueuedPlayer, QueuedPlayerStatus, NormalizedCategory } from './state';

export function parseDbTimestampMs(isoOrDbString?: string | null): number {
  if (!isoOrDbString) return 0;
  const cleanStr = isoOrDbString.trim().replace(' ', 'T');
  const ms = new Date(cleanStr).getTime();
  return isNaN(ms) ? 0 : ms;
}

export function logAuctionDebug(source: string, roomId: string, state: AuctionState | null) {
  console.log('[AUCTION SYNC DEBUG]', {
    timestamp: new Date().toISOString(),
    source,
    roomId,
    auctionId: state?.auctionId || null,
    currentLotId: state?.lotId || null,
    currentLotIndex: state?.currentPlayerIndex ?? -1,
    currentPlayerName: state?.currentPlayer?.name || null,
    category: state?.currentPlayer?.category || null,
    currentBid: state?.currentBid ?? 0,
    timerExpiresAt: state?.timerExpiresAt || null,
    highestBidderId: state?.highestBidderId || null,
    bidCount: state?.bidCount ?? 0,
  });
}

function parseAuctionStateFromRaw(data: Record<string, unknown>): AuctionState {
  let rawStatus = (data.auctionStatus as string) || (data.status as string) || 'NOT_STARTED';
  let statusText: AuctionState['auctionStatus'] = 'NOT_STARTED';
  if (rawStatus === 'IN_PROGRESS' || rawStatus === 'LIVE') statusText = 'LIVE';
  else if (rawStatus === 'PAUSED') statusText = 'PAUSED';
  else if (rawStatus === 'COMPLETED') statusText = 'COMPLETED';

  let rawPlayer = data.currentPlayer as Record<string, unknown> | null;
  if (!rawPlayer && data.player_stats && data.playerId) {
    const stats = data.player_stats as Record<string, unknown>;
    rawPlayer = {
      id: data.playerId,
      name: stats.name,
      category: stats.category,
      basePrice: stats.base_price,
      role: stats.role,
      country: stats.country,
      battingHand: stats.batting_hand,
      age: stats.age,
      status: data.lotStatus === 'BIDDING' || data.lotStatus === 'ACTIVE' ? 'LIVE' : data.lotStatus
    };
  }

  const rawStats = rawPlayer?.stats as Record<string, unknown> | undefined;
  const currentPlayer: QueuedPlayer | null = rawPlayer
    ? {
        playerId: (rawPlayer.playerId as string) || (rawPlayer.id as string) || '',
        name: (rawPlayer.name as string) || '',
        category: (rawPlayer.category as NormalizedCategory) || 'CORE',
        basePrice: typeof rawPlayer.basePrice === 'number' ? rawPlayer.basePrice : (rawPlayer.base_price as number) ?? 50,
        auctionOrder: (rawPlayer.auctionOrder as number) ?? 1,
        status: (rawPlayer.status as QueuedPlayerStatus) || 'LIVE',
        role: rawPlayer.role as string | undefined,
        country: rawPlayer.country as string | undefined,
        image_url: rawPlayer.image_url as string | null | undefined,
        age: typeof rawPlayer.age === 'number' ? rawPlayer.age : undefined,
        battingHand: rawPlayer.battingHand as string | undefined,
        stats: rawStats ? {
          matches: typeof rawStats.matches === 'number' ? rawStats.matches : undefined,
          runs: typeof rawStats.runs === 'number' ? rawStats.runs : undefined,
          average: typeof rawStats.average === 'number' ? rawStats.average : undefined,
          strikeRate: typeof rawStats.strikeRate === 'number' ? rawStats.strikeRate : undefined,
          hundreds: typeof rawStats.hundreds === 'number' ? rawStats.hundreds : undefined,
          fifties: typeof rawStats.fifties === 'number' ? rawStats.fifties : undefined,
          highest: rawStats.highest !== undefined ? (rawStats.highest as string | number) : undefined,
          wickets: typeof rawStats.wickets === 'number' ? rawStats.wickets : undefined,
          economy: typeof rawStats.economy === 'number' ? rawStats.economy : undefined,
          bestBowling: typeof rawStats.bestBowling === 'string' ? rawStats.bestBowling : undefined,
        } : undefined,
      }
    : null;

  const rawQueue = (data.playerQueue as Array<Record<string, unknown>>) || [];
  const playerQueue: QueuedPlayer[] = rawQueue.map((item, idx) => {
    const rawItemStats = item.stats as Record<string, unknown> | undefined;
    return {
      playerId: (item.playerId as string) || (item.id as string) || `player-${idx}`,
      name: (item.name as string) || '',
      category: (item.category as NormalizedCategory) || 'CORE',
      basePrice: typeof item.basePrice === 'number' ? item.basePrice : (item.base_price as number) ?? 50,
      auctionOrder: (item.auctionOrder as number) ?? idx + 1,
      status: (item.status as QueuedPlayerStatus) || 'UPCOMING',
      role: item.role as string | undefined,
      country: item.country as string | undefined,
      image_url: item.image_url as string | null | undefined,
      age: typeof item.age === 'number' ? item.age : undefined,
      battingHand: (item.battingHand as string) || (item.batting_hand as string) || undefined,
      stats: rawItemStats ? {
        matches: typeof rawItemStats.matches === 'number' ? rawItemStats.matches : undefined,
        runs: typeof rawItemStats.runs === 'number' ? rawItemStats.runs : undefined,
        average: typeof rawItemStats.average === 'number' ? rawItemStats.average : undefined,
        strikeRate: typeof rawItemStats.strikeRate === 'number' ? rawItemStats.strikeRate : undefined,
        hundreds: typeof rawItemStats.hundreds === 'number' ? rawItemStats.hundreds : undefined,
        fifties: typeof rawItemStats.fifties === 'number' ? rawItemStats.fifties : undefined,
        highest: rawItemStats.highest !== undefined ? (rawItemStats.highest as string | number) : undefined,
        wickets: typeof rawItemStats.wickets === 'number' ? rawItemStats.wickets : undefined,
        economy: typeof rawItemStats.economy === 'number' ? rawItemStats.economy : undefined,
        bestBowling: typeof rawItemStats.bestBowling === 'string' ? rawItemStats.bestBowling : undefined,
      } : undefined,
    };
  });

  const rawBid = data.currentBid;
  const currentBid = typeof rawBid === 'number' && rawBid > 0 ? rawBid : (currentPlayer?.basePrice ?? 200);

  const parsedIndex = (data.currentPlayerIndex as number) ?? (data.lotIndex as number) ?? (currentPlayer ? 0 : -1);
  const activeIndex = parsedIndex >= 0 ? parsedIndex : 0;

  // Align currentPlayer strictly to playerQueue[activeIndex] if queue exists, preserving stats, age, and battingHand
  let finalPlayer = currentPlayer;
  if (playerQueue.length > 0 && activeIndex < playerQueue.length) {
    const queuePlayer = playerQueue[activeIndex];
    if (queuePlayer) {
      if (!finalPlayer || finalPlayer.name !== queuePlayer.name) {
        finalPlayer = queuePlayer;
      } else {
        // Merge queuePlayer attributes if current is missing them
        finalPlayer = {
          ...finalPlayer,
          age: finalPlayer.age ?? queuePlayer.age,
          battingHand: finalPlayer.battingHand ?? queuePlayer.battingHand,
          country: finalPlayer.country ?? queuePlayer.country,
          role: finalPlayer.role ?? queuePlayer.role,
          stats: finalPlayer.stats ?? queuePlayer.stats,
        };
      }
    }
  }

  return {
    auctionId: (data.auctionId as string) || (data.auction_id as string) || null,
    lotId: (data.lotId as string) || (data.lot_id as string) || null,
    timerExpiresAt: (data.timerExpiresAt as string) || null,
    timerDurationSeconds: (data.timerDurationSeconds as number) ?? 15,
    isGetReady: Boolean(data.isGetReady),
    getReadyExpiresAt: (data.getReadyExpiresAt as string) || null,
    auctionStatus: statusText,
    lotStatus: String(data.lotStatus || data.lot_status || 'PENDING'),
    currentPlayerIndex: activeIndex,
    currentCategory: (data.currentCategory as AuctionState['currentCategory']) || finalPlayer?.category || null,
    currentBid,
    highestBidderId: (data.highestBidderId as string) || null,
    bidCount: (data.bidCount as number) ?? 0,
    currentPlayer: finalPlayer,
    currentPlayerId: finalPlayer?.playerId || (data.currentPlayerId as string) || null,
    playerQueue,
  };
}

/**
 * Fetches the authoritative AuctionState directly from Supabase Database.
 * This is the primary server/database source of truth for all clients.
 * Enforces canonical database resolution via get_authoritative_auction_state RPC.
 */
export async function fetchAuthoritativeAuctionState(roomId: string): Promise<AuctionState | null> {
  if (!roomId) return null;
  const supabase = createClient();

  // 1. Try RPC FIRST for authoritative state resolution
  const { data: rpcData, error: rpcErr } = await supabase.rpc('get_authoritative_auction_state', { p_room_id: roomId });
  if (rpcData && !rpcData.error && rpcData.success !== false && (rpcData.auctionStatus || rpcData.status)) {
    const parsed = parseAuctionStateFromRaw(rpcData as Record<string, unknown>);
    if (parsed.auctionStatus !== 'NOT_STARTED') {
      return parsed;
    }
  }

  // 2. Direct table queries fallback if RPC returned incomplete data
  let { data: auctions, error: aErr } = await supabase
    .from('auctions')
    .select('id, room_id, status, current_lot_id, current_lot_index, total_lots, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false });

  if (aErr || !auctions || auctions.length === 0) {
    if (rpcData && !rpcData.error && rpcData.success !== false) {
      return parseAuctionStateFromRaw(rpcData as Record<string, unknown>);
    }
    return null;
  }

  const statusWeight = (status: string) => {
    if (status === 'IN_PROGRESS') return 1;
    if (status === 'PAUSED') return 2;
    if (status === 'MINI_AUCTION') return 3;
    if (status === 'COMPLETED') return 4;
    return 5;
  };

  auctions.sort((a, b) => {
    const weightA = statusWeight(a.status);
    const weightB = statusWeight(b.status);
    if (weightA !== weightB) return weightA - weightB;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const auction = auctions[0];

  if (!auction || auction.status === 'LOBBY') {
    if (rpcData && !rpcData.error && rpcData.success !== false) {
      return parseAuctionStateFromRaw(rpcData as Record<string, unknown>);
    }
    return null;
  }

  // 2. Fetch active lot & player strictly via current_lot_id or current_lot_index
  let activeLot: any = null;
  if (auction.current_lot_id) {
    const { data: lotById } = await supabase
      .from('auction_lots')
      .select('id, lot_index, player_id, base_price, current_bid, highest_bidder_team_id, timer_expires_at, timer_duration_seconds, status, players(id, name, category, role, country, image_url)')
      .eq('id', auction.current_lot_id)
      .maybeSingle();

    if (lotById && lotById.lot_index === auction.current_lot_index) {
      activeLot = lotById;
    }
  }

  if (!activeLot) {
    const { data: lotByIndex } = await supabase
      .from('auction_lots')
      .select('id, lot_index, player_id, base_price, current_bid, highest_bidder_team_id, timer_expires_at, timer_duration_seconds, status, players(id, name, category, role, country, image_url)')
      .eq('auction_id', auction.id)
      .eq('lot_index', auction.current_lot_index)
      .maybeSingle();

    if (lotByIndex) {
      activeLot = lotByIndex;
      // Self-heal DB: Ensure auctions.current_lot_id points strictly to lotByIndex.id
      if (auction.current_lot_id !== lotByIndex.id) {
        console.warn(`[AUCTION SYNC] Self-healing DB current_lot_id mismatch: lotByIndex.id=${lotByIndex.id}, auction.current_lot_id=${auction.current_lot_id}`);
        await supabase.from('auctions').update({ current_lot_id: lotByIndex.id }).eq('id', auction.id);
      }
    }
  }

  if (!activeLot || !activeLot.players) {
    // Fallback to RPC parsing if lot tables are unpopulated
    const { data: rpcData } = await supabase.rpc('get_authoritative_auction_state', { p_room_id: roomId });
    if (rpcData && !rpcData.error) {
      return parseAuctionStateFromRaw(rpcData as Record<string, unknown>);
    }
    return null;
  }

  // 3. Count valid bids on active lot
  const { count: bidCount } = await supabase
    .from('bids')
    .select('id', { count: 'exact', head: true })
    .eq('lot_id', activeLot.id)
    .eq('is_valid', true);

  // 4. Fetch player queue ordered strictly by lot_index ASC
  const { data: rawQueue } = await supabase
    .from('auction_lots')
    .select('lot_index, base_price, status, players(id, name, category, role, country, image_url)')
    .eq('auction_id', auction.id)
    .order('lot_index', { ascending: true });

  const playerQueue: QueuedPlayer[] = (rawQueue || []).map((item: any, idx: number) => ({
    playerId: item.players?.id || `p-${idx}`,
    name: item.players?.name || '',
    category: (item.players?.category as NormalizedCategory) || 'CORE',
    basePrice: item.base_price ?? 50,
    auctionOrder: item.lot_index + 1,
    status: item.status === 'BIDDING' || item.status === 'ACTIVE' ? 'LIVE' : item.status === 'SOLD' ? 'SOLD' : item.status === 'UNSOLD' ? 'UNSOLD' : 'UPCOMING',
    role: item.players?.role,
    country: item.players?.country,
    image_url: item.players?.image_url,
  }));

  const player = activeLot.players;
  const currentPlayer: QueuedPlayer = {
    playerId: player.id,
    name: player.name,
    category: (player.category as NormalizedCategory) || 'CORE',
    basePrice: activeLot.base_price,
    auctionOrder: activeLot.lot_index + 1,
    status: activeLot.status === 'BIDDING' || activeLot.status === 'ACTIVE' ? 'LIVE' : activeLot.status === 'SOLD' ? 'SOLD' : activeLot.status === 'UNSOLD' ? 'UNSOLD' : 'UPCOMING',
    role: player.role,
    country: player.country,
    image_url: player.image_url,
  };

  const statusText = auction.status === 'IN_PROGRESS' ? 'LIVE' : auction.status === 'PAUSED' ? 'PAUSED' : auction.status === 'COMPLETED' ? 'COMPLETED' : 'NOT_STARTED';

  const state: AuctionState = {
    auctionId: auction.id,
    lotId: activeLot.id,
    timerExpiresAt: activeLot.timer_expires_at || null,
    timerDurationSeconds: activeLot.timer_duration_seconds || 15,
    auctionStatus: statusText,
    currentPlayerIndex: activeLot.lot_index,
    currentCategory: (player.category as NormalizedCategory) || null,
    currentBid: activeLot.current_bid || activeLot.base_price,
    highestBidderId: activeLot.highest_bidder_team_id || null,
    bidCount: bidCount || 0,
    currentPlayer,
    currentPlayerId: player.id,
    playerQueue,
  };

  logAuctionDebug('A. fetchAuthoritativeAuctionState (Canonical DB)', roomId, state);
  return state;
}
