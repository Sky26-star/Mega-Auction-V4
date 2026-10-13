import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let testUserEmail = `gaptest-${Date.now()}@example.com`;
let testUserPassword = 'password123';

type NarrowAuthClient = ReturnType<typeof createClient> & {
  rpc: (fn: 'create_room_with_team', args: {
    p_room_code: string;
    p_room_name: string;
    p_room_settings: any;
    p_player_set_id: string;
    p_team_name: string;
    p_team_short_name: string;
    p_team_color: string;
    p_default_purse: number;
    p_player_ids: string[] | null;
  }) => Promise<{ data: { room_id: string } | null; error: any }>;
};

let authClient: NarrowAuthClient;

test.beforeAll(async () => {
  const { data, error } = await supabase.auth.admin.createUser({
    email: testUserEmail,
    password: testUserPassword,
    email_confirm: true,
    user_metadata: { display_name: `GapTest_${Date.now()}`, username: `gaptest_${Date.now()}` }
  });
  if (error) console.error('Failed to create test user:', error);
  
  authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ) as NarrowAuthClient;
  await authClient.auth.signInWithPassword({ email: testUserEmail, password: testUserPassword });
});

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:3000/login');
  await page.fill('#login-email', testUserEmail);
  await page.fill('#login-password', testUserPassword);
  await page.click('button:has-text("ENTER AUCTION ARENA"), #login-submit-btn');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
});

test.describe('Room Pool Gap Validation', () => {

  test('TEST 1 - ALL MODE COUNT', async ({ page }) => {
    console.log('\n--- TEST 1: ALL MODE COUNT ---');
    await page.goto('http://localhost:3000/rooms/create');
    await page.waitForSelector('button:has-text("FULL SET")');
    await page.click('button:has-text("FULL SET")');
    await page.waitForSelector('text=Loading player pool...', { state: 'hidden' });
    
    // Check if there is an explicit select for N
    const countInputs = await page.locator('div').filter({ hasText: 'Select Player Count' }).locator('select').count();
    if (countInputs === 0) {
      console.log('EVIDENCE: ALL mode currently selects entire player set; no N selection control exists.');
      throw new Error('No count selection control in ALL mode');
    }
  });

  test('TEST 2 - CATEGORY MODE COUNT', async ({ page }) => {
    console.log('\n--- TEST 2: CATEGORY MODE COUNT ---');
    await page.goto('http://localhost:3000/rooms/create');
    await page.click('button:has-text("BY CATEGORY")');
    
    // Check if categories are dynamic (loaded buttons)
    const categoryButtons = await page.locator('button:has-text("Category")').count();
    console.log(`EVIDENCE: Available categories loaded: ${categoryButtons > 0}`);
    
    // Check for N selection per category or overall
    const countInputs = await page.locator('div').filter({ hasText: 'Select Player Count' }).locator('select').count();
    if (countInputs === 0) {
      console.log('EVIDENCE: No N selection control exists in CATEGORY mode.');
      throw new Error('No count selection control in CATEGORY mode');
    }
  });

  test('TEST 3 - ROLE MODE COUNT', async ({ page }) => {
    console.log('\n--- TEST 3: ROLE MODE COUNT ---');
    await page.goto('http://localhost:3000/rooms/create');
    await page.click('button:has-text("BY ROLE")');
    
    // Check if roles are dynamic (e.g. BATSMAN, BOWLER)
    const roleButtons = await page.locator('button:has-text("BATSMAN")').count();
    console.log(`EVIDENCE: Available roles loaded: ${roleButtons > 0}`);
    
    const countInputs = await page.locator('div').filter({ hasText: 'Select Player Count' }).locator('select').count();
    if (countInputs === 0) {
      console.log('EVIDENCE: No N selection control exists in ROLE mode.');
      throw new Error('No count selection control in ROLE mode');
    }
  });

  test('TEST 4 - MANUAL FILTERS', async ({ page }) => {
    console.log('\n--- TEST 4: MANUAL FILTERS ---');
    await page.goto('http://localhost:3000/rooms/create');
    await page.click('button:has-text("MANUAL SELECT")');
    await page.waitForSelector('text=Loading player pool...', { state: 'hidden' });
    
    const hasSearch = await page.locator('input[placeholder*="Search"]').isVisible();
    const hasRoleFilter = await page.locator('select:has(option[value="ALL"]:has-text("Role"))').isVisible();
    const hasCategoryFilter = await page.locator('select:has(option[value="ALL"]:has-text("Category"))').isVisible();
    
    console.log(`EVIDENCE: Search exists: ${hasSearch}`);
    console.log(`EVIDENCE: Role filter exists: ${hasRoleFilter}`);
    console.log(`EVIDENCE: Category filter exists: ${hasCategoryFilter}`);
    
    if (!hasRoleFilter || !hasCategoryFilter) {
      throw new Error('Missing role or category filters in MANUAL mode');
    }
  });

  test('TEST 5 - BOT POOL ISOLATION', async ({ page }) => {
    console.log('\n--- TEST 5: BOT POOL ISOLATION ---');
    // Using RPC to create a room with bots + 5 players
    const { data: players } = await supabase.from('players').select('id').eq('player_set_id', '00000000-0000-0000-0000-000000000202').limit(5);
    if (!players) throw new Error('No players found');
    const pIds = players.map(p => p.id);
    
    const { data: roomCodeObj, error } = await authClient.rpc('create_room_with_team', {
      p_room_code: `BOT${Math.floor(Math.random() * 1000)}`,
      p_room_name: 'Bot Isolation Test',
      p_room_settings: { "timer_duration_seconds": 15, "bot_count": 3 },
      p_player_set_id: '00000000-0000-0000-0000-000000000202',
      p_team_name: 'Host Team',
      p_team_short_name: 'HT',
      p_team_color: '#FFFFFF',
      p_default_purse: 100,
      p_player_ids: pIds
    });
    
    if (error) {
      throw new Error(error.message);
    }
    if (!roomCodeObj) {
      throw new Error('create_room_with_team returned no room data');
    }
    
    const roomId = roomCodeObj.room_id;
    
    const { data: auction } = await supabase.from('auctions').select('id').eq('room_id', roomId).single();
    if (!auction) throw new Error('No auction found');
    
    const { data: lots } = await supabase.from('auction_lots').select('id, player_id').eq('auction_id', auction.id);
    if (!lots) throw new Error('No lots found');
    
    console.log(`EVIDENCE: Created ${lots.length} lots for bot isolation test.`);
    // Do not claim isolation is proven by lot count alone
    // expect(lots.length).toBe(5);
    
    // Inspect future candidates via runtime code is not safe/straightforward in Playwright without code changes
    // Reporting NOT_VERIFIED for candidate extraction part
    console.log('EVIDENCE: Bot runtime candidate inspection without code changes: NOT_VERIFIED');
  });

  test('TEST 6 - POOL IMMUTABILITY', async ({ page }) => {
    console.log('\n--- TEST 6: POOL IMMUTABILITY ---');
    const { data: players } = await supabase.from('players').select('id').eq('player_set_id', '00000000-0000-0000-0000-000000000202').limit(5);
    if (!players) throw new Error('No players found');
    const pIds = players.map(p => p.id);
    
    const { data: roomCodeObj, error } = await authClient.rpc('create_room_with_team', {
      p_room_code: `IMM${Math.floor(Math.random() * 1000)}`,
      p_room_name: 'Immutability Test',
      p_room_settings: { "timer_duration_seconds": 15 },
      p_player_set_id: '00000000-0000-0000-0000-000000000202',
      p_team_name: 'Host Team',
      p_team_short_name: 'HT',
      p_team_color: '#FFFFFF',
      p_default_purse: 100,
      p_player_ids: pIds
    });
    
    if (error) {
      throw new Error(error.message);
    }
    if (!roomCodeObj) {
      throw new Error('create_room_with_team returned no room data');
    }
    
    const roomId = roomCodeObj.room_id;
    const { data: auction } = await supabase.from('auctions').select('id').eq('room_id', roomId).single();
    if (!auction) throw new Error('No auction found');
    
    const { data: beforeLots } = await supabase.from('auction_lots').select('id').eq('auction_id', auction.id);
    if (!beforeLots) throw new Error('No beforeLots found');
    expect(beforeLots.length).toBe(5);
    console.log('EVIDENCE: 5 lots exist before auction.');
    
    await page.goto(`http://localhost:3000/rooms/${roomId}`);
    await page.click('button:has-text("START AUCTION")');
    await page.waitForURL(/\/rooms\/[a-zA-Z0-9-]{36}\/auction/);
    
    const { data: afterLots } = await supabase.from('auction_lots').select('id').eq('auction_id', auction.id);
    if (!afterLots) throw new Error('No afterLots found');
    expect(afterLots.length).toBe(5);
    console.log('EVIDENCE: 5 lots exist after auction started.');
    
    // UI doesn't have an 'Add players' button in active auction
    const hasAddPlayers = await page.locator('button:has-text("Add players")').isVisible();
    console.log(`EVIDENCE: Can pool be changed via UI after start? ${hasAddPlayers}`);
  });

  test('TEST 7 - INVALID / DUPLICATE PLAYER IDs', async () => {
    console.log('\n--- TEST 7: INVALID / DUPLICATE PLAYER IDs ---');
    
    const { count: initRooms } = await supabase.from('rooms').select('*', { count: 'exact', head: true });
    const { count: initAuctions } = await supabase.from('auctions').select('*', { count: 'exact', head: true });
    const { count: initLots } = await supabase.from('auction_lots').select('*', { count: 'exact', head: true });

    const { data: players } = await supabase.from('players').select('id').eq('player_set_id', '00000000-0000-0000-0000-000000000202').limit(5);
    if (!players || players.length < 5) throw new Error('Not enough players found');
    const pIds = players.map(p => p.id);
    
    // Case A: Duplicate IDs
    const duplicatePIds = [pIds[0], pIds[1], pIds[2], pIds[3], pIds[4], pIds[0]];
    const { error: errA } = await authClient.rpc('create_room_with_team', {
      p_room_code: `DUP${Math.floor(Math.random() * 1000)}`,
      p_room_name: 'Duplicate Test',
      p_room_settings: { "timer_duration_seconds": 15 },
      p_player_set_id: '00000000-0000-0000-0000-000000000202',
      p_team_name: 'Test',
      p_team_short_name: 'TT',
      p_team_color: '#FFFFFF',
      p_default_purse: 100,
      p_player_ids: duplicatePIds
    });
    
    console.log(`EVIDENCE: Case A (Duplicate) rejected: ${!!errA}`);
    
    const { count: midRooms } = await supabase.from('rooms').select('*', { count: 'exact', head: true });
    const { count: midAuctions } = await supabase.from('auctions').select('*', { count: 'exact', head: true });
    const { count: midLots } = await supabase.from('auction_lots').select('*', { count: 'exact', head: true });
    
    expect(midRooms).toBe(initRooms);
    expect(midAuctions).toBe(initAuctions);
    expect(midLots).toBe(initLots);

    // Case B: Non-existent UUID
    const invalidPIds = [pIds[0], pIds[1], pIds[2], pIds[3], '11111111-1111-4111-a111-111111111111'];
    const { error: errB } = await authClient.rpc('create_room_with_team', {
      p_room_code: `INV${Math.floor(Math.random() * 1000)}`,
      p_room_name: 'Invalid Test',
      p_room_settings: { "timer_duration_seconds": 15 },
      p_player_set_id: '00000000-0000-0000-0000-000000000202',
      p_team_name: 'Test',
      p_team_short_name: 'TT',
      p_team_color: '#FFFFFF',
      p_default_purse: 100,
      p_player_ids: invalidPIds
    });
    
    console.log(`EVIDENCE: Case B (Invalid UUID) rejected: ${!!errB}`);
    
    const { count: endRooms } = await supabase.from('rooms').select('*', { count: 'exact', head: true });
    const { count: endAuctions } = await supabase.from('auctions').select('*', { count: 'exact', head: true });
    const { count: endLots } = await supabase.from('auction_lots').select('*', { count: 'exact', head: true });

    expect(endRooms).toBe(initRooms);
    expect(endAuctions).toBe(initAuctions);
    expect(endLots).toBe(initLots);
    
    if (!errA || !errB) {
      throw new Error('Failed to reject duplicate/invalid UUIDs');
    }
  });

});
