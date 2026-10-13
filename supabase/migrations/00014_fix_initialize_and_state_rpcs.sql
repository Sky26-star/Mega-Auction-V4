-- Migration: 00014_fix_initialize_and_state_rpcs.sql
-- Description: Fixes process_lot_expiry, initialize_and_start_auction, and get_authoritative_auction_state PL/pgSQL functions

CREATE OR REPLACE FUNCTION public.process_lot_expiry(
  p_auction_id UUID,
  p_target_lot_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction RECORD;
  v_lot RECORD;
  v_player RECORD;
  v_seq INT;
  v_adv_res JSONB;
BEGIN
  -- Verify caller room participant privilege if authenticated
  IF auth.role() = 'authenticated' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.room_participants rp ON rp.room_id = a.room_id
      WHERE a.id = p_auction_id AND rp.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED_ROOM_ACCESS: User % is not a participant in auction %', auth.uid(), p_auction_id;
    END IF;
  END IF;

  -- LEVEL 1 LOCK: auctions row
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.id = p_auction_id
  FOR UPDATE;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_FOUND');
  END IF;

  -- TARGET LOT IDEMPOTENCY GUARD
  IF p_target_lot_id IS NOT NULL AND p_target_lot_id != v_auction.current_lot_id THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_PROCESSED',
      'target_lot_id', p_target_lot_id,
      'current_lot_id', v_auction.current_lot_id
    );
  END IF;

  IF v_auction.current_lot_id IS NULL THEN
    RETURN jsonb_build_object('status', 'NO_ACTIVE_LOT');
  END IF;

  -- LEVEL 2 LOCK: current lot row
  SELECT al.* INTO v_lot
  FROM public.auction_lots al
  WHERE al.id = v_auction.current_lot_id
  FOR UPDATE;

  -- ALLOW 'BIDDING', 'ACTIVE', 'PENDING' TO EXPIRE. ONLY BLOCK IF ALREADY FINALIZED AS 'SOLD' OR 'UNSOLD'
  IF v_lot.id IS NULL OR v_lot.status IN ('SOLD', 'UNSOLD') THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_PROCESSED',
      'lot_id', v_auction.current_lot_id,
      'lot_status', v_lot.status
    );
  END IF;

  -- WALL-CLOCK EXPIRY CHECK
  IF clock_timestamp() < v_lot.timer_expires_at THEN
    RETURN jsonb_build_object(
      'status', 'NOT_EXPIRED',
      'timer_expires_at', v_lot.timer_expires_at,
      'remaining_seconds', EXTRACT(EPOCH FROM (v_lot.timer_expires_at - clock_timestamp()))
    );
  END IF;

  -- LOT EXPIRED: FINALIZE
  IF v_lot.highest_bidder_team_id IS NOT NULL THEN
    -- SOLD
    UPDATE public.auction_lots
    SET status = 'SOLD'
    WHERE id = v_lot.id;

    -- Add player to winning team squad
    INSERT INTO public.squad_players (
      auction_id, team_id, player_id, lot_id, purchase_price, acquired_at
    ) VALUES (
      p_auction_id, v_lot.highest_bidder_team_id, v_lot.player_id, v_lot.id, v_lot.current_bid, NOW()
    );

    -- Emit LOT_COMPLETED (SOLD) event via _emit_auction_event
    v_seq := public._emit_auction_event(
      p_auction_id,
      'LOT_COMPLETED',
      jsonb_build_object(
        'lot_id', v_lot.id,
        'status', 'SOLD',
        'winning_team_id', v_lot.highest_bidder_team_id,
        'winning_bid', v_lot.current_bid,
        'player_id', v_lot.player_id
      ),
      NULL
    );
  ELSE
    -- UNSOLD
    UPDATE public.auction_lots
    SET status = 'UNSOLD'
    WHERE id = v_lot.id;

    -- Emit LOT_COMPLETED (UNSOLD) event via _emit_auction_event
    v_seq := public._emit_auction_event(
      p_auction_id,
      'LOT_COMPLETED',
      jsonb_build_object(
        'lot_id', v_lot.id,
        'status', 'UNSOLD',
        'player_id', v_lot.player_id
      ),
      NULL
    );
  END IF;

  -- ADVANCE TO NEXT LOT
  v_adv_res := public.advance_lot(p_auction_id);

  RETURN jsonb_build_object(
    'success', true,
    'status', 'EXPIRED_AND_FINALIZED',
    'lot_id', v_lot.id,
    'final_lot_status', CASE WHEN v_lot.highest_bidder_team_id IS NOT NULL THEN 'SOLD' ELSE 'UNSOLD' END,
    'sequence', v_seq,
    'advance_result', v_adv_res
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_lot_expiry(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_lot_expiry(UUID, UUID) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_authoritative_auction_state(
  p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room RECORD;
  v_auction RECORD;
  v_active_lot RECORD;
  v_active_player RECORD;
  v_bid_count INT := 0;
  v_queue JSONB := '[]'::jsonb;
  v_current_player_obj JSONB := NULL;
  v_status_text TEXT;
  v_category_text TEXT;
BEGIN
  -- Read room details
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = p_room_id;
  IF v_room.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
  END IF;

  -- Read auction details
  SELECT a.* INTO v_auction FROM public.auctions a WHERE a.room_id = p_room_id ORDER BY a.created_at DESC LIMIT 1;
  IF v_auction.id IS NULL OR v_auction.status = 'LOBBY' THEN
    RETURN jsonb_build_object(
      'roomId', p_room_id::text,
      'auctionId', v_auction.id::text,
      'lotId', NULL,
      'auctionStatus', 'NOT_STARTED',
      'currentPlayerIndex', -1,
      'currentCategory', NULL,
      'currentBid', 0,
      'highestBidderId', NULL,
      'bidCount', 0,
      'currentPlayer', NULL,
      'playerQueue', '[]'::jsonb
    );
  END IF;

  -- Map database auction status to engine auction status
  v_status_text := CASE v_auction.status
    WHEN 'IN_PROGRESS' THEN 'LIVE'
    WHEN 'PAUSED' THEN 'PAUSED'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    ELSE 'NOT_STARTED'
  END;

  -- Build player queue array from persisted auction_lots + players
  SELECT jsonb_agg(
    jsonb_build_object(
      'playerId', p.id::text,
      'name', p.name,
      'category', p.category,
      'basePrice', al.base_price,
      'status', CASE al.status
        WHEN 'ACTIVE' THEN 'LIVE'
        WHEN 'BIDDING' THEN 'LIVE'
        WHEN 'SOLD' THEN 'SOLD'
        WHEN 'UNSOLD' THEN 'UNSOLD'
        ELSE 'UPCOMING'
      END,
      'auctionOrder', al.lot_index + 1,
      'role', p.role,
      'country', p.country,
      'image_url', p.image_url
    ) ORDER BY al.lot_index ASC
  ) INTO v_queue
  FROM public.auction_lots al
  JOIN public.players p ON p.id = al.player_id
  WHERE al.auction_id = v_auction.id;

  v_queue := COALESCE(v_queue, '[]'::jsonb);

  -- Fetch active lot details strictly derived from current_lot_index
  SELECT al.* INTO v_active_lot
  FROM public.auction_lots al
  WHERE al.auction_id = v_auction.id AND al.lot_index = v_auction.current_lot_index
  ORDER BY al.created_at ASC
  LIMIT 1;

  -- Self-healing: if current_lot_id is missing or out-of-sync, synchronize it
  IF v_active_lot.id IS NOT NULL AND (v_auction.current_lot_id IS NULL OR v_auction.current_lot_id != v_active_lot.id) THEN
    UPDATE public.auctions
    SET current_lot_id = v_active_lot.id
    WHERE id = v_auction.id;
  END IF;

  IF v_active_lot.id IS NOT NULL THEN
    SELECT p.* INTO v_active_player FROM public.players p WHERE p.id = v_active_lot.player_id;

    -- Count valid bids on active lot
    SELECT COUNT(*) INTO v_bid_count FROM public.bids WHERE lot_id = v_active_lot.id AND is_valid = true;

    v_category_text := v_active_player.category;

    v_current_player_obj := jsonb_build_object(
      'playerId', v_active_player.id::text,
      'name', v_active_player.name,
      'category', v_active_player.category,
      'basePrice', v_active_lot.base_price,
      'status', CASE v_active_lot.status
        WHEN 'ACTIVE' THEN 'LIVE'
        WHEN 'BIDDING' THEN 'LIVE'
        WHEN 'SOLD' THEN 'SOLD'
        WHEN 'UNSOLD' THEN 'UNSOLD'
        ELSE 'UPCOMING'
      END,
      'auctionOrder', v_active_lot.lot_index + 1,
      'role', v_active_player.role,
      'country', v_active_player.country,
      'image_url', v_active_player.image_url
    );
  END IF;

  RETURN jsonb_build_object(
    'roomId', p_room_id::text,
    'auctionId', v_auction.id::text,
    'lotId', v_active_lot.id::text,
    'auctionStatus', v_status_text,
    'currentPlayerIndex', v_auction.current_lot_index,
    'currentCategory', v_category_text,
    'currentBid', COALESCE(v_active_lot.current_bid, v_active_lot.base_price, 0),
    'highestBidderId', v_active_lot.highest_bidder_team_id,
    'bidCount', v_bid_count,
    'timerExpiresAt', v_active_lot.timer_expires_at,
    'timerDurationSeconds', COALESCE(v_active_lot.timer_duration_seconds, (v_room.settings->>'timer_duration_seconds')::int, 15),
    'currentPlayer', v_current_player_obj,
    'playerQueue', v_queue
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_auction_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_authoritative_auction_state(UUID) TO authenticated, anon, service_role;


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
  v_player RECORD;
  v_lot_index INT := 0;
  v_first_lot_id UUID := NULL;
  v_first_base_price INT := 0;
  v_existing_lots INT := 0;
  v_generated_lot_id UUID;
BEGIN
  -- Read room details
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = p_room_id;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND: Room % does not exist', p_room_id;
  END IF;

  -- Host Authorization Guard
  IF auth.role() = 'authenticated' AND v_room.host_id != auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NOT_HOST: Only the room host can start the auction';
  END IF;

  -- Read or create auction row
  SELECT a.* INTO v_auction FROM public.auctions a WHERE a.room_id = p_room_id ORDER BY a.created_at DESC LIMIT 1 FOR UPDATE;
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

  -- Check if lots already exist for this auction
  SELECT COUNT(*) INTO v_existing_lots FROM public.auction_lots WHERE auction_id = v_auction.id;

  IF v_existing_lots = 0 THEN
    v_lot_index := 0;
    FOR v_player IN
      SELECT p.*
      FROM public.players p
      JOIN public.player_set_players psp ON psp.player_id = p.id
      WHERE psp.player_set_id = v_target_set_id
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
    LOOP
      v_generated_lot_id := gen_random_uuid();
      IF v_lot_index = 0 THEN
        v_first_lot_id := v_generated_lot_id;
        v_first_base_price := v_player.base_price;
      END IF;

      INSERT INTO public.auction_lots (
        id, auction_id, player_id, lot_index, status, base_price, current_bid, created_at
      ) VALUES (
        v_generated_lot_id,
        v_auction.id,
        v_player.id,
        v_lot_index,
        CASE WHEN v_lot_index = 0 THEN 'BIDDING' ELSE 'PENDING' END,
        v_player.base_price,
        0,
        NOW()
      );

      v_lot_index := v_lot_index + 1;
    END LOOP;

    -- Fallback pool if player set was empty
    IF v_lot_index = 0 THEN
      FOR v_player IN
        SELECT p.*
        FROM public.players p
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
            ELSE 5
          END ASC,
          p.name ASC
        LIMIT 50
      LOOP
        v_generated_lot_id := gen_random_uuid();
        IF v_lot_index = 0 THEN
          v_first_lot_id := v_generated_lot_id;
          v_first_base_price := v_player.base_price;
        END IF;

        INSERT INTO public.auction_lots (
          id, auction_id, player_id, lot_index, status, base_price, current_bid, created_at
        ) VALUES (
          v_generated_lot_id,
          v_auction.id,
          v_player.id,
          v_lot_index,
          CASE WHEN v_lot_index = 0 THEN 'BIDDING' ELSE 'PENDING' END,
          v_player.base_price,
          0,
          NOW()
        );

        v_lot_index := v_lot_index + 1;
      END LOOP;
    END IF;
  END IF;

  -- Explicitly resolve Lot 0's ID and base_price from auction_lots where lot_index = 0
  SELECT id, base_price INTO v_first_lot_id, v_first_base_price
  FROM public.auction_lots
  WHERE auction_id = v_auction.id AND lot_index = 0
  LIMIT 1;

  -- Ensure Lot 0 is set to BIDDING with current_bid = 0, highest_bidder_team_id = NULL, and active timer
  UPDATE public.auction_lots
  SET status = 'BIDDING',
      current_bid = 0,
      highest_bidder_team_id = NULL,
      timer_expires_at = clock_timestamp() + (COALESCE((v_room.settings->>'timer_duration_seconds')::int, 15) || ' seconds')::interval
  WHERE id = v_first_lot_id;

  -- Update auctions row to IN_PROGRESS pointing strictly to Lot 0's ID
  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      current_lot_index = 0,
      current_lot_id = v_first_lot_id,
      total_lots = COALESCE(NULLIF(v_lot_index, 0), v_existing_lots),
      started_at = clock_timestamp()
  WHERE id = v_auction.id;

  -- Update rooms row status to IN_PROGRESS
  UPDATE public.rooms
  SET status = 'IN_PROGRESS',
      updated_at = clock_timestamp()
  WHERE id = p_room_id;

  -- Emit AUCTION_STARTED event into auction_events table
  PERFORM public._emit_auction_event(
    v_auction.id,
    'AUCTION_STARTED',
    jsonb_build_object('started_at', clock_timestamp(), 'room_id', p_room_id),
    auth.uid()
  );

  RETURN public.get_authoritative_auction_state(p_room_id);
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_and_start_auction(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initialize_and_start_auction(UUID, UUID) TO authenticated, anon, service_role;
