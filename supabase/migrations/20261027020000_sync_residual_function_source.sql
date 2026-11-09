-- Match function definitions captured from the linked public schema after reconciliation.
-- This preserves the verified live bodies and exact line endings.
BEGIN;
SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION "public"."_emit_auction_event"("p_auction_id" "uuid", "p_event_type" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb", "p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_next_sequence INT;
BEGIN
  UPDATE public.auctions
  SET current_sequence = current_sequence + 1
  WHERE id = p_auction_id
  RETURNING current_sequence INTO v_next_sequence;

  IF v_next_sequence IS NULL THEN
    RAISE EXCEPTION 'AUCTION_NOT_FOUND: Auction % does not exist', p_auction_id;
  END IF;

  INSERT INTO public.auction_events (auction_id, sequence, event_type, payload, actor_id)
  VALUES (p_auction_id, v_next_sequence, p_event_type, p_payload, p_actor_id);

  RETURN v_next_sequence;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."activate_lot_timer"("p_auction_id" "uuid", "p_lot_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_auction RECORD;
  v_lot RECORD;
  v_timer_sec INT := 15;
  v_timer_expires TIMESTAMPTZ;
BEGIN
  -- Level 1 Lock: Auctions table
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.id = p_auction_id
  FOR UPDATE;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'AUCTION_NOT_FOUND');
  END IF;

  IF v_auction.status NOT IN ('IN_PROGRESS', 'LIVE') THEN
    RETURN jsonb_build_object('success', false, 'status', 'AUCTION_NOT_LIVE');
  END IF;

  -- Level 2 Lock: Target lot
  SELECT al.* INTO v_lot
  FROM public.auction_lots al
  WHERE al.id = p_lot_id AND al.auction_id = p_auction_id
  FOR UPDATE;

  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'LOT_NOT_FOUND');
  END IF;

  -- Idempotency Guard: If timer_expires_at is ALREADY set, return authoritative state immediately without resetting
  IF v_lot.timer_expires_at IS NOT NULL THEN
    RETURN public.get_authoritative_auction_state(v_auction.room_id);
  END IF;

  -- Activate Timer Atomically on Server
  v_timer_sec := COALESCE(v_lot.timer_duration_seconds, 15);
  v_timer_expires := clock_timestamp() + (v_timer_sec * INTERVAL '1 second');

  UPDATE public.auction_lots
  SET timer_expires_at = v_timer_expires,
      timer_duration_seconds = v_timer_sec,
      status = 'BIDDING'
  WHERE id = v_lot.id;

  -- Emit LOT_TIMER_ACTIVATED Event
  PERFORM public._emit_auction_event(
    p_auction_id,
    'LOT_TIMER_ACTIVATED',
    jsonb_build_object(
      'lot_id', v_lot.id,
      'lot_index', v_lot.lot_index,
      'timer_expires_at', to_char(v_timer_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    NULL
  );

  RETURN public.get_authoritative_auction_state(v_auction.room_id);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."execute_bot_bids"("p_auction_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  -- Delegate directly to internal pipeline with auto bot candidate selection
  RETURN public._process_bid_internal(
    p_auction_id,
    NULL,
    NULL,
    NULL,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION "public"."provision_bots"("p_room_id" "uuid", "p_bot_count" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_room RECORD;
  v_default_purse INT;
  v_inserted_count INT := 0;
BEGIN
  -- Read room details and settings
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = p_room_id;
  IF v_room.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
  END IF;

  -- Parse default purse from room settings (in Crores) and convert to Lakhs
  v_default_purse := COALESCE((v_room.settings->>'default_purse')::int * 100, 10000);

  IF v_room.auction_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_STARTED');
  END IF;

  -- High-performance set-based insert to prevent deadlocks and race conditions
  WITH bot_pool AS (
    SELECT id, name, "shortName", color
    FROM jsonb_populate_recordset(null::record, v_room.settings->'bots')
    AS b(id text, name text, "shortName" text, color text)
    LIMIT p_bot_count
  )
  INSERT INTO public.teams (
    auction_id, name, short_name, color, purse, initial_purse, is_bot
  )
  SELECT
    v_room.auction_id,
    b.name,
    b.shortName,
    b.color,
    v_default_purse,
    v_default_purse,
    true
  FROM bot_pool b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.teams t 
    WHERE t.auction_id = v_room.auction_id 
    AND t.name = b.name
  );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Bots provisioned successfully',
    'inserted', v_inserted_count
  );
END;
$$;
COMMIT;
