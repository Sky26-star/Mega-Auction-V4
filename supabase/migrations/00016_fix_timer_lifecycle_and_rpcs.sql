-- Migration: 00016_fix_timer_lifecycle_and_rpcs.sql
-- Description: Authoritative Root-Cause Fix for Auction Start Delay, Timer Lifecycle, GET READY State, and Concurrency Locks
-- Target Engine: PostgreSQL 15+ (Supabase Cloud)

BEGIN;

-- ============================================================
-- 0. DEFENSIVE DDL: Ensure required columns exist
-- ============================================================
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS total_lots INT NOT NULL DEFAULT 0;
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS is_unsold_round BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.auction_lots ADD COLUMN IF NOT EXISTS timer_duration_seconds INT NOT NULL DEFAULT 15;

-- ============================================================
-- 1. PRIVATE HELPER FUNCTION: public._get_lot_get_ready_expires_at
-- ============================================================
DROP FUNCTION IF EXISTS public._get_lot_get_ready_expires_at(TIMESTAMPTZ, INT);

CREATE OR REPLACE FUNCTION public._get_lot_get_ready_expires_at(
  p_timer_expires_at TIMESTAMPTZ,
  p_timer_duration_sec INT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_timer_expires_at IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN p_timer_expires_at - (COALESCE(p_timer_duration_sec, 15) * INTERVAL '1 second');
END;
$$;

REVOKE ALL ON FUNCTION public._get_lot_get_ready_expires_at(TIMESTAMPTZ, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._get_lot_get_ready_expires_at(TIMESTAMPTZ, INT) TO service_role;


-- ============================================================
-- 2. AUTHORITATIVE STATE EXPORTER: public.get_authoritative_auction_state
-- ============================================================
DROP FUNCTION IF EXISTS public.get_authoritative_auction_state(UUID);

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
    'currentBid', COALESCE(v_active_lot.current_bid, v_active_lot.base_price, 0),
    'highestBidderId', COALESCE(v_active_lot.highest_bidder_team_id, NULL),
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
-- 3. SET-BASED INITIALIZATION: public.initialize_and_start_auction
-- ============================================================
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
    -- High-Performance Set-Based Insert (No PL/pgSQL FOR Loop)
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
      0,
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
        0,
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

  -- Set 3-second GET READY timer buffer on Lot 0
  v_timer_expires := clock_timestamp() + INTERVAL '3 seconds' + (v_timer_sec * INTERVAL '1 second');

  UPDATE public.auction_lots
  SET status = 'BIDDING',
      current_bid = 0,
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

  -- Evaluate bot interests for Lot 0
  PERFORM public.evaluate_bot_interests(v_auction.id, v_first_lot_id);

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


-- ============================================================
-- 4. LOT ADVANCEMENT & UNSOLD CLONING: public.advance_lot
-- ============================================================
DROP FUNCTION IF EXISTS public.advance_lot(UUID);

CREATE OR REPLACE FUNCTION public.advance_lot(
  p_auction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction RECORD;
  v_room RECORD;
  v_next_lot RECORD;
  v_cloned_count INT := 0;
  v_timer_sec INT;
  v_timer_expires TIMESTAMPTZ;
  v_next_lot_index INT;
  v_seq INT;
BEGIN
  -- Level 1 Lock: auctions row
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.id = p_auction_id
  FOR UPDATE;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_FOUND');
  END IF;

  -- Read room settings for timer duration
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = v_auction.room_id;
  v_timer_sec := COALESCE(NULLIF((v_room.settings->>'timer_duration_seconds')::int, 0), 15);

  v_next_lot_index := v_auction.current_lot_index + 1;

  -- Check if next lot exists in sequence with Level 2 lock
  SELECT al.* INTO v_next_lot
  FROM public.auction_lots al
  WHERE al.auction_id = p_auction_id AND al.lot_index = v_next_lot_index
  FOR UPDATE;

  IF v_next_lot.id IS NOT NULL THEN
    v_timer_sec := COALESCE(v_next_lot.timer_duration_seconds, v_timer_sec);
    v_timer_expires := clock_timestamp() + INTERVAL '3 seconds' + (v_timer_sec * INTERVAL '1 second');

    -- Next lot exists: activate with 3-second GET READY transition buffer
    UPDATE public.auctions
    SET current_lot_index = v_next_lot_index,
        current_lot_id = v_next_lot.id
    WHERE id = p_auction_id;

    UPDATE public.auction_lots
    SET status = 'BIDDING',
        timer_duration_seconds = v_timer_sec,
        timer_expires_at = v_timer_expires
    WHERE id = v_next_lot.id;

    PERFORM public.evaluate_bot_interests(p_auction_id, v_next_lot.id);

    v_seq := public._emit_auction_event(
      p_auction_id,
      'LOT_STARTED',
      jsonb_build_object(
        'lot_id', v_next_lot.id,
        'lot_index', v_next_lot_index,
        'player_id', v_next_lot.player_id,
        'base_price', v_next_lot.base_price,
        'timer_expires_at', v_timer_expires,
        'is_unsold_round', v_auction.is_unsold_round
      ),
      NULL
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'LOT_STARTED',
      'current_lot_id', v_next_lot.id,
      'current_lot_index', v_next_lot_index,
      'is_unsold_round', v_auction.is_unsold_round,
      'sequence', v_seq
    );
  END IF;

  -- Current round lots exhausted: check for unsold lots if Round 1
  IF NOT v_auction.is_unsold_round THEN
    -- Set-Based Unsold Lot Cloning for Round 2
    INSERT INTO public.auction_lots (
      id, auction_id, player_id, lot_index, status, base_price, current_bid, timer_duration_seconds, created_at
    )
    SELECT
      gen_random_uuid(),
      p_auction_id,
      al.player_id,
      (v_auction.total_lots + ROW_NUMBER() OVER (ORDER BY al.lot_index ASC) - 1)::int,
      'PENDING',
      GREATEST(1, FLOOR(al.base_price * 0.5)),
      0,
      v_timer_sec,
      NOW()
    FROM public.auction_lots al
    WHERE al.auction_id = p_auction_id AND al.status = 'UNSOLD';

    GET DIAGNOSTICS v_cloned_count = ROW_COUNT;

    IF v_cloned_count > 0 THEN
      UPDATE public.auctions
      SET is_unsold_round = true,
          total_lots = v_auction.total_lots + v_cloned_count
      WHERE id = p_auction_id;

      SELECT al.* INTO v_next_lot
      FROM public.auction_lots al
      WHERE al.auction_id = p_auction_id AND al.lot_index = v_next_lot_index
      FOR UPDATE;

      IF v_next_lot.id IS NOT NULL THEN
        v_timer_expires := clock_timestamp() + INTERVAL '3 seconds' + (v_timer_sec * INTERVAL '1 second');

        UPDATE public.auctions
        SET current_lot_index = v_next_lot.lot_index,
            current_lot_id = v_next_lot.id
        WHERE id = p_auction_id;

        UPDATE public.auction_lots
        SET status = 'BIDDING',
            timer_duration_seconds = v_timer_sec,
            timer_expires_at = v_timer_expires
        WHERE id = v_next_lot.id;

        PERFORM public.evaluate_bot_interests(p_auction_id, v_next_lot.id);

        v_seq := public._emit_auction_event(
          p_auction_id,
          'UNSOLD_ROUND_STARTED',
          jsonb_build_object(
            'cloned_lots', v_cloned_count,
            'current_lot_id', v_next_lot.id,
            'current_lot_index', v_next_lot.lot_index,
            'timer_expires_at', v_timer_expires
          ),
          NULL
        );

        RETURN jsonb_build_object(
          'success', true,
          'status', 'UNSOLD_ROUND_STARTED',
          'current_lot_id', v_next_lot.id,
          'current_lot_index', v_next_lot.lot_index,
          'cloned_lots', v_cloned_count,
          'sequence', v_seq
        );
      END IF;
    END IF;
  END IF;

  -- Auction completed
  UPDATE public.auctions
  SET status = 'COMPLETED',
      completed_at = clock_timestamp()
  WHERE id = p_auction_id;

  UPDATE public.rooms
  SET status = 'COMPLETED',
      updated_at = NOW()
  WHERE id = v_auction.room_id;

  v_seq := public._emit_auction_event(
    p_auction_id,
    'AUCTION_COMPLETED',
    jsonb_build_object(
      'auction_id', p_auction_id,
      'status', 'COMPLETED'
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'AUCTION_COMPLETED',
    'sequence', v_seq
  );
END;
$$;

REVOKE ALL ON FUNCTION public.advance_lot(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_lot(UUID) TO authenticated, service_role;


-- ============================================================
-- 5. MONOTONIC EXPIRY FINALIZATION: public.process_lot_expiry
-- ============================================================
DROP FUNCTION IF EXISTS public.process_lot_expiry(UUID, UUID);

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
  v_now TIMESTAMPTZ := clock_timestamp();
  v_winning_team RECORD;
  v_seq INT;
  v_advance_res JSONB;
BEGIN
  -- Level 1 Lock: auctions row
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.id = p_auction_id
  FOR UPDATE;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'AUCTION_NOT_FOUND');
  END IF;

  IF v_auction.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', true, 'status', 'AUCTION_COMPLETED');
  END IF;

  -- Level 2 Lock: current active lot
  IF v_auction.current_lot_id IS NOT NULL THEN
    SELECT al.* INTO v_lot
    FROM public.auction_lots al
    WHERE al.id = v_auction.current_lot_id
    FOR UPDATE;
  END IF;

  IF v_lot.id IS NULL THEN
    SELECT al.* INTO v_lot
    FROM public.auction_lots al
    WHERE al.auction_id = p_auction_id AND al.lot_index = v_auction.current_lot_index
    FOR UPDATE;
  END IF;

  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NO_ACTIVE_LOT');
  END IF;

  -- Idempotency Guard: Target lot mismatch (already advanced)
  IF p_target_lot_id IS NOT NULL AND v_lot.id != p_target_lot_id THEN
    RETURN jsonb_build_object('success', true, 'status', 'ALREADY_PROCESSED', 'message', 'Target lot has already been advanced');
  END IF;

  -- Idempotency Guard: Lot already finalized
  IF v_lot.status IN ('SOLD', 'UNSOLD', 'SKIPPED') THEN
    RETURN jsonb_build_object('success', true, 'status', 'ALREADY_PROCESSED', 'message', 'Lot already finalized');
  END IF;

  -- Verify timer actually expired using DB wall clock
  IF v_lot.timer_expires_at IS NOT NULL AND v_now < v_lot.timer_expires_at THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'NOT_EXPIRED',
      'seconds_remaining', ceil(EXTRACT(EPOCH FROM (v_lot.timer_expires_at - v_now)))
    );
  END IF;

  -- Finalize current lot: SOLD or UNSOLD
  IF v_lot.highest_bidder_team_id IS NOT NULL AND v_lot.current_bid > 0 THEN
    -- Finalize as SOLD with Level 3 Lock on team
    SELECT t.* INTO v_winning_team
    FROM public.teams t
    WHERE t.id = v_lot.highest_bidder_team_id
    FOR UPDATE;

    UPDATE public.auction_lots
    SET status = 'SOLD',
        winning_team_id = v_lot.highest_bidder_team_id,
        winning_bid = v_lot.current_bid
    WHERE id = v_lot.id;

    -- Add to squad_players
    INSERT INTO public.squad_players (
      auction_id, team_id, player_id, lot_id, purchase_price, bought_at
    ) VALUES (
      p_auction_id, v_lot.highest_bidder_team_id, v_lot.player_id, v_lot.id, v_lot.current_bid, NOW()
    );

    -- Update team purse and player count
    UPDATE public.teams
    SET purse = purse - v_lot.current_bid,
        players_bought = players_bought + 1
    WHERE id = v_lot.highest_bidder_team_id;

    -- Emit LOT_SOLD event
    v_seq := public._emit_auction_event(
      p_auction_id,
      'LOT_SOLD',
      jsonb_build_object(
        'lot_id', v_lot.id,
        'lot_index', v_lot.lot_index,
        'winning_team_id', v_lot.highest_bidder_team_id,
        'winning_bid', v_lot.current_bid,
        'player_id', v_lot.player_id
      ),
      NULL
    );
  ELSE
    -- Finalize as UNSOLD
    UPDATE public.auction_lots
    SET status = 'UNSOLD'
    WHERE id = v_lot.id;

    v_seq := public._emit_auction_event(
      p_auction_id,
      'LOT_UNSOLD',
      jsonb_build_object(
        'lot_id', v_lot.id,
        'lot_index', v_lot.lot_index,
        'player_id', v_lot.player_id
      ),
      NULL
    );
  END IF;

  -- Advance to next lot
  v_advance_res := public.advance_lot(p_auction_id);

  RETURN jsonb_build_object(
    'success', true,
    'status', 'EXPIRED_AND_FINALIZED',
    'final_lot_id', v_lot.id,
    'final_status', CASE WHEN v_lot.highest_bidder_team_id IS NOT NULL THEN 'SOLD' ELSE 'UNSOLD' END,
    'advance_result', v_advance_res
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_lot_expiry(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_lot_expiry(UUID, UUID) TO authenticated, service_role;


-- ============================================================
-- 6. ATOMIC BID VALIDATION & LOCKING: public._process_bid_internal
-- ============================================================
DROP FUNCTION IF EXISTS public._process_bid_internal(UUID, UUID, INT, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public._process_bid_internal(UUID, UUID, INT, UUID);

CREATE OR REPLACE FUNCTION public._process_bid_internal(
  p_auction_id UUID,
  p_team_id UUID,
  p_amount INT,
  p_request_id UUID,
  p_is_bot BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction RECORD;
  v_lot RECORD;
  v_team RECORD;
  v_bid_count INT := 0;
  v_min_bid INT := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_get_ready_expires TIMESTAMPTZ;
  v_timer_sec INT := 15;
  v_timer_expires TIMESTAMPTZ;
  v_seq INT;
  v_existing_bid RECORD;
BEGIN
  -- Idempotency Check: Request ID
  SELECT b.* INTO v_existing_bid FROM public.bids b WHERE b.request_id = p_request_id;
  IF v_existing_bid.id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'status', 'IDEMPOTENT_REPLAY', 'bid_id', v_existing_bid.id);
  END IF;

  -- Level 1 Lock: auctions row
  SELECT a.* INTO v_auction FROM public.auctions a WHERE a.id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL OR v_auction.status != 'IN_PROGRESS' THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_ACTIVE');
  END IF;

  -- Level 2 Lock: current auction lot
  IF v_auction.current_lot_id IS NOT NULL THEN
    SELECT al.* INTO v_lot FROM public.auction_lots al WHERE al.id = v_auction.current_lot_id FOR UPDATE;
  END IF;

  IF v_lot.id IS NULL THEN
    SELECT al.* INTO v_lot FROM public.auction_lots al WHERE al.auction_id = p_auction_id AND al.lot_index = v_auction.current_lot_index FOR UPDATE;
  END IF;

  IF v_lot.id IS NULL OR v_lot.status NOT IN ('BIDDING', 'ACTIVE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'LOT_NOT_BIDDING');
  END IF;

  -- Level 3 Lock: bidding team
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id AND t.auction_id = p_auction_id FOR UPDATE;
  IF v_team.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TEAM_NOT_FOUND');
  END IF;

  v_timer_sec := COALESCE(v_lot.timer_duration_seconds, 15);
  v_get_ready_expires := public._get_lot_get_ready_expires_at(v_lot.timer_expires_at, v_timer_sec);

  -- GET READY Phase Guard: Bids disabled during GET READY window
  IF v_get_ready_expires IS NOT NULL AND v_now < v_get_ready_expires THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_GETTING_READY', 'message', 'Bidding disabled during GET READY phase');
  END IF;

  -- Expiry Guard: Wall clock check
  IF v_lot.timer_expires_at IS NOT NULL AND v_now >= v_lot.timer_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'TIMER_EXPIRED', 'message', 'Timer expired; advancing lot');
  END IF;

  -- Outbid Lock Guard: Cannot bid against oneself
  IF v_lot.highest_bidder_team_id = p_team_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_HIGHEST_BIDDER');
  END IF;

  -- Calculate minimum required bid
  IF v_lot.current_bid = 0 THEN
    v_min_bid := v_lot.base_price;
  ELSE
    v_min_bid := v_lot.current_bid + CASE
      WHEN v_lot.current_bid < 100 THEN 5
      WHEN v_lot.current_bid < 500 THEN 10
      WHEN v_lot.current_bid < 1000 THEN 25
      ELSE 50
    END;
  END IF;

  IF p_amount < v_min_bid THEN
    RETURN jsonb_build_object('success', false, 'error', 'BID_TOO_LOW', 'min_bid', v_min_bid, 'provided_bid', p_amount);
  END IF;

  -- Purse Guard
  IF p_amount > v_team.purse THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_PURSE', 'purse', v_team.purse, 'required', p_amount);
  END IF;

  -- Count total valid bids on this lot
  SELECT COUNT(*) + 1 INTO v_bid_count FROM public.bids b WHERE b.lot_id = v_lot.id AND b.is_valid = true;

  -- Reset bidding timer to full duration from current DB clock
  v_timer_expires := clock_timestamp() + (v_timer_sec * INTERVAL '1 second');

  -- Update lot with new high bid
  UPDATE public.auction_lots
  SET current_bid = p_amount,
      highest_bidder_team_id = p_team_id,
      timer_expires_at = v_timer_expires
  WHERE id = v_lot.id;

  -- Insert bid record with request_id idempotency key
  INSERT INTO public.bids (
    auction_id, lot_id, team_id, amount, request_id, is_bot, is_valid, bid_number, created_at
  ) VALUES (
    p_auction_id, v_lot.id, p_team_id, p_amount, p_request_id, p_is_bot, true, v_bid_count, NOW()
  );

  -- Emit BID_PLACED event
  v_seq := public._emit_auction_event(
    p_auction_id,
    'BID_PLACED',
    jsonb_build_object(
      'lot_id', v_lot.id,
      'team_id', p_team_id,
      'amount', p_amount,
      'bid_number', v_bid_count,
      'timer_expires_at', v_timer_expires
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'BID_ACCEPTED',
    'amount', p_amount,
    'highest_bidder_team_id', p_team_id,
    'timer_expires_at', v_timer_expires,
    'sequence', v_seq
  );
END;
$$;

REVOKE ALL ON FUNCTION public._process_bid_internal(UUID, UUID, INT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._process_bid_internal(UUID, UUID, INT, UUID, BOOLEAN) TO service_role;


-- ============================================================
-- 7. PUBLIC BID WRAPPER: public.process_bid
-- ============================================================
DROP FUNCTION IF EXISTS public.process_bid(UUID, UUID, INT, UUID);

CREATE OR REPLACE FUNCTION public.process_bid(
  p_auction_id UUID,
  p_team_id UUID,
  p_amount INT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._process_bid_internal(p_auction_id, p_team_id, p_amount, p_request_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public.process_bid(UUID, UUID, INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_bid(UUID, UUID, INT, UUID) TO authenticated, service_role;

COMMIT;
