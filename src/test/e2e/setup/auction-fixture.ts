import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import './e2e-target-guard';

const supabaseUrl = process.env.SUPABASE_TEST_URL!;
const supabaseAnonKey = process.env.SUPABASE_TEST_ANON_KEY!;

/**
 * Creates a standard authenticated Supabase client for a disposable test user.
 * 
 * 1. Generates a unique UUID and dummy email.
 * 2. Uses standard auth.signUp() to create the identity.
 * 3. Returns the authenticated client and the user info.
 */
export async function createDisposableTestUser() {
  const supabase = createClient(supabaseUrl, supabaseAnonKey!);
  const runId = crypto.randomUUID();
  const testEmail = `test_fixture_${runId}@example.com`;
  const testPassword = `Pass_${runId}!`;

  const { data, error } = await supabase.auth.signUp({
    email: testEmail,
    password: testPassword,
  });

  if (error) {
    throw new Error(`Failed to create disposable test user: ${error.message}`);
  }

  if (!data.session) {
    throw new Error('SignUp succeeded but returned no session. Local Supabase must have email confirmation disabled.');
  }

  if (!data.user) {
    throw new Error('SignUp succeeded but returned no user.');
  }

  return {
    supabase, // Now authenticated as the dummy user
    user: data.user,
    session: data.session,
    runId,
  };
}

/**
 * Bounded Test Player Set for Phase 13A Lifecycle Validation.
 * 
 * Creates a private, disposable player_set with exactly 3 carefully designed
 * test players using standard authenticated Supabase API calls.
 * 
 * Player Design Rationale (based on bot-valuation-engine.ts analysis):
 * - Players have NO statistics → computePlayerRating returns 74 (minimum).
 * - normalizedRating = max(0, (74 - 74) / 24) = 0.
 * - basePremium = pow(0, 1.8) * 1600 = 0.
 * - playerValue = base_price + 0 = base_price.
 * - With fresh bot (roleNeed=CRITICAL, multiplier=1.5), scarcity, pacing:
 *   targetValue ≈ base_price * ~2.3x.
 * - This ensures bots exhaust their valuation ceiling within 1-3 bids.
 * 
 * RLS Authorization:
 * - player_sets: "Users can create player sets" → created_by = auth.uid()
 * - players: "Player set owner can modify players" → player_set_id owned by auth.uid()
 * 
 * No Service Role. No schema changes. No migrations.
 */
export async function createBoundedTestPlayerSet(supabase: any) {
  // 1. Get authenticated user ID
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Cannot create bounded player set: no authenticated user');
  }

  const playerSetId = crypto.randomUUID();

  // 2. Create player_set (authenticated owner)
  const { error: psError } = await supabase
    .from('player_sets')
    .insert({
      id: playerSetId,
      name: `Phase13A Bounded Test Set ${playerSetId.substring(0, 8)}`,
      description: 'Disposable test-only player set for Phase 13A lifecycle validation',
      created_by: user.id,
      is_public: false,
    });

  if (psError) {
    throw new Error(`Failed to create bounded player_set: ${psError.message}`);
  }

  // 3. Verify player_set exists
  const { data: psCheck, error: psCheckErr } = await supabase
    .from('player_sets')
    .select('id')
    .eq('id', playerSetId)
    .single();

  if (psCheckErr || !psCheck) {
    // Cleanup on verification failure
    await supabase.from('player_sets').delete().eq('id', playerSetId);
    throw new Error(`Bounded player_set verification failed: ${psCheckErr?.message || 'not found'}`);
  }

  // 4. Insert exactly 3 bounded test players
  //
  // Player 1: "Test Alpha" — Low-value domestic BATSMAN
  //   - base_price: 100 (Lakhs), category: D, is_overseas: false
  //   - Bot targetValue ≈ 100 * 2.3 = ~230L. Bot stops bidding around 225-250L.
  //   - Human can outbid at ~250L to trigger SOLD.
  //   - No stats → rating 74 → zero premium.
  //
  // Player 2: "Test Beta" — Overseas BOWLER
  //   - base_price: 100 (Lakhs), category: D, is_overseas: true
  //   - Used for overseas constraint testing.
  //   - Similar valuation ceiling to Player 1.
  //
  // Player 3: "Test Gamma" — High base price domestic ALL_ROUNDER
  //   - base_price: 2000 (Lakhs), category: D, is_overseas: false
  //   - With constrained purse (e.g., 500L), base_price > purse → zero bids → UNSOLD.
  //   - With normal purse, tests high-base-price behavior.
  //
  const testPlayers = [
    {
      id: crypto.randomUUID(),
      player_set_id: playerSetId,
      name: 'Test Alpha',
      role: 'BATSMAN',
      category: 'D',
      base_price: 100,
      is_overseas: false,
      country: 'India',
    },
    {
      id: crypto.randomUUID(),
      player_set_id: playerSetId,
      name: 'Test Beta',
      role: 'BOWLER',
      category: 'D',
      base_price: 100,
      is_overseas: true,
      country: 'England',
    },
    {
      id: crypto.randomUUID(),
      player_set_id: playerSetId,
      name: 'Test Gamma',
      role: 'ALL_ROUNDER',
      category: 'D',
      base_price: 2000,
      is_overseas: false,
      country: 'India',
    },
  ];

  const { error: playersError } = await supabase
    .from('players')
    .insert(testPlayers);

  if (playersError) {
    // Cleanup player_set on player insertion failure
    await supabase.from('player_sets').delete().eq('id', playerSetId);
    throw new Error(`Failed to insert bounded test players: ${playersError.message}`);
  }

  // 5. Verify player count
  const { data: playerCheck, error: playerCheckErr } = await supabase
    .from('players')
    .select('id')
    .eq('player_set_id', playerSetId);

  if (playerCheckErr || !playerCheck || playerCheck.length !== 3) {
    // Cleanup on verification failure
    await supabase.from('players').delete().eq('player_set_id', playerSetId);
    await supabase.from('player_sets').delete().eq('id', playerSetId);
    throw new Error(`Bounded player count verification failed: expected 3, got ${playerCheck?.length || 0}`);
  }

  return {
    playerSetId,
    playerIds: testPlayers.map(p => p.id),
    players: testPlayers,
  };
}

/**
 * Creates a bounded 5-player set specifically for Phase 13B validation.
 * Designed to create meaningful budget depletion and competitive escalation.
 * 
 * Players:
 * 1. B1 - High value BATSMAN (base 200) -> drains purses
 * 2. B2 - High value BOWLER (base 200) -> tests cascade yield
 * 3. B3 - Mid value ALL_ROUNDER (base 100) -> tests remaining purse competition
 * 4. B4 - Overseas BATSMAN (base 100) -> tests overseas constraints
 * 5. B5 - High base price UNSOLD bait (base 2000) -> tests complete exhaustion
 */
export async function createPhase13BTestPlayerSet(supabase: any, runId?: string) {
  // 1. Get authenticated user ID
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Cannot create bounded player set: no authenticated user');
  }

  const playerSetId = crypto.randomUUID();

  const { error: psError } = await supabase
    .from('player_sets')
    .insert({
      id: playerSetId,
      name: `Phase 13B Test Set ${Date.now()}`,
      description: 'Disposable test-only player set for Phase 13B validation',
      created_by: user.id,
      is_public: false,
    });

  if (psError) {
    throw new Error(`Failed to create bounded 13B player_set: ${psError.message}`);
  }

  const testPlayers = [
    {
      id: crypto.randomUUID(),
      player_set_id: playerSetId,
      name: 'P13B Alpha',
      role: 'BATSMAN',
      category: 'C',
      base_price: 200,
      is_overseas: false,
      country: 'India',
      matches: 50,
      runs: 1500,
      batting_average: 32.0,
      strike_rate: 140.0,
      hundreds: 0,
      fifties: 10,
      highest_score: 90,
      boundaries: 200,
    },
    {
      id: crypto.randomUUID(),
      player_set_id: playerSetId,
      name: 'P13B Beta',
      role: 'BOWLER',
      category: 'C',
      base_price: 200,
      is_overseas: false,
      country: 'India',
      matches: 50,
      runs: 1500,
      batting_average: 32.0,
      strike_rate: 140.0,
      hundreds: 0,
      fifties: 10,
      highest_score: 90,
      boundaries: 200,
    },
    {
      id: crypto.randomUUID(),
      player_set_id: playerSetId,
      name: 'P13B Gamma',
      role: 'ALL_ROUNDER',
      category: 'D',
      base_price: 100,
      is_overseas: false,
      country: 'India',
      matches: 50,
      runs: 1500,
      batting_average: 32.0,
      strike_rate: 140.0,
      hundreds: 0,
      fifties: 10,
      highest_score: 90,
      boundaries: 200,
    },
    {
      id: crypto.randomUUID(),
      player_set_id: playerSetId,
      name: 'P13B Delta',
      role: 'BATSMAN',
      category: 'D',
      base_price: 100,
      is_overseas: true,
      country: 'England',
      matches: 50,
      runs: 1500,
      batting_average: 32.0,
      strike_rate: 140.0,
      hundreds: 0,
      fifties: 10,
      highest_score: 90,
      boundaries: 200,
    },
    {
      id: crypto.randomUUID(),
      player_set_id: playerSetId,
      name: 'P13B Epsilon',
      role: 'ALL_ROUNDER',
      category: 'C',
      base_price: 2000,
      is_overseas: false,
      country: 'India',
      matches: 50,
      runs: 1500,
      batting_average: 32.0,
      strike_rate: 140.0,
      hundreds: 0,
      fifties: 10,
      highest_score: 90,
      boundaries: 200,
    },
  ];

  const { error: playersError } = await supabase
    .from('players')
    .insert(testPlayers);

  if (playersError) {
    await supabase.from('player_sets').delete().eq('id', playerSetId);
    throw new Error(`Failed to insert bounded test players 13B: ${playersError.message}`);
  }

  const { data: playerCheck, error: playerCheckErr } = await supabase
    .from('players')
    .select('id')
    .eq('player_set_id', playerSetId);

  if (playerCheckErr || !playerCheck || playerCheck.length !== 5) {
    await supabase.from('players').delete().eq('player_set_id', playerSetId);
    await supabase.from('player_sets').delete().eq('id', playerSetId);
    throw new Error(`Bounded 13B player count verification failed: expected 5, got ${playerCheck?.length || 0}`);
  }

  return {
    playerSetId,
    playerIds: testPlayers.map(p => p.id),
    players: testPlayers,
  };
}

/**
 * Cleanup a bounded test player set and all its players.
 * 
 * IMPORTANT: This must be called AFTER delete_room has removed all auctions,
 * lots, and bids referencing these players. The FK constraint on auction_lots
 * is ON DELETE RESTRICT, so the player_set cannot be deleted while referenced.
 * 
 * Cleanup order:
 * 1. Delete players (cascaded by player_set FK ON DELETE CASCADE)
 * 2. Delete player_set
 * 3. Verify absence
 */
export async function cleanupBoundedTestPlayerSet(supabase: any, playerSetId: string) {
  // player_sets.id → players.player_set_id has ON DELETE CASCADE
  // So deleting the player_set cascades to players.
  const { error } = await supabase
    .from('player_sets')
    .delete()
    .eq('id', playerSetId);

  if (error) {
    console.warn(`Warning: Failed to cleanup bounded player_set ${playerSetId}: ${error.message}`);
    return { success: false, error: error.message };
  }

  // Verify absence
  const { data: psCheck } = await supabase
    .from('player_sets')
    .select('id')
    .eq('id', playerSetId)
    .maybeSingle();

  const { data: playerCheck } = await supabase
    .from('players')
    .select('id')
    .eq('player_set_id', playerSetId);

  return {
    success: true,
    playerSetAbsent: psCheck === null,
    playersAbsent: !playerCheck || playerCheck.length === 0,
  };
}

/**
 * Creates a safe, isolated disposable integration-test auction.
 * 
 * Flow:
 * 1. Generate unique room code.
 * 2. Call create_room_with_team RPC as the authenticated user.
 * 3. Call provision_room_bots RPC.
 * 
 * @param supabase Authenticated Supabase client
 * @param runId Unique run identifier for naming
 * @param options Optional overrides for playerSetId and roomSettings
 */
export async function setupDisposableAuction(
  supabase: any,
  runId: string,
  options?: {
    playerSetId?: string;
    roomSettings?: Record<string, any>;
    defaultPurse?: number;
  }
) {
  // 6 char code
  const roomCode = `T${runId.substring(0, 5).toUpperCase()}`;
  
  const roomSettings = {
    timer_duration_seconds: 15,
    min_bid_increment: 50,
    default_purse: options?.roomSettings?.default_purse ?? 10000,
    max_squad_size: options?.roomSettings?.max_squad_size ?? 15,
    max_overseas: options?.roomSettings?.max_overseas ?? 8,
    bot_count: 3,
    bot_difficulty: 'Balanced',
    // Merge any additional settings
    ...(options?.roomSettings || {}),
  };

  // Use provided player set or the official IPL 2026 dataset
  const playerSetId = options?.playerSetId || '00000000-0000-0000-0000-000000000202';

  // Host purse in Lakhs
  const defaultPurse = options?.defaultPurse ?? 10000;

  // 1. Create Room & Auction via RPC
  const { data: createData, error: createError } = await supabase.rpc('create_room_with_team', {
    p_room_code: roomCode,
    p_room_name: `Integration Test ${roomCode}`,
    p_room_settings: roomSettings,
    p_player_set_id: playerSetId,
    p_team_name: `Test Host ${roomCode}`,
    p_team_short_name: `TH${roomCode.substring(0, 2)}`, // max 5 chars
    p_team_color: '#B8322E',
    p_default_purse: defaultPurse
  });

  if (createError) {
    throw new Error(`Failed to create room with team: ${createError.message}`);
  }

  const { room_id, auction_id, team_id } = createData;

  // 2. Provision bots (Simulation of bot provisioning step)
  const botsPayload = [
    { id: 'bot-1', name: 'Bot Mumbai', shortName: 'BM', color: '#004BA0', managerName: 'AI Mumbai' },
    { id: 'bot-2', name: 'Bot Delhi', shortName: 'BD', color: '#0000FF', managerName: 'AI Delhi' },
    { id: 'bot-3', name: 'Bot Bangalore', shortName: 'BB', color: '#FF0000', managerName: 'AI Bangalore' },
  ];

  const { error: botError } = await supabase.rpc('provision_room_bots', {
    p_room_id: room_id,
    p_bots: botsPayload,
  });

  if (botError) {
    // Partial setup failure: Room was created, but bots failed.
    // Clean up the room so it doesn't leak.
    await supabase.rpc('delete_room', { p_room_id: room_id });
    throw new Error(`Failed to provision bots: ${botError.message} (Room ${room_id} was cleaned up)`);
  }

  return {
    roomId: room_id,
    auctionId: auction_id,
    hostTeamId: team_id,
    roomCode
  };
}

/**
 * Cleans up the disposable test auction by invoking the existing delete_room RPC.
 * This triggers Postgres ON DELETE CASCADE to remove teams, lots, and the auction.
 * 
 * @param supabase Authenticated Supabase client (as Host)
 * @param roomId Room ID to delete
 */
export async function cleanupDisposableAuction(supabase: any, roomId: string) {
  const { data, error } = await supabase.rpc('delete_room', {
    p_room_id: roomId
  });

  if (error) {
    throw new Error(`Failed to cleanup disposable room: ${error.message}`);
  }
  return data;
}
