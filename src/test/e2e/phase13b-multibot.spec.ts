import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import {
  createDisposableTestUser,
  createPhase13BTestPlayerSet,
  setupDisposableAuction,
  cleanupBoundedTestPlayerSet,
  cleanupDisposableAuction,
} from './setup/auction-fixture';

// ============================================================
// Helper: Poll DB state until condition or timeout
// ============================================================
async function pollUntil(
  supabase: any,
  fetchFn: () => Promise<any>,
  conditionFn: (res: any) => boolean,
  timeoutMs: number,
  intervalMs = 500
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetchFn();
    if (conditionFn(res)) {
      return res;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout exceeded after ${timeoutMs}ms waiting for condition.`);
}

// Phase 13B API-level tests (M1, M2, M5)
test.describe.serial('Phase 13B — Multi-Bot & Failures', () => {
  test.setTimeout(300000); // 5 minutes to accommodate bidding wars
  
  let supabase: any;
  let playerSetId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  
  // Players from createPhase13BTestPlayerSet (ordered by lot_index later)
  // B1 (Alpha)   - Base 200, Role: BATSMAN
  // B2 (Beta)    - Base 200, Role: BOWLER
  // B3 (Gamma)   - Base 100, Role: ALL_ROUNDER
  // B4 (Delta)   - Base 100, Role: BATSMAN, Overseas
  // B5 (Epsilon) - Base 2000, Role: ALL_ROUNDER
  let lots: any[] = [];

  test.setTimeout(180000);

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    const runId = crypto.randomUUID().substring(0, 8);

    const { playerSetId: fetchedPlayerSetId, players } = await createPhase13BTestPlayerSet(supabase, runId);
    playerSetId = fetchedPlayerSetId;

    // We want bots to have a 1700 initial purse. So we pass 17.
    // Reserve needed for 15 slots (futureMinBasePrice=100) is 14 * 100 = 1400.
    // So they have 1700 - 1400 = 300 available for the first bid.
    const auction = await setupDisposableAuction(supabase, runId, {
      playerSetId,
      roomSettings: { default_purse: 17, max_squad_size: 15, max_overseas: 8 },
      defaultPurse: 10000, 
    });

    roomId = auction.roomId;
    auctionId = auction.auctionId;
    hostTeamId = auction.hostTeamId;
    
    // Start the auction
    const { error: startErr } = await supabase.rpc('v3_start_auction', { p_room_id: roomId });
    if (startErr) throw startErr;
    
    // Wait for GET_READY on lot 1 and fetch all lots
    await pollUntil(
      supabase,
      () => supabase.from('auctions').select('status').eq('id', auctionId).single(),
      (r) => r.data?.status === 'IN_PROGRESS',
      10000
    );

    const { data } = await supabase
      .from('auction_lots')
      .select('id, lot_index, base_price, players(name)')
      .eq('auction_id', auctionId)
      .order('lot_index', { ascending: true });
      
    lots = data || [];
  });

  test.afterAll(async () => {
    if (roomId) {
      await cleanupDisposableAuction(supabase, roomId);
    }
    const adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    if (playerSetId) {
      await cleanupBoundedTestPlayerSet(adminClient, playerSetId);
    }
  });

  test('M1: Multi-Bot Brawl (Realistic Escalation) — NOT YET PROVEN', async ({ request }) => {
    test.setTimeout(180000);
    
    // 1. Fetch lots with player info
    const { data: lots, error: lotErr } = await supabase
      .from('auction_lots')
      .select('*, players(name, base_price)')
      .eq('auction_id', auctionId)
      .order('lot_index', { ascending: true });
      
    console.log('Lots:', lots?.map((l: any) => ({ name: l.players.name, base: l.players.base_price })));
    
    const lot1 = lots[0];

    // Wait for lot to enter BIDDING state
    await pollUntil(
      supabase,
      async () => supabase.from('auction_lots').select('status').eq('id', lot1.id).single(),
      (r) => r.data?.status === 'BIDDING',
      15000
    );

    const { data: bidData, error: bidErr } = await supabase.rpc('v3_place_bid', {
      p_auction_id: auctionId,
      p_lot_id: lot1.id,
      p_team_id: hostTeamId,
      p_request_id: crypto.randomUUID(),
      p_is_bot: false,
    });
    console.log('Host bid response:', { bidData, bidErr });
    if (bidErr || !bidData.success) {
      console.warn(`Host bid failed: ${bidData?.error}`);
    } else {
      console.log(`Host opened bidding at ${lot1.base_price} for Lot 1`);
    }

    // Wait until Lot 1 becomes SOLD
    const settled = await pollUntil(
      supabase,
      async () => {
        const { data } = await supabase.from('auction_lots').select('status, winning_bid, winning_team_id').eq('id', lot1.id).single();
        console.log(`Lot 1 status: ${data?.status}, bid: ${data?.winning_bid}`);
        return data;
      },
      (r) => r?.status === 'SOLD',
      120000 
    );
    
    expect(settled).not.toBeNull();
    expect(settled.status).toBe('SOLD');
    
    // Check that there were multiple bids from DIFFERENT bots.
    const { data: bids } = await supabase
      .from('bids')
      .select('team_id, amount')
      .eq('lot_id', lot1.id)
      .order('amount', { ascending: true });
      
    expect(bids.length).toBeGreaterThan(1); // At least 2 bids
    
    const uniqueTeams = new Set(bids.map((b: any) => b.team_id));
    expect(uniqueTeams.size).toBeGreaterThan(1); // At least 2 distinct bots participated
    
    // Ensure the winning bid escalated above base price
    expect(settled.winning_bid).toBeGreaterThan(lot1.base_price);
  });

  test('M2: Budget Depletion Cascade — PROOF OF CONCEPT', async () => {
    test.setTimeout(450000); // 7.5 minutes to accommodate sequential bidding
    // M1 consumed Lot 1, so one bot's budget is depleted.
    // Lot 2 (Beta) will be fought over by the remaining bots.
    const lot2 = lots[1];
    
    // Wait for lot 2 to enter BIDDING state
    await pollUntil(
      supabase,
      async () => supabase.from('auction_lots').select('status').eq('id', lot2.id).single(),
      (r) => r.data?.status === 'BIDDING',
      90000
    );

    // Let bots bid organically. Do NOT place a host bid.
    
    const { data: settled2 } = await pollUntil(
      supabase,
      () => supabase.from('auction_lots').select('status, winning_bid, winning_team_id').eq('id', lot2.id).single(),
      (r) => r.data?.status === 'SOLD' || r.data?.status === 'UNSOLD',
      90000
    );
    
    console.log(`Lot 2 settled as ${settled2?.status} for ${settled2?.winning_bid} to ${settled2?.winning_team_id}`);
    
    // Check balances of bots
    const { data: botsAfterLot2 } = await supabase
      .from('teams')
      .select('id, name, purse, initial_purse')
      .eq('auction_id', auctionId)
      .eq('is_bot', true);
      
    console.log('Bot Status After Lot 2:', botsAfterLot2);
    
    // Now process lots[2], lots[3], lots[4] sequentially WITHOUT host bids
    for (let i = 2; i < lots.length - 1; i++) {
      const currentLot = lots[i];
      
      console.log(`Waiting for Lot ${i + 1} to settle organically...`);
      // Wait for it to finish (SOLD or UNSOLD)
      const settledLot = await pollUntil(
        supabase,
        async () => supabase.from('auction_lots').select('status, winning_bid, winning_team_id').eq('id', currentLot.id).single(),
        (r) => r.data?.status === 'SOLD' || r.data?.status === 'UNSOLD',
        180000
      );
      console.log(`Lot ${i + 1} settled as ${settledLot.data?.status} for ${settledLot.data?.winning_bid} to ${settledLot.data?.winning_team_id}`);
    }
    
    // Epsilon is the 2000L base price lot (Lot 5).
    const lotEpsilon = lots.find((l: any) => l.base_price === 2000)!;
    console.log(`Waiting for Lot 5 (Epsilon, 2000L base) to settle organically...`);
    
    // 1. Check bot purses right before Lot 5
    const { data: botsBeforeLot5 } = await supabase
      .from('teams')
      .select('id, name, purse')
      .eq('auction_id', auctionId)
      .eq('is_bot', true);
    console.log('Bot Purses Before Lot 5:', botsBeforeLot5);

    // 2. Wait for Lot 5 to settle
    const settledEpsilon = await pollUntil(
      supabase,
      async () => supabase.from('auction_lots').select('status, winning_bid, winning_team_id').eq('id', lotEpsilon.id).single(),
      (r) => r.data?.status === 'SOLD' || r.data?.status === 'UNSOLD',
      180000
    );

    // 3. Verify no bot bids were placed on Lot 5
    const { data: epsilonBids } = await supabase
      .from('bids')
      .select('team_id, amount, is_bot')
      .eq('lot_id', lotEpsilon.id);
      
    const botBidsOnEpsilon = epsilonBids?.filter((b: any) => b.is_bot) || [];
    console.log('Bot bids on Lot 5:', botBidsOnEpsilon);
    
    // ASSERTIONS
    expect(botBidsOnEpsilon.length).toBe(0); // Zero bot participation
    expect(settledEpsilon.data?.status).toBe('UNSOLD'); // Because no bot bids and no host bid
    
    // M2 COMPLETED automatically?
    // Let's check if auction status is COMPLETED
    const { data: finalAuction } = await supabase
      .from('auctions')
      .select('status')
      .eq('id', auctionId)
      .single();
    console.log(`Final Auction Status: ${finalAuction?.status}`);
  });
});
