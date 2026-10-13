-- Migration: 00013_fix_advance_lot_rpc.sql
-- Description: Fixes missing v_next_lot_index PL/pgSQL variable declaration in advance_lot RPC function

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
    -- Next lot exists: activate it
    UPDATE public.auctions
    SET current_lot_index = v_next_lot_index,
        current_lot_id = v_next_lot.id
    WHERE id = p_auction_id;

    UPDATE public.auction_lots
    SET status = 'BIDDING',
        timer_expires_at = clock_timestamp() + (v_timer_sec * INTERVAL '1 second')
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
        'timer_expires_at', (clock_timestamp() + (v_timer_sec * INTERVAL '1 second')),
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
  -- ISSUE #6: CLONE-ON-TRANSITION UNSOLD ROUND LOGIC
  IF NOT v_auction.is_unsold_round THEN
    -- Check for unsold lots from Round 1
    v_new_lot_index := v_auction.total_lots;

    FOR v_unsold_lot IN
      SELECT al.* FROM public.auction_lots al
      WHERE al.auction_id = p_auction_id AND al.status = 'UNSOLD'
      ORDER BY al.lot_index ASC
    LOOP
      v_new_lot_id := gen_random_uuid();

      -- Clone UNSOLD lot as a NEW row in auction_lots
      -- Round 2 base_price = GREATEST(1, FLOOR(original_base_price * 0.5))
      INSERT INTO public.auction_lots (
        id, auction_id, player_id, lot_index, status, base_price,
        current_bid, timer_duration_seconds, created_at
      ) VALUES (
        v_new_lot_id,
        p_auction_id,
        v_unsold_lot.player_id,
        v_new_lot_index,
        'PENDING',
        GREATEST(1, FLOOR(v_unsold_lot.base_price * 0.5)),
        0,
        v_unsold_lot.timer_duration_seconds,
        NOW()
      );

      v_new_lot_index := v_new_lot_index + 1;
      v_cloned_count := v_cloned_count + 1;
    END LOOP;

    IF v_cloned_count > 0 THEN
      -- Unsold Round 2 initialized with cloned lots
      UPDATE public.auctions
      SET is_unsold_round = true,
          total_lots = v_auction.total_lots + v_cloned_count
      WHERE id = p_auction_id;

      -- Emit UNSOLD_ROUND_STARTED event
      v_seq := public._emit_auction_event(
        p_auction_id,
        'UNSOLD_ROUND_STARTED',
        jsonb_build_object('cloned_lots_count', v_cloned_count),
        NULL
      );

      -- Recursively activate the first cloned lot of Round 2
      RETURN public.advance_lot(p_auction_id);
    END IF;
  END IF;

  -- No unsold lots or Round 2 completed: COMPLETE AUCTION
  UPDATE public.auctions
  SET status = 'COMPLETED',
      completed_at = clock_timestamp(),
      current_lot_id = NULL
  WHERE id = p_auction_id;

  v_seq := public._emit_auction_event(
    p_auction_id,
    'AUCTION_COMPLETED',
    jsonb_build_object('completed_at', clock_timestamp()),
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'COMPLETED',
    'completed_at', clock_timestamp(),
    'sequence', v_seq
  );
END;
$$;

REVOKE ALL ON FUNCTION public.advance_lot(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_lot(UUID) TO service_role;
