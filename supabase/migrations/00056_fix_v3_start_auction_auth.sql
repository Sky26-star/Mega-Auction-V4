-- Fix public.v3_start_auction to use public.resolve_user_id() instead of auth.uid()

CREATE OR REPLACE FUNCTION public.v3_start_auction(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_first_lot public.auction_lots%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_get_ready_expires_at TIMESTAMPTZ;
BEGIN
  -- VERIFY ROOM AND HOST
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  IF public.resolve_user_id() IS NULL OR v_room.host_id != public.resolve_user_id() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  -- LOCK AUCTION
  SELECT * INTO v_auction FROM public.auctions WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  -- CHECK VALID START STATES
  IF v_auction.status IN ('IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_ALREADY_STARTED');
  END IF;

  -- LOCK FIRST PENDING LOT
  SELECT * INTO v_first_lot
  FROM public.auction_lots
  WHERE auction_id = v_auction.id AND status = 'PENDING'
  ORDER BY lot_index ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NO_PENDING_LOTS');
  END IF;

  -- UPDATE LOT TO GET_READY
  v_get_ready_expires_at := v_now + INTERVAL '5 seconds';

  UPDATE public.auction_lots
  SET status = 'GET_READY',
      get_ready_expires_at = v_get_ready_expires_at,
      timer_expires_at = NULL,
      current_bid = base_price,
      highest_bidder_team_id = NULL
  WHERE id = v_first_lot.id;

  -- UPDATE AUCTION
  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      current_lot_id = v_first_lot.id,
      current_lot_index = v_first_lot.lot_index,
      started_at = COALESCE(started_at, v_now)
  WHERE id = v_auction.id;

  RETURN jsonb_build_object(
    'success', true,
    'auction_id', v_auction.id,
    'room_id', p_room_id,
    'lot_id', v_first_lot.id,
    'lot_index', v_first_lot.lot_index,
    'status', 'IN_PROGRESS',
    'lot_status', 'GET_READY',
    'get_ready_expires_at', v_get_ready_expires_at,
    'current_bid', v_first_lot.base_price
  );
END;
$function$;
