import type { V3AuctionLot } from '@/lib/v3-auction-types';

const LOT_STATUS_RANK: Record<V3AuctionLot['status'], number> = {
  PENDING: 0,
  GET_READY: 1,
  ACTIVE: 2,
  BIDDING: 3,
  SOLD: 4,
  UNSOLD: 4,
  SKIPPED: 4,
};

const FINAL_LOT_STATUSES = new Set<V3AuctionLot['status']>(['SOLD', 'UNSOLD', 'SKIPPED']);
const ACTIVE_LOT_STATUSES = new Set<V3AuctionLot['status']>(['GET_READY', 'ACTIVE', 'BIDDING']);

function laterTimestamp(previous: string | null, incoming: string | null): string | null {
  if (!previous) return incoming;
  if (!incoming) return previous;

  const previousTime = Date.parse(previous);
  const incomingTime = Date.parse(incoming);
  if (Number.isFinite(previousTime) && (!Number.isFinite(incomingTime) || incomingTime < previousTime)) {
    return previous;
  }

  return incoming;
}

function mergeSameLot(previous: V3AuctionLot, incoming: V3AuctionLot): V3AuctionLot {
  if (FINAL_LOT_STATUSES.has(previous.status)) {
    if (incoming.status !== previous.status) return previous;

    return {
      ...incoming,
      current_bid: Math.max(previous.current_bid ?? 0, incoming.current_bid ?? 0),
      highest_bidder_team_id: incoming.highest_bidder_team_id ?? previous.highest_bidder_team_id,
      winning_team_id: incoming.winning_team_id ?? previous.winning_team_id,
      winning_bid: incoming.winning_bid ?? previous.winning_bid,
    };
  }

  if (LOT_STATUS_RANK[incoming.status] < LOT_STATUS_RANK[previous.status]) {
    return previous;
  }

  if (
    previous.status === 'BIDDING' &&
    incoming.status === 'BIDDING' &&
    Number.isFinite(previous.current_bid) &&
    Number.isFinite(incoming.current_bid) &&
    incoming.current_bid < previous.current_bid
  ) {
    return {
      ...incoming,
      status: previous.status,
      current_bid: previous.current_bid,
      highest_bidder_team_id: previous.highest_bidder_team_id ?? incoming.highest_bidder_team_id,
      timer_expires_at: laterTimestamp(previous.timer_expires_at, incoming.timer_expires_at),
    };
  }

  if (previous.status === 'BIDDING' && incoming.status === 'BIDDING') {
    return {
      ...incoming,
      highest_bidder_team_id:
        incoming.current_bid === previous.current_bid
          ? incoming.highest_bidder_team_id ?? previous.highest_bidder_team_id
          : incoming.highest_bidder_team_id,
      timer_expires_at: laterTimestamp(previous.timer_expires_at, incoming.timer_expires_at),
    };
  }

  if (previous.status === 'GET_READY' && incoming.status === 'GET_READY') {
    return {
      ...incoming,
      get_ready_expires_at: laterTimestamp(previous.get_ready_expires_at, incoming.get_ready_expires_at),
    };
  }

  return incoming;
}

function isOlderLot(previous: V3AuctionLot, incoming: V3AuctionLot): boolean {
  // The unsold-round queue follows the main queue and may restart its own index.
  if (!previous.is_mini_round && incoming.is_mini_round) return false;
  if (previous.is_mini_round && !incoming.is_mini_round) return true;
  return incoming.lot_index < previous.lot_index;
}

/** Reconcile a database snapshot without allowing the same auction to move backwards. */
export function reconcileAuthoritativeLot(
  previousAuctionId: string | null,
  previousLot: V3AuctionLot | null,
  incomingAuctionId: string,
  incomingLot: V3AuctionLot | null
): V3AuctionLot | null {
  if (!incomingLot || previousAuctionId !== incomingAuctionId || !previousLot) {
    return incomingLot;
  }

  if (previousLot.id === incomingLot.id) {
    return mergeSameLot(previousLot, incomingLot);
  }

  return isOlderLot(previousLot, incomingLot) ? previousLot : incomingLot;
}

/** Apply only relevant live-lot Realtime events; terminal and old-lot events trigger a refresh only. */
export function reconcileRealtimeLot(
  previousLot: V3AuctionLot | null,
  incomingLot: V3AuctionLot
): V3AuctionLot | null {
  if (previousLot?.id === incomingLot.id) {
    return mergeSameLot(previousLot, incomingLot);
  }

  if (!ACTIVE_LOT_STATUSES.has(incomingLot.status)) return previousLot;
  if (!previousLot) return incomingLot;
  if (isOlderLot(previousLot, incomingLot)) return previousLot;

  return incomingLot;
}
