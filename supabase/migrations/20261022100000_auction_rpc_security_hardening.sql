-- Migration: 20261022100000_auction_rpc_security_hardening.sql
-- Description: Comprehensive Auction RPC Security Hardening & Concurrency Consolidation
--   1. Secure v3_place_bid: Require room participant team membership for humans, reject forged bot bids,
--      prevent human bidding on bot teams, enforce server-only bot bidding, and validate idempotency post-auth.
--   2. Secure v3_start_bidding: Disallow non-service_role force bypass of GET_READY timer.
--   3. Secure v3_finalize_and_advance_lot: Preserve distributed advisory lock (pg_try_advisory_xact_lock)
--      and finalization from 00060, while hardening timer force check against non-service_role.
--   4. Strict RPC ACLs: Restrict lifecycle RPCs (finalize, start_bidding, close_mini_selection) to service_role only.
--      Revoke anonymous execution from v3_place_bid.
-- NOTE: DO NOT APPLY TO PRODUCTION WITHOUT PRIOR SEPARATE APPROVAL.

BEGIN;

-- ============================================================================
-- 1. SECURE v3_place_bid
-- ============================================================================
CREATE OR REPLACE FUNCTION public.v3_place_bid(
  p_auction_id uuid,
  p_lot_id uuid,
  p_team_id uuid,
  p_request_id uuid,
  p_is_bot boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lot public.auction_lots%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_room_settings JSONB;
  v_room_id UUID;
  v_user_id UUID := public.resolve_user_id();
  v_jwt_claims_raw TEXT := nullif(current_setting('request.jwt.claims', true), '');
  v_jwt_claims JSONB := CASE 
    WHEN v_jwt_claims_raw IS NOT NULL AND v_jwt_claims_raw ~ '^\s*\{' 
    THEN v_jwt_claims_raw::jsonb 
    ELSE NULL 
  END;
  v_jwt_role TEXT := CASE 
    WHEN v_jwt_claims IS NOT NULL THEN (v_jwt_claims->>'role') 
    ELSE NULL 
  END;
  v_session_role TEXT := COALESCE(current_setting('role', true), '');
  v_is_service_role BOOLEAN := COALESCE(
    (v_session_role = 'service_role' AND (v_jwt_role = 'service_role' OR auth.role() = 'service_role'))
    OR session_user IN ('postgres', 'supabase_admin', 'service_role'),
    false
  )
  AND v_session_role NOT IN ('authenticated', 'anon');
  v_now TIMESTAMPTZ := clock_timestamp();
  v_min_increment INT;
  v_min_required_bid INT;
  v_max_squad_size INT;
  v_max_overseas INT;
  v_is_overseas BOOLEAN;
  v_existing_bid public.bids%ROWTYPE;
  v_bid_number INT;
  v_bid_id UUID;
  v_new_expires_at TIMESTAMPTZ;
BEGIN
  -- Request ID is strictly required for all bid submissions
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_REQUEST_ID_REQUIRED');
  END IF;

  -- 1. LOCK LOT FIRST (Consistent global lock hierarchy: auction_lots -> teams)
  SELECT * INTO v_lot
    FROM public.auction_lots
   WHERE id = p_lot_id AND auction_id = p_auction_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_FOUND');
  END IF;

  -- 2. LOCK TEAM SECOND (Prevents deadlock cycle with v3_finalize_and_advance_lot)
  SELECT * INTO v_team
    FROM public.teams
   WHERE id = p_team_id AND auction_id = p_auction_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_NOT_FOUND');
  END IF;

  -- 3. CALLER AUTHORIZATION
  -- A client claiming p_is_bot=true without being the service_role is rejected immediately
  IF COALESCE(p_is_bot, false) AND NOT v_is_service_role THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_BID_FORBIDDEN');
  END IF;

  -- Human callers cannot bid on bot teams
  IF v_team.is_bot AND NOT v_is_service_role THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_BID_FORBIDDEN');
  END IF;

  -- Bot bids cannot be submitted on behalf of human teams
  IF NOT v_team.is_bot AND COALESCE(p_is_bot, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_BID_FORBIDDEN');
  END IF;

  -- Human callers must be authenticated and verified as a human participant of the specific team
  IF NOT v_is_service_role THEN
    IF v_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
    END IF;

    SELECT a.room_id
      INTO v_room_id
      FROM public.auctions a
     WHERE a.id = p_auction_id;

    IF v_room_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM public.room_participants rp
       WHERE rp.room_id = v_room_id
         AND rp.user_id = v_user_id
         AND rp.team_id = p_team_id
         AND rp.is_bot = false
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_MEMBERSHIP_REQUIRED');
    END IF;
  END IF;

  -- 4. IDEMPOTENCY CHECK (executed AFTER caller authorization to prevent cross-team request_id snooping)
  SELECT * INTO v_existing_bid
    FROM public.bids
   WHERE request_id = p_request_id;

  IF FOUND THEN
    IF v_existing_bid.auction_id != p_auction_id
       OR v_existing_bid.team_id != p_team_id
       OR v_existing_bid.lot_id != p_lot_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_DUPLICATE_REQUEST');
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', true,
      'bid_id', v_existing_bid.id,
      'auction_id', v_existing_bid.auction_id,
      'lot_id', v_existing_bid.lot_id,
      'team_id', v_existing_bid.team_id,
      'amount', v_existing_bid.amount,
      'request_id', v_existing_bid.request_id
    );
  END IF;

  -- 5. LOT STATUS & TIMER VALIDATION
  -- AUTO-TRANSITION GET_READY -> BIDDING IF TIMER EXPIRED
  IF v_lot.status = 'GET_READY' THEN
    IF v_lot.get_ready_expires_at IS NOT NULL
       AND v_now >= v_lot.get_ready_expires_at THEN
      v_lot.status := 'BIDDING';
      v_lot.timer_expires_at := v_now
        + (v_lot.timer_duration_seconds * INTERVAL '1 second');

      UPDATE public.auction_lots
         SET status = 'BIDDING', timer_expires_at = v_lot.timer_expires_at
       WHERE id = v_lot.id;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_BIDDING');
    END IF;
  END IF;

  IF v_lot.status != 'BIDDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_BIDDING');
  END IF;

  IF v_lot.timer_expires_at IS NOT NULL AND v_now >= v_lot.timer_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TIMER_EXPIRED');
  END IF;

  IF v_lot.highest_bidder_team_id = p_team_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ALREADY_HIGHEST_BIDDER');
  END IF;

  -- 4. FETCH SETTINGS & PLAYER
  SELECT r.settings
    INTO v_room_settings
    FROM public.auctions a
    JOIN public.rooms r ON a.room_id = r.id
   WHERE a.id = p_auction_id;

  SELECT is_overseas
    INTO v_is_overseas
    FROM public.players
   WHERE id = v_lot.player_id;

  v_max_squad_size := COALESCE((v_room_settings->>'max_squad_size')::int, 25);
  v_max_overseas := COALESCE((v_room_settings->>'max_overseas')::int, 8);

  -- 6. CALCULATE REQUIRED BID VIA INCREMENT LADDER
  IF v_lot.highest_bidder_team_id IS NULL OR v_lot.current_bid = 0 THEN
    v_min_required_bid := v_lot.base_price;
  ELSE
    v_min_increment := CASE
      WHEN v_lot.current_bid <= 300 THEN 25
      WHEN v_lot.current_bid <= 600 THEN 50
      WHEN v_lot.current_bid <= 1000 THEN 75
      WHEN v_lot.current_bid <= 1500 THEN 100
      WHEN v_lot.current_bid <= 2000 THEN 150
      WHEN v_lot.current_bid <= 2500 THEN 175
      ELSE 200
    END;
    v_min_required_bid := v_lot.current_bid + v_min_increment;
  END IF;

  -- 7. VALIDATIONS
  IF v_team.purse < v_min_required_bid THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INSUFFICIENT_PURSE');
  END IF;

  IF v_team.players_bought >= v_max_squad_size THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SQUAD_LIMIT_REACHED');
  END IF;

  IF v_is_overseas AND v_team.overseas_count >= v_max_overseas THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_OVERSEAS_LIMIT');
  END IF;

  -- 8. APPLY BID & EXTEND TIMER
  SELECT COALESCE(MAX(bid_number), 0) + 1
    INTO v_bid_number
    FROM public.bids
   WHERE lot_id = v_lot.id;

  v_new_expires_at := v_now
    + (v_lot.timer_duration_seconds * INTERVAL '1 second');

  INSERT INTO public.bids (
    auction_id, lot_id, team_id, amount, request_id, is_bot, is_valid,
    bid_number, created_at
  ) VALUES (
    p_auction_id, v_lot.id, p_team_id, v_min_required_bid, p_request_id,
    v_team.is_bot, true, v_bid_number, v_now
  )
  RETURNING id INTO v_bid_id;

  UPDATE public.auction_lots
     SET current_bid = v_min_required_bid,
         highest_bidder_team_id = p_team_id,
         timer_expires_at = v_new_expires_at
   WHERE id = v_lot.id;

  RETURN jsonb_build_object(
    'success', true,
    'auction_id', p_auction_id,
    'lot_id', p_lot_id,
    'team_id', p_team_id,
    'bid_id', v_bid_id,
    'amount', v_min_required_bid,
    'current_bid', v_min_required_bid,
    'highest_bidder_team_id', p_team_id,
    'timer_expires_at', v_new_expires_at,
    'sequence', v_bid_number,
    'request_id', p_request_id
  );
END;
$function$;

-- ============================================================================
-- 2. SECURE v3_start_bidding
-- ============================================================================
DROP FUNCTION IF EXISTS public.v3_start_bidding(uuid, uuid, boolean);
CREATE OR REPLACE FUNCTION public.v3_start_bidding(
  p_auction_id uuid,
  p_lot_id uuid,
  p_force boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_lot public.auction_lots%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_timer_expires_at TIMESTAMPTZ;
  v_jwt_claims_raw TEXT := nullif(current_setting('request.jwt.claims', true), '');
  v_jwt_claims JSONB := CASE 
    WHEN v_jwt_claims_raw IS NOT NULL AND v_jwt_claims_raw ~ '^\s*\{' 
    THEN v_jwt_claims_raw::jsonb 
    ELSE NULL 
  END;
  v_jwt_role TEXT := CASE 
    WHEN v_jwt_claims IS NOT NULL THEN (v_jwt_claims->>'role') 
    ELSE NULL 
  END;
  v_session_role TEXT := COALESCE(current_setting('role', true), '');
  v_is_service_role BOOLEAN := COALESCE(
    (v_session_role = 'service_role' AND (v_jwt_role = 'service_role' OR auth.role() = 'service_role'))
    OR session_user IN ('postgres', 'supabase_admin', 'service_role'),
    false
  )
  AND v_session_role NOT IN ('authenticated', 'anon');
BEGIN
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  IF v_auction.current_lot_id != p_lot_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NOT_CURRENT_LOT');
  END IF;

  SELECT * INTO v_lot
    FROM public.auction_lots
   WHERE id = p_lot_id AND auction_id = p_auction_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_FOUND');
  END IF;

  IF v_lot.status = 'BIDDING' THEN
    RETURN jsonb_build_object(
      'success', true, 'is_duplicate', true, 'lot_id', v_lot.id,
      'status', 'BIDDING', 'timer_expires_at', v_lot.timer_expires_at
    );
  END IF;

  IF v_lot.status != 'GET_READY' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_GET_READY');
  END IF;

  -- Only trusted service role can force-bypass GET_READY timer
  IF NOT COALESCE(p_force, false) OR NOT v_is_service_role THEN
    IF v_lot.get_ready_expires_at IS NULL OR v_now < v_lot.get_ready_expires_at THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_GET_READY_NOT_EXPIRED');
    END IF;
  END IF;

  v_timer_expires_at := v_now
    + (v_lot.timer_duration_seconds * INTERVAL '1 second');

  UPDATE public.auction_lots
     SET status = 'BIDDING', timer_expires_at = v_timer_expires_at
   WHERE id = v_lot.id;

  RETURN jsonb_build_object(
    'success', true, 'lot_id', v_lot.id, 'status', 'BIDDING',
    'timer_expires_at', v_timer_expires_at
  );
END;
$function$;

-- ============================================================================
-- 3. SECURE v3_finalize_and_advance_lot (Preserves Concurrency from 00060)
-- ============================================================================
DROP FUNCTION IF EXISTS public.v3_finalize_and_advance_lot(uuid, uuid, boolean);
CREATE OR REPLACE FUNCTION public.v3_finalize_and_advance_lot(
  p_auction_id UUID,
  p_lot_id UUID,
  p_force BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lot public.auction_lots%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_next_lot public.auction_lots%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_is_overseas BOOLEAN;
  v_final_status TEXT;
  v_unsold_count INT;
  v_eligible_teams INT;
  v_room_settings JSONB;
  v_max_squad_size INT;
  v_new_auction_status TEXT;
  v_has_mini_session BOOLEAN;
  v_lock_acquired BOOLEAN;
  v_jwt_claims_raw TEXT := nullif(current_setting('request.jwt.claims', true), '');
  v_jwt_claims JSONB := CASE 
    WHEN v_jwt_claims_raw IS NOT NULL AND v_jwt_claims_raw ~ '^\s*\{' 
    THEN v_jwt_claims_raw::jsonb 
    ELSE NULL 
  END;
  v_jwt_role TEXT := CASE 
    WHEN v_jwt_claims IS NOT NULL THEN (v_jwt_claims->>'role') 
    ELSE NULL 
  END;
  v_session_role TEXT := COALESCE(current_setting('role', true), '');
  v_is_service_role BOOLEAN := COALESCE(
    (v_session_role = 'service_role' AND (v_jwt_role = 'service_role' OR auth.role() = 'service_role'))
    OR session_user IN ('postgres', 'supabase_admin', 'service_role'),
    false
  )
  AND v_session_role NOT IN ('authenticated', 'anon');
BEGIN
  -- 1. DISTRIBUTED CONCURRENCY CONTROL:
  -- Prevent concurrent tick/finalization transactions across multiple server instances
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('auction_lock_' || p_auction_id::text));
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_CONCURRENT_AUCTION_FINALIZATION_IN_PROGRESS');
  END IF;

  -- 2. LOCK CURRENT LOT
  SELECT * INTO v_lot FROM public.auction_lots WHERE id = p_lot_id AND auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_FOUND');
  END IF;

  IF v_lot.status != 'BIDDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_BIDDING');
  END IF;

  -- 3. STRICT TIMER EXPIRY VERIFICATION:
  -- Force bypass is strictly restricted to service_role. When force is false or caller is not service_role,
  -- timer must be strictly expired.
  IF NOT COALESCE(p_force, false) OR NOT v_is_service_role THEN
    IF v_lot.timer_expires_at IS NULL OR v_now < v_lot.timer_expires_at THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_TIMER_NOT_EXPIRED');
    END IF;
  END IF;

  -- 4. PROCESS WINNER OR UNSOLD
  IF v_lot.highest_bidder_team_id IS NOT NULL THEN
    -- LOCK TEAM
    SELECT * INTO v_team FROM public.teams WHERE id = v_lot.highest_bidder_team_id FOR UPDATE;

    -- DOUBLE CHECK FUNDS
    IF v_team.purse < v_lot.current_bid THEN
      RAISE EXCEPTION 'ERR_INSUFFICIENT_PURSE_DURING_FINALIZATION';
    END IF;

    SELECT is_overseas INTO v_is_overseas FROM public.players WHERE id = v_lot.player_id;

    -- DEDUCT AND ASSIGN
    UPDATE public.teams
    SET purse = purse - v_lot.current_bid,
        players_bought = players_bought + 1,
        overseas_count = overseas_count + (CASE WHEN v_is_overseas THEN 1 ELSE 0 END)
    WHERE id = v_team.id;

    INSERT INTO public.squad_players (auction_id, team_id, player_id, lot_id, purchase_price)
    VALUES (p_auction_id, v_team.id, v_lot.player_id, v_lot.id, v_lot.current_bid);

    v_final_status := 'SOLD';

    UPDATE public.auction_lots
    SET status = 'SOLD',
        winning_team_id = v_team.id,
        winning_bid = v_lot.current_bid
    WHERE id = v_lot.id;
  ELSE
    v_final_status := 'UNSOLD';
    UPDATE public.auction_lots
    SET status = 'UNSOLD'
    WHERE id = v_lot.id;
  END IF;

  -- 5. ATOMIC ADVANCE TO NEXT LOT
  SELECT * INTO v_next_lot
  FROM public.auction_lots
  WHERE auction_id = p_auction_id AND status = 'PENDING'
  ORDER BY lot_index ASC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.auction_lots
    SET status = 'GET_READY',
        get_ready_expires_at = v_now + INTERVAL '5 seconds',
        timer_expires_at = NULL,
        current_bid = base_price,
        highest_bidder_team_id = NULL
    WHERE id = v_next_lot.id;

    UPDATE public.auctions
    SET current_lot_id = v_next_lot.id,
        current_lot_index = v_next_lot.lot_index
    WHERE id = p_auction_id;

    v_new_auction_status := 'IN_PROGRESS';
  ELSE
    -- NO MORE PENDING LOTS: Transition to MINI_AUCTION or COMPLETED
    SELECT r.settings INTO v_room_settings
    FROM public.auctions a JOIN public.rooms r ON a.room_id = r.id 
    WHERE a.id = p_auction_id;
    
    v_max_squad_size := COALESCE((v_room_settings->>'max_squad_size')::int, 25);
    
    SELECT COUNT(*) INTO v_unsold_count 
    FROM public.auction_lots 
    WHERE auction_id = p_auction_id AND status = 'UNSOLD';
    
    SELECT COUNT(*) INTO v_eligible_teams 
    FROM public.teams 
    WHERE auction_id = p_auction_id AND players_bought < v_max_squad_size AND purse > 0;
    
    SELECT EXISTS(
      SELECT 1 FROM public.mini_auction_sessions WHERE auction_id = p_auction_id
    ) INTO v_has_mini_session;
    
    IF v_unsold_count > 0 AND v_eligible_teams > 0 AND NOT v_has_mini_session THEN
      UPDATE public.auctions
      SET status = 'MINI_AUCTION',
          current_lot_id = NULL
      WHERE id = p_auction_id;
      
      INSERT INTO public.mini_auction_sessions (auction_id, status, created_at, updated_at)
      VALUES (p_auction_id, 'SETUP', v_now, v_now)
      ON CONFLICT (auction_id) DO NOTHING;

      v_new_auction_status := 'MINI_AUCTION';
    ELSE
      UPDATE public.auctions
      SET status = 'COMPLETED',
          current_lot_id = NULL,
          completed_at = v_now
      WHERE id = p_auction_id;
      
      v_new_auction_status := 'COMPLETED';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lot_id', p_lot_id,
    'status', v_final_status,
    'next_lot_id', v_next_lot.id,
    'auction_status', v_new_auction_status
  );
END;
$$;

-- 2-argument wrapper overload for v3_finalize_and_advance_lot
CREATE OR REPLACE FUNCTION public.v3_finalize_and_advance_lot(
  p_auction_id UUID,
  p_lot_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.v3_finalize_and_advance_lot(p_auction_id, p_lot_id, false);
END;
$$;

-- 2-argument wrapper overload for v3_start_bidding
CREATE OR REPLACE FUNCTION public.v3_start_bidding(
  p_auction_id UUID,
  p_lot_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.v3_start_bidding(p_auction_id, p_lot_id, false);
END;
$$;

-- ============================================================================
-- 3b. SECURE v3_close_mini_selection
-- ============================================================================
CREATE OR REPLACE FUNCTION public.v3_close_mini_selection(
  p_auction_id UUID,
  p_force BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_user_id UUID := public.resolve_user_id();
  v_jwt_claims_raw TEXT := nullif(current_setting('request.jwt.claims', true), '');
  v_jwt_claims JSONB := CASE 
    WHEN v_jwt_claims_raw IS NOT NULL AND v_jwt_claims_raw ~ '^\s*\{' 
    THEN v_jwt_claims_raw::jsonb 
    ELSE NULL 
  END;
  v_jwt_role TEXT := CASE 
    WHEN v_jwt_claims IS NOT NULL THEN (v_jwt_claims->>'role') 
    ELSE NULL 
  END;
  v_session_role TEXT := COALESCE(current_setting('role', true), '');
  v_is_service_role BOOLEAN := COALESCE(
    (v_session_role = 'service_role' AND (v_jwt_role = 'service_role' OR auth.role() = 'service_role'))
    OR session_user IN ('postgres', 'supabase_admin', 'service_role'),
    false
  )
  AND v_session_role NOT IN ('authenticated', 'anon');
  v_max_lot_index INT;
  v_selected_player_id UUID;
  v_player public.players%ROWTYPE;
  v_count INT := 0;
BEGIN
  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', true, 'status', 'COMPLETED', 'total_lots', v_session.total_lots, 'already_completed', true);
  END IF;

  IF v_session.status = 'SELECTION_CLOSED' THEN
    RETURN jsonb_build_object('success', true, 'status', 'SELECTION_CLOSED', 'total_lots', v_session.total_lots, 'already_closed', true);
  END IF;

  IF v_session.status != 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_SESSION_STATUS');
  END IF;

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;

  -- Caller check: service_role or room host
  IF NOT v_is_service_role AND (v_user_id IS NULL OR v_room.host_id IS DISTINCT FROM v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  -- Timer check: non-service-role callers CANNOT force early close
  IF NOT v_is_service_role OR NOT COALESCE(p_force, false) THEN
    IF v_session.selection_expires_at IS NULL OR v_now < v_session.selection_expires_at THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_WINDOW_ACTIVE');
    END IF;
  END IF;

  -- Fetch maximum existing lot index
  SELECT COALESCE(MAX(lot_index), 0) INTO v_max_lot_index
  FROM public.auction_lots WHERE auction_id = p_auction_id;

  -- Iterate through distinct nominated players
  FOR v_selected_player_id IN
    SELECT DISTINCT player_id FROM public.mini_auction_selections
    WHERE auction_id = p_auction_id
  LOOP
    SELECT * INTO v_player FROM public.players WHERE id = v_selected_player_id;
    IF FOUND THEN
      v_count := v_count + 1;
      INSERT INTO public.auction_lots (
        auction_id,
        player_id,
        lot_index,
        base_price,
        status,
        is_mini_round
      ) VALUES (
        p_auction_id,
        v_player.id,
        v_max_lot_index + v_count,
        FLOOR(v_player.base_price * 0.8),
        'PENDING',
        true
      );
    END IF;
  END LOOP;

  -- ZERO NOMINATIONS PATH: transition both session and auction to COMPLETED
  IF v_count = 0 THEN
    UPDATE public.mini_auction_sessions
    SET status = 'COMPLETED',
        total_lots = 0,
        closed_at = v_now,
        completed_at = v_now,
        updated_at = v_now
    WHERE id = v_session.id;

    UPDATE public.auctions
    SET status = 'COMPLETED',
        current_lot_id = NULL,
        completed_at = v_now
    WHERE id = p_auction_id;

    RETURN jsonb_build_object('success', true, 'status', 'COMPLETED', 'total_lots', 0);
  END IF;

  -- NORMAL LOT PATH: transition to SELECTION_CLOSED
  UPDATE public.mini_auction_sessions
  SET status = 'SELECTION_CLOSED',
      total_lots = v_count,
      closed_at = v_now,
      updated_at = v_now
  WHERE id = v_session.id;

  RETURN jsonb_build_object('success', true, 'status', 'SELECTION_CLOSED', 'total_lots', v_count);
END;
$$;

-- ============================================================================
-- 4. STRICT RPC ACLS
-- ============================================================================
-- v3_place_bid: Allow authenticated and service_role, revoke from anon and PUBLIC
REVOKE ALL ON FUNCTION public.v3_place_bid(uuid, uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v3_place_bid(uuid, uuid, uuid, uuid, boolean)
  TO authenticated, service_role;

-- Lifecycle RPCs: Revoke from all public clients; grant strictly to service_role
REVOKE ALL ON FUNCTION public.v3_start_bidding(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v3_start_bidding(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_start_bidding(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.v3_start_bidding(uuid, uuid, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.v3_close_mini_selection(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_close_mini_selection(uuid, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid, boolean)
  TO service_role;

-- ============================================================================
-- 5. PERMISSION ASSERTIONS
-- ============================================================================
DO $assertions$
BEGIN
  -- Anon must not execute any bidding or lifecycle function
  IF has_function_privilege('anon', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: anon can execute v3_place_bid';
  END IF;

  IF has_function_privilege('anon', 'public.v3_start_bidding(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.v3_start_bidding(uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.v3_close_mini_selection(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.v3_finalize_and_advance_lot(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: anon can execute a worker-only auction RPC';
  END IF;

  -- Authenticated must be able to execute v3_place_bid (for human bids)
  IF NOT has_function_privilege('authenticated', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: authenticated cannot execute v3_place_bid';
  END IF;

  -- Authenticated must NOT be able to execute worker-only lifecycle RPCs
  IF has_function_privilege('authenticated', 'public.v3_start_bidding(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v3_start_bidding(uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v3_close_mini_selection(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v3_finalize_and_advance_lot(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: authenticated can execute a worker-only auction RPC';
  END IF;

  -- Service role must retain full execute privileges on all bidding and lifecycle RPCs
  IF NOT has_function_privilege('service_role', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_start_bidding(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_start_bidding(uuid,uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_close_mini_selection(uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_finalize_and_advance_lot(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: service_role lost a required auction RPC permission';
  END IF;
END;
$assertions$;

COMMIT;
