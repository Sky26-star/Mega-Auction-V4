import './setup/e2e-target-guard';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import {
  cleanupBoundedTestPlayerSet,
  cleanupDisposableAuction,
  createDisposableTestUser,
  createPhase13BTestPlayerSet,
  setupDisposableAuction,
} from './setup/auction-fixture';

async function invokeAuctionTick() {
  const response = await fetch('http://localhost:3000/api/auction/tick', {
    method: 'POST',
    headers: { 'x-auction-tick-secret': process.env.AUCTION_TICK_SECRET! },
  });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.success).toBe(true);
  return body;
}

test('authenticated human-only room with two players completes every lot through auction ticks', async () => {
  test.setTimeout(300000);
  const host = await createDisposableTestUser();
  const secondHuman = await createDisposableTestUser();
  const admin = createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let roomId: string | undefined;
  let playerSetId: string | undefined;
  try {
    const { playerSetId: testPlayerSetId } = await createPhase13BTestPlayerSet(host.supabase, crypto.randomUUID().slice(0, 8));
    playerSetId = testPlayerSetId;

    const room = await setupDisposableAuction(host.supabase, crypto.randomUUID(), {
      playerSetId,
      botCount: 0,
      roomSettings: { default_purse: 170, max_squad_size: 15, max_overseas: 8 },
      defaultPurse: 10000,
    });
    roomId = room.roomId;

    const joined = await secondHuman.supabase.rpc('join_room_with_team', {
      p_room_code: room.roomCode,
      p_team_name: `Second Human ${room.roomCode}`,
      p_team_short_name: `S${room.roomCode.slice(1, 4)}`,
      p_team_color: '#234567',
    });
    expect(joined.error).toBeNull();
    expect(joined.data?.team_id).toBeTruthy();
    const secondHumanTeamId = joined.data.team_id as string;

    const started = await host.supabase.rpc('v3_start_auction', { p_room_id: room.roomId });
    expect(started.error).toBeNull();

    const { data: lots, error: lotsError } = await admin
      .from('auction_lots')
      .select('id, lot_index, base_price, status')
      .eq('auction_id', room.auctionId)
      .order('lot_index', { ascending: true });
    expect(lotsError).toBeNull();
    expect(lots).toHaveLength(5);

    const humanTeams = [room.hostTeamId, secondHumanTeamId];
    for (let index = 0; index < lots!.length; index += 1) {
      const lot = lots![index]!;
      const { data: beforeStart, error: beforeStartError } = await admin
        .from('auction_lots')
        .select('status')
        .eq('id', lot.id)
        .single();
      expect(beforeStartError).toBeNull();
      expect(beforeStart.status).toBe('GET_READY');

      const expiredReady = await admin
        .from('auction_lots')
        .update({ get_ready_expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq('id', lot.id);
      expect(expiredReady.error).toBeNull();
      const startTick = await invokeAuctionTick();
      expect(startTick.actions.some((action: any) => action.lot === lot.id && action.action === 'START_BIDDING')).toBe(true);

      const humanTeamId = humanTeams[index % humanTeams.length]!;
      const humanClient = index % humanTeams.length === 0 ? host.supabase : secondHuman.supabase;
      const humanBid = await humanClient.rpc('v3_place_bid', {
        p_auction_id: room.auctionId,
        p_lot_id: lot.id,
        p_team_id: humanTeamId,
        p_request_id: crypto.randomUUID(),
        p_is_bot: false,
      });
      expect(humanBid.error).toBeNull();
      expect(humanBid.data?.success).toBe(true);

      // A normal tick before the expiry must leave the live lot open.
      const reactionWindow = await admin
        .from('auction_lots')
        .update({ timer_expires_at: new Date(Date.now() + 5000).toISOString() })
        .eq('id', lot.id);
      expect(reactionWindow.error).toBeNull();
      const midTick = await invokeAuctionTick();
      expect(midTick.actions.some((action: any) => action.lot === lot.id && action.action === 'FINALIZE_LOT')).toBe(false);

      const expiredBidding = await admin
        .from('auction_lots')
        .update({ timer_expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq('id', lot.id);
      expect(expiredBidding.error).toBeNull();
      const finalTick = await invokeAuctionTick();
      expect(finalTick.actions.some((action: any) => action.lot === lot.id && action.action === 'FINALIZE_LOT')).toBe(true);

      const { data: finalLot, error: finalLotError } = await admin
        .from('auction_lots')
        .select('status, winning_team_id, winning_bid')
        .eq('id', lot.id)
        .single();
      expect(finalLotError).toBeNull();
      expect(finalLot.status).toBe('SOLD');
      expect(finalLot.winning_team_id).toBeTruthy();
      expect(finalLot.winning_bid).toBeGreaterThanOrEqual(lot.base_price);

      const { data: progression, error: progressionError } = await admin
        .from('auctions')
        .select('status, current_lot_id, current_lot_index')
        .eq('id', room.auctionId)
        .single();
      expect(progressionError).toBeNull();
      if (index < lots!.length - 1) {
        expect(progression.status).toBe('IN_PROGRESS');
        expect(progression.current_lot_id).toBe(lots![index + 1]!.id);
        expect(progression.current_lot_index).toBe(lots![index + 1]!.lot_index);
        const { data: nextLot, error: nextLotError } = await admin
          .from('auction_lots')
          .select('status')
          .eq('id', lots![index + 1]!.id)
          .single();
        expect(nextLotError).toBeNull();
        expect(nextLot.status).toBe('GET_READY');
      } else {
        expect(progression.status).toBe('COMPLETED');
        expect(progression.current_lot_id).toBeNull();
      }
    }

    const { data: finalAuction, error: finalAuctionError } = await admin
      .from('auctions')
      .select('status')
      .eq('id', room.auctionId)
      .single();
    expect(finalAuctionError).toBeNull();
    expect(finalAuction.status).toBe('COMPLETED');

    const { data: finalLots, error: finalLotsError } = await admin
      .from('auction_lots')
      .select('status')
      .eq('auction_id', room.auctionId);
    expect(finalLotsError).toBeNull();
    expect(finalLots?.every((lot) => lot.status === 'SOLD')).toBe(true);

    const { data: humanBids, error: humanBidError } = await admin
      .from('bids')
      .select('team_id, is_bot')
      .eq('auction_id', room.auctionId)
      .in('team_id', humanTeams);
    expect(humanBidError).toBeNull();
    expect(new Set(humanBids?.map((bid) => bid.team_id)).size).toBe(2);

    const { data: botBids, error: botBidError } = await admin
      .from('bids')
      .select('id')
      .eq('auction_id', room.auctionId)
      .eq('is_bot', true);
    expect(botBidError).toBeNull();
    expect(botBids).toHaveLength(0);
  } finally {
    if (roomId) await cleanupDisposableAuction(host.supabase, roomId).catch(() => undefined);
    if (playerSetId) await cleanupBoundedTestPlayerSet(admin, playerSetId).catch(() => undefined);
    await admin.auth.admin.deleteUser(host.user.id).catch(() => undefined);
    await admin.auth.admin.deleteUser(secondHuman.user.id).catch(() => undefined);
  }
});
