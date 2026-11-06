-- Guard server bot bids against stale decisions and persist permanent lot drops.
-- NOTE: This is an additive migration. Apply through the normal migration process;
-- do not use it to reset or replace an existing database.

BEGIN;

ALTER TABLE public.bot_lot_state
  ADD COLUMN IF NOT EXISTS is_dropped BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.bot_lot_state
  ADD COLUMN IF NOT EXISTS dropped_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.keep_bot_lot_drop_terminal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.is_dropped THEN
    NEW.is_dropped := true;
    NEW.is_interested := false;
    NEW.dropped_at := COALESCE(OLD.dropped_at, NEW.dropped_at, clock_timestamp());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_keep_bot_lot_drop_terminal ON public.bot_lot_state;
CREATE TRIGGER trg_keep_bot_lot_drop_terminal
  BEFORE UPDATE ON public.bot_lot_state
  FOR EACH ROW EXECUTE FUNCTION public.keep_bot_lot_drop_terminal();

CREATE OR REPLACE FUNCTION public.v3_place_bot_bid(
  p_auction_id UUID,
  p_lot_id UUID,
  p_team_id UUID,
  p_request_id UUID,
  p_expected_current_bid INT,
  p_expected_highest_bidder_team_id UUID,
  p_expected_next_bid_amount INT,
  p_maximum_bid INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session_role TEXT := COALESCE(current_setting('role', true), '');
  v_jwt_claims_raw TEXT := nullif(current_setting('request.jwt.claims', true), '');
  v_jwt_claims JSONB := CASE
    WHEN v_jwt_claims_raw IS NOT NULL AND v_jwt_claims_raw ~ '^\s*\{'
    THEN v_jwt_claims_raw::jsonb
    ELSE NULL
  END;
  v_jwt_role TEXT := CASE WHEN v_jwt_claims IS NOT NULL THEN v_jwt_claims->>'role' ELSE NULL END;
  v_is_service_role BOOLEAN := COALESCE(
    (v_session_role = 'service_role' AND (v_jwt_role = 'service_role' OR auth.role() = 'service_role'))
    OR session_user IN ('postgres', 'supabase_admin', 'service_role'),
    false
  ) AND v_session_role NOT IN ('authenticated', 'anon');
  v_existing_bid public.bids%ROWTYPE;
  v_lot public.auction_lots%ROWTYPE;
  v_current_bid INT;
  v_min_increment INT;
  v_min_required_bid INT;
  v_result JSONB;
BEGIN
  -- This worker-only guard must reject untrusted callers before revealing state.
  IF NOT v_is_service_role THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_BID_FORBIDDEN');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_REQUEST_ID_REQUIRED');
  END IF;

  -- Preserve idempotent retries even after the auction snapshot has advanced.
  SELECT * INTO v_existing_bid
    FROM public.bids
   WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_existing_bid.auction_id != p_auction_id
       OR v_existing_bid.team_id != p_team_id
       OR v_existing_bid.lot_id != p_lot_id
       OR NOT v_existing_bid.is_bot THEN
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
      'current_bid', v_existing_bid.amount,
      'request_id', v_existing_bid.request_id
    );
  END IF;

  -- Lock the lot before checking the snapshot; v3_place_bid uses this same
  -- lot-then-team order and performs the authoritative purse/quota checks.
  SELECT * INTO v_lot
    FROM public.auction_lots
   WHERE id = p_lot_id AND auction_id = p_auction_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_FOUND');
  END IF;

  v_current_bid := CASE
    WHEN v_lot.highest_bidder_team_id IS NULL THEN 0
    ELSE COALESCE(v_lot.current_bid, 0)
  END;

  IF v_current_bid IS DISTINCT FROM p_expected_current_bid
     OR v_lot.highest_bidder_team_id IS DISTINCT FROM p_expected_highest_bidder_team_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_STALE_BOT_DECISION');
  END IF;

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

  IF v_min_required_bid IS DISTINCT FROM p_expected_next_bid_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_STALE_BOT_DECISION');
  END IF;

  IF p_maximum_bid IS NULL OR v_min_required_bid > p_maximum_bid THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_MAXIMUM_BID_EXCEEDED');
  END IF;

  v_result := public.v3_place_bid(p_auction_id, p_lot_id, p_team_id, p_request_id, true);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v3_mark_bot_drop(
  p_auction_id UUID,
  p_lot_id UUID,
  p_team_id UUID,
  p_maximum_bid INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session_role TEXT := COALESCE(current_setting('role', true), '');
  v_jwt_claims_raw TEXT := nullif(current_setting('request.jwt.claims', true), '');
  v_jwt_claims JSONB := CASE
    WHEN v_jwt_claims_raw IS NOT NULL AND v_jwt_claims_raw ~ '^\s*\{'
    THEN v_jwt_claims_raw::jsonb
    ELSE NULL
  END;
  v_jwt_role TEXT := CASE WHEN v_jwt_claims IS NOT NULL THEN v_jwt_claims->>'role' ELSE NULL END;
  v_is_service_role BOOLEAN := COALESCE(
    (v_session_role = 'service_role' AND (v_jwt_role = 'service_role' OR auth.role() = 'service_role'))
    OR session_user IN ('postgres', 'supabase_admin', 'service_role'),
    false
  ) AND v_session_role NOT IN ('authenticated', 'anon');
  v_lot public.auction_lots%ROWTYPE;
  v_is_bot BOOLEAN;
BEGIN
  IF NOT v_is_service_role THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_DROP_FORBIDDEN');
  END IF;
  IF p_maximum_bid IS NULL OR p_maximum_bid < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_BOT_MAXIMUM_BID');
  END IF;

  SELECT * INTO v_lot
    FROM public.auction_lots
   WHERE id = p_lot_id AND auction_id = p_auction_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_FOUND');
  END IF;
  IF v_lot.status <> 'BIDDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_BIDDING');
  END IF;

  SELECT is_bot INTO v_is_bot
    FROM public.teams
   WHERE id = p_team_id AND auction_id = p_auction_id;
  IF NOT FOUND OR NOT COALESCE(v_is_bot, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_TEAM_REQUIRED');
  END IF;

  INSERT INTO public.bot_lot_state AS existing_state (
    lot_id, team_id, is_interested, max_per_player_budget, is_dropped, dropped_at, updated_at
  ) VALUES (
    p_lot_id, p_team_id, false, p_maximum_bid, true, clock_timestamp(), clock_timestamp()
  )
  ON CONFLICT (lot_id, team_id) DO UPDATE SET
    is_interested = false,
    is_dropped = true,
    dropped_at = COALESCE(existing_state.dropped_at, EXCLUDED.dropped_at),
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('success', true, 'lot_id', p_lot_id, 'team_id', p_team_id, 'is_dropped', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.v3_place_bot_bid(uuid, uuid, uuid, uuid, integer, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_place_bot_bid(uuid, uuid, uuid, uuid, integer, uuid, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.v3_mark_bot_drop(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v3_mark_bot_drop(uuid, uuid, uuid, integer)
  TO service_role;

DO $assertions$
BEGIN
  IF has_function_privilege('anon', 'public.v3_place_bot_bid(uuid,uuid,uuid,uuid,integer,uuid,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v3_place_bot_bid(uuid,uuid,uuid,uuid,integer,uuid,integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_place_bot_bid(uuid,uuid,uuid,uuid,integer,uuid,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: v3_place_bot_bid must be service_role-only';
  END IF;
  IF has_function_privilege('anon', 'public.v3_mark_bot_drop(uuid,uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v3_mark_bot_drop(uuid,uuid,uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v3_mark_bot_drop(uuid,uuid,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Security assertion failed: v3_mark_bot_drop must be service_role-only';
  END IF;
END;
$assertions$;

COMMIT;
