-- C6/C7 follow-up for the auction and room RPCs identified in the live
-- disposable-schema audit. Each target below is explicit; unrelated routines
-- are not rewritten by this migration.

BEGIN;

-- New functions must start with no API-role or PUBLIC execution grant. Existing
-- routines keep their reviewed, explicit ACLs; callers of future RPCs must get
-- an intentional GRANT in the same migration that creates the function.
-- PostgreSQL's built-in PUBLIC default is global, so revoke it globally for
-- the application migration role, then clear API-role defaults in public.
-- Application migrations create the audited RPCs as postgres; do not alter
-- the unrelated supabase_admin/system defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;

-- Authoritative state is readable by the room host/participants and trusted
-- service workers only. The prior SECURITY DEFINER implementation bypassed
-- RLS without checking room membership.
CREATE OR REPLACE FUNCTION public.get_authoritative_auction_state(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_active_lot public.auction_lots%ROWTYPE;
  v_current_player public.players%ROWTYPE;
  v_bid_count integer := 0;
  v_effective_bid integer := 0;
  v_timer_sec integer := 15;
  v_now timestamptz := clock_timestamp();
  v_timer_expires_iso text := NULL;
  v_is_get_ready boolean := false;
  v_get_ready_expires_iso text := NULL;
  v_teams jsonb := '[]'::jsonb;
  v_queue jsonb := '[]'::jsonb;
  v_user_id uuid;
  v_request_role text := COALESCE(current_setting('role', true), '');
  v_is_service_role boolean := COALESCE(
    (v_request_role = 'service_role' AND auth.role() = 'service_role')
      OR session_user IN ('postgres', 'supabase_admin', 'service_role'),
    false
  ) AND v_request_role NOT IN ('authenticated', 'anon');
BEGIN
  IF NOT v_is_service_role THEN
    v_user_id := public.resolve_user_id();
    IF v_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.rooms r
      LEFT JOIN public.room_participants rp ON rp.room_id = r.id
      WHERE r.id = p_room_id
        AND (r.host_id = v_user_id OR rp.user_id = v_user_id)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_MEMBERSHIP_REQUIRED');
    END IF;
  END IF;

  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.room_id = p_room_id
  ORDER BY
    CASE a.status
      WHEN 'IN_PROGRESS' THEN 1
      WHEN 'PAUSED' THEN 2
      WHEN 'MINI_AUCTION' THEN 3
      WHEN 'COMPLETED' THEN 4
      ELSE 5
    END ASC,
    a.created_at DESC
  LIMIT 1;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NO_AUCTION_FOUND', 'message', 'No auction exists for this room');
  END IF;

  SELECT al.* INTO v_active_lot
  FROM public.auction_lots al
  WHERE (v_auction.current_lot_id IS NOT NULL AND al.id = v_auction.current_lot_id)
     OR (v_auction.current_lot_id IS NULL AND al.auction_id = v_auction.id AND al.lot_index = v_auction.current_lot_index)
  LIMIT 1;

  SELECT p.* INTO v_current_player
  FROM public.players p
  WHERE v_active_lot.id IS NOT NULL AND p.id = v_active_lot.player_id
  LIMIT 1;

  IF v_active_lot.id IS NOT NULL THEN
    v_timer_sec := COALESCE(v_active_lot.timer_duration_seconds, 15);
    IF v_active_lot.timer_expires_at IS NOT NULL THEN
      v_timer_expires_iso := to_char(v_active_lot.timer_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;
    IF v_active_lot.status = 'GET_READY' AND v_active_lot.get_ready_expires_at IS NOT NULL THEN
      v_is_get_ready := v_active_lot.get_ready_expires_at > v_now;
      v_get_ready_expires_iso := to_char(v_active_lot.get_ready_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;

    SELECT count(*) INTO v_bid_count
    FROM public.bids b
    WHERE b.lot_id = v_active_lot.id AND b.is_valid = true;

    IF v_bid_count > 0 AND v_active_lot.current_bid > 0 THEN
      v_effective_bid := v_active_lot.current_bid;
    ELSE
      v_effective_bid := COALESCE(v_active_lot.base_price, v_current_player.base_price, 200);
    END IF;
  ELSE
    v_effective_bid := 0;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'shortName', t.short_name,
      'color', t.color,
      'purse', t.purse,
      'initial_purse', t.initial_purse,
      'playersBought', COALESCE((SELECT count(*) FROM public.squad_players sp WHERE sp.team_id = t.id), 0),
      'is_bot', t.is_bot
    ) ORDER BY t.name ASC
  ) INTO v_teams
  FROM public.teams t
  WHERE t.auction_id = v_auction.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_auction.status,
    'auctionId', v_auction.id,
    'roomId', v_auction.room_id,
    'lotId', v_active_lot.id,
    'lotIndex', v_auction.current_lot_index,
    'isUnsoldRound', v_auction.is_unsold_round,
    'playerId', v_active_lot.player_id,
    'currentBid', v_effective_bid,
    'highestBidderId', v_active_lot.highest_bidder_team_id,
    'winningTeamId', v_active_lot.winning_team_id,
    'winningBid', v_active_lot.winning_bid,
    'bidCount', v_bid_count,
    'timerDurationSeconds', v_timer_sec,
    'timerExpiresAt', v_timer_expires_iso,
    'isGetReady', v_is_get_ready,
    'getReadyExpiresAt', v_get_ready_expires_iso,
    'lotStatus', COALESCE(v_active_lot.status, 'PENDING'),
    'teams', COALESCE(v_teams, '[]'::jsonb),
    'queue', COALESCE(v_queue, '[]'::jsonb),
    'player_stats', CASE WHEN v_current_player.id IS NOT NULL THEN jsonb_build_object(
      'name', v_current_player.name,
      'age', v_current_player.age,
      'category', v_current_player.category,
      'role', v_current_player.role,
      'country', v_current_player.country,
      'batting_hand', v_current_player.batting_hand,
      'base_price', v_current_player.base_price,
      'is_overseas', v_current_player.is_overseas,
      'image_url', v_current_player.image_url,
      'matches', v_current_player.matches,
      'runs', v_current_player.runs,
      'wickets', v_current_player.wickets,
      'batting_average', v_current_player.batting_average,
      'strike_rate', v_current_player.strike_rate,
      'economy_rate', v_current_player.economy_rate,
      'bowling_average', v_current_player.bowling_average,
      'bowling_strike_rate', v_current_player.bowling_strike_rate,
      'best_bowling', v_current_player.best_bowling,
      'highest_score', v_current_player.highest_score,
      'hundreds', v_current_player.hundreds,
      'fifties', v_current_player.fifties,
      'three_wicket_hauls', v_current_player.three_wicket_hauls,
      'catches', v_current_player.catches,
      'stumpings', v_current_player.stumpings
    ) ELSE NULL END
  );
END;
$function$;

-- Snapshot creation uses the Clerk-to-Supabase mapping and only copies a
-- player set the caller owns or that is explicitly public.
CREATE OR REPLACE FUNCTION public.v3_create_room_snapshot(p_master_set_id uuid, p_room_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := public.resolve_user_id();
  v_new_set_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated to snapshot a room';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.player_sets ps
    WHERE ps.id = p_master_set_id
      AND (ps.is_public OR ps.created_by = v_user_id)
  ) THEN
    RAISE EXCEPTION 'PLAYER_SET_NOT_FOUND_OR_FORBIDDEN';
  END IF;

  INSERT INTO public.player_sets (name, description, created_by, is_public)
  VALUES (
    'Room ' || trim(p_room_code) || ' Snapshot',
    'Isolated player data snapshot for room ' || trim(p_room_code),
    v_user_id,
    false
  )
  RETURNING id INTO v_new_set_id;

  INSERT INTO public.players (
    player_set_id, name, role, category, base_price, is_overseas, image_url, country,
    age, batting_hand, matches, runs, batting_average, strike_rate, hundreds, fifties,
    highest_score, boundaries, overs, wickets, bowling_average, economy_rate,
    bowling_strike_rate, best_bowling, three_wicket_hauls, catches, stumpings
  )
  SELECT
    v_new_set_id, name, role, category, base_price, is_overseas, image_url, country,
    age, batting_hand, matches, runs, batting_average, strike_rate, hundreds, fifties,
    highest_score, boundaries, overs, wickets, bowling_average, economy_rate,
    bowling_strike_rate, best_bowling, three_wicket_hauls, catches, stumpings
  FROM public.players
  WHERE player_set_id = p_master_set_id;

  RETURN v_new_set_id;
END;
$function$;

-- Remove anonymous execution from each sensitive room/auction RPC found in the
-- live C6 audit. Trigger-only routines lose anon EXECUTE as well.
REVOKE ALL ON FUNCTION public.activate_lot_timer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.advance_lot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cleanup_expired_abandoned_rooms(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.initialize_and_start_auction(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.keep_bot_lot_drop_terminal() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_abandoned_rooms_expired(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provision_bots(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_room_participant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.touch_room_activity(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_auction_completed_mini_bridge() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_preserve_mega_completed_at_fn() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_my_team(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_room_settings(uuid, text, jsonb, integer, integer, integer, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v3_admin_force_initiate_mini_auction(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v3_confirm_mini_selections(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v3_create_room_snapshot(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v3_respond_trade(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v3_propose_trade(uuid, uuid, uuid, uuid[], uuid[], text, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v3_release_player(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v3_start_auction(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v3_start_mini_selection(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.v3_toggle_mini_selection(uuid, uuid, boolean) FROM PUBLIC, anon;

-- Legacy mutation endpoints lack caller checks. Keep timer/cleanup operations
-- on the server and disable the old arbitrary-amount process_bid RPC.
REVOKE ALL ON FUNCTION public.activate_lot_timer(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.activate_lot_timer(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.advance_lot(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.advance_lot(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cleanup_expired_abandoned_rooms(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_abandoned_rooms(integer) TO service_role;
REVOKE ALL ON FUNCTION public.mark_abandoned_rooms_expired(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_rooms_expired(integer) TO service_role;
REVOKE ALL ON FUNCTION public.process_lot_expiry(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_lot_expiry(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.provision_bots(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.provision_bots(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.touch_room_activity(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.touch_room_activity(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.process_bid(uuid, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- These room RPCs perform authenticated-user authorization in their bodies.
-- Do not leave a service_role grant that those bodies reject.
REVOKE ALL ON FUNCTION public.delete_room(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.delete_room(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.provision_room_bots(uuid, jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.provision_room_bots(uuid, jsonb) TO authenticated;

-- These functions use the authenticated user's own identity/ownership checks;
-- service-role calls have a separate worker RPC where one is required.
REVOKE ALL ON FUNCTION public.initialize_and_start_auction(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.initialize_and_start_auction(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_room_participant(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.remove_room_participant(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.update_my_team(uuid, text, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.update_my_team(uuid, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_room_settings(uuid, text, jsonb, integer, integer, integer, jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.update_room_settings(uuid, text, jsonb, integer, integer, integer, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.v3_admin_force_initiate_mini_auction(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.v3_admin_force_initiate_mini_auction(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.v3_confirm_mini_selections(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.v3_confirm_mini_selections(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.v3_create_room_snapshot(uuid, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.v3_create_room_snapshot(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.v3_propose_trade(uuid, uuid, uuid, uuid[], uuid[], text, uuid, jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.v3_propose_trade(uuid, uuid, uuid, uuid[], uuid[], text, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.v3_release_player(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.v3_release_player(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.v3_respond_trade(uuid, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.v3_respond_trade(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.v3_start_auction(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.v3_start_auction(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.v3_start_mini_selection(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.v3_start_mini_selection(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.v3_toggle_mini_selection(uuid, uuid, boolean) FROM service_role;
GRANT EXECUTE ON FUNCTION public.v3_toggle_mini_selection(uuid, uuid, boolean) TO authenticated;

-- Explicitly pin the SECURITY DEFINER functions in this reviewed C6/C7
-- surface. The broader public-schema inventory remains outside this migration.
ALTER FUNCTION public._emit_auction_event(uuid, text, jsonb, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public._get_lot_get_ready_expires_at(timestamptz, integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public._process_bid_internal(uuid, uuid, integer, uuid, boolean) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.activate_lot_timer(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.advance_lot(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.cleanup_expired_abandoned_rooms(integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.delete_room(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.evaluate_bot_interests(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.execute_bot_bids(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.get_authoritative_auction_state(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.initialize_and_start_auction(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.is_room_participant(uuid, uuid) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.mark_abandoned_rooms_expired(integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.pause_auction(uuid, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.process_bid(uuid, uuid, integer, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.process_lot_expiry(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.provision_bots(uuid, integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.provision_room_bots(uuid, jsonb) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.remove_room_participant(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.resume_auction(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.start_auction(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.touch_room_activity(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_my_team(uuid, text, text, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_room_settings(uuid, text, jsonb, integer, integer, integer, jsonb) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_admin_force_initiate_mini_auction(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_confirm_mini_selections(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_create_room_snapshot(uuid, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_propose_trade(uuid, uuid, uuid, uuid[], uuid[], text, uuid, jsonb) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_respond_bot_trade(uuid, text, text) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.v3_release_player(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_respond_trade(uuid, text, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_start_auction(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_start_mini_selection(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.v3_toggle_mini_selection(uuid, uuid, boolean) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.trg_auction_completed_mini_bridge() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.trg_preserve_mega_completed_at_fn() SET search_path = pg_catalog, public, pg_temp;

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        '_emit_auction_event', '_get_lot_get_ready_expires_at', '_process_bid_internal',
        'activate_lot_timer', 'advance_lot', 'cleanup_expired_abandoned_rooms',
        'delete_room', 'get_authoritative_auction_state', 'handle_new_user',
        'evaluate_bot_interests', 'execute_bot_bids', 'initialize_and_start_auction',
        'is_room_participant', 'mark_abandoned_rooms_expired',
        'pause_auction', 'process_bid', 'process_lot_expiry', 'provision_bots',
        'provision_room_bots', 'remove_room_participant', 'resume_auction',
        'start_auction', 'touch_room_activity', 'update_my_team', 'update_room_settings',
        'v3_admin_force_initiate_mini_auction', 'v3_confirm_mini_selections',
        'v3_create_room_snapshot', 'v3_propose_trade', 'v3_release_player',
        'v3_respond_bot_trade', 'v3_respond_trade', 'v3_start_auction',
        'v3_start_mini_selection', 'v3_toggle_mini_selection'
      )
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'C6 failed: anon retains execute on a reviewed auction/room RPC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'C6 failed: anon can execute a public SECURITY DEFINER function';
  END IF;

  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE')
     OR has_schema_privilege('service_role', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'C7 failed: an application role can create shadow objects in public';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) acl
    WHERE d.defaclobjtype = 'f'
      AND d.defaclrole = 'postgres'::pg_catalog.regrole
      AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::pg_catalog.regnamespace)
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee IN (
        0,
        'anon'::pg_catalog.regrole,
        'authenticated'::pg_catalog.regrole,
        'service_role'::pg_catalog.regrole
      )
  ) THEN
    RAISE EXCEPTION 'C6 failed: future functions retain implicit PUBLIC/API-role EXECUTE defaults';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT (
        COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
        OR COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public, auth, pg_temp']::text[]
        OR COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']::text[]
      )
  ) THEN
    RAISE EXCEPTION 'C7 failed: a public SECURITY DEFINER function has an unreviewed search_path';
  END IF;

  IF has_function_privilege('authenticated', 'public.process_bid(uuid,uuid,integer,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.process_bid(uuid,uuid,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C6 failed: legacy raw process_bid remains executable';
  END IF;

  IF has_function_privilege('anon', 'public.get_authoritative_auction_state(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_authoritative_auction_state(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_authoritative_auction_state(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.v3_create_room_snapshot(uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.v3_create_room_snapshot(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.v3_create_room_snapshot(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C7 failed: state/snapshot RPC grants do not match their authorization checks';
  END IF;

  IF has_function_privilege('anon', 'public.v3_admin_force_initiate_mini_auction(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v3_admin_force_initiate_mini_auction(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_admin_force_initiate_mini_auction(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C6 failed: force mini-auction RPC is not service-role-only';
  END IF;

  IF has_function_privilege('anon', 'public.delete_room(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.delete_room(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.delete_room(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.provision_room_bots(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.provision_room_bots(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.provision_room_bots(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.v3_respond_trade(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.v3_respond_trade(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.v3_respond_trade(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C6 failed: user-only room/trade RPC grants do not match their authorization checks';
  END IF;

  IF has_function_privilege('authenticated', 'public.activate_lot_timer(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.activate_lot_timer(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.advance_lot(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.advance_lot(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.process_lot_expiry(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.process_lot_expiry(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.provision_bots(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.provision_bots(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C6 failed: server-only auction worker RPC grants are incorrect';
  END IF;

  IF has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.handle_new_user()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.set_updated_at()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.set_updated_at()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.keep_bot_lot_drop_terminal()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.keep_bot_lot_drop_terminal()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.keep_bot_lot_drop_terminal()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.trg_auction_completed_mini_bridge()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.trg_auction_completed_mini_bridge()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.trg_auction_completed_mini_bridge()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.trg_preserve_mega_completed_at_fn()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.trg_preserve_mega_completed_at_fn()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.trg_preserve_mega_completed_at_fn()', 'EXECUTE') THEN
    RAISE EXCEPTION 'C6 failed: a trigger-only function remains executable by an application role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname IN (
        '_emit_auction_event', '_get_lot_get_ready_expires_at', '_process_bid_internal',
        'activate_lot_timer', 'advance_lot', 'cleanup_expired_abandoned_rooms',
        'delete_room', 'get_authoritative_auction_state', 'handle_new_user',
        'evaluate_bot_interests', 'execute_bot_bids', 'initialize_and_start_auction',
        'is_room_participant', 'mark_abandoned_rooms_expired',
        'pause_auction', 'process_bid', 'process_lot_expiry', 'provision_bots',
        'provision_room_bots', 'remove_room_participant', 'resume_auction',
        'start_auction', 'touch_room_activity', 'update_my_team', 'update_room_settings',
        'v3_admin_force_initiate_mini_auction', 'v3_confirm_mini_selections',
        'v3_create_room_snapshot', 'v3_propose_trade', 'v3_release_player',
        'v3_respond_bot_trade', 'v3_respond_trade', 'v3_start_auction',
        'v3_start_mini_selection', 'v3_toggle_mini_selection'
      )
      AND NOT COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
      AND NOT (
        p.proname IN ('is_room_participant', 'v3_respond_bot_trade')
        AND COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public, auth, pg_temp']::text[]
      )
  ) THEN
    RAISE EXCEPTION 'C7 failed: a reviewed auction/room SECURITY DEFINER search_path is not pinned';
  END IF;
END;
$assertions$;

NOTIFY pgrst, 'reload schema';

COMMIT;
