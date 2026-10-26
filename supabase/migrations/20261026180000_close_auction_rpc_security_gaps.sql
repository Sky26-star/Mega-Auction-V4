-- Close remaining authorization, privilege, and SECURITY DEFINER gaps in the
-- auction RPC surface. Bot workers must use v3_place_bot_bid, which validates
-- the bot team, decision snapshot, next bid, and maximum valuation.

BEGIN;

-- Human clients may place human bids. The service role must use the bot-only
-- guarded RPC instead of impersonating a human team through this endpoint.
REVOKE ALL ON FUNCTION public.v3_place_bid(uuid, uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.v3_place_bid(uuid, uuid, uuid, uuid, boolean)
  TO authenticated;

-- Keep executable grants aligned with the caller each RPC is designed for.
REVOKE ALL ON FUNCTION public.v3_place_bot_bid(uuid, uuid, uuid, uuid, integer, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_place_bot_bid(uuid, uuid, uuid, uuid, integer, uuid, integer, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.v3_mark_bot_drop(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_mark_bot_drop(uuid, uuid, uuid, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.v3_start_bidding(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v3_start_bidding(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_start_bidding(uuid, uuid),
  public.v3_start_bidding(uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid),
  public.v3_finalize_and_advance_lot(uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.v3_close_mini_selection(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_close_mini_selection(uuid, boolean) TO service_role;

-- User-facing room and mini-auction setup calls require an authenticated
-- identity; worker-only state transitions remain service-role-only above.
REVOKE ALL ON FUNCTION public.resolve_user_id() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_user_id() TO authenticated;
REVOKE ALL ON FUNCTION public.create_room_with_team(text, text, jsonb, uuid, text, text, text, integer, uuid[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_room_with_team(text, text, jsonb, uuid, text, text, text, integer, uuid[])
  TO authenticated;
REVOKE ALL ON FUNCTION public.join_room_with_team(text, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.join_room_with_team(text, text, text, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.v3_start_mini_auction(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v3_start_mini_auction(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.v3_initiate_mini_auction(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.v3_initiate_mini_auction(uuid) TO authenticated;

-- SECURITY DEFINER bodies in this RPC path use schema-qualified application
-- objects. Put built-ins first and keep temporary objects last; app roles do
-- not need CREATE in public and therefore cannot plant shadow objects there.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.resolve_user_id()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_place_bid(uuid, uuid, uuid, uuid, boolean)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_place_bot_bid(uuid, uuid, uuid, uuid, integer, uuid, integer, integer)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_mark_bot_drop(uuid, uuid, uuid, integer)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_start_bidding(uuid, uuid)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_start_bidding(uuid, uuid, boolean)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid, boolean)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_close_mini_selection(uuid, boolean)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.create_room_with_team(text, text, jsonb, uuid, text, text, text, integer, uuid[])
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.join_room_with_team(text, text, text, text)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_start_mini_auction(uuid)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_initiate_mini_auction(uuid)
  SET search_path = pg_catalog, public, pg_temp;

DO $assertions$
BEGIN
  IF has_function_privilege('anon', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: v3_place_bid must be authenticated-only';
  END IF;

  IF has_function_privilege('anon', 'public.v3_place_bot_bid(uuid,uuid,uuid,uuid,integer,uuid,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v3_place_bot_bid(uuid,uuid,uuid,uuid,integer,uuid,integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_place_bot_bid(uuid,uuid,uuid,uuid,integer,uuid,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: v3_place_bot_bid must be service_role-only';
  END IF;

  IF has_function_privilege('anon', 'public.create_room_with_team(text,text,jsonb,uuid,text,text,text,integer,uuid[])', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.create_room_with_team(text,text,jsonb,uuid,text,text,text,integer,uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.create_room_with_team(text,text,jsonb,uuid,text,text,text,integer,uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.join_room_with_team(text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.join_room_with_team(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.join_room_with_team(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: room RPC grants do not match authenticated user access';
  END IF;

  IF has_function_privilege('anon', 'public.v3_start_mini_auction(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.v3_start_mini_auction(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_start_mini_auction(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.v3_initiate_mini_auction(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.v3_initiate_mini_auction(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.v3_initiate_mini_auction(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: mini-auction RPC grants are not restricted to their callers';
  END IF;

  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE')
     OR has_schema_privilege('service_role', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Security assertion failed: application roles can CREATE in public';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p
     WHERE p.oid IN (
       'public.resolve_user_id()'::pg_catalog.regprocedure,
       'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)'::pg_catalog.regprocedure,
       'public.v3_place_bot_bid(uuid,uuid,uuid,uuid,integer,uuid,integer,integer)'::pg_catalog.regprocedure,
       'public.v3_mark_bot_drop(uuid,uuid,uuid,integer)'::pg_catalog.regprocedure,
       'public.v3_start_bidding(uuid,uuid)'::pg_catalog.regprocedure,
       'public.v3_start_bidding(uuid,uuid,boolean)'::pg_catalog.regprocedure,
       'public.v3_finalize_and_advance_lot(uuid,uuid)'::pg_catalog.regprocedure,
       'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)'::pg_catalog.regprocedure,
       'public.v3_close_mini_selection(uuid,boolean)'::pg_catalog.regprocedure,
       'public.create_room_with_team(text,text,jsonb,uuid,text,text,text,integer,uuid[])'::pg_catalog.regprocedure,
       'public.join_room_with_team(text,text,text,text)'::pg_catalog.regprocedure,
       'public.v3_start_mini_auction(uuid)'::pg_catalog.regprocedure,
       'public.v3_initiate_mini_auction(uuid)'::pg_catalog.regprocedure
     )
       AND NOT COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'Security assertion failed: a reviewed SECURITY DEFINER search_path is not pinned safely';
  END IF;
END;
$assertions$;

NOTIFY pgrst, 'reload schema';

COMMIT;
