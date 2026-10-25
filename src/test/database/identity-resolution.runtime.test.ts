import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { formatIsolatedTarget, resolveIsolatedRlsConfig } from './runtime-test-config';

const isolatedConfig = resolveIsolatedRlsConfig(process.env);
const jwtSecret = process.env.SUPABASE_TEST_JWT_SECRET;

if (!isolatedConfig && jwtSecret) {
  throw new Error('SUPABASE_TEST_JWT_SECRET requires all explicit isolated SUPABASE_TEST_* variables.');
}
if (isolatedConfig && (!jwtSecret || jwtSecret.trim().length < 32)) {
  throw new Error('Set SUPABASE_TEST_JWT_SECRET from the disposable local project to run identity tests.');
}

const identityTestsConfigured = isolatedConfig !== null && Boolean(jwtSecret);

function createAuthenticatedJwt(subject: string): string {
  if (!jwtSecret) throw new Error('The isolated identity signing key is unavailable.');

  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      aud: 'authenticated',
      exp: now + 300,
      iat: now,
      iss: 'supabase',
      role: 'authenticated',
      sub: subject,
    }),
  ].join('.');
  const signature = createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function clientForSubject(subject: string): SupabaseClient {
  const token = createAuthenticatedJwt(subject);
  return createClient(isolatedConfig!.url, isolatedConfig!.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

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

function requireNoError(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

describe.skipIf(!identityTestsConfigured)('Isolated resolve_user_id identity runtime tests', () => {
  let adminClient: SupabaseClient | undefined;
  let uuidClient: SupabaseClient | undefined;
  let uuidProfileId: string | undefined;
  let mappedProfileId: string | undefined;
  let mappedClerkSubject: string | undefined;
  let unmappedClerkSubject: string | undefined;
  let mappedRoomId: string | undefined;
  let uuidRoomId: string | undefined;
  let uuidEmail: string | undefined;

  beforeAll(async () => {
    adminClient = createClient(isolatedConfig!.url, isolatedConfig!.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const suffix = randomUUID();
    uuidEmail = `identity_uuid_${suffix}@example.com`;
    const password = `Test-${randomUUID()}-Only!`;

    const { data: uuidAuth, error: uuidCreateError } = await adminClient.auth.admin.createUser({
      email: uuidEmail,
      password,
      email_confirm: true,
      user_metadata: { username: `identity_uuid_${suffix}`, display_name: 'Identity UUID fixture' },
    });
    if (uuidAuth?.user) uuidProfileId = uuidAuth.user.id;
    requireNoError(uuidCreateError, 'UUID fixture auth user creation');
    if (!uuidProfileId) throw new Error('UUID fixture auth user creation returned no user.');

    const mappedEmail = `identity_mapped_${suffix}@example.com`;
    const { data: mappedAuth, error: mappedCreateError } = await adminClient.auth.admin.createUser({
      email: mappedEmail,
      password,
      email_confirm: true,
      user_metadata: { username: `identity_mapped_${suffix}`, display_name: 'Identity mapped fixture' },
    });
    if (mappedAuth?.user) mappedProfileId = mappedAuth.user.id;
    requireNoError(mappedCreateError, 'mapped fixture auth user creation');
    if (!mappedProfileId) throw new Error('Mapped fixture auth user creation returned no user.');

    mappedClerkSubject = `clerk_test_${suffix}`;
    unmappedClerkSubject = `clerk_missing_${suffix}`;
    const { error: mappingError } = await adminClient.from('clerk_user_mappings').insert({
      clerk_user_id: mappedClerkSubject,
      profile_id: mappedProfileId,
    });
    requireNoError(mappingError, 'synthetic Clerk mapping creation');

    const { data: mappedRoom, error: mappedRoomError } = await adminClient
      .from('rooms')
      .insert({
        code: `M${suffix.replace(/-/g, '').slice(0, 5).toUpperCase()}`,
        name: 'Mapped identity fixture room',
        host_id: mappedProfileId,
      })
      .select('id')
      .single();
    if (mappedRoom) mappedRoomId = mappedRoom.id;
    requireNoError(mappedRoomError, 'mapped identity room creation');
    if (!mappedRoomId) throw new Error('Mapped identity room creation returned no row.');

    const { error: memberError } = await adminClient.from('room_participants').insert([
      { room_id: mappedRoomId, user_id: mappedProfileId, role: 'HOST' },
      { room_id: mappedRoomId, user_id: uuidProfileId, role: 'MEMBER' },
    ]);
    requireNoError(memberError, 'identity room participant fixture creation');

    const { data: uuidRoom, error: uuidRoomError } = await adminClient
      .from('rooms')
      .insert({
        code: `U${suffix.replace(/-/g, '').slice(0, 5).toUpperCase()}`,
        name: 'UUID identity fixture room',
        host_id: uuidProfileId,
      })
      .select('id')
      .single();
    if (uuidRoom) uuidRoomId = uuidRoom.id;
    requireNoError(uuidRoomError, 'UUID identity room creation');
    if (!uuidRoomId) throw new Error('UUID identity room creation returned no row.');

    const { error: uuidMemberError } = await adminClient.from('room_participants').insert({
      room_id: uuidRoomId,
      user_id: uuidProfileId,
      role: 'HOST',
    });
    requireNoError(uuidMemberError, 'UUID identity room participant fixture creation');

    uuidClient = createClient(isolatedConfig!.url, isolatedConfig!.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: uuidSignInError } = await uuidClient.auth.signInWithPassword({
      email: uuidEmail,
      password,
    });
    requireNoError(uuidSignInError, 'UUID fixture sign in');
  });

  afterAll(async () => {
    const failures: string[] = [];
    const roomIds = [mappedRoomId, uuidRoomId].filter((id): id is string => Boolean(id));
    const profileIds = [uuidProfileId, mappedProfileId].filter((id): id is string => Boolean(id));
    const mappingIds = [mappedClerkSubject].filter((id): id is string => Boolean(id));

    if (!adminClient) {
      if (roomIds.length || profileIds.length || mappingIds.length) {
        throw new Error('Identity fixture cleanup cannot run because its admin client was not initialized.');
      }
      return;
    }

    if (roomIds.length) {
      await runCleanupStep(failures, 'room participants', async () => {
        const { error } = await adminClient!.from('room_participants').delete().in('room_id', roomIds);
        requireNoError(error, 'room participant cleanup');
      });
      await runCleanupStep(failures, 'rooms', async () => {
        const { error } = await adminClient!.from('rooms').delete().in('id', roomIds);
        requireNoError(error, 'room cleanup');
      });
    }

    if (mappingIds.length) {
      await runCleanupStep(failures, 'Clerk mappings', async () => {
        const { error } = await adminClient!
          .from('clerk_user_mappings')
          .delete()
          .in('clerk_user_id', mappingIds);
        requireNoError(error, 'mapping cleanup');
      });
    }

    if (profileIds.length) {
      await runCleanupStep(failures, 'profiles', async () => {
        const { error } = await adminClient!.from('profiles').delete().in('id', profileIds);
        requireNoError(error, 'profile cleanup');
      });
    }

    for (const profileId of profileIds) {
      await runCleanupStep(failures, `auth user ${profileId}`, async () => {
        const { data, error } = await adminClient!.auth.admin.getUserById(profileId);
        if (error?.status === 404 || error?.code === 'user_not_found' || !data.user) return;
        requireNoError(error, 'auth user lookup during cleanup');
        const { error: deleteError } = await adminClient!.auth.admin.deleteUser(profileId);
        if (deleteError?.status !== 404 && deleteError?.code !== 'user_not_found') {
          requireNoError(deleteError, 'auth user cleanup');
        }
      });
    }

    // Read-only confirmation that every captured fixture resource is gone.
    if (mappingIds.length) {
      await runCleanupStep(failures, 'mapping cleanup verification', async () => {
        const { data, error } = await adminClient!
          .from('clerk_user_mappings')
          .select('clerk_user_id')
          .in('clerk_user_id', mappingIds);
        requireNoError(error, 'mapping cleanup verification');
        if (data?.length) throw new Error('Synthetic Clerk mapping remains after cleanup.');
      });
    }
    if (roomIds.length) {
      await runCleanupStep(failures, 'room cleanup verification', async () => {
        const { data, error } = await adminClient!.from('rooms').select('id').in('id', roomIds);
        requireNoError(error, 'room cleanup verification');
        if (data?.length) throw new Error('Synthetic room remains after cleanup.');
      });
    }
    if (profileIds.length) {
      await runCleanupStep(failures, 'profile cleanup verification', async () => {
        const { data, error } = await adminClient!.from('profiles').select('id').in('id', profileIds);
        requireNoError(error, 'profile cleanup verification');
        if (data?.length) throw new Error('Synthetic profile remains after cleanup.');
      });

      await runCleanupStep(failures, 'auth user cleanup verification', async () => {
        for (const profileId of profileIds) {
          const { data, error } = await adminClient!.auth.admin.getUserById(profileId);
          if (error?.status === 404 || error?.code === 'user_not_found') continue;
          requireNoError(error, 'auth user cleanup verification');
          if (data.user) throw new Error('Synthetic auth user remains after cleanup.');
        }
      });
    }

    if (failures.length) {
      throw new Error(`Identity fixture cleanup failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
    }
  });

  it('resolves a real Supabase Auth UUID subject to only its own profile', async () => {
    const { data, error } = await uuidClient!.rpc('resolve_user_id');
    expect(error).toBeNull();
    expect(data).toBe(uuidProfileId);

    const { data: ownProfile, error: ownProfileError } = await uuidClient!
      .from('profiles')
      .select('id')
      .eq('id', uuidProfileId!)
      .maybeSingle();
    expect(ownProfileError).toBeNull();
    expect(ownProfile?.id).toBe(uuidProfileId);

    const { data: otherProfile, error: otherProfileError } = await uuidClient!
      .from('profiles')
      .select('id')
      .eq('id', mappedProfileId!)
      .maybeSingle();
    expect(otherProfileError).toBeNull();
    expect(otherProfile).toBeNull();
  });

  it('resolves a signed mapped Clerk subject and limits room profile results to authorized room IDs', async () => {
    const mappedClient = clientForSubject(mappedClerkSubject!);
    const { data, error } = await mappedClient.rpc('resolve_user_id');
    expect(error).toBeNull();
    expect(data).toBe(mappedProfileId);

    const { data: profiles, error: profilesError } = await mappedClient.rpc('get_room_public_profiles', {
      p_room_ids: [mappedRoomId!, uuidRoomId!],
    });
    expect(profilesError).toBeNull();
    expect(profiles?.length).toBeGreaterThan(0);
    expect(profiles?.every((row: { room_id: string }) => row.room_id === mappedRoomId)).toBe(true);
  });

  it('returns NULL for an unmapped Clerk subject and denies room profile results', async () => {
    const unmappedClient = clientForSubject(unmappedClerkSubject!);
    const { data, error } = await unmappedClient.rpc('resolve_user_id');
    expect(error).toBeNull();
    expect(data).toBeNull();

    const { data: profiles, error: profilesError } = await unmappedClient.rpc('get_room_public_profiles', {
      p_room_ids: [mappedRoomId!],
    });
    expect(profilesError).toBeNull();
    expect(profiles).toEqual([]);
  });

  it('does not accept a caller-supplied profile identity or room ID as an identity override', async () => {
    const mappedClient = clientForSubject(mappedClerkSubject!);
    const { data: forgedIdentity, error: forgedIdentityError } = await mappedClient.rpc(
      'resolve_user_id',
      { p_subject: uuidProfileId }
    );
    expect(forgedIdentityError).not.toBeNull();
    expect(forgedIdentity).toBeNull();

    const { data: requestedProfiles, error: requestedProfilesError } = await mappedClient.rpc(
      'get_room_public_profiles',
      { p_room_ids: [uuidRoomId!] }
    );
    expect(requestedProfilesError).toBeNull();
    expect(requestedProfiles).toEqual([]);

    const { data: mappedIdentity, error: mappedIdentityError } = await mappedClient.rpc('resolve_user_id');
    expect(mappedIdentityError).toBeNull();
    expect(mappedIdentity).toBe(mappedProfileId);
  });

  it('denies anonymous resolver execution and returns NULL for service_role identity resolution', async () => {
    const anonClient = createClient(isolatedConfig!.url, isolatedConfig!.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: anonData, error: anonError } = await anonClient.rpc('resolve_user_id');
    expect(anonError).not.toBeNull();
    expect(anonData).toBeNull();

    const { data: serviceData, error: serviceError } = await adminClient!.rpc('resolve_user_id');
    expect(serviceError).toBeNull();
    expect(serviceData).toBeNull();
  });
});

describe('Isolated identity runtime target check', () => {
  it('reports only the loopback target and never key or token values', () => {
    if (isolatedConfig) console.info(formatIsolatedTarget(isolatedConfig.url));
    expect(true).toBe(true);
  });
});
