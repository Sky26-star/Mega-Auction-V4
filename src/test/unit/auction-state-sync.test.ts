import { describe, expect, it } from 'vitest';
import { reconcileAuthoritativeLot, reconcileRealtimeLot } from '@/lib/auction/auction-state-sync';
import type { V3AuctionLot } from '@/lib/v3-auction-types';

function lot(overrides: Partial<V3AuctionLot> = {}): V3AuctionLot {
  return {
    id: 'lot-3',
    auction_id: 'auction-1',
    player_id: 'player-3',
    lot_index: 3,
    status: 'BIDDING',
    base_price: 200,
    current_bid: 250,
    highest_bidder_team_id: 'team-1',
    winning_team_id: null,
    winning_bid: null,
    get_ready_expires_at: null,
    timer_expires_at: '2026-10-25T10:00:00.000Z',
    is_mini_round: false,
    ...overrides,
  };
}

describe('auction state reconciliation', () => {
  it('keeps the current lot when an older authoritative snapshot arrives', () => {
    const current = lot({ id: 'lot-4', lot_index: 4, player_id: 'player-4' });
    const stale = lot({ id: 'lot-2', lot_index: 2, player_id: 'player-2', status: 'GET_READY' });

    expect(reconcileAuthoritativeLot('auction-1', current, 'auction-1', stale)).toBe(current);
  });

  it('keeps the current active lot when a delayed Realtime event refers to an earlier lot', () => {
    const current = lot({ id: 'lot-4', lot_index: 4, player_id: 'player-4' });
    const delayed = lot({ id: 'lot-2', lot_index: 2, player_id: 'player-2', status: 'BIDDING' });

    expect(reconcileRealtimeLot(current, delayed)).toBe(current);
  });

  it('does not install a terminal event as the active lot when there is no current lot', () => {
    const completedEvent = lot({ status: 'SOLD', winning_team_id: 'team-1', winning_bid: 250 });
    expect(reconcileRealtimeLot(null, completedEvent)).toBeNull();
  });

  it('does not reopen a finalized lot from a delayed BIDDING event', () => {
    const sold = lot({ status: 'SOLD', winning_team_id: 'team-1', winning_bid: 250 });
    const stale = lot({ status: 'BIDDING', winning_team_id: null, winning_bid: null });

    expect(reconcileRealtimeLot(sold, stale)).toBe(sold);
    expect(reconcileAuthoritativeLot('auction-1', sold, 'auction-1', stale)).toBe(sold);
  });

  it('does not regress same-lot status, bid amount, bidder, or timer', () => {
    const current = lot({ current_bid: 450, highest_bidder_team_id: 'team-2', timer_expires_at: '2026-10-25T10:01:00.000Z' });
    const delayed = lot({ status: 'GET_READY', current_bid: 200, highest_bidder_team_id: null, timer_expires_at: null });

    expect(reconcileRealtimeLot(current, delayed)).toBe(current);
    expect(reconcileAuthoritativeLot('auction-1', current, 'auction-1', delayed)).toBe(current);
  });

  it('does not shorten an active bidding timer from a delayed same-bid update', () => {
    const current = lot({
      current_bid: 250,
      timer_expires_at: '2026-10-25T10:01:00.000Z',
    });
    const delayed = lot({
      current_bid: 250,
      timer_expires_at: '2026-10-25T10:00:30.000Z',
    });

    expect(reconcileRealtimeLot(current, delayed)?.timer_expires_at).toBe(current.timer_expires_at);
  });

  it('accepts a timer extension for the same bidding lot', () => {
    const current = lot({ timer_expires_at: '2026-10-25T10:00:30.000Z' });
    const extended = lot({ timer_expires_at: '2026-10-25T10:01:00.000Z' });

    expect(reconcileRealtimeLot(current, extended)?.timer_expires_at).toBe(extended.timer_expires_at);
  });

  it('does not shorten the GET_READY countdown from a delayed update', () => {
    const current = lot({ status: 'GET_READY', get_ready_expires_at: '2026-10-25T10:01:00.000Z' });
    const delayed = lot({ status: 'GET_READY', get_ready_expires_at: '2026-10-25T10:00:30.000Z' });

    expect(reconcileRealtimeLot(current, delayed)?.get_ready_expires_at).toBe(current.get_ready_expires_at);
  });

  it('accepts the next active lot, but not a later terminal event as a live lot', () => {
    const current = lot({ id: 'lot-3', lot_index: 3 });
    const nextReady = lot({ id: 'lot-4', lot_index: 4, status: 'GET_READY' });
    const futureSold = lot({ id: 'lot-5', lot_index: 5, status: 'SOLD' });

    expect(reconcileRealtimeLot(current, nextReady)).toBe(nextReady);
    expect(reconcileRealtimeLot(current, futureSold)).toBe(current);
  });

  it('allows progression into the unsold round, then rejects late main-round events', () => {
    const mainRound = lot({ id: 'lot-main', lot_index: 25, status: 'UNSOLD', is_mini_round: false });
    const unsoldRound = lot({ id: 'lot-mini', lot_index: 0, status: 'GET_READY', is_mini_round: true });
    const delayedMainEvent = lot({ id: 'lot-main-old', lot_index: 24, status: 'BIDDING', is_mini_round: false });

    expect(reconcileRealtimeLot(mainRound, unsoldRound)).toBe(unsoldRound);
    expect(reconcileRealtimeLot(unsoldRound, delayedMainEvent)).toBe(unsoldRound);
  });

  it('clears an active lot when the authoritative state explicitly reports none', () => {
    const current = lot();
    expect(reconcileAuthoritativeLot('auction-1', current, 'auction-1', null)).toBeNull();
  });
});
