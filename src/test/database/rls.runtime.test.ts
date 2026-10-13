import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Helper to load .env.local variables in Vitest test environment
function getEnv() {
  const envPath = path.resolve(__dirname, '../../../.env.local');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env: Record<string, string> = {};
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        env[trimmed.substring(0, idx).trim()] = trimmed.substring(idx + 1).trim();
      }
    }
  });
  return env;
}

const env = getEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const isConfigured = Boolean(
  supabaseUrl &&
    anonKey &&
    serviceRoleKey &&
    !anonKey.includes('placeholder') &&
    !serviceRoleKey.includes('placeholder')
);

describe.skipIf(!isConfigured)('Phase 2A Runtime Database RLS Verification', () => {
  let adminClient: SupabaseClient;
  let userAClient: SupabaseClient;
  let userBClient: SupabaseClient;

  let userAId: string;
  let userBId: string;
  let roomAId: string;
  let roomBId: string;
  let auctionAId: string;
  let playerSetId: string;
  let playerAId: string;

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false },
    });

    // 1. Create User A and User B via Admin Client
    const userAEmail = `test_usera_${Date.now()}@example.com`;
    const userBEmail = `test_userb_${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    const { data: authA, error: errA } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password,
      email_confirm: true,
      user_metadata: { username: `usera_${Date.now()}`, display_name: 'User A' },
    });
    if (errA || !authA.user) throw new Error(`Failed to create User A: ${errA?.message}`);
    userAId = authA.user.id;

    const { data: authB, error: errB } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password,
      email_confirm: true,
      user_metadata: { username: `userb_${Date.now()}`, display_name: 'User B' },
    });
    if (errB || !authB.user) throw new Error(`Failed to create User B: ${errB?.message}`);
    userBId = authB.user.id;

    // 2. Sign in User A and User B to get authenticated client instances
    userAClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    const { error: signInErrA } = await userAClient.auth.signInWithPassword({ email: userAEmail, password });
    if (signInErrA) throw new Error(`User A sign in failed: ${signInErrA.message}`);

    userBClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    const { error: signInErrB } = await userBClient.auth.signInWithPassword({ email: userBEmail, password });
    if (signInErrB) throw new Error(`User B sign in failed: ${signInErrB.message}`);

    // 3. Setup Seed Data via Admin Client (Room A hosted by User A, Room B hosted by User B)
    const { data: playerSet, error: psErr } = await adminClient
      .from('player_sets')
      .insert({ name: 'Test Set', created_by: userAId, is_public: true })
      .select()
      .single();
    if (psErr || !playerSet) throw new Error(`Player set setup failed: ${psErr?.message}`);
    playerSetId = playerSet.id;

    const { data: player, error: pErr } = await adminClient
      .from('players')
      .insert({ player_set_id: playerSetId, name: 'Player 1', role: 'BATSMAN', category: 'A', base_price: 10 })
      .select()
      .single();
    if (pErr || !player) throw new Error(`Player setup failed: ${pErr?.message}`);
    playerAId = player.id;

    const { data: roomA, error: rAErr } = await adminClient
      .from('rooms')
      .insert({ code: `RA${Math.floor(1000 + Math.random() * 9000)}`, name: 'Room A', host_id: userAId })
      .select()
      .single();
    if (rAErr || !roomA) throw new Error(`Room A setup failed: ${rAErr?.message}`);
    roomAId = roomA.id;

    const { data: roomB, error: rBErr } = await adminClient
      .from('rooms')
      .insert({ code: `RB${Math.floor(1000 + Math.random() * 9000)}`, name: 'Room B', host_id: userBId })
      .select()
      .single();
    if (rBErr || !roomB) throw new Error(`Room B setup failed: ${rBErr?.message}`);
    roomBId = roomB.id;

    // Add User A to Room A, User B to Room B
    await adminClient.from('room_participants').insert([
      { room_id: roomAId, user_id: userAId, role: 'HOST' },
      { room_id: roomBId, user_id: userBId, role: 'HOST' },
    ]);

    // Create Auction A for Room A
    const { data: auctionA, error: aAErr } = await adminClient
      .from('auctions')
      .insert({ room_id: roomAId, player_set_id: playerSetId, status: 'LOBBY' })
      .select()
      .single();
    if (aAErr || !auctionA) throw new Error(`Auction A setup failed: ${aAErr?.message}`);
    auctionAId = auctionA.id;
  });

  afterAll(async () => {
    // Cleanup created test users via Admin Client
    if (adminClient && userAId) await adminClient.auth.admin.deleteUser(userAId);
    if (adminClient && userBId) await adminClient.auth.admin.deleteUser(userBId);
  });

  it('Test 1: User A accesses Room A → ALLOWED', async () => {
    const { data, error } = await userAClient.from('rooms').select('id, name').eq('id', roomAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.name).toBe('Room A');
  });

  it('Test 2: User A attempts to access Room B → DENIED', async () => {
    const { data, error } = await userAClient.from('room_participants').select('*').eq('room_id', roomBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0); // RLS isolates room participants
  });

  it('Test 3: Non-host attempts host-only mutation → DENIED', async () => {
    // User B (non-host of Room A) attempts to update Room A settings
    const { data, error } = await userBClient
      .from('rooms')
      .update({ name: 'Hacked Room A' })
      .eq('id', roomAId)
      .select();
    expect(data).toHaveLength(0); // RLS blocks update by non-host
  });

  it('Test 4: User attempts to mutate another user profile → DENIED', async () => {
    // User A attempts to update User B's profile
    const { data, error } = await userAClient
      .from('profiles')
      .update({ display_name: 'Hacked Profile' })
      .eq('id', userBId)
      .select();
    expect(data).toHaveLength(0); // RLS blocks modifying another user profile
  });

  it('Test 5: Ordinary user attempts direct bot_lot_state mutation → DENIED', async () => {
    // User A attempts to insert directly into bot_lot_state
    const { error } = await userAClient
      .from('bot_lot_state')
      .insert({ lot_id: roomAId, team_id: roomAId, max_per_player_budget: 100 });
    expect(error).not.toBeNull(); // RLS blocks direct client mutation
  });

  it('Test 6: Room participant attempts access to unrelated auction data → DENIED', async () => {
    // User B (participant of Room B, not Room A) attempts to read Auction A
    const { data, error } = await userBClient.from('auctions').select('*').eq('id', auctionAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0); // RLS isolates auction session data
  });

  it('Test 7: Authorized room participant accesses permitted room auction data → ALLOWED', async () => {
    // User A (participant of Room A) reads Auction A
    const { data, error } = await userAClient.from('auctions').select('id, status').eq('id', auctionAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe('LOBBY');
  });
});

describe('Phase 2A Runtime RLS Environment Check', () => {
  it('Reports environment readiness status', () => {
    if (!isConfigured) {
      console.warn('⚠️ Runtime RLS Verification skipped: Supabase local container or Cloud credentials not configured in .env.local.');
    } else {
      console.log('✅ Runtime RLS Environment configured for Supabase Project:', supabaseUrl);
    }
    expect(true).toBe(true);
  });
});
