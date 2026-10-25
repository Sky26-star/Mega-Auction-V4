import './setup/e2e-target-guard';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let testUserEmail = `test-${Date.now()}@example.com`;
let testUserPassword = 'password123';

test.beforeAll(async () => {
  // Create a confirmed user using the admin API
  const { data, error } = await supabase.auth.admin.createUser({
    email: testUserEmail,
    password: testUserPassword,
    email_confirm: true,
    user_metadata: { display_name: `TestUser_${Date.now()}`, username: `testuser_${Date.now()}` }
  });
  if (error) {
    console.error('Failed to create test user:', error);
  } else {
    console.log('Test user created:', data.user.id);
  }
});

test.beforeEach(async ({ page }) => {
  // Login via UI
  await page.goto('http://localhost:3000/login');
  await page.fill('#login-email', testUserEmail);
  await page.fill('#login-password', testUserPassword);
  await page.click('button:has-text("ENTER AUCTION ARENA"), #login-submit-btn');
  
  // Wait for login to complete and navigate to dashboard
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  await page.waitForTimeout(1000); // Give it a moment to stabilize session
});

test.describe('Room Scoped Player Pool Smoke Test', () => {

  test('TEST A - MANUAL SELECT (5 players)', async ({ page }) => {
    test.setTimeout(120000);
    console.log('--- TEST A: MANUAL SELECT ---');

    await page.goto('http://localhost:3000/rooms/create');
    
    // Fill basic room info
    await page.fill('#room-name', 'Smoke Test A - Manual');
    
    // Select manual mode in the Player Pool Selector
    await page.click('button:has-text("MANUAL SELECT")');
    
    // Wait for players to load
    await page.waitForSelector('input[placeholder="Search players..."]');
    
    // We need to click 5 distinct players. 
    // They are rendered as buttons with names. Let's get the first 5.
    const playerButtons = page.locator('button:has(span.text-xs:has-text("•"))');
    await expect(playerButtons.first()).toBeVisible();
    
    const count = await playerButtons.count();
    expect(count).toBeGreaterThan(5);

    const selectedPlayerNames: string[] = [];
    for (let i = 0; i < 5; i++) {
      const btn = playerButtons.nth(i);
      const name = await btn.locator('span.text-sm').innerText();
      selectedPlayerNames.push(name);
      await btn.click();
    }
    
    console.log('Selected players:', selectedPlayerNames);

    // Disable bots to keep it simple
    await page.click('label[for="enable-bots-toggle"]');

    // Create room
    await page.click('#create-room-submit-btn');

    // Wait for navigation to lobby
    await page.waitForURL(/\/rooms\/[a-zA-Z0-9-]{36}/);
    const url = page.url();
    const roomId = url.split('/').pop()!;
    console.log(`Room created: ${roomId}`);

    // Verify DB
    const { data: auction } = await supabase.from('auctions').select('id').eq('room_id', roomId).single();
    const auctionId = auction!.id;
    console.log(`Auction ID: ${auctionId}`);

    const { data: lots } = await supabase.from('auction_lots').select('id, player_id, players(name)').eq('auction_id', auctionId);
    console.log(`Lots created: ${lots!.length}`);
    
    expect(lots!.length).toBe(5);
    
    const lotPlayerNames = lots!.map(l => (l.players as any).name);
    for (const name of selectedPlayerNames) {
      expect(lotPlayerNames).toContain(name);
    }
    
    // Start Auction
    // Actually, UI start auction requires clicking "START AUCTION" button in lobby
    await page.click('button:has-text("START AUCTION")');
    await page.waitForURL(/\/rooms\/[a-zA-Z0-9-]{36}\/auction/);
    console.log('Auction started successfully via UI');
  });

  test('TEST B - ALL (202 players)', async ({ page }) => {
    test.setTimeout(120000);
    console.log('\n--- TEST B: ALL ---');
    await page.goto('http://localhost:3000/rooms/create');
    await page.fill('#room-name', 'Smoke Test B - All');
    
    // Select the default dataset
    await page.getByRole('combobox', { name: 'Select Auction Player Set' }).click();
    await page.getByRole('option', { name: /Official IPL 2026 Dataset/ }).click();
    
    // Make sure FULL SET is selected (it is by default)
    await page.click('button:has-text("FULL SET")');
    
    await page.click('label[for="enable-bots-toggle"]');
    await page.click('#create-room-submit-btn');
    
    await page.waitForURL(/\/rooms\/[a-zA-Z0-9-]{36}/);
    const roomId = page.url().split('/').pop()!;
    console.log(`Room created: ${roomId}`);

    const { data: auction } = await supabase.from('auctions').select('id').eq('room_id', roomId).single();
    const auctionId = auction!.id;
    
    const { data: lots } = await supabase.from('auction_lots').select('id').eq('auction_id', auctionId);
    console.log(`Lots created: ${lots!.length}`);
    expect(lots!.length).toBe(202);
  });

  test('TEST C - BY ROLE (WICKET_KEEPER)', async ({ page }) => {
    test.setTimeout(120000);
    console.log('\n--- TEST C: BY ROLE ---');
    await page.goto('http://localhost:3000/rooms/create');
    await page.fill('#room-name', 'Smoke Test C - Role');
    
    await page.click('button:has-text("BY ROLE")');
    // Unselect all others, or just select WICKET_KEEPER
    // The UI toggles. By default when clicking "BY ROLE", ALL roles are selected.
    // Let's just click 'BATSMAN', 'BOWLER', 'ALL_ROUNDER' to toggle them OFF.
    await page.click('button:has-text("BATSMAN")');
    await page.click('button:has-text("BOWLER")');
    await page.click('button:has-text("ALL ROUNDER")');
    // Only WICKET_KEEPER remains selected.
    
    await page.click('label[for="enable-bots-toggle"]');
    await page.click('#create-room-submit-btn');
    
    await page.waitForURL(/\/rooms\/[a-zA-Z0-9-]{36}/);
    const roomId = page.url().split('/').pop()!;
    console.log(`Room created: ${roomId}`);

    const { data: auction } = await supabase.from('auctions').select('id').eq('room_id', roomId).single();
    const { data: lots } = await supabase.from('auction_lots').select('id, players(role)').eq('auction_id', auction!.id);
    console.log(`Lots created: ${lots!.length}`);
    
    for (const lot of lots!) {
      expect((lot.players as any).role).toBe('WICKET_KEEPER');
    }
  });

  test('TEST D - BACKWARD COMPATIBILITY', async ({ page }) => {
    test.setTimeout(120000);
    console.log('\n--- TEST D: BACKWARD COMPATIBILITY ---');
    
    // Create an authenticated client to call the RPC
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await authClient.auth.signInWithPassword({ email: testUserEmail, password: testUserPassword });
    
    // In UI, FULL SET sends the whole array, not NULL.
    // To test NULL, we must call the RPC directly.
    const { data: roomCodeObj, error } = await authClient.rpc('create_room_with_team', {
      p_room_code: `SMK${Math.floor(Math.random() * 1000)}`,
      p_room_name: 'Smoke Test D - Backward Comp',
      p_room_settings: { "timer_duration_seconds": 15 },
      p_player_set_id: '00000000-0000-0000-0000-000000000202',
      p_team_name: 'Test D',
      p_team_short_name: 'TD',
      p_team_color: '#FFFFFF',
      p_default_purse: 100,
      p_player_ids: null // NULL POOL
    });
    
    if (error) {
      console.error('RPC Error:', error);
      throw new Error(error.message);
    }
    
    console.log(`Room created via RPC: ${roomCodeObj.room_id}`);
    
    const { data: auction } = await supabase.from('auctions').select('id').eq('room_id', roomCodeObj.room_id).single();
    const { data: lots } = await supabase.from('auction_lots').select('id').eq('auction_id', auction!.id);
    
    console.log(`Lots created: ${lots!.length}`);
    expect(lots!.length).toBe(202);
  });
});
