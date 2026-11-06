-- Fresh-project compatibility step, immediately BEFORE
-- 20261017100000_room_scoped_profile_access.sql (never after final hardening).
-- Reviewed execution against a hosted project requires separate approval.
-- The historical profile migration checks this direct grant. Modern projects
-- do not supply it through default privileges. Its later removal is preserved
-- by 20261026180000_close_auction_rpc_security_gaps.sql.
BEGIN;

DO $preflight$
BEGIN
  IF current_user <> 'postgres'
     OR to_regprocedure('public.resolve_user_id()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.resolve_user_id()'::regprocedure
         AND p.proowner = 'postgres'::regrole
         AND p.prosecdef
         AND p.prosrc LIKE '%clerk_user_mappings%'
         AND p.prosrc LIKE '%v_sub::uuid%'
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy
       WHERE polrelid = 'public.profiles'::regclass
         AND polname = 'Users can read own profile'
     ) THEN
    RAISE EXCEPTION 'Fresh-project ACL step requires the postgres-owned pre-hardening identity resolver';
  END IF;
END;
$preflight$;

GRANT EXECUTE ON FUNCTION public.resolve_user_id() TO service_role;

COMMIT;
