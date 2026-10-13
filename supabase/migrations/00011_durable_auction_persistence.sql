-- Migration: 00011_durable_auction_persistence.sql
-- Description: Authoritative Supabase Database Persistence & RPCs for Multiplayer Auction State + Strict Manager Capacity (10 Max)
-- Phase: Multiplayer Persistence & Realtime State Engine

-- ============================================================
-- 1. RPC: public.get_authoritative_auction_state
-- ============================================================
-- Reconstructs the complete authoritative AuctionState from database rows
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
      'roomId', p_room_id,
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


-- ============================================================
-- 2. RPC: public.initialize_and_start_auction
-- ============================================================
-- Initializes auction lots and activates the first player in Supabase DB atomically
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

  -- Return existing active state if auction is already live or completed
  IF v_auction.status IN ('IN_PROGRESS', 'PAUSED', 'COMPLETED') THEN
    RETURN public.get_authoritative_auction_state(p_room_id);
  END IF;

  -- Determine player set
  v_target_set_id := COALESCE(p_player_set_id, v_auction.player_set_id, (v_room.settings->>'player_set_id')::uuid);
  IF v_target_set_id IS NULL THEN
    SELECT id INTO v_target_set_id FROM public.player_sets LIMIT 1;
  END IF;

  -- Check if lots already exist for this auction
  SELECT COUNT(*) INTO v_existing_lots FROM public.auction_lots WHERE auction_id = v_auction.id;

  IF v_existing_lots = 0 THEN
    -- Populate auction_lots ordered deterministically by category priority:
    -- MARQUEE/ICON (1) -> A/ELITE (2) -> B/PREMIER (3) -> C/CORE (4) -> D/RISING (5) -> alphabetical name
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
        CASE WHEN v_lot_index = 0 THEN 'ACTIVE' ELSE 'PENDING' END,
        v_player.base_price,
        CASE WHEN v_lot_index = 0 THEN v_player.base_price ELSE 0 END,
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
          CASE WHEN v_lot_index = 0 THEN 'ACTIVE' ELSE 'PENDING' END,
          v_player.base_price,
          CASE WHEN v_lot_index = 0 THEN v_player.base_price ELSE 0 END,
          NOW()
        );

        v_lot_index := v_lot_index + 1;
      END LOOP;
    END IF;
  END IF;

  -- Explicitly resolve Lot 0's ID and base_price from the newly created auction_lots where lot_index = 0
  SELECT id, base_price INTO v_first_lot_id, v_first_base_price
  FROM public.auction_lots
  WHERE auction_id = v_auction.id AND lot_index = 0
  LIMIT 1;

  -- Ensure Lot 0 itself is created/set to BIDDING with current_bid = 0 (unbid), highest_bidder_team_id = NULL, and active timer
  UPDATE public.auction_lots
  SET status = 'BIDDING',
      current_bid = 0,
      highest_bidder_team_id = NULL,
      timer_expires_at = NOW() + (COALESCE((v_room.settings->>'timer_duration_seconds')::int, 15) || ' seconds')::interval
  WHERE id = v_first_lot_id;

  -- Update auctions row to IN_PROGRESS pointing strictly to Lot 0's ID
  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      current_lot_index = 0,
      current_lot_id = v_first_lot_id,
      total_lots = COALESCE(v_lot_index, v_existing_lots),
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


-- ============================================================
-- 3. RPC: public.join_room_with_team
-- ============================================================
-- Atomic room joining and team creation with strict 10-manager capacity enforcement
CREATE OR REPLACE FUNCTION public.join_room_with_team(
  p_room_code TEXT,
  p_team_name TEXT,
  p_team_short_name TEXT,
  p_team_color TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room RECORD;
  v_existing_participant RECORD;
  v_manager_count INT;
  v_team_id UUID;
  v_default_purse INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated to join a room';
  END IF;

  -- 1. Find Room & Auction
  SELECT r.*, a.id AS auction_id INTO v_room
  FROM public.rooms r
  LEFT JOIN public.auctions a ON a.room_id = r.id
  WHERE r.code = upper(trim(p_room_code));

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND: Room code % not found', p_room_code;
  END IF;

  -- 2. Check if User is already a participant
  SELECT rp.* INTO v_existing_participant
  FROM public.room_participants rp
  WHERE rp.room_id = v_room.id AND rp.user_id = v_user_id;

  IF v_existing_participant.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_room.id,
      'already_joined', true,
      'participant_id', v_existing_participant.id
    );
  END IF;

  -- 3. Check Room Status
  IF v_room.status NOT IN ('OPEN', 'LOBBY') THEN
    RAISE EXCEPTION 'ROOM_NOT_OPEN: Room is no longer open for joining';
  END IF;

  -- 4. STRICT MANAGER CAPACITY ENFORCEMENT (MAX 10 MANAGERS)
  SELECT COUNT(*) INTO v_manager_count
  FROM public.room_participants
  WHERE room_id = v_room.id;

  IF v_manager_count >= 10 THEN
    RAISE EXCEPTION 'EXCEEDS_MANAGER_CAPACITY: Room has reached maximum capacity of 10 managers';
  END IF;

  -- 5. Create Team & Add Participant
  v_default_purse := COALESCE((v_room.settings->>'default_purse')::int, 100);

  INSERT INTO public.teams (
    auction_id, name, short_name, color, purse, initial_purse, is_bot
  ) VALUES (
    v_room.auction_id,
    trim(p_team_name),
    upper(trim(p_team_short_name)),
    COALESCE(trim(p_team_color), '#C9A227'),
    v_default_purse,
    v_default_purse,
    false
  ) RETURNING id INTO v_team_id;

  INSERT INTO public.room_participants (
    room_id, user_id, team_id, role, is_bot, is_connected
  ) VALUES (
    v_room.id, v_user_id, v_team_id, 'MEMBER', false, true
  );

  RETURN jsonb_build_object(
    'room_id', v_room.id,
    'already_joined', false,
    'team_id', v_team_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_room_with_team(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_room_with_team(TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
