-- Migration: 00017_fix_auction_initialization_rpc.sql
-- Description: Phase 1 Authoritative Fix for Opening Current Bid (Base Price) and Timer Initialization
-- Target Engine: PostgreSQL 15+ (Supabase Cloud)

BEGIN;

-- ============================================================
-- 1. AUTHORITATIVE STATE EXPORTER: public.get_authoritative_auction_state
-- Fix: CASE WHEN v_active_lot.current_bid > 0 THEN v_active_lot.current_bid ELSE v_active_lot.base_price END
-- ============================================================
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
  v_current_player RECORD;
  v_teams JSONB;
  v_queue JSONB;
  v_bid_count INT := 0;
  v_timer_duration INT := 15;
  v_get_ready_expires_at TIMESTAMPTZ;
  v_is_get_ready BOOLEAN := false;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_effective_bid INT;
BEGIN
  -- Read room
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = p_room_id;
  IF v_room.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
  END IF;

  v_timer_duration := COALESCE(NULLIF((v_room.settings->>'timer_duration_seconds')::int, 0), 15);

  -- Read latest auction for room
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.room_id = p_room_id
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'auctionStatus', 'NOT_STARTED',
      'roomId', p_room_id,
      'currentPlayerIndex', -1,
      'bidCount', 0,
      'currentBid', 0,
      'teamsList', '[]'::jsonb,
      'playerQueue', '[]'::jsonb
    );
  END IF;

  -- Fetch active lot
  IF v_auction.current_lot_id IS NOT NULL THEN
    SELECT al.* INTO v_active_lot
    FROM public.auction_lots al
    WHERE al.id = v_auction.current_lot_id;
  END IF;

  IF v_active_lot.id IS NULL AND v_auction.status = 'IN_PROGRESS' THEN
    SELECT al.* INTO v_active_lot
    FROM public.auction_lots al
    WHERE al.auction_id = v_auction.id AND al.lot_index = v_auction.current_lot_index;
  END IF;

  -- Compute GET READY window for active lot
  IF v_active_lot.id IS NOT NULL THEN
    v_timer_duration := COALESCE(v_active_lot.timer_duration_seconds, v_timer_duration);
    v_get_ready_expires_at := public._get_lot_get_ready_expires_at(v_active_lot.timer_expires_at, v_timer_duration);
    v_is_get_ready := (v_get_ready_expires_at IS NOT NULL AND v_now < v_get_ready_expires_at);

    SELECT p.* INTO v_current_player
    FROM public.players p
    WHERE p.id = v_active_lot.player_id;

    SELECT COUNT(*) INTO v_bid_count
    FROM public.bids b
    WHERE b.lot_id = v_active_lot.id AND b.is_valid = true;

    -- Opening bid semantics: if no bids exist or current_bid is 0, effective currentBid IS base_price
    IF v_bid_count > 0 AND v_active_lot.current_bid > 0 THEN
      v_effective_bid := v_active_lot.current_bid;
    ELSE
      v_effective_bid := COALESCE(v_active_lot.base_price, v_current_player.base_price, 200);
    END IF;
  ELSE
    v_effective_bid := 0;
  END IF;

  -- Fetch teams list
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'auction_id', t.auction_id,
      'name', t.name,
      'short_name', t.short_name,
      'color', t.color,
      'purse', t.purse,
      'initial_purse', t.initial_purse,
      'players_bought', t.players_bought,
      'overseas_count', t.overseas_count,
      'is_bot', t.is_bot
    ) ORDER BY t.name ASC
  ), '[]'::jsonb) INTO v_teams
  FROM public.teams t
  WHERE t.auction_id = v_auction.id;

  -- Fetch player queue
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'playerId', p.id,
      'name', p.name,
      'category', p.category,
      'role', p.role,
      'country', p.country,
      'basePrice', al.base_price,
      'auctionOrder', al.lot_index + 1,
      'status', CASE
                  WHEN al.status IN ('BIDDING', 'ACTIVE') THEN 'LIVE'
                  WHEN al.status = 'SOLD' THEN 'SOLD'
                  WHEN al.status = 'UNSOLD' THEN 'UNSOLD'
                  ELSE 'UPCOMING'
                END,
      'image_url', p.image_url
    ) ORDER BY al.lot_index ASC
  ), '[]'::jsonb) INTO v_queue
  FROM public.auction_lots al
  JOIN public.players p ON p.id = al.player_id
  WHERE al.auction_id = v_auction.id;

  RETURN jsonb_build_object(
    'success', true,
    'auctionId', v_auction.id,
    'roomId', p_room_id,
    'lotId', COALESCE(v_active_lot.id, NULL),
    'auctionStatus', CASE
                       WHEN v_auction.status = 'IN_PROGRESS' THEN 'LIVE'
                       WHEN v_auction.status = 'PAUSED' THEN 'PAUSED'
                       WHEN v_auction.status = 'COMPLETED' THEN 'COMPLETED'
                       ELSE 'NOT_STARTED'
                     END,
    'currentPlayerIndex', v_auction.current_lot_index,
    'currentCategory', COALESCE(v_current_player.category, NULL),
    'currentBid', v_effective_bid,
    'highestBidderId', CASE WHEN v_bid_count > 0 THEN COALESCE(v_active_lot.highest_bidder_team_id, NULL) ELSE NULL END,
    'bidCount', v_bid_count,
    'timerExpiresAt', COALESCE(v_active_lot.timer_expires_at, NULL),
    'timerDurationSeconds', v_timer_duration,
    'isGetReady', v_is_get_ready,
    'getReadyExpiresAt', COALESCE(v_get_ready_expires_at, NULL),
    'currentPlayer', CASE WHEN v_current_player.id IS NOT NULL THEN jsonb_build_object(
      'playerId', v_current_player.id,
      'name', v_current_player.name,
      'category', v_current_player.category,
      'role', v_current_player.role,
      'country', v_current_player.country,
      'basePrice', COALESCE(v_active_lot.base_price, v_current_player.base_price),
      'auctionOrder', v_active_lot.lot_index + 1,
      'status', 'LIVE',
      'image_url', v_current_player.image_url
    ) ELSE NULL END,
    'teamsList', v_teams,
    'playerQueue', v_queue
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_auction_state(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authoritative_auction_state(UUID) TO authenticated, service_role;

-- ============================================================
-- 2. SAFE INITIALIZATION FUNCTION: public.initialize_and_start_auction
-- Guard: If auction is ALREADY IN_PROGRESS, do NOT reset active lots or restart timer.
-- ============================================================
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
  v_timer_expires TIMESTAMPTZ;
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

  -- Idempotency Guard: If auction is ALREADY IN_PROGRESS or PAUSED, return authoritative state directly without corrupting state
  IF v_auction.id IS NOT NULL AND v_auction.status IN ('IN_PROGRESS', 'PAUSED') THEN
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
    -- High-Performance Set-Based Insert
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
    JOIN public.player_set_players psp ON psp.player_id = p.id
    WHERE psp.player_set_id = v_target_set_id;

    GET DIAGNOSTICS v_total_lots_inserted = ROW_COUNT;

    -- Fallback pool if set was empty
    IF v_total_lots_inserted = 0 THEN
      INSERT INTO public.auction_lots (
        id, auction_id, player_id, lot_index, status, base_price, current_bid, timer_duration_seconds, created_at
      )
      SELECT
        gen_random_uuid(),
        v_auction.id,
        sub.id,
        (ROW_NUMBER() OVER (
          ORDER BY
            CASE UPPER(sub.category)
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
            sub.name ASC
        ) - 1)::int AS lot_index,
        CASE WHEN ROW_NUMBER() OVER (
          ORDER BY
            CASE UPPER(sub.category)
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
            sub.name ASC
        ) = 1 THEN 'BIDDING' ELSE 'PENDING' END AS status,
        sub.base_price,
        sub.base_price,
        v_timer_sec,
        NOW()
      FROM (
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
      ) sub;

      GET DIAGNOSTICS v_total_lots_inserted = ROW_COUNT;
    END IF;
  END IF;

  -- Resolve Lot 0's ID
  SELECT id INTO v_first_lot_id
  FROM public.auction_lots
  WHERE auction_id = v_auction.id AND lot_index = 0
  LIMIT 1;

  -- Set 3-second GET READY timer buffer on Lot 0 with fresh clock_timestamp()
  v_timer_expires := clock_timestamp() + INTERVAL '3 seconds' + (v_timer_sec * INTERVAL '1 second');

  UPDATE public.auction_lots
  SET status = 'BIDDING',
      highest_bidder_team_id = NULL,
      timer_duration_seconds = v_timer_sec,
      timer_expires_at = v_timer_expires
  WHERE id = v_first_lot_id;

  -- Update auction row to IN_PROGRESS
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

  -- Emit AUCTION_STARTED event
  PERFORM public._emit_auction_event(
    v_auction.id,
    'AUCTION_STARTED',
    jsonb_build_object(
      'auction_id', v_auction.id,
      'first_lot_id', v_first_lot_id,
      'total_lots', COALESCE(NULLIF(v_total_lots_inserted, 0), v_existing_lots),
      'timer_expires_at', v_timer_expires
    ),
    NULL
  );

  RETURN public.get_authoritative_auction_state(p_room_id);
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_and_start_auction(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_and_start_auction(UUID, UUID) TO authenticated, service_role;

COMMIT;
