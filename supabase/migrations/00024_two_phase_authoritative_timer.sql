-- Migration: 00024_two_phase_authoritative_timer.sql
-- Description: Two-Phase Authoritative Timer Engine (activate_lot_timer RPC) & Complete Player Master Data Pipeline

BEGIN;

-- 1. Create activate_lot_timer RPC (Idempotent Lot Timer Activation)
CREATE OR REPLACE FUNCTION public.activate_lot_timer(
  p_auction_id UUID,
  p_lot_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Idempotency Guard: If timer_expires_at is ALREADY set, return authoritative state immediately
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

GRANT EXECUTE ON FUNCTION public.activate_lot_timer(UUID, UUID) TO authenticated, service_role, anon;

-- 2. Update initialize_and_start_auction to set timer_expires_at = NULL initially for two-phase start
DROP FUNCTION IF EXISTS public.initialize_and_start_auction(UUID);
DROP FUNCTION IF EXISTS public.initialize_and_start_auction(UUID, UUID);

CREATE OR REPLACE FUNCTION public.initialize_and_start_auction(
  p_room_id UUID,
  p_player_set_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room RECORD;
  v_auction RECORD;
  v_target_set_id UUID;
  v_first_lot_id UUID := NULL;
  v_existing_lots INT := 0;
  v_total_lots_inserted INT := 0;
  v_timer_sec INT := 15;
BEGIN
  -- Read room details
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = p_room_id;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND: Room % does not exist', p_room_id;
  END IF;

  v_timer_sec := COALESCE(NULLIF((v_room.settings->>'timer_duration_seconds')::int, 0), 15);

  -- Host Authorization Guard
  IF auth.role() = 'authenticated' AND v_room.host_id != auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NOT_HOST: Only the room host can start the auction';
  END IF;

  -- Read or create auction row with Level 1 lock
  SELECT a.* INTO v_auction FROM public.auctions a WHERE a.room_id = p_room_id ORDER BY a.created_at DESC LIMIT 1 FOR UPDATE;

  -- If auction is ALREADY IN_PROGRESS, return state
  IF v_auction.id IS NOT NULL AND v_auction.status = 'IN_PROGRESS' THEN
    RETURN public.get_authoritative_auction_state(p_room_id);
  END IF;

  IF v_auction.id IS NULL THEN
    v_target_set_id := COALESCE(p_player_set_id, (v_room.settings->>'player_set_id')::uuid);
    IF v_target_set_id IS NULL THEN
      SELECT id INTO v_target_set_id FROM public.player_sets LIMIT 1;
    END IF;

    INSERT INTO public.auctions (
      room_id, player_set_id, status, current_lot_index, created_at
    ) VALUES (
      p_room_id, v_target_set_id, 'LOBBY', 0, NOW()
    ) RETURNING * INTO v_auction;
  END IF;

  -- Determine player set
  v_target_set_id := COALESCE(p_player_set_id, v_auction.player_set_id, (v_room.settings->>'player_set_id')::uuid);
  IF v_target_set_id IS NULL THEN
    SELECT id INTO v_target_set_id FROM public.player_sets LIMIT 1;
  END IF;

  -- Check existing lots
  SELECT COUNT(*) INTO v_existing_lots FROM public.auction_lots WHERE auction_id = v_auction.id;

  IF v_existing_lots = 0 THEN
    INSERT INTO public.auction_lots (
      id, auction_id, player_id, lot_index, status, base_price, current_bid, timer_duration_seconds, created_at
    )
    SELECT
      gen_random_uuid(),
      v_auction.id,
      p.id,
      (ROW_NUMBER() OVER (
        ORDER BY
          CASE UPPER(p.category)
            WHEN 'MARQUEE' THEN 1
            WHEN 'ICON' THEN 1
            WHEN 'A' THEN 2
            WHEN 'ELITE' THEN 2
            WHEN 'B' THEN 3
            WHEN 'PREMIER' THEN 3
            WHEN 'C' THEN 4
            WHEN 'CORE' THEN 4
            WHEN 'D' THEN 5
            WHEN 'RISING' THEN 5
            ELSE 6
          END ASC,
          p.name ASC
      ) - 1)::int AS lot_index,
      CASE WHEN ROW_NUMBER() OVER (
        ORDER BY
          CASE UPPER(p.category)
            WHEN 'MARQUEE' THEN 1
            WHEN 'ICON' THEN 1
            WHEN 'A' THEN 2
            WHEN 'ELITE' THEN 2
            WHEN 'B' THEN 3
            WHEN 'PREMIER' THEN 3
            WHEN 'C' THEN 4
            WHEN 'CORE' THEN 4
            WHEN 'D' THEN 5
            WHEN 'RISING' THEN 5
            ELSE 6
          END ASC,
          p.name ASC
      ) = 1 THEN 'BIDDING' ELSE 'PENDING' END AS status,
      p.base_price,
      p.base_price,
      v_timer_sec,
      NOW()
    FROM public.players p
    WHERE p.player_set_id = v_target_set_id;

    GET DIAGNOSTICS v_total_lots_inserted = ROW_COUNT;
  END IF;

  -- Resolve Lot 0's ID
  SELECT id INTO v_first_lot_id
  FROM public.auction_lots
  WHERE auction_id = v_auction.id AND lot_index = 0
  LIMIT 1;

  -- TWO-PHASE TIMER START: Set status to BIDDING but keep timer_expires_at = NULL until client signals ready via activate_lot_timer RPC
  UPDATE public.auction_lots
  SET status = 'BIDDING',
      highest_bidder_team_id = NULL,
      timer_duration_seconds = v_timer_sec,
      timer_expires_at = NULL
  WHERE id = v_first_lot_id;

  -- Update auction row to IN_PROGRESS & reset current_lot_index to 0
  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      current_lot_index = 0,
      current_lot_id = v_first_lot_id,
      total_lots = COALESCE(NULLIF(v_total_lots_inserted, 0), v_existing_lots),
      started_at = clock_timestamp()
  WHERE id = v_auction.id;

  -- Update room status to LOCKED
  UPDATE public.rooms
  SET status = 'LOCKED',
      updated_at = NOW()
  WHERE id = p_room_id;

  RETURN public.get_authoritative_auction_state(p_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.initialize_and_start_auction(UUID, UUID) TO authenticated, service_role, anon;

-- 3. Update advance_lot to set timer_expires_at = NULL for next lot until activate_lot_timer is called
CREATE OR REPLACE FUNCTION public.advance_lot(p_auction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction RECORD;
  v_next_lot RECORD;
  v_total_lots INT;
  v_seq INT;
BEGIN
  -- Level 1 Lock: auctions row
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.id = p_auction_id
  FOR UPDATE;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'AUCTION_NOT_FOUND');
  END IF;

  SELECT COUNT(*) INTO v_total_lots
  FROM public.auction_lots
  WHERE auction_id = p_auction_id;

  -- Find next PENDING or UNRESOLVED lot
  SELECT al.* INTO v_next_lot
  FROM public.auction_lots al
  WHERE al.auction_id = p_auction_id
    AND al.lot_index > v_auction.current_lot_index
    AND al.status NOT IN ('SOLD', 'UNSOLD', 'SKIPPED')
  ORDER BY al.lot_index ASC
  LIMIT 1
  FOR UPDATE;

  IF v_next_lot.id IS NULL THEN
    -- All lots complete
    UPDATE public.auctions
    SET status = 'COMPLETED',
        current_lot_id = NULL,
        completed_at = clock_timestamp()
    WHERE id = p_auction_id;

    UPDATE public.rooms
    SET status = 'COMPLETED',
        updated_at = NOW()
    WHERE id = v_auction.room_id;

    v_seq := public._emit_auction_event(
      p_auction_id,
      'AUCTION_COMPLETED',
      jsonb_build_object('total_lots', v_total_lots),
      NULL
    );

    RETURN jsonb_build_object('success', true, 'status', 'AUCTION_COMPLETED');
  END IF;

  -- Prepare next lot with timer_expires_at = NULL (Two-phase timer readiness)
  UPDATE public.auction_lots
  SET status = 'BIDDING',
      highest_bidder_team_id = NULL,
      current_bid = base_price,
      timer_expires_at = NULL
  WHERE id = v_next_lot.id;

  UPDATE public.auctions
  SET current_lot_index = v_next_lot.lot_index,
      current_lot_id = v_next_lot.id
  WHERE id = p_auction_id;

  v_seq := public._emit_auction_event(
    p_auction_id,
    'LOT_ADVANCED',
    jsonb_build_object(
      'lot_id', v_next_lot.id,
      'lot_index', v_next_lot.lot_index,
      'player_id', v_next_lot.player_id
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'LOT_ADVANCED',
    'next_lot_id', v_next_lot.id,
    'next_lot_index', v_next_lot.lot_index
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_lot(UUID) TO authenticated, service_role, anon;

COMMIT;
