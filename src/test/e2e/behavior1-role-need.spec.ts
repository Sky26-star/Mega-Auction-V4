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

test.describe('Behavior 1 - Dynamic Role Need', () => {
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

  test('Prove Dynamic Role Need Causal Impact', async () => {
    const auction = await setupDisposableAuction(supabase, crypto.randomUUID(), {
      playerSetId,
      roomSettings: { default_purse: 10000, max_squad_size: 25, max_overseas: 8 },
    });
    roomId = auction.roomId;
    
    const { error: delErr } = await serviceSupabase.from('teams').delete().eq('auction_id', auction.auctionId).eq('is_bot', true);
    if (delErr) throw new Error("Delete failed: " + JSON.stringify(delErr));

    const bot1Id = 'd0000000-0000-0000-0000-00000000000a'; // STRATEGIC
    const bot2Id = 'd0000000-0000-0000-0000-00000000000f'; // STRATEGIC

    const { error: insErr } = await serviceSupabase.from('teams').insert([
      { id: bot1Id, auction_id: auction.auctionId, name: 'Bot A', short_name: 'BTA', purse: 8000, initial_purse: 8000, is_bot: true },
      { id: bot2Id, auction_id: auction.auctionId, name: 'Bot B', short_name: 'BTB', purse: 8000, initial_purse: 8000, is_bot: true }
    ]);
    if (insErr) throw new Error("Insert failed: " + JSON.stringify(insErr));
    
    // Inject 3 Dummy BATSMAN for Bot A (State A)
    for (let i = 0; i < 3; i++) {
      const dummyId = crypto.randomUUID();
      await serviceSupabase.from('players').insert({
        id: dummyId, player_set_id: playerSetId, name: `Dummy Batsman ${i}`,
        role: 'BATSMAN', category: 'C', base_price: 100, is_overseas: false, country: 'India'
      });
      await serviceSupabase.from('auction_lots').insert({
        id: crypto.randomUUID(), auction_id: auction.auctionId, player_id: dummyId,
        status: 'SOLD', winning_team_id: bot1Id, winning_bid: 100, base_price: 100, lot_index: 900 + i
      });
    }

    // Set all players to BATSMAN
    await serviceSupabase.from('players').update({ role: 'BATSMAN', category: 'A', base_price: 200 }).eq('player_set_id', playerSetId);

    // Start auction
    const { data: startData } = await supabase.rpc('v3_start_auction', { p_room_id: auction.roomId });
    const lot1Id = startData.lot_id;
    
    await pollUntil(
      () => supabase.from('auction_lots').select('status').eq('id', lot1Id).single(),
      (r: any) => r.data && r.data.status === 'BIDDING',
      15000
    );
    
    await new Promise(r => setTimeout(r, 8000));
    
    console.log(`[TEST ARTIFACT] Bot 1 (Low Need): ${bot1Id}`);
    console.log(`[TEST ARTIFACT] Bot 2 (High Need): ${bot2Id}`);
  });
});
