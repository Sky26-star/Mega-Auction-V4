-- Room-scoped participant identity access.
-- This forward migration intentionally fails closed when the installed schema,
-- resolver, grants, or profile policies differ from the audited contract.
BEGIN;

DO $preflight$
DECLARE
  v_profiles_owner name;
  v_profiles_rls boolean;
  v_profiles_force_rls boolean;
  v_resolver_owner name;
  v_resolver_security_definer boolean;
  v_resolver_config text[];
  v_resolver_source text;
  v_resolver_acl aclitem[];
  v_unknown_policy text;
  v_object text;
  v_resolver_oid oid;
  v_participant_rls boolean;
  v_participant_policy text;
  v_host_participant_policy text;
  v_mapping_owner name;
  v_mapping_rls boolean;
  v_mapping_force_rls boolean;
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.rooms') IS NULL
     OR pg_catalog.to_regclass('public.room_participants') IS NULL
     OR pg_catalog.to_regclass('public.auctions') IS NULL
     OR pg_catalog.to_regclass('public.player_sets') IS NULL
     OR pg_catalog.to_regclass('public.clerk_user_mappings') IS NULL THEN
    RAISE EXCEPTION 'Room profile migration requires profiles, rooms, room_participants, auctions, player_sets, and clerk_user_mappings';
  END IF;

  FOREACH v_object IN ARRAY ARRAY[
    'public.profiles.id:uuid', 'public.profiles.username:text',
    'public.profiles.display_name:text', 'public.profiles.avatar_url:text',
    'public.profiles.is_admin:boolean',
    'public.profiles.created_at:timestamp with time zone',
    'public.profiles.updated_at:timestamp with time zone',
    'public.rooms.id:uuid',
    'public.rooms.code:character varying', 'public.rooms.name:text',
    'public.rooms.host_id:uuid', 'public.rooms.status:text',
    'public.rooms.settings:jsonb', 'public.room_participants.room_id:uuid',
    'public.room_participants.user_id:uuid', 'public.auctions.room_id:uuid',
    'public.auctions.player_set_id:uuid', 'public.player_sets.id:uuid',
    'public.player_sets.name:text',
    'public.clerk_user_mappings.clerk_user_id:text',
    'public.clerk_user_mappings.profile_id:uuid'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE (c.table_schema || '.' || c.table_name || '.' || c.column_name) = split_part(v_object, ':', 1)
        AND c.data_type = split_part(v_object, ':', 2)
    ) THEN
      RAISE EXCEPTION 'Required schema column/type missing: %', v_object;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity
  INTO v_profiles_owner, v_profiles_rls, v_profiles_force_rls
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.profiles'::regclass;

  IF v_profiles_owner IS DISTINCT FROM 'postgres'
     OR NOT v_profiles_rls
     OR v_profiles_force_rls THEN
    RAISE EXCEPTION 'Expected postgres-owned profiles with RLS enabled and not forced (owner %, RLS %, FORCE %)',
      v_profiles_owner, v_profiles_rls, v_profiles_force_rls;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    WHERE c.oid = ANY (ARRAY[
        'public.rooms'::regclass,
        'public.room_participants'::regclass,
        'public.auctions'::regclass,
        'public.player_sets'::regclass
      ])
      AND (pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres'
           OR c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Room profile RPCs require postgres-owned room tables without FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity
  INTO v_mapping_owner, v_mapping_rls, v_mapping_force_rls
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.clerk_user_mappings'::regclass;
  IF v_mapping_owner IS DISTINCT FROM 'postgres'
     OR v_mapping_rls IS DISTINCT FROM true
     OR v_mapping_force_rls THEN
    RAISE EXCEPTION 'Expected postgres-owned, RLS-protected clerk_user_mappings without FORCE ROW LEVEL SECURITY';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.clerk_user_mappings'::regclass
      AND p.polname = 'Deny all access to clerk_user_mappings'
      AND p.polcmd = '*'
      AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'false'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.clerk_user_mappings'::regclass
      AND p.polname <> 'Deny all access to clerk_user_mappings'
      AND p.polpermissive
  ) THEN
    RAISE EXCEPTION 'Expected the deny-all Clerk mapping policy and no additional permissive mapping policies';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.clerk_user_mappings'::regclass
      AND c.contype = 'p'
      AND pg_catalog.pg_get_constraintdef(c.oid) = 'PRIMARY KEY (clerk_user_id)'
  ) THEN
    RAISE EXCEPTION 'Expected a unique Clerk subject to profile mapping';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, p.prosrc, p.proacl
  INTO v_resolver_owner, v_resolver_security_definer, v_resolver_config, v_resolver_source, v_resolver_acl
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resolve_user_id' AND p.pronargs = 0;

  IF v_resolver_owner IS DISTINCT FROM 'postgres'
     OR v_resolver_security_definer IS DISTINCT FROM true
     OR NOT COALESCE(
       v_resolver_config @> ARRAY['search_path=public']
       OR v_resolver_config @> ARRAY['search_path=pg_catalog, public, auth'],
       false
     )
     OR v_resolver_source NOT LIKE '%v_sub::uuid%'
     OR v_resolver_source NOT LIKE '%clerk_user_mappings%'
     OR v_resolver_source NOT LIKE '%service_role%' THEN
    RAISE EXCEPTION 'resolve_user_id() differs from the reviewed UUID fallback and Clerk-mapping implementation';
  END IF;

  SELECT p.oid INTO v_resolver_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resolve_user_id' AND p.pronargs = 0;
  -- Accept only the reviewed 00054 ACL and the known postgres default-ACL
  -- variant that adds a direct anon grant. Check the complete ACL before
  -- removing that expected legacy grant; unexpected roles or grantors fail closed.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(
      COALESCE(v_resolver_acl, pg_catalog.acldefault('f', 'postgres'::regrole))
    ) acl
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = acl.grantor
    WHERE acl.grantee = 0
       OR grantor.rolname IS DISTINCT FROM 'postgres'
       OR grantee.rolname NOT IN ('postgres', 'anon', 'authenticated', 'service_role')
       OR acl.privilege_type <> 'EXECUTE'
       OR (grantee.rolname <> 'postgres' AND acl.is_grantable)
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(
      COALESCE(v_resolver_acl, pg_catalog.acldefault('f', 'postgres'::regrole))
    ) acl
    JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = acl.grantor
    WHERE grantee.rolname = 'authenticated'
      AND grantor.rolname = 'postgres'
      AND acl.privilege_type = 'EXECUTE'
      AND NOT acl.is_grantable
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(
      COALESCE(v_resolver_acl, pg_catalog.acldefault('f', 'postgres'::regrole))
    ) acl
    JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = acl.grantor
    WHERE grantee.rolname = 'service_role'
      AND grantor.rolname = 'postgres'
      AND acl.privilege_type = 'EXECUTE'
      AND NOT acl.is_grantable
  ) THEN
    RAISE EXCEPTION 'resolve_user_id() has an unreviewed ACL; expected postgres owner grants to authenticated and service_role, with only the known optional anon default grant';
  END IF;

  SELECT c.relrowsecurity INTO v_participant_rls
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.room_participants'::regclass;
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid)
    INTO v_participant_policy
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = 'public.room_participants'::regclass
    AND p.polcmd = 'r'
    AND p.polname = 'Room participants viewable by room members';
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid)
    INTO v_host_participant_policy
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = 'public.room_participants'::regclass
    AND p.polcmd = '*'
    AND p.polname = 'Host can manage room participants';

  IF v_participant_rls IS DISTINCT FROM true OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.room_participants'::regclass
      AND p.polcmd = 'r'
      AND p.polname = 'Room participants viewable by room members'
  ) OR v_participant_policy IS NULL
    OR v_participant_policy NOT LIKE '%resolve_user_id%'
    OR v_participant_policy NOT LIKE '%is_room_participant%'
    OR v_participant_policy NOT LIKE '%host_id%'
    OR v_host_participant_policy IS NULL
    OR v_host_participant_policy NOT LIKE '%resolve_user_id%'
    OR v_host_participant_policy NOT LIKE '%host_id%' THEN
    RAISE EXCEPTION 'Expected room-participant RLS and the established room-membership SELECT policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.room_participants'::regclass
      AND p.polcmd IN ('r', '*')
      AND p.polpermissive
      AND p.polname NOT IN (
        'Room participants viewable by room members',
        'Host can manage room participants'
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected additional room-participant SELECT policy may widen access';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c
       WHERE c.conrelid = 'public.rooms'::regclass
         AND c.contype = 'u'
         AND pg_catalog.pg_get_constraintdef(c.oid) = 'UNIQUE (code)'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c
       WHERE c.conrelid = 'public.auctions'::regclass
         AND c.contype = 'u'
         AND pg_catalog.pg_get_constraintdef(c.oid) = 'UNIQUE (room_id)'
     ) THEN
    RAISE EXCEPTION 'Expected unique room invite codes and at most one auction per room';
  END IF;

  -- Known policies from the checked-in history and the Phase 2 draft contract.
  -- Unknown policies stop the migration instead of being silently removed.
  SELECT p.polname INTO v_unknown_policy
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = 'public.profiles'::regclass
    AND p.polname::text <> ALL (ARRAY[
      'Profiles are viewable by everyone',
      'Profiles are viewable by authenticated users',
      'Users can read own profile',
      'Users can update own profile'
    ]::text[])
  LIMIT 1;
  IF v_unknown_policy IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected profiles policy %; review its purpose before migration', v_unknown_policy;
  END IF;
END;
$preflight$;

-- Normalize only the reviewed legacy baseline, after checking every ACL entry.
-- The service_role grant is deliberately preserved; authenticated is explicit.
REVOKE EXECUTE ON FUNCTION public.resolve_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_user_id() TO authenticated;

DO $resolver_acl_postflight$
DECLARE
  v_resolver_oid oid;
BEGIN
  SELECT p.oid INTO v_resolver_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resolve_user_id' AND p.pronargs = 0;

  IF NOT pg_catalog.has_function_privilege('authenticated', v_resolver_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_resolver_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_resolver_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'resolve_user_id() ACL normalization failed; authenticated and service_role must retain EXECUTE while anon is denied';
  END IF;
END;
$resolver_acl_postflight$;

-- Harden the reviewed resolver's historical search path without changing its
-- UUID fallback or Clerk mapping behavior.
ALTER FUNCTION public.resolve_user_id() SET search_path = pg_catalog, public, auth;

-- Ordinary access is self-only and limited to fields used by account features.
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.resolve_user_id() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.resolve_user_id() = id)
  WITH CHECK (public.resolve_user_id() = id);

REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
DO $column_acl$
DECLARE
  v_column name;
BEGIN
  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.profiles'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE public.profiles FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;
END;
$column_acl$;

DO $acl_preflight$
DECLARE
  v_column name;
BEGIN
  IF pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'TRIGGER')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'DELETE')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'REFERENCES')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'TRIGGER') THEN
    RAISE EXCEPTION 'Inherited or unexpected profile privileges remain; inspect role memberships and ACLs';
  END IF;

  FOR v_column IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.profiles'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF (v_column::text NOT IN ('id', 'username', 'display_name', 'avatar_url', 'created_at', 'updated_at')
        AND pg_catalog.has_column_privilege('authenticated', 'public.profiles', v_column, 'SELECT'))
       OR (v_column::text NOT IN ('display_name', 'avatar_url')
        AND pg_catalog.has_column_privilege('authenticated', 'public.profiles', v_column, 'UPDATE'))
       OR pg_catalog.has_column_privilege('authenticated', 'public.profiles', v_column, 'INSERT')
       OR pg_catalog.has_column_privilege('authenticated', 'public.profiles', v_column, 'REFERENCES')
       OR pg_catalog.has_column_privilege('anon', 'public.profiles', v_column, 'SELECT')
       OR pg_catalog.has_column_privilege('anon', 'public.profiles', v_column, 'UPDATE')
       OR pg_catalog.has_column_privilege('anon', 'public.profiles', v_column, 'INSERT')
       OR pg_catalog.has_column_privilege('anon', 'public.profiles', v_column, 'REFERENCES') THEN
      RAISE EXCEPTION 'Inherited or unexpected column privilege remains on public.profiles.%', v_column;
    END IF;
  END LOOP;
END;
$acl_preflight$;

GRANT SELECT (id, username, display_name, avatar_url, created_at, updated_at)
  ON TABLE public.profiles TO authenticated;
GRANT UPDATE (display_name, avatar_url)
  ON TABLE public.profiles TO authenticated;

-- Remove the old global profile view only when it is the expected postgres-owned view.
DO $view_preflight$
DECLARE
  v_owner name;
  v_kind "char";
  v_view_definition text;
BEGIN
  IF pg_catalog.to_regclass('public.public_profiles') IS NOT NULL THEN
    SELECT pg_catalog.pg_get_userbyid(c.relowner), c.relkind
      INTO v_owner, v_kind
    FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.public_profiles'::regclass;
    IF v_owner IS DISTINCT FROM 'postgres' OR v_kind IS DISTINCT FROM 'v' THEN
      RAISE EXCEPTION 'public.public_profiles exists but is not the expected postgres-owned ordinary view';
    END IF;
    SELECT pg_catalog.pg_get_viewdef('public.public_profiles'::regclass, true)
      INTO v_view_definition;
    IF v_view_definition !~* '^\s*SELECT\s+((public\.)?profiles\.)?id,\s*((public\.)?profiles\.)?username,\s*((public\.)?profiles\.)?display_name,\s*((public\.)?profiles\.)?avatar_url\s+FROM\s+(public\.)?profiles\s*;?\s*$' THEN
      RAISE EXCEPTION 'public.public_profiles has an unexpected definition; review it before removal';
    END IF;
    REVOKE ALL PRIVILEGES ON TABLE public.public_profiles FROM PUBLIC, anon, authenticated;
    DROP VIEW public.public_profiles;
  END IF;
END;
$view_preflight$;

CREATE FUNCTION public.get_room_public_profiles(p_room_ids uuid[])
RETURNS TABLE (
  room_id uuid,
  id uuid,
  username text,
  display_name text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH caller AS (
    SELECT public.resolve_user_id() AS user_id
  ), requested_rooms AS (
    SELECT DISTINCT unnest(COALESCE(p_room_ids, ARRAY[]::uuid[])) AS room_id
  ), authorized_rooms AS (
    SELECT r.id AS room_id, r.host_id
    FROM public.rooms r
    JOIN requested_rooms requested ON requested.room_id = r.id
    CROSS JOIN caller c
    WHERE c.user_id IS NOT NULL
      AND (
        r.host_id = c.user_id
        OR EXISTS (
          SELECT 1 FROM public.room_participants rp
          WHERE rp.room_id = r.id AND rp.user_id = c.user_id
        )
      )
  ), room_profiles AS (
    SELECT ar.room_id, ar.host_id AS profile_id FROM authorized_rooms ar
    UNION
    SELECT ar.room_id, rp.user_id AS profile_id
    FROM authorized_rooms ar
    JOIN public.room_participants rp ON rp.room_id = ar.room_id
    WHERE rp.user_id IS NOT NULL
  )
  SELECT rp.room_id, p.id, p.username, p.display_name, p.avatar_url
  FROM room_profiles rp
  JOIN public.profiles p ON p.id = rp.profile_id
$function$;
ALTER FUNCTION public.get_room_public_profiles(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_room_public_profiles(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_room_public_profiles(uuid[]) TO authenticated;

-- Invite-code preview returns only the room fields rendered by the existing
-- preview plus the approved host identity fields. New participants require
-- OPEN status; existing members may preview their own room so the existing
-- idempotent join_room_with_team path continues to work after the room locks.
CREATE FUNCTION public.get_room_preview_by_code(p_code text)
RETURNS TABLE (
  room_id uuid,
  code character varying,
  name text,
  host_id uuid,
  status text,
  settings jsonb,
  player_set_name text,
  host_profile_id uuid,
  host_username text,
  host_display_name text,
  host_avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    r.id,
    r.code,
    r.name,
    r.host_id,
    r.status,
    pg_catalog.jsonb_build_object(
      'default_purse', COALESCE(r.settings -> 'default_purse', '1000'::jsonb),
      'timer_duration_seconds', COALESCE(r.settings -> 'timer_duration_seconds', '15'::jsonb),
      'max_squad_size', COALESCE(r.settings -> 'max_squad_size', '25'::jsonb),
      'max_overseas', COALESCE(r.settings -> 'max_overseas', '8'::jsonb)
    ),
    ps.name,
    hp.id,
    hp.username,
    hp.display_name,
    hp.avatar_url
  FROM public.rooms r
  JOIN public.profiles hp ON hp.id = r.host_id
  LEFT JOIN public.auctions a ON a.room_id = r.id
  LEFT JOIN public.player_sets ps ON ps.id = a.player_set_id
  WHERE pg_catalog.length(pg_catalog.btrim(p_code)) = 6
    AND pg_catalog.btrim(p_code) ~ '^[A-Za-z0-9]{6}$'
    AND r.code = pg_catalog.upper(pg_catalog.btrim(p_code))
    AND public.resolve_user_id() IS NOT NULL
    AND (
      r.status = 'OPEN'
      OR r.host_id = public.resolve_user_id()
      OR EXISTS (
        SELECT 1 FROM public.room_participants rp
        WHERE rp.room_id = r.id
          AND rp.user_id = public.resolve_user_id()
      )
    )
$function$;
ALTER FUNCTION public.get_room_preview_by_code(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_room_preview_by_code(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_room_preview_by_code(text) TO authenticated;

COMMIT;
