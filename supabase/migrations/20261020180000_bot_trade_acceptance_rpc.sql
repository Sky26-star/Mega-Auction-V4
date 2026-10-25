-- Add a server-only bot acceptance boundary without widening human trade RPCs.
-- The bot RPC validates the mapped room host and pending bot-receiver trade,
-- then delegates the locked swap to v3_respond_trade so ownership, roster,
-- overseas, competing-trade, and audit-log behavior stay in one implementation.

BEGIN;

DO $patch_v3_respond_trade$
DECLARE
  v_function_oid oid := 'public.v3_respond_trade(uuid,text,text)'::regprocedure;
  v_definition text;
  v_before_owner oid;
  v_before_config text[];
  v_before_security_definer boolean;
  v_old_actor text := '  v_user_id UUID := public.resolve_user_id();';
  v_new_actor text := $replacement$
  v_bot_accept_host_profile_id UUID := CASE
    WHEN p_action = 'ACCEPT' AND auth.jwt()->>'role' = 'service_role'
      THEN NULLIF(current_setting('app.v3_bot_trade_host_profile_id', true), '')::UUID
    ELSE NULL
  END;
  v_is_bot_accept BOOLEAN := v_bot_accept_host_profile_id IS NOT NULL;
  v_user_id UUID := COALESCE(v_bot_accept_host_profile_id, public.resolve_user_id());$replacement$;
  v_old_accept text := '    IF NOT v_is_receiver AND NOT (v_is_host AND v_receiver_team.is_bot AND NOT v_is_proposer) THEN';
  v_new_accept text := '    IF NOT v_is_receiver AND NOT (v_is_host AND v_receiver_team.is_bot AND (NOT v_is_proposer OR v_is_bot_accept)) THEN';
  v_has_old_actor boolean;
  v_has_old_accept boolean;
BEGIN
  SELECT p.proowner, p.proconfig, p.prosecdef
  INTO v_before_owner, v_before_config, v_before_security_definer
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_function_oid;

  IF v_before_owner IS NULL OR NOT v_before_security_definer
     OR v_before_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'Unexpected v3_respond_trade owner/security/search_path; refusing bot-acceptance patch';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;
  v_has_old_actor := position(v_old_actor IN v_definition) > 0;
  v_has_old_accept := position(v_old_accept IN v_definition) > 0;

  IF v_has_old_actor AND v_has_old_accept THEN
    IF length(v_definition) - length(replace(v_definition, v_old_actor, '')) <> length(v_old_actor)
       OR length(v_definition) - length(replace(v_definition, v_old_accept, '')) <> length(v_old_accept) THEN
      RAISE EXCEPTION 'Unexpected duplicate authorization fragments in v3_respond_trade';
    END IF;

    v_definition := replace(v_definition, v_old_actor, v_new_actor);
    v_definition := replace(v_definition, v_old_accept, v_new_accept);
    EXECUTE v_definition;
  ELSIF position(v_new_actor IN v_definition) > 0 AND position(v_new_accept IN v_definition) > 0
        AND NOT v_has_old_actor AND NOT v_has_old_accept THEN
    -- Idempotent rerun after this exact patch.
    NULL;
  ELSE
    RAISE EXCEPTION 'v3_respond_trade differs from the reviewed 00059 authorization baseline; refusing patch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_function_oid
      AND p.proowner = v_before_owner
      AND p.prosecdef = v_before_security_definer
      AND p.proconfig IS NOT DISTINCT FROM v_before_config
  ) THEN
    RAISE EXCEPTION 'v3_respond_trade owner/security/search_path changed during patch';
  END IF;
END;
$patch_v3_respond_trade$;

CREATE OR REPLACE FUNCTION public.v3_respond_bot_trade(
  p_trade_id UUID,
  p_host_clerk_user_id TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_role TEXT := auth.jwt()->>'role';
  v_host_profile_id UUID;
  v_trade public.trades%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_auction_room_id UUID;
  v_proposer_team public.teams%ROWTYPE;
  v_receiver_team public.teams%ROWTYPE;
  v_result JSONB;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- The service-role JWT is required; user and anonymous clients cannot use
  -- this RPC even if they know a trade or Clerk subject.
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ERR_UNAUTHORIZED_BOT_TRADE_CALLER' USING ERRCODE = '42501';
  END IF;

  -- Clear any stale session value before doing work. The capability is set
  -- only around the call to the existing atomic response implementation.
  PERFORM pg_catalog.set_config('app.v3_bot_trade_host_profile_id', '', true);

  IF p_host_clerk_user_id IS NULL OR btrim(p_host_clerk_user_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_TRADE_HOST_ID_REQUIRED');
  END IF;

  -- Preserve the resolver's legacy UUID-subject behavior; otherwise require
  -- an explicit Clerk-to-profile mapping. A host ID is never accepted from
  -- the browser: the server route passes Clerk's authenticated subject.
  BEGIN
    v_host_profile_id := p_host_clerk_user_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    v_host_profile_id := NULL;
  END;

  IF v_host_profile_id IS NULL THEN
    SELECT m.profile_id INTO v_host_profile_id
    FROM public.clerk_user_mappings m
    WHERE m.clerk_user_id = p_host_clerk_user_id;
  END IF;

  IF v_host_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_TRADE_HOST_UNMAPPED');
  END IF;

  SELECT t.* INTO v_trade
  FROM public.trades t
  WHERE t.id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_NOT_FOUND');
  END IF;

  SELECT r.* INTO v_room
  FROM public.rooms r
  WHERE r.id = v_trade.room_id
  FOR SHARE;

  IF NOT FOUND OR v_room.host_id IS DISTINCT FROM v_host_profile_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED_BOT_TRADE_HOST');
  END IF;

  SELECT a.room_id INTO v_auction_room_id
  FROM public.auctions a
  WHERE a.id = v_trade.auction_id
  FOR SHARE;

  IF NOT FOUND OR v_auction_room_id IS DISTINCT FROM v_trade.room_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_AUCTION_ROOM_MISMATCH');
  END IF;

  -- Lock teams in a deterministic order before checking their auction scope.
  PERFORM tm.id
  FROM public.teams tm
  WHERE tm.auction_id = v_trade.auction_id
    AND tm.id IN (v_trade.proposer_team_id, v_trade.receiver_team_id)
  ORDER BY tm.id
  FOR UPDATE OF tm;

  SELECT tm.* INTO v_proposer_team
  FROM public.teams tm
  WHERE tm.id = v_trade.proposer_team_id AND tm.auction_id = v_trade.auction_id;

  SELECT tm.* INTO v_receiver_team
  FROM public.teams tm
  WHERE tm.id = v_trade.receiver_team_id AND tm.auction_id = v_trade.auction_id;

  IF v_proposer_team.id IS NULL OR v_receiver_team.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_TEAM_AUCTION_MISMATCH');
  END IF;

  IF NOT v_receiver_team.is_bot THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_TRADE_RECEIVER_NOT_BOT');
  END IF;

  -- A human proposer must be represented by a room participant. Bot-to-bot
  -- offers are also supported by the host-authorized bot-cycle route.
  IF NOT v_proposer_team.is_bot AND NOT EXISTS (
    SELECT 1
    FROM public.room_participants rp
    WHERE rp.room_id = v_trade.room_id
      AND rp.team_id = v_trade.proposer_team_id
      AND rp.user_id IS NOT NULL
      AND rp.role <> 'SPECTATOR'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_PROPOSER_NOT_ROOM_PARTICIPANT');
  END IF;

  IF v_trade.status IS DISTINCT FROM 'PENDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_NOT_PENDING', 'status', v_trade.status);
  END IF;

  IF v_trade.expires_at IS NOT NULL AND v_now >= v_trade.expires_at THEN
    UPDATE public.trades
    SET status = 'EXPIRED', updated_at = v_now
    WHERE id = v_trade.id AND status = 'PENDING';
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_EXPIRED');
  END IF;

  -- The ordinary RPC owns the locked swap, ownership rechecks, roster and
  -- overseas limits, competing-trade expiry, and audit log. The scoped GUC
  -- lets it record/authorize this mapped host only for this bot ACCEPT call.
  PERFORM pg_catalog.set_config('app.v3_bot_trade_host_profile_id', v_host_profile_id::TEXT, true);
  v_result := public.v3_respond_trade(v_trade.id, 'ACCEPT', p_notes);
  PERFORM pg_catalog.set_config('app.v3_bot_trade_host_profile_id', '', true);
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_catalog.set_config('app.v3_bot_trade_host_profile_id', '', true);
  RAISE;
END;
$function$;

-- The privileged implementation must be owned by the trusted local Supabase
-- migration owner; otherwise SECURITY DEFINER would not have a stable owner.
ALTER FUNCTION public.v3_respond_bot_trade(UUID, TEXT, TEXT) OWNER TO postgres;

-- Keep human acceptance on the ordinary authenticated-user RPC. Do not allow
-- direct anonymous or service-role use of that path; bot routes use only the
-- dedicated RPC above.
REVOKE ALL ON FUNCTION public.v3_respond_trade(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.v3_respond_trade(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.v3_respond_bot_trade(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_respond_bot_trade(UUID, TEXT, TEXT) TO service_role;

DO $assert_bot_trade_rpc_security$
DECLARE
  v_human_oid oid := 'public.v3_respond_trade(uuid,text,text)'::regprocedure;
  v_bot_oid oid := 'public.v3_respond_bot_trade(uuid,text,text)'::regprocedure;
BEGIN
  IF NOT pg_catalog.has_function_privilege('authenticated', v_human_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_human_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_human_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected effective EXECUTE grants on v3_respond_trade';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', v_bot_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_bot_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_bot_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected effective EXECUTE grants on v3_respond_bot_trade';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_bot_oid
      AND p.proowner = 'postgres'::regrole
      AND p.prosecdef
      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public, auth']::text[]
  ) THEN
    RAISE EXCEPTION 'Unexpected owner/security/search_path on v3_respond_bot_trade';
  END IF;
END;
$assert_bot_trade_rpc_security$;

NOTIFY pgrst, 'reload schema';

COMMIT;
