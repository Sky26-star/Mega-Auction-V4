import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { formatIsolatedTarget, resolveIsolatedRlsConfig } from './runtime-test-config';

const isolatedConfig = resolveIsolatedRlsConfig(process.env);
const supabaseUrl = isolatedConfig?.url;
const anonKey = isolatedConfig?.anonKey;
const serviceRoleKey = isolatedConfig?.serviceRoleKey;
const isConfigured = isolatedConfig !== null;

async function runCleanupStep(
  failures: string[],
  label: string,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isMissingAuthUserError(error: { status?: number; code?: string }): boolean {
  return error.status === 404 || error.code === 'user_not_found';
}

async function cleanupFixture(
  adminClient: SupabaseClient | undefined,
  fixture: {
    roomAId?: string;
    roomBId?: string;
    createdRoomId?: string;
    userAId?: string;
    userBId?: string;
    userCId?: string;
    auctionAId?: string;
    createdAuctionId?: string;
    playerAId?: string;
    playerSetId?: string;
  }
): Promise<void> {
  const failures: string[] = [];
  const {
    roomAId,
    roomBId,
    createdRoomId,
    userAId,
    userBId,
    userCId,
    auctionAId,
    createdAuctionId,
    playerAId,
    playerSetId,
  } = fixture;
  const roomIds = [roomAId, roomBId, createdRoomId].filter((id): id is string => Boolean(id));
  const auctionIds = [auctionAId, createdAuctionId].filter((id): id is string => Boolean(id));
  const userIds = [userAId, userBId, userCId].filter((id): id is string => Boolean(id));

  if (!adminClient) {
    if (roomIds.length || userIds.length || auctionIds.length || playerAId || playerSetId) {
      throw new Error('RLS fixture cleanup could not run because the admin client was not initialized.');
    }
    return;
  }

  // Remove dependent records before their parents. Row deletions by captured ID
  // are idempotent; the service client bypasses ordinary-user RLS policies.
  // Participants must be removed before auctions because a created host
  // participant references its team, and teams are removed with the auction.
  if (roomIds.length) {
    await runCleanupStep(failures, 'room participants', async () => {
      const { error } = await adminClient.from('room_participants').delete().in('room_id', roomIds);
      if (error) throw new Error(error.message);
    });
  }

  for (const auctionId of auctionIds) {
    await runCleanupStep(failures, `auction ${auctionId}`, async () => {
      const { error } = await adminClient.from('auctions').delete().eq('id', auctionId);
      if (error) throw new Error(error.message);
    });
  }

  if (roomIds.length) {
    await runCleanupStep(failures, 'rooms', async () => {
      const { error } = await adminClient.from('rooms').delete().in('id', roomIds);
      if (error) throw new Error(error.message);
    });
  }

  if (playerAId) {
    await runCleanupStep(failures, 'player', async () => {
      const { error } = await adminClient.from('players').delete().eq('id', playerAId);
      if (error) throw new Error(error.message);
    });
  }

  if (playerSetId) {
    await runCleanupStep(failures, 'player set', async () => {
      const { error } = await adminClient.from('player_sets').delete().eq('id', playerSetId);
      if (error) throw new Error(error.message);
    });
  }

  if (userIds.length) {
    await runCleanupStep(failures, 'test profiles', async () => {
      const { error } = await adminClient.from('profiles').delete().in('id', userIds);
      if (error) throw new Error(error.message);
    });
  }

  for (const userId of userIds) {
    await runCleanupStep(failures, `auth user ${userId}`, async () => {
      const { data, error: lookupError } = await adminClient.auth.admin.getUserById(userId);
      if (lookupError) {
        if (isMissingAuthUserError(lookupError)) return;
        throw new Error(lookupError.message);
      }
      if (!data.user) return;

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
      if (deleteError && !isMissingAuthUserError(deleteError)) {
        throw new Error(deleteError.message);
      }
    });
  }

  if (failures.length) {
    throw new Error(`RLS fixture cleanup failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  }
}

describe.skipIf(!isConfigured)('Phase 2A Runtime Database RLS Verification', () => {
  let adminClient: SupabaseClient;
  let userAClient: SupabaseClient;
  let userBClient: SupabaseClient;
  let userCClient: SupabaseClient;

  let userAId: string;
  let userBId: string;
  let userCId: string;
  let createdRoomId: string | undefined;
  let roomAId: string;
  let roomBId: string;
  let roomACode: string;
  let roomBCode: string;
  let auctionAId: string;
  let createdAuctionId: string | undefined;
  let playerSetId: string;
  let playerAId: string;

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false },
    });

    // 1. Create User A and User B via Admin Client
    const userAEmail = `test_usera_${Date.now()}@example.com`;
    const userBEmail = `test_userb_${Date.now()}@example.com`;
    const userCEmail = `test_userc_${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    const { data: authA, error: errA } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password,
      email_confirm: true,
      user_metadata: { username: `usera_${Date.now()}`, display_name: 'User A' },
    });
    if (authA?.user) userAId = authA.user.id;
    if (errA || !authA?.user) throw new Error(`Failed to create User A: ${errA?.message}`);

    const { data: authB, error: errB } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password,
      email_confirm: true,
      user_metadata: { username: `userb_${Date.now()}`, display_name: 'User B' },
    });
    if (authB?.user) userBId = authB.user.id;
    if (errB || !authB?.user) throw new Error(`Failed to create User B: ${errB?.message}`);

    const { data: authC, error: errC } = await adminClient.auth.admin.createUser({
      email: userCEmail,
      password,
      email_confirm: true,
      user_metadata: { username: `userc_${Date.now()}`, display_name: 'User C' },
    });
    if (authC?.user) userCId = authC.user.id;
    if (errC || !authC?.user) throw new Error(`Failed to create User C: ${errC?.message}`);

    // 2. Sign in all three users to get authenticated client instances.
    userAClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    const { error: signInErrA } = await userAClient.auth.signInWithPassword({ email: userAEmail, password });
    if (signInErrA) throw new Error(`User A sign in failed: ${signInErrA.message}`);

    userBClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    const { error: signInErrB } = await userBClient.auth.signInWithPassword({ email: userBEmail, password });
    if (signInErrB) throw new Error(`User B sign in failed: ${signInErrB.message}`);

    userCClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    const { error: signInErrC } = await userCClient.auth.signInWithPassword({ email: userCEmail, password });
    if (signInErrC) throw new Error(`User C sign in failed: ${signInErrC.message}`);

    // 3. Setup Seed Data via Admin Client (Room A hosted by User A, Room B hosted by User B)
    const { data: playerSet, error: psErr } = await adminClient
      .from('player_sets')
      .insert({ name: 'Test Set', created_by: userAId, is_public: true })
      .select()
      .single();
    if (playerSet) playerSetId = playerSet.id;
    if (psErr || !playerSet) throw new Error(`Player set setup failed: ${psErr?.message}`);

    const { data: player, error: pErr } = await adminClient
      .from('players')
      .insert({ player_set_id: playerSetId, name: 'Player 1', role: 'BATSMAN', category: 'A', base_price: 10 })
      .select()
      .single();
    if (player) playerAId = player.id;
    if (pErr || !player) throw new Error(`Player setup failed: ${pErr?.message}`);

    const { data: roomA, error: rAErr } = await adminClient
      .from('rooms')
      .insert({ code: `RA${Math.floor(1000 + Math.random() * 9000)}`, name: 'Room A', host_id: userAId })
      .select()
      .single();
    if (roomA) roomAId = roomA.id;
    if (roomA) roomACode = roomA.code;
    if (rAErr || !roomA) throw new Error(`Room A setup failed: ${rAErr?.message}`);

    const { data: roomB, error: rBErr } = await adminClient
      .from('rooms')
      .insert({ code: `RB${Math.floor(1000 + Math.random() * 9000)}`, name: 'Room B', host_id: userBId })
      .select()
      .single();
    if (roomB) roomBId = roomB.id;
    if (roomB) roomBCode = roomB.code;
    if (rBErr || !roomB) throw new Error(`Room B setup failed: ${rBErr?.message}`);

    // Add User A and User B to Room A; User B also hosts Room B.
    const { error: participantError } = await adminClient.from('room_participants').insert([
      { room_id: roomAId, user_id: userAId, role: 'HOST' },
      { room_id: roomAId, user_id: userBId, role: 'MEMBER' },
      { room_id: roomBId, user_id: userBId, role: 'HOST' },
    ]);
    if (participantError) throw new Error(`Participant setup failed: ${participantError.message}`);

    // Create Auction A for Room A
    const { data: auctionA, error: aAErr } = await adminClient
      .from('auctions')
      .insert({ room_id: roomAId, player_set_id: playerSetId, status: 'LOBBY' })
      .select()
      .single();
    if (auctionA) auctionAId = auctionA.id;
    if (aAErr || !auctionA) throw new Error(`Auction A setup failed: ${aAErr?.message}`);
  });

  afterAll(async () => {
    await cleanupFixture(adminClient, {
      roomAId,
      roomBId,
      createdRoomId,
      userAId,
      userBId,
      userCId,
      auctionAId,
      createdAuctionId,
      playerAId,
      playerSetId,
    });
  });

  it('Test 1: User A accesses Room A → ALLOWED', async () => {
    const { data, error } = await userAClient.from('rooms').select('id, name').eq('id', roomAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.name).toBe('Room A');
  });

  it('Test 2: User A attempts to access Room B → DENIED', async () => {
    const { data: unauthorizedRooms, error: roomError } = await userAClient
      .from('rooms')
      .select('id, name')
      .eq('id', roomBId);
    expect(roomError).toBeNull();
    expect(unauthorizedRooms).toHaveLength(0);

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
    // Check the permitted projection only: SELECT * would include columns that
    // ordinary users are deliberately not allowed to read (such as is_admin).
    const { data: before, error: beforeError } = await adminClient
      .from('profiles')
      .select('id, display_name')
      .eq('id', userBId)
      .single();
    expect(beforeError).toBeNull();

    // User A attempts to update User B's permitted display field.
    const { data, error } = await userAClient
      .from('profiles')
      .update({ display_name: 'Hacked Profile' })
      .eq('id', userBId)
      .select('id, display_name');
    expect(error?.code ?? null).toBeNull();
    expect(data).toEqual([]); // RLS filters out another user's profile row

    const { data: after, error: afterError } = await adminClient
      .from('profiles')
      .select('id, display_name')
      .eq('id', userBId)
      .single();
    expect(afterError).toBeNull();
    expect(after?.display_name).toBe(before?.display_name);
  });

  it('Profile privacy: user can read their own permitted profile fields', async () => {
    const { data, error } = await userAClient
      .from('profiles')
      .select('id, username, display_name, avatar_url, created_at, updated_at')
      .eq('id', userAId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(userAId);
    expect(data?.[0]).not.toHaveProperty('is_admin');
  });

  it('Profile privacy: user can update permitted fields on their own profile', async () => {
    const { data, error } = await userAClient
      .from('profiles')
      .update({ display_name: 'User A' })
      .eq('id', userAId)
      .select('id, display_name');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.display_name).toBe('User A');
  });

  it('Profile privacy: user cannot read another user private is_admin field', async () => {
    const { data, error } = await userAClient
      .from('profiles')
      .select('is_admin')
      .eq('id', userBId);

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('Profile privacy: room members can read public fields only for their shared room', async () => {
    const { data, error } = await userAClient.rpc('get_room_public_profiles', {
      p_room_ids: [roomAId],
    });

    expect(error).toBeNull();
    const userBPublicProfile = data?.find((profile: { id: string }) => profile.id === userBId);
    expect(userBPublicProfile).toHaveProperty('username');
    expect(userBPublicProfile).toHaveProperty('display_name');
    expect(userBPublicProfile).toHaveProperty('avatar_url');
    expect(userBPublicProfile).not.toHaveProperty('is_admin');

    const { data: unrelatedRoomProfiles, error: unrelatedRoomError } = await userAClient.rpc(
      'get_room_public_profiles',
      { p_room_ids: [roomBId] }
    );
    expect(unrelatedRoomError).toBeNull();
    expect(unrelatedRoomProfiles).toHaveLength(0);
  });

  it('Profile privacy: membership helper rejects another identity supplied by an authenticated caller', async () => {
    const { data: ownMembership, error: ownError } = await userAClient.rpc('is_room_participant', {
      p_room_id: roomAId,
      p_user_id: userAId,
    });
    expect(ownError).toBeNull();
    expect(ownMembership).toBe(true);

    const { data: impersonatedMembership, error: impersonationError } = await userAClient.rpc(
      'is_room_participant',
      { p_room_id: roomAId, p_user_id: userBId }
    );
    expect(impersonationError).toBeNull();
    expect(impersonatedMembership).toBe(false);

    const { data: trustedMembership, error: trustedError } = await adminClient.rpc(
      'is_room_participant',
      { p_room_id: roomAId, p_user_id: userBId }
    );
    expect(trustedError).toBeNull();
    expect(trustedMembership).toBe(true);
  });

  it('Create Room RPC persists the room, host team, and scoped host profile', async () => {
    const { data, error } = await userCClient.rpc('create_room_with_team', {
      p_room_code: `CR${Math.floor(1000 + Math.random() * 9000)}`,
      p_room_name: 'Created by RPC',
      p_room_settings: {
        timer_duration_seconds: 15,
        min_bid_increment: 10,
        default_purse: 1000,
        max_squad_size: 25,
        max_overseas: 8,
        player_set_id: playerSetId,
        player_order: 'CATEGORY',
        bot_count: 0,
        bots: [],
      },
      p_player_set_id: playerSetId,
      p_team_name: 'User C Test Team',
      p_team_short_name: 'UCT',
      p_team_color: '#123456',
      p_default_purse: 1000,
      p_player_ids: [playerAId],
    });

    expect(error).toBeNull();
    const created = data as { room_id: string; auction_id: string; team_id: string };
    createdRoomId = created.room_id;
    createdAuctionId = created.auction_id;
    expect(createdRoomId).toBeTruthy();
    expect(createdAuctionId).toBeTruthy();
    expect(created.team_id).toBeTruthy();

    const { data: room, error: roomError } = await userCClient
      .from('rooms')
      .select('id, host_id, name')
      .eq('id', createdRoomId)
      .single();
    expect(roomError).toBeNull();
    expect(room).toMatchObject({ id: createdRoomId, host_id: userCId, name: 'Created by RPC' });

    const { data: participant, error: participantError } = await userCClient
      .from('room_participants')
      .select('user_id, team_id, role')
      .eq('room_id', createdRoomId)
      .single();
    expect(participantError).toBeNull();
    expect(participant).toMatchObject({ user_id: userCId, team_id: created.team_id, role: 'HOST' });

    const { data: publicProfiles, error: profileError } = await userCClient.rpc(
      'get_room_public_profiles',
      { p_room_ids: [createdRoomId] }
    );
    expect(profileError).toBeNull();
    expect(publicProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ room_id: createdRoomId, id: userCId }),
    ]));
  });

  it('Profile privacy: ordinary user cannot alter is_admin', async () => {
    const { data, error } = await userAClient
      .from('profiles')
      .update({ is_admin: true })
      .eq('id', userAId)
      .select('id');

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('Test 5: Ordinary user attempts direct bot_lot_state mutation → DENIED', async () => {
    // User A attempts to insert directly into bot_lot_state
    const { error } = await userAClient
      .from('bot_lot_state')
      .insert({ lot_id: roomAId, team_id: roomAId, max_per_player_budget: 100 });
    expect(error).not.toBeNull(); // RLS blocks direct client mutation
  });

  it('Test 6: Room participant attempts access to unrelated auction data → DENIED', async () => {
    // User C has no membership or host role in Room A and attempts Auction A.
    const { data, error } = await userCClient.from('auctions').select('*').eq('id', auctionAId);
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

  it('Invite preview: authenticated new joiner can preview an OPEN room with approved fields only', async () => {
    const { data, error } = await userCClient.rpc('get_room_preview_by_code', { p_code: roomACode });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      room_id: roomAId,
      code: roomACode,
      name: 'Room A',
      host_id: userAId,
      status: 'OPEN',
      host_profile_id: userAId,
    });
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual([
      'code',
      'host_avatar_url',
      'host_display_name',
      'host_profile_id',
      'host_username',
      'host_id',
      'name',
      'player_set_name',
      'room_id',
      'settings',
      'status',
    ].sort());
    expect(data?.[0]).not.toHaveProperty('is_admin');
    expect(data?.[0]).not.toHaveProperty('email');
  });

  it('Invite preview: invalid invite codes return no preview', async () => {
    // The preview contract accepts exactly six alphanumeric characters, so this
    // malformed code cannot accidentally resolve to unrelated seeded data.
    const invalidCode = 'BAD-CODE';
    const { data, error } = await userCClient.rpc('get_room_preview_by_code', { p_code: invalidCode });

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('Invite preview: closed rooms are hidden from new joiners but remain previewable to members and hosts', async () => {
    const { error: closeRoomsError } = await adminClient
      .from('rooms')
      .update({ status: 'LOCKED' })
      .in('id', [roomAId, roomBId]);
    expect(closeRoomsError).toBeNull();

    const { data: newJoinerData, error: newJoinerError } = await userCClient.rpc(
      'get_room_preview_by_code',
      { p_code: roomACode }
    );
    expect(newJoinerError).toBeNull();
    expect(newJoinerData).toEqual([]);

    // User B is a member of Room A and host of Room B. The draft contract keeps
    // previews available to existing participants and the room host.
    const { data: memberData, error: memberError } = await userBClient.rpc(
      'get_room_preview_by_code',
      { p_code: roomACode }
    );
    expect(memberError).toBeNull();
    expect(memberData).toHaveLength(1);

    const { data: hostData, error: hostError } = await userBClient.rpc(
      'get_room_preview_by_code',
      { p_code: roomBCode }
    );
    expect(hostError).toBeNull();
    expect(hostData).toHaveLength(1);
  });
});

describe('Phase 2A Runtime RLS Environment Check', () => {
  it('Reports environment readiness status', () => {
    if (!isConfigured) {
      console.warn('Runtime RLS suite skipped: explicit isolated SUPABASE_TEST_* variables are required.');
    } else {
      console.info(formatIsolatedTarget(supabaseUrl!));
    }
    expect(true).toBe(true);
  });
});
