-- Migration: 00015_fix_timer_and_start_flow.sql
-- Description: Optimizes initialize_and_start_auction with set-based lot insertion and adds 3s GET READY buffer to timer_expires_at

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
  v_first_base_price INT := 0;
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
    -- High-Performance Set-Based Insert for Player Set
    INSERT INTO public.auction_lots (
      id, auction_id, player_id, lot_index, status, base_price, current_bid, created_at
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
      NOW()
    FROM public.players p
    JOIN public.player_set_players psp ON psp.player_id = p.id
    WHERE psp.player_set_id = v_target_set_id;

    GET DIAGNOSTICS v_total_lots_inserted = ROW_COUNT;

    -- Fallback pool if player set was empty
    IF v_total_lots_inserted = 0 THEN
      INSERT INTO public.auction_lots (
        id, auction_id, player_id, lot_index, status, base_price, current_bid, created_at
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

  -- Explicitly resolve Lot 0's ID and base_price from auction_lots where lot_index = 0
  SELECT id, base_price INTO v_first_lot_id, v_first_base_price
  FROM public.auction_lots
  WHERE auction_id = v_auction.id AND lot_index = 0
  LIMIT 1;

  -- Ensure Lot 0 is set to BIDDING with active timer including 3-second GET READY transition buffer
  UPDATE public.auction_lots
  SET status = 'BIDDING',
      current_bid = 0,
      highest_bidder_team_id = NULL,
      timer_expires_at = clock_timestamp() + INTERVAL '3 seconds' + (v_timer_sec * INTERVAL '1 second')
  WHERE id = v_first_lot_id;

  -- Update auctions row to IN_PROGRESS pointing strictly to Lot 0's ID
  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      current_lot_index = 0,
      current_lot_id = v_first_lot_id,
      total_lots = COALESCE(NULLIF(v_total_lots_inserted, 0), v_existing_lots),
      started_at = clock_timestamp()
  WHERE id = v_auction.id;

  -- Update rooms row status to IN_PROGRESS
  UPDATE public.rooms
  SET status = 'LOCKED',
      updated_at = NOW()
  WHERE id = p_room_id;

  -- Evaluate bot interests for Lot 0
  PERFORM public.evaluate_bot_interests(v_auction.id, v_first_lot_id);

  -- Emit AUCTION_STARTED event via Issue #7 helper
  PERFORM public._emit_auction_event(
    v_auction.id,
    'AUCTION_STARTED',
    jsonb_build_object(
      'auction_id', v_auction.id,
      'first_lot_id', v_first_lot_id,
      'total_lots', COALESCE(NULLIF(v_total_lots_inserted, 0), v_existing_lots)
    ),
    NULL
  );

  RETURN public.get_authoritative_auction_state(p_room_id);
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_and_start_auction(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initialize_and_start_auction(UUID, UUID) TO authenticated, anon, service_role;


-- Update advance_lot RPC to also include 2-second GET READY transition buffer between lots
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
  v_unsold_lot RECORD;
  v_new_lot_id UUID;
  v_new_lot_index INT;
  v_next_lot_index INT;
  v_cloned_count INT := 0;
  v_timer_sec INT;
  v_seq INT;
  v_eval_res JSONB;
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

  -- Check if next lot exists in current lot sequence
  SELECT al.* INTO v_next_lot
  FROM public.auction_lots al
  WHERE al.auction_id = p_auction_id AND al.lot_index = v_next_lot_index;

  IF v_next_lot.id IS NOT NULL THEN
    -- Next lot exists: activate it with 2-second transition buffer
    UPDATE public.auctions
    SET current_lot_index = v_next_lot_index,
        current_lot_id = v_next_lot.id
    WHERE id = p_auction_id;

    UPDATE public.auction_lots
    SET status = 'BIDDING',
        timer_expires_at = clock_timestamp() + INTERVAL '2 seconds' + (v_timer_sec * INTERVAL '1 second')
    WHERE id = v_next_lot.id;

    -- Evaluate bot interests for new lot
    v_eval_res := public.evaluate_bot_interests(p_auction_id, v_next_lot.id);

    -- Emit LOT_STARTED event
    v_seq := public._emit_auction_event(
      p_auction_id,
      'LOT_STARTED',
      jsonb_build_object(
        'lot_id', v_next_lot.id,
        'lot_index', v_next_lot_index,
        'player_id', v_next_lot.player_id,
        'base_price', v_next_lot.base_price,
        'timer_expires_at', (clock_timestamp() + INTERVAL '2 seconds' + (v_timer_sec * INTERVAL '1 second')),
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

  -- Current round lots exhausted.
  IF NOT v_auction.is_unsold_round THEN
    -- Check for unsold lots from Round 1
    v_new_lot_index := v_auction.total_lots;

    FOR v_unsold_lot IN
      SELECT al.* FROM public.auction_lots al
      WHERE al.auction_id = p_auction_id AND al.status = 'UNSOLD'
      ORDER BY al.lot_index ASC
    LOOP
      v_new_lot_id := gen_random_uuid();

      INSERT INTO public.auction_lots (
        id, auction_id, player_id, lot_index, status, base_price, current_bid, created_at
      ) VALUES (
        v_new_lot_id,
        p_auction_id,
        v_unsold_lot.player_id,
        v_new_lot_index,
        'PENDING',
        GREATEST(1, FLOOR(v_unsold_lot.base_price * 0.5)),
        0,
        NOW()
      );

      v_new_lot_index := v_new_lot_index + 1;
      v_cloned_count := v_cloned_count + 1;
    END LOOP;

    IF v_cloned_count > 0 THEN
      UPDATE public.auctions
      SET is_unsold_round = true,
          total_lots = v_new_lot_index
      WHERE id = p_auction_id;

      SELECT al.* INTO v_next_lot
      FROM public.auction_lots al
      WHERE al.auction_id = p_auction_id AND al.lot_index = v_auction.current_lot_index + 1;

      IF v_next_lot.id IS NOT NULL THEN
        UPDATE public.auctions
        SET current_lot_index = v_next_lot.lot_index,
            current_lot_id = v_next_lot.id
        WHERE id = p_auction_id;

        UPDATE public.auction_lots
        SET status = 'BIDDING',
            timer_expires_at = clock_timestamp() + INTERVAL '2 seconds' + (v_timer_sec * INTERVAL '1 second')
        WHERE id = v_next_lot.id;

        PERFORM public.evaluate_bot_interests(p_auction_id, v_next_lot.id);

        v_seq := public._emit_auction_event(
          p_auction_id,
          'LOT_STARTED',
          jsonb_build_object(
            'lot_id', v_next_lot.id,
            'lot_index', v_next_lot.lot_index,
            'player_id', v_next_lot.player_id,
            'base_price', v_next_lot.base_price,
            'timer_expires_at', (clock_timestamp() + INTERVAL '2 seconds' + (v_timer_sec * INTERVAL '1 second')),
            'is_unsold_round', true
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

REVOKE ALL ON FUNCTION public.advance_lot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_lot(UUID) TO authenticated, anon, service_role;
