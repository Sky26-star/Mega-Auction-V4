import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatIsolatedTarget, resolveIsolatedRlsConfig } from './runtime-test-config';

const readDraft = (name: string) =>
  readFileSync(resolve(process.cwd(), 'docs', name), 'utf8');
const readRoomProfileMigration = () =>
  readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261017100000_room_scoped_profile_access.sql'),
    'utf8'
  );
const readRoomMembershipMigration = () =>
  readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261020130000_room_membership_read_policy.sql'),
    'utf8'
  );

describe('Phase 2 security migration drafts', () => {
  it('defines self-only profile access and room-scoped public profile RPCs', () => {
    const sql = readRoomProfileMigration();
    const roomProfileFunction = sql.match(
      /CREATE FUNCTION public\.get_room_public_profiles[\s\S]*?\$function\$;/
    )?.[0] || '';
    const previewFunction = sql.match(
      /CREATE FUNCTION public\.get_room_preview_by_code[\s\S]*?\$function\$;/
    )?.[0] || '';
    expect(sql.trimStart()).toMatch(/^--[\s\S]*?BEGIN;/);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
    expect(sql).toContain('CREATE POLICY "Users can read own profile" ON public.profiles');
    expect(sql).toContain('USING (public.resolve_user_id() = id)');
    expect(sql).toContain('WITH CHECK (public.resolve_user_id() = id)');
    expect(sql).toContain('GRANT SELECT (id, username, display_name, avatar_url, created_at, updated_at)');
    expect(sql).toContain('GRANT UPDATE (display_name, avatar_url)');
    expect(sql).toContain('REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I)');
    expect(sql).toContain("v_column::text NOT IN ('id', 'username', 'display_name', 'avatar_url', 'created_at', 'updated_at')");
    expect(sql).toContain("v_column::text NOT IN ('display_name', 'avatar_url')");
    expect(sql).toContain('CREATE FUNCTION public.get_room_public_profiles(p_room_ids uuid[])');
    expect(roomProfileFunction).toContain('username text');
    expect(roomProfileFunction).toContain('display_name text');
    expect(roomProfileFunction).toContain('avatar_url text');
    expect(roomProfileFunction).not.toMatch(/is_admin|email/i);
    expect(sql).toContain('r.host_id = c.user_id');
    expect(sql).toContain('rp.room_id = r.id AND rp.user_id = c.user_id');
    expect(sql).toContain('CREATE FUNCTION public.get_room_preview_by_code(p_code text)');
    expect(previewFunction).toContain('host_username text');
    expect(previewFunction).not.toMatch(/is_admin|email/i);
    expect(sql).toContain("r.status = 'OPEN'");
    expect(sql).toContain('rp.user_id = public.resolve_user_id()');
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.get_room_public_profiles(uuid[]) TO authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.get_room_preview_by_code(text) TO authenticated;");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).toContain("v_unknown_policy IS NOT NULL");
    expect(sql).toContain('v_resolver_source NOT LIKE \'%v_sub::uuid%\'');
    expect(sql).toContain('ALTER FUNCTION public.resolve_user_id() SET search_path = pg_catalog, public, auth;');
    expect(sql).toContain('DROP VIEW public.public_profiles;');
  });

  it('normalizes only the reviewed resolver ACL baseline before effective privilege checks', () => {
    const sql = readRoomProfileMigration();
    const baselineCheck = sql.indexOf("resolve_user_id() has an unreviewed ACL");
    const normalize = sql.indexOf(
      'REVOKE EXECUTE ON FUNCTION public.resolve_user_id() FROM PUBLIC, anon;'
    );
    const authenticatedGrant = sql.indexOf(
      'GRANT EXECUTE ON FUNCTION public.resolve_user_id() TO authenticated;'
    );
    const postflight = sql.indexOf('DO $resolver_acl_postflight$');

    expect(sql).toContain('COALESCE(v_resolver_acl, pg_catalog.acldefault');
    expect(sql).toContain("grantee.rolname NOT IN ('postgres', 'anon', 'authenticated', 'service_role')");
    expect(sql).toContain("grantor.rolname IS DISTINCT FROM 'postgres'");
    expect(sql).toContain("grantee.rolname = 'authenticated'");
    expect(sql).toContain("grantee.rolname = 'service_role'");
    expect(sql).toContain('acl.grantee = 0');
    expect(sql).not.toMatch(/ALTER DEFAULT PRIVILEGES/i);
    expect(baselineCheck).toBeGreaterThan(-1);
    expect(normalize).toBeGreaterThan(baselineCheck);
    expect(authenticatedGrant).toBeGreaterThan(normalize);
    expect(postflight).toBeGreaterThan(authenticatedGrant);

    const finalAclCheck = sql.slice(postflight, sql.indexOf('$resolver_acl_postflight$;', postflight));
    expect(finalAclCheck).toContain("has_function_privilege('authenticated', v_resolver_oid, 'EXECUTE')");
    expect(finalAclCheck).toContain("has_function_privilege('anon', v_resolver_oid, 'EXECUTE')");
    expect(finalAclCheck).toContain("has_function_privilege('service_role', v_resolver_oid, 'EXECUTE')");
  });

  it('restricts room reads to hosts and members and prevents identity-probe abuse', () => {
    const sql = readRoomMembershipMigration();
    const helper = sql.match(
      /CREATE OR REPLACE FUNCTION public\.is_room_participant[\s\S]*?\$function\$;/
    )?.[0] || '';
    const preflight = sql.slice(sql.indexOf('DO $preflight$'), sql.indexOf('$preflight$;'));

    expect(sql.trimStart()).toMatch(/^--[\s\S]*?BEGIN;/);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
    expect(preflight).toContain("v_policy_qual IS DISTINCT FROM '(auth.role() = ''authenticated''::text)'");
    expect(preflight).toContain("p.polcmd IN ('r', '*')");
    expect(preflight).toContain("p.polname <> 'Rooms viewable by authenticated users'");
    expect(preflight).toContain("grantee.rolname NOT IN ('postgres', 'anon', 'authenticated', 'service_role')");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.is_room_participant(uuid, uuid) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.is_room_participant(uuid, uuid) TO authenticated, service_role;');
    expect(helper).toContain('p_user_id IS DISTINCT FROM v_actor_id');
    expect(helper).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(sql).toContain('DROP POLICY "Rooms viewable by authenticated users" ON public.rooms;');
    expect(sql).toContain('CREATE POLICY "Rooms viewable by hosts and participants" ON public.rooms');
    expect(sql).toContain('OR public.is_room_participant(id, public.resolve_user_id())');
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.is_room_participant[^;]*\banon\b/i);
  });

  it('routes participant identity reads through room-scoped RPCs only', () => {
    const rooms = readFileSync(resolve(process.cwd(), 'src/lib/rooms.ts'), 'utf8');
    const dashboard = readFileSync(resolve(process.cwd(), 'src/app/(dashboard)/dashboard/page.tsx'), 'utf8');
    const participantUi = [
      'src/components/rooms/participant-list.tsx',
      'src/components/rooms/auction-participant-card.tsx',
      'src/components/rooms/team-list.tsx',
    ].map(path => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');
    expect(rooms).toContain(".rpc('get_room_public_profiles'");
    expect(rooms).toContain(".rpc('get_room_preview_by_code'");
    expect(dashboard).toContain(".rpc('get_room_public_profiles'");
    expect(rooms).not.toContain(".from('public_profiles')");
    expect(dashboard).not.toContain(".from('public_profiles')");
    expect(rooms).not.toMatch(/profiles!rooms_host_id_fkey|profile:profiles\(/);
    expect(dashboard).not.toMatch(/profiles!rooms_host_id_fkey/);
    expect(participantUi).toContain('profile?.display_name');
    expect(participantUi).toContain('profile?.username');
  });

  it('keeps admin checks behind the server-only service profile lookup', () => {
    const adminAuth = readFileSync(resolve(process.cwd(), 'src/lib/admin/auth.ts'), 'utf8');
    const dashboard = readFileSync(resolve(process.cwd(), 'src/app/(dashboard)/dashboard/page.tsx'), 'utf8');
    const profileRoute = readFileSync(resolve(process.cwd(), 'src/app/api/auth/me/route.ts'), 'utf8');
    expect(adminAuth).toContain("from '@/lib/supabase/admin'");
    expect(adminAuth).toContain(".from('clerk_user_mappings')");
    expect(adminAuth).toContain(".select('id, username, display_name, avatar_url, is_admin, created_at, updated_at')");
    expect(dashboard).toContain('verifyAdminUser()');
    expect(profileRoute).toContain("const PROFILE_FIELDS = 'id, username, display_name, avatar_url, created_at, updated_at'");
    expect(profileRoute).not.toMatch(/\.select\('\*'\)/);
  });

  it('keeps Phase 2C syntax, mapped authorization, and grants aligned', () => {
    const sql = readDraft('PHASE_2C_REMOTE_MIGRATION.sql');
    const stateFunction = sql.match(
      /CREATE OR REPLACE FUNCTION public\.get_authoritative_auction_state[\s\S]*?REVOKE ALL/
    )?.[0];
    const initializeFunction = sql.match(
      /CREATE OR REPLACE FUNCTION public\.initialize_and_start_auction[\s\S]*?REVOKE ALL/
    )?.[0];

    expect(stateFunction).toContain('v_min_required_bid INT');
    expect(stateFunction).toContain('public.resolve_user_id()');
    expect(stateFunction).toMatch(/SET current_lot_id = v_active_lot\.id\s+WHERE id = v_auction\.id\s+AND current_lot_index = v_auction\.current_lot_index\s+AND current_lot_id IS DISTINCT FROM v_active_lot\.id/);
    expect(sql).not.toContain('auth.uid()');
    expect(stateFunction).toContain('public.is_room_participant');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.(?:get_authoritative_auction_state|initialize_and_start_auction)[^;]*\banon\b/i);
    expect(initializeFunction).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(initializeFunction).toContain("v_auction.status NOT IN ('LOBBY', 'READY')");
    expect(sql).toMatch(/END LOOP;\s+END IF;\s+END IF;\s+IF v_lot_index = 0 AND v_existing_lots = 0/);
    expect(initializeFunction).toContain("'PLAYER_SET_REQUIRED'");
    expect(initializeFunction).toContain("'PLAYER_SET_HAS_NO_PLAYERS'");
    expect(initializeFunction).toMatch(/FROM public\.players p\s+WHERE p\.player_set_id = v_target_set_id/);
    expect(initializeFunction).not.toMatch(/FROM public\.players p\s+ORDER BY[\s\S]*?LIMIT 50/);
  });
});

describe('isolated runtime RLS test target guard', () => {
  const validEnv = (overrides: Record<string, string | undefined> = {}) => ({
    SUPABASE_TEST_URL: 'http://127.0.0.1:55321',
    SUPABASE_TEST_ANON_KEY: 'disposable-anon-key',
    SUPABASE_TEST_SERVICE_ROLE_KEY: 'disposable-service-key',
    // These simulate project env-file values and must never win over test settings.
    NEXT_PUBLIC_SUPABASE_URL: 'https://production.example.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'production-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'production-service-key',
    ...overrides,
  });

  it('uses the explicit test-only variables instead of project environment values', () => {
    const config = resolveIsolatedRlsConfig(validEnv());
    expect(config).toEqual({
      url: 'http://127.0.0.1:55321',
      anonKey: 'disposable-anon-key',
      serviceRoleKey: 'disposable-service-key',
    });
  });

  it('does not use ambient project settings when isolated test variables are absent', () => {
    expect(resolveIsolatedRlsConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://production.example.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'production-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'production-service-key',
    })).toBeNull();
  });

  it.each([
    'https://production.example.invalid',
    'http://127.0.0.1:54321',
    'http://localhost:54321',
  ])('rejects non-loopback or non-disposable target %s', (url) => {
    expect(() => resolveIsolatedRlsConfig(validEnv({ SUPABASE_TEST_URL: url }))).toThrow(
      /loopback URL on port 55321/
    );
  });

  it.each([
    { SUPABASE_TEST_URL: 'http://127.0.0.1:55321' },
    {
      SUPABASE_TEST_URL: 'http://127.0.0.1:55321',
      SUPABASE_TEST_ANON_KEY: 'disposable-anon-key',
    },
  ])('fails closed when the explicit test configuration is incomplete', (partial) => {
    expect(() => resolveIsolatedRlsConfig(partial)).toThrow(/Set all three SUPABASE_TEST_\*/);
  });

  it('allows approved loopback hosts on port 55321 and formats target output without keys', () => {
    expect(resolveIsolatedRlsConfig(validEnv({ SUPABASE_TEST_URL: 'http://localhost:55321' }))?.url)
      .toBe('http://localhost:55321');
    expect(resolveIsolatedRlsConfig(validEnv({ SUPABASE_TEST_URL: 'http://[::1]:55321' }))?.url)
      .toBe('http://[::1]:55321');
    const message = formatIsolatedTarget('http://127.0.0.1:55321');
    expect(message).toBe('[ISOLATED RLS TEST] target: http://127.0.0.1:55321');
    expect(message).not.toContain('disposable-anon-key');
    expect(message).not.toContain('disposable-service-key');
  });

  it('does not load project env files or log database keys from the mutating runtime test', () => {
    const runtimeTest = readFileSync(resolve(process.cwd(), 'src/test/database/rls.runtime.test.ts'), 'utf8');
    expect(runtimeTest).not.toContain('.env.local');
    expect(runtimeTest).toContain('resolveIsolatedRlsConfig(process.env)');
    expect(runtimeTest).toContain('console.info(formatIsolatedTarget(supabaseUrl!))');
    expect(runtimeTest).not.toMatch(/console\.(?:log|info|warn|error)\([^\n]*(?:anonKey|serviceRoleKey)/);
  });

  it('cleans only captured fixture rows in dependency order and surfaces cleanup failures', () => {
    const runtimeTest = readFileSync(resolve(process.cwd(), 'src/test/database/rls.runtime.test.ts'), 'utf8');
    const cleanupOrder = [
      "from('room_participants').delete()",
      "from('auctions').delete()",
      "from('rooms').delete()",
      "from('players').delete()",
      "from('player_sets').delete()",
      "from('profiles').delete()",
      'auth.admin.getUserById(userId)',
      'auth.admin.deleteUser(userId)',
    ].map((snippet) => runtimeTest.indexOf(snippet));

    expect(cleanupOrder.every((position) => position >= 0)).toBe(true);
    expect(cleanupOrder).toEqual([...cleanupOrder].sort((left, right) => left - right));
    expect(runtimeTest).toContain('filter((id): id is string => Boolean(id))');
    expect(runtimeTest).toContain('if (roomIds.length)');
    expect(runtimeTest).toContain('if (userIds.length)');
    expect(runtimeTest).toContain('if (failures.length)');
    expect(runtimeTest).toContain('RLS fixture cleanup failed:');
    expect(runtimeTest).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/);
  });

  it('uses a third nonmember identity for unrelated auction denial and cleans it up', () => {
    const runtimeTest = readFileSync(resolve(process.cwd(), 'src/test/database/rls.runtime.test.ts'), 'utf8');
    const unrelatedAuctionCase = runtimeTest.match(
      /it\('Test 6:[\s\S]*?\n  \}\);/
    )?.[0] || '';

    expect(runtimeTest).toContain('let userCClient: SupabaseClient');
    expect(runtimeTest).toContain('let userCId: string');
    expect(runtimeTest).toContain('userCId,');
    expect(runtimeTest).toContain("const userIds = [userAId, userBId, userCId]");
    expect(runtimeTest).toContain("{ room_id: roomAId, user_id: userBId, role: 'MEMBER' }");
    expect(unrelatedAuctionCase).toContain('userCClient.from(\'auctions\')');
    expect(unrelatedAuctionCase).not.toContain('userBClient');
  });

  it('denies direct nonmember room reads while preserving scoped invite preview', () => {
    const runtimeTest = readFileSync(resolve(process.cwd(), 'src/test/database/rls.runtime.test.ts'), 'utf8');
    const roomDenialCase = runtimeTest.match(
      /it\('Test 2:[\s\S]*?\n  \}\);/
    )?.[0] || '';

    expect(roomDenialCase).toContain('userAClient');
    expect(roomDenialCase).toContain(".from('rooms')");
    expect(roomDenialCase).toContain('expect(unauthorizedRooms).toHaveLength(0)');
    expect(runtimeTest).toContain('membership helper rejects another identity supplied by an authenticated caller');
    expect(runtimeTest).toContain('Create Room RPC persists the room, host team, and scoped host profile');
    expect(runtimeTest).toContain("rpc('get_room_preview_by_code'");
  });

  it('checks cross-user profile updates through permitted columns and exercises invite preview policy', () => {
    const runtimeTest = readFileSync(resolve(process.cwd(), 'src/test/database/rls.runtime.test.ts'), 'utf8');
    const crossUserUpdateCase = runtimeTest.match(
      /it\('Test 4:[\s\S]*?\n  \}\);/
    )?.[0] || '';

    expect(crossUserUpdateCase).toContain(".select('id, display_name')");
    expect(crossUserUpdateCase).toContain("expect(error?.code ?? null).toBeNull()");
    expect(crossUserUpdateCase).toContain('expect(data).toEqual([])');
    expect(crossUserUpdateCase).toContain("expect(after?.display_name).toBe(before?.display_name)");
    expect(runtimeTest).toContain(".select('is_admin')");
    expect(runtimeTest).toContain("it('Invite preview: authenticated new joiner can preview an OPEN room");
    expect(runtimeTest).toContain("it('Invite preview: invalid invite codes return no preview'");
    expect(runtimeTest).toContain("it('Invite preview: closed rooms are hidden from new joiners");
  });

  it('covers authenticated resolver identity cases with local signed tokens and fail-closed cleanup', () => {
    const identityTest = readFileSync(
      resolve(process.cwd(), 'src/test/database/identity-resolution.runtime.test.ts'),
      'utf8'
    );
    const cleanup = identityTest.match(/afterAll\(async \(\) => \{[\s\S]*?\n  \}\);/)?.[0] || '';

    expect(identityTest).toContain("from 'node:crypto'");
    expect(identityTest).toContain('SUPABASE_TEST_JWT_SECRET');
    expect(identityTest).toContain('resolveIsolatedRlsConfig(process.env)');
    expect(identityTest).not.toContain('.env.local');
    expect(identityTest).toContain("rpc('resolve_user_id')");
    expect(identityTest).toContain('mapped Clerk subject');
    expect(identityTest).toContain('unmapped Clerk subject');
    expect(identityTest).toContain('real Supabase Auth UUID subject');
    expect(identityTest).toContain('caller-supplied profile identity');
    expect(identityTest).toContain('service_role identity resolution');
    expect(identityTest).not.toMatch(/console\.(?:log|info|warn|error)\([^\n]*(?:jwtSecret|token)/i);
    expect(cleanup.indexOf("from('room_participants').delete()")).toBeGreaterThanOrEqual(0);
    expect(cleanup.indexOf("from('rooms').delete()")).toBeGreaterThan(cleanup.indexOf("from('room_participants').delete()"));
    expect(cleanup.indexOf("from('clerk_user_mappings')")).toBeGreaterThan(cleanup.indexOf("from('rooms').delete()"));
    expect(cleanup.indexOf("from('profiles').delete()")).toBeGreaterThan(cleanup.indexOf("from('clerk_user_mappings')"));
    expect(cleanup).toContain('mapping cleanup verification');
    expect(cleanup).toContain('room cleanup verification');
    expect(cleanup).toContain('profile cleanup verification');
    expect(cleanup).toContain('auth user cleanup verification');
    expect(cleanup).toContain('Identity fixture cleanup failed:');
  });
});
