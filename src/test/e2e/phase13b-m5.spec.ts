import { test, expect } from '@playwright/test';
import {
  createDisposableTestUser,
  createPhase13BTestPlayerSet,
  setupDisposableAuction,
  cleanupBoundedTestPlayerSet,
  cleanupDisposableAuction,
} from './setup/auction-fixture';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Helper to invoke the production tick endpoint
async function invokeTick() {
  const res = await fetch('http://localhost:3000/api/auction/tick', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`
    },
  });
  const data = await res.json();
  return { status: res.status, data };
}

test.describe.serial('Phase 13B — M5 CONTROLLED TICK / FAILURE-PATH VALIDATION', () => {
  test.setTimeout(180000);

  let hostUser: any;
  let roomId: string;
  let auctionId: string;
  let playerSetId: string;
  let supabaseAdmin: any;

  test.beforeAll(async () => {
    hostUser = await createDisposableTestUser();
    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  });

  test.afterEach(async () => {
    if (roomId) {
      await cleanupDisposableAuction(hostUser.supabase, roomId);
      roomId = '';
    }
    if (playerSetId) {
      await cleanupBoundedTestPlayerSet(supabaseAdmin, playerSetId);
      playerSetId = '';
    }
  });

  test('M5 Scenarios: Lifecycle expiry, zero bids, idempotency, and final lot', async () => {
    const runId = crypto.randomUUID().substring(0, 8);
    // Create player set with exactly 2 players to test final lot behavior
    const { playerSetId: psId, playerIds } = await createPhase13BTestPlayerSet(hostUser.supabase, runId);
    playerSetId = psId;

    // Remove extra players (leave only 2) for a short auction.
    // This is necessary fixture shaping to safely and deterministically test the Final Lot (COMPLETED) transition
    // without simulating an entire 100+ player auction.
    const playersToDelete = playerIds.slice(2);
    if (playersToDelete.length > 0) {
      const { error: delErr } = await supabaseAdmin.from('players').delete().in('id', playersToDelete);
      expect(delErr).toBeNull();
    }

    const auction = await setupDisposableAuction(hostUser.supabase, runId, {
      playerSetId,
      roomSettings: { default_purse: 1000, max_squad_size: 15, max_overseas: 8 },
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;

    // Start auction -> moves to GET_READY for lot 1
    const { error: startErr } = await hostUser.supabase.rpc('v3_start_auction', { p_room_id: roomId });
    expect(startErr).toBeNull();

    let { data: currentAuction, error: getAuctionErr } = await supabaseAdmin.from('auctions').select('*').eq('id', auctionId).single();
    expect(getAuctionErr).toBeNull();
    let lotId1 = currentAuction.current_lot_id;
    expect(lotId1).toBeDefined();

    // Fast-forward GET_READY expiry (use 1970 to mathematically guarantee expiry against any clock drift)
    const { error: updErr1 } = await supabaseAdmin.from('auction_lots')
      .update({ get_ready_expires_at: new Date(10000).toISOString() })
      .eq('id', lotId1);
    expect(updErr1).toBeNull();

    // Bounded retry loop to handle potential background daemon race condition
    let reachedBidding = false;
    let startBiddingActionObserved = false;
    for (let i = 0; i < 5; i++) {
      let tickRes = await invokeTick();
      expect(tickRes.status).toBe(200);
      
      const hasAction = tickRes.data.actions?.some((a: any) => a.action === 'START_BIDDING' && a.lot === lotId1);
      if (hasAction) startBiddingActionObserved = true;

      let { data: lot1 } = await supabaseAdmin.from('auction_lots').select('status').eq('id', lotId1).single();
      if (lot1.status === 'BIDDING') {
        reachedBidding = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    expect(reachedBidding).toBe(true);

    // SCENARIO B: No Valid Bid (Zero Bids)
    // Fast-forward BIDDING expiry for lot 1 (use 1970 to mathematically guarantee expiry)
    const { error: updErr2 } = await supabaseAdmin.from('auction_lots')
      .update({ timer_expires_at: new Date(10000).toISOString() })
      .eq('id', lotId1);
    expect(updErr2).toBeNull();

    // SCENARIO A: Expired lot -> finalize
    let reachedUnsold = false;
    let finalizeActionObserved = false;
    for (let i = 0; i < 5; i++) {
      let tickRes = await invokeTick();
      expect(tickRes.status).toBe(200);

      const hasAction = tickRes.data.actions.some((a: any) => a.action === 'FINALIZE_LOT' && a.lot === lotId1);
      if (hasAction) finalizeActionObserved = true;

      let { data: lot1After } = await supabaseAdmin.from('auction_lots').select('status, winning_bid').eq('id', lotId1).single();
      if (lot1After.status === 'UNSOLD') {
        reachedUnsold = true;
        expect(lot1After.winning_bid).toBeNull();
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    expect(reachedUnsold).toBe(true);

    // SCENARIO C: Repeated Tick / Idempotency
    // Claim: "Repeated tick after finalized lot does not duplicate finalization of that lot."
    // Call tick again immediately. It should process the next lot (GET_READY), but NOT finalize lot 1 again.
    let tickResIdempotent = await invokeTick();
    expect(tickResIdempotent.status).toBe(200);
    
    // Check that FINALIZE_LOT for lot 1 is NOT in the actions
    const finalizeActions = tickResIdempotent.data.actions.filter((a: any) => a.action === 'FINALIZE_LOT' && a.lot === lotId1);
    expect(finalizeActions.length).toBe(0);

    // Check auction state - should have advanced to lot 2
    let { data: advancedAuction, error: advErr } = await supabaseAdmin.from('auctions').select('current_lot_id, status').eq('id', auctionId).single();
    expect(advErr).toBeNull();
    let lotId2 = advancedAuction.current_lot_id;
    expect(lotId2).not.toBe(lotId1);
    expect(lotId2).toBeDefined();

    // SCENARIO D: Next Lot / Final Lot
    // Fast forward GET_READY for lot 2
    const { error: updErr3 } = await supabaseAdmin.from('auction_lots')
      .update({ get_ready_expires_at: new Date(10000).toISOString() })
      .eq('id', lotId2);
    expect(updErr3).toBeNull();
    
    // Bounded wait for lot 2 to become BIDDING
    for (let i = 0; i < 5; i++) {
      let tickRes = await invokeTick();
      expect(tickRes.status).toBe(200);
      let { data: lot2 } = await supabaseAdmin.from('auction_lots').select('status').eq('id', lotId2).single();
      if (lot2.status === 'BIDDING') break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Valid bid established through the existing production v3_place_bid RPC as controlled test setup.
    // The bid itself is not the M5 subject under test; production tick/finalization/completion is.
    const { data: teams, error: teamsErr } = await supabaseAdmin.from('teams').select('id').eq('auction_id', auctionId);
    expect(teamsErr).toBeNull();
    const testBidTeamId = teams[0].id;
    const { error: bidErr } = await hostUser.supabase.rpc('v3_place_bid', {
      p_auction_id: auctionId,
      p_lot_id: lotId2,
      p_team_id: testBidTeamId,
      p_request_id: crypto.randomUUID(),
      p_is_bot: false
    });
    expect(bidErr).toBeNull();

    // Fast-forward BIDDING for lot 2
    const { error: updErr4 } = await supabaseAdmin.from('auction_lots')
      .update({ timer_expires_at: new Date(10000).toISOString() })
      .eq('id', lotId2);
    expect(updErr4).toBeNull();
    
    let reachedSold = false;
    for (let i = 0; i < 5; i++) {
      let tickRes = await invokeTick();
      expect(tickRes.status).toBe(200);
      let { data: lot2After } = await supabaseAdmin.from('auction_lots').select('status, winning_team_id').eq('id', lotId2).single();
      if (lot2After.status === 'SOLD') {
        reachedSold = true;
        expect(lot2After.winning_team_id).toBe(testBidTeamId);
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    expect(reachedSold).toBe(true);

    // Verify auction is COMPLETED because it was the final lot
    let { data: finalAuction, error: finalAucErr } = await supabaseAdmin.from('auctions').select('status').eq('id', auctionId).single();
    expect(finalAucErr).toBeNull();
    expect(finalAuction.status).toBe('COMPLETED');

    // Completed auction is safely ignored by the active/paused tick processing path.
    let finalTickRes = await invokeTick();
    expect(finalTickRes.status).toBe(200);
    expect(finalTickRes.data.message).toBe('No active or paused auctions');
  });

  test('M5 Scenario: Pause/Resume Safety', async () => {
    const runId = crypto.randomUUID().substring(0, 8);
    const { playerSetId: psId } = await createPhase13BTestPlayerSet(hostUser.supabase, runId);
    playerSetId = psId;

    const auction = await setupDisposableAuction(hostUser.supabase, runId, {
      playerSetId,
      roomSettings: { default_purse: 1000, max_squad_size: 15, max_overseas: 8 },
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;

    await hostUser.supabase.rpc('v3_start_auction', { p_room_id: roomId });
    let { data: initialAuction, error: initialAucErr } = await supabaseAdmin.from('auctions').select('current_lot_id').eq('id', auctionId).single();
    expect(initialAucErr).toBeNull();
    let lotId = initialAuction.current_lot_id;

    // Fast-forward GET_READY
    const { error: updErr5 } = await supabaseAdmin.from('auction_lots').update({ get_ready_expires_at: new Date(10000).toISOString() }).eq('id', lotId);
    expect(updErr5).toBeNull();
    
    for (let i = 0; i < 5; i++) {
      let tickRes = await invokeTick();
      expect(tickRes.status).toBe(200);
      let { data: lot } = await supabaseAdmin.from('auction_lots').select('status').eq('id', lotId).single();
      if (lot.status === 'BIDDING') break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Pause auction
    const { error: pauseErr } = await hostUser.supabase.rpc('pause_auction', { p_auction_id: auctionId, p_reason: 'Testing Pause' });
    expect(pauseErr).toBeNull();

    // Verify status PAUSED
    let { data: pausedAuction, error: pausedAucErr } = await supabaseAdmin.from('auctions').select('status').eq('id', auctionId).single();
    expect(pausedAucErr).toBeNull();
    expect(pausedAuction.status).toBe('PAUSED');

    // Fast-forward BIDDING timer in DB (to simulate time passing while paused)
    const { error: updErr6 } = await supabaseAdmin.from('auction_lots').update({ timer_expires_at: new Date(10000).toISOString() }).eq('id', lotId);
    expect(updErr6).toBeNull();

    // Claim: while auction status is PAUSED, the tick path does not finalize the expired lot.
    let tickRes = await invokeTick();
    expect(tickRes.status).toBe(200);

    // Lot should still be BIDDING (not UNSOLD/SOLD) because auction is PAUSED
    let { data: pausedLot, error: pausedLotErr } = await supabaseAdmin.from('auction_lots').select('status').eq('id', lotId).single();
    expect(pausedLotErr).toBeNull();
    expect(pausedLot.status).toBe('BIDDING');

    // Resume auction
    const { error: resumeErr } = await hostUser.supabase.rpc('resume_auction', { p_auction_id: auctionId });
    expect(resumeErr).toBeNull();

    // We must manually reset the timer_expires_at backwards again because resume_auction updates it to be in the future
    const { error: updErr7 } = await supabaseAdmin.from('auction_lots').update({ timer_expires_at: new Date(10000).toISOString() }).eq('id', lotId);
    expect(updErr7).toBeNull();

    // Now call Tick -> Should finalize lot because it is resumed and timer is expired
    let reachedUnsold = false;
    for (let i = 0; i < 5; i++) {
      let tickRes = await invokeTick();
      expect(tickRes.status).toBe(200);
      let { data: resumedLot } = await supabaseAdmin.from('auction_lots').select('status').eq('id', lotId).single();
      if (resumedLot.status === 'UNSOLD') {
        reachedUnsold = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    expect(reachedUnsold).toBe(true);
  });
});
