-- Restrict direct room reads to the room host and its participants.
-- Invite-code previews remain available through the separately scoped
-- get_room_preview_by_code(text) RPC.
BEGIN;

DO $preflight$
DECLARE
  v_rooms_owner name;
  v_rooms_rls boolean;
  v_rooms_force_rls boolean;
  v_policy_qual text;
  v_helper_owner name;
  v_helper_security_definer boolean;
  v_helper_config text[];
  v_helper_source text;
  v_helper_acl aclitem[];
  v_helper_oid oid;
BEGIN
  IF pg_catalog.to_regclass('public.rooms') IS NULL
     OR pg_catalog.to_regclass('public.room_participants') IS NULL THEN
    RAISE EXCEPTION 'Room visibility migration requires rooms and room_participants';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity
    INTO v_rooms_owner, v_rooms_rls, v_rooms_force_rls
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.rooms'::regclass;

  IF v_rooms_owner IS DISTINCT FROM 'postgres'
     OR v_rooms_rls IS DISTINCT FROM true
     OR v_rooms_force_rls THEN
    RAISE EXCEPTION 'Expected postgres-owned rooms with RLS enabled and not forced (owner %, RLS %, FORCE %) ',
      v_rooms_owner, v_rooms_rls, v_rooms_force_rls;
  END IF;

  SELECT p.oid, pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, p.prosrc, p.proacl
    INTO v_helper_oid, v_helper_owner, v_helper_security_definer, v_helper_config, v_helper_source, v_helper_acl
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_room_participant' AND p.pronargs = 2
    AND p.oid = pg_catalog.to_regprocedure('public.is_room_participant(uuid, uuid)');

  IF v_helper_owner IS DISTINCT FROM 'postgres'
     OR v_helper_security_definer IS DISTINCT FROM true
     OR v_helper_config IS DISTINCT FROM ARRAY['search_path=public']::text[]
     OR v_helper_source NOT LIKE '%FROM public.room_participants%'
     OR v_helper_source NOT LIKE '%room_id = p_room_id%'
     OR v_helper_source NOT LIKE '%user_id = p_user_id%' THEN
    RAISE EXCEPTION 'is_room_participant(uuid, uuid) differs from the reviewed postgres-owned membership helper';
  END IF;

  -- Accept only the reviewed legacy ACL: postgres owner plus the expected
  -- anon/authenticated/service_role EXECUTE entries, with no PUBLIC or
  -- unexpected grantor/role/privilege. The known anon grant is removed below.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(
      COALESCE(v_helper_acl, pg_catalog.acldefault('f', 'postgres'::regrole))
    ) acl
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = acl.grantor
    WHERE acl.grantee = 0
       OR grantor.rolname IS DISTINCT FROM 'postgres'
       OR grantee.rolname NOT IN ('postgres', 'anon', 'authenticated', 'service_role')
       OR acl.privilege_type <> 'EXECUTE'
       OR acl.is_grantable
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(
      COALESCE(v_helper_acl, pg_catalog.acldefault('f', 'postgres'::regrole))
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
      COALESCE(v_helper_acl, pg_catalog.acldefault('f', 'postgres'::regrole))
    ) acl
    JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = acl.grantor
    WHERE grantee.rolname = 'service_role'
      AND grantor.rolname = 'postgres'
      AND acl.privilege_type = 'EXECUTE'
      AND NOT acl.is_grantable
  ) THEN
    RAISE EXCEPTION 'is_room_participant(uuid, uuid) has an unreviewed ACL';
  END IF;

  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid)
    INTO v_policy_qual
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = 'public.rooms'::regclass
    AND p.polname = 'Rooms viewable by authenticated users'
    AND p.polcmd = 'r'
    AND p.polpermissive
    AND p.polroles = ARRAY[0::oid]
    AND p.polwithcheck IS NULL;

  IF v_policy_qual IS DISTINCT FROM '(auth.role() = ''authenticated''::text)' THEN
    RAISE EXCEPTION 'Expected the reviewed broad authenticated room-read policy; found %', v_policy_qual;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.rooms'::regclass
      AND p.polcmd IN ('r', '*')
      AND p.polname <> 'Rooms viewable by authenticated users'
  ) THEN
    RAISE EXCEPTION 'Unexpected additional room SELECT/ALL policy; review before restricting room visibility';
  END IF;
END;
$preflight$;

-- Keep the helper's public contract for trusted server functions, but prevent
-- anonymous access and stop authenticated callers from probing another user's
-- membership by supplying an arbitrary profile UUID.
CREATE OR REPLACE FUNCTION public.is_room_participant(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_actor_id uuid := public.resolve_user_id();
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (v_actor_id IS NULL OR p_user_id IS DISTINCT FROM v_actor_id) THEN
    RETURN false;
  END IF;

  IF p_room_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.room_participants rp
    WHERE rp.room_id = p_room_id
      AND rp.user_id = p_user_id
  );
END;
$function$;
ALTER FUNCTION public.is_room_participant(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_room_participant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_room_participant(uuid, uuid) TO authenticated, service_role;

DROP POLICY "Rooms viewable by authenticated users" ON public.rooms;
CREATE POLICY "Rooms viewable by hosts and participants" ON public.rooms
  FOR SELECT TO authenticated
  USING (
    public.resolve_user_id() IS NOT NULL
    AND (
      host_id = public.resolve_user_id()
      OR public.is_room_participant(id, public.resolve_user_id())
    )
  );

DO $postflight$
DECLARE
  v_helper_oid oid;
BEGIN
  SELECT p.oid INTO v_helper_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_room_participant' AND p.pronargs = 2
    AND p.oid = pg_catalog.to_regprocedure('public.is_room_participant(uuid, uuid)');

  IF pg_catalog.has_function_privilege('anon', v_helper_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_helper_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_helper_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'is_room_participant(uuid, uuid) ACL normalization failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.rooms'::regclass
      AND p.polname = 'Rooms viewable by hosts and participants'
      AND p.polcmd = 'r'
      AND p.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')]
      AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%resolve_user_id%'
      AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%is_room_participant%'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.rooms'::regclass
      AND p.polcmd IN ('r', '*')
      AND p.polpermissive
      AND p.polname <> 'Rooms viewable by hosts and participants'
  ) THEN
    RAISE EXCEPTION 'Room membership policy postflight failed';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
