import './setup/e2e-target-guard';
import { test, expect } from '@playwright/test';
import { createDisposableTestUser, setupDisposableAuction, cleanupDisposableAuction, createBoundedTestPlayerSet, cleanupBoundedTestPlayerSet } from './setup/auction-fixture';
import crypto from 'crypto';


async function pollUntil<T>(
  queryFn: () => Promise<T>,
  conditionFn: (result: T) => boolean,
  timeoutMs = 15000,
  pollIntervalMs = 1000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const startTime = Date.now();

    const interval = setInterval(async () => {
      try {
        const result = await queryFn();

        if (conditionFn(result)) {
          clearInterval(interval);
          resolve(result);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          reject(new Error('pollUntil timeout'));
        }
      } catch {
        // ignore and retry
      }
    }, pollIntervalMs);
  });
}

test.describe('Live Behaviors Targeted', () => {
  let supabase: any;
  let roomId: string;
  let auctionId: string;
  let runId: string;
  let serviceSupabase: any;

  let playerSetId: string;

  test.beforeAll(async () => {
    const { createClient } = require('@supabase/supabase-js');
    serviceSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    runId = setup.runId;
    
    const ps = await createBoundedTestPlayerSet(supabase);
    playerSetId = ps.playerSetId;
  });

  test.afterAll(async () => {
    if (roomId && supabase) {
      try { await cleanupDisposableAuction(supabase, roomId); } catch (e) { }
    }
    if (playerSetId && supabase) {
      await cleanupBoundedTestPlayerSet(supabase, playerSetId);
    }
  });

  test('Trigger Endgame Surplus', async () => {
    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: { default_purse: 10000, max_squad_size: 15, max_overseas: 8 },
    });
    // With 10000 Lakhs and 15 slots, 10000/15 = 666.6 > 500. This triggers Endgame Surplus naturally on Lot 1.
    roomId = auction.roomId;
    const { data: startData } = await supabase.rpc('v3_start_auction', { p_room_id: auction.roomId });
    const lot1Id = startData.lot_id;
    
    // Just wait for lot 1 to be BIDDING and bots to bid.
    await pollUntil(
      () => supabase.from('auction_lots').select('status').eq('id', lot1Id).single(),
      (r: any) => r.data && r.data.status === 'BIDDING',
      15000
    );
    await new Promise(r => setTimeout(r, 2000)); // wait for bots to evaluate
  });
  
  test('Trigger Overseas Clamp & Purse Insufficient', async () => {
    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: { default_purse: 1, max_squad_size: 15, max_overseas: 1 },
    });
    // Purse is 1 Lakh (100). Base price is 200. This guarantees PURSE_INSUFFICIENT.
    // Max overseas is 1. We will insert 1 overseas player into the bot's roster to trigger OVERSEAS_FULL on the next overseas lot.
    
    const { data: bots } = await supabase.from('teams').select('*').eq('auction_id', auction.auctionId).eq('is_bot', true);
    
    // Update bot 1 to have 0 purse, triggering PURSE_INSUFFICIENT
    await serviceSupabase.from('teams').update({ purse: 10 }).eq('id', bots[0].id);
    // Update bot 2 to have enough purse
    await serviceSupabase.from('teams').update({ purse: 10000 }).eq('id', bots[1].id);
    
    // To trigger OVERSEAS_FULL, Bot 2 must have an overseas player in its roster.
    // The server calculates overseas_count from SOLD lots.
    const dummyPlayerId = crypto.randomUUID();
    const { error: pe } = await serviceSupabase.from('players').insert({
      id: dummyPlayerId,
      player_set_id: playerSetId,
      name: 'Dummy Overseas',
      role: 'BATSMAN',
      category: 'C',
      base_price: 100,
      is_overseas: true,
      country: 'England'
    });
    if (pe) throw new Error("Player insert failed: " + pe.message);

    const { error: le } = await serviceSupabase.from('auction_lots').insert({
      id: crypto.randomUUID(),
      auction_id: auction.auctionId,
      player_id: dummyPlayerId,
      status: 'SOLD',
      winning_team_id: bots[1].id,
      winning_bid: 100,
      base_price: 100,
      lot_index: 999
    });
    if (le) throw new Error("Lot insert failed: " + le.message);

    // Set all players in this player set to overseas to guarantee the current lot is overseas
    await serviceSupabase.from('players').update({ is_overseas: true }).eq('player_set_id', playerSetId);
    
    const { data: startData } = await supabase.rpc('v3_start_auction', { p_room_id: auction.roomId });
    const lot1Id = startData.lot_id;
    
    // Wait for bidding
    await pollUntil(
      () => supabase.from('auction_lots').select('status').eq('id', lot1Id).single(),
      (r: any) => r.data && r.data.status === 'BIDDING',
      15000
    );
    await new Promise(r => setTimeout(r, 6000));
  });
});
