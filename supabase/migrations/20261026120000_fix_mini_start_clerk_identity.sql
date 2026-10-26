-- Clerk identity fix for the mini-auction start RPC

-- Update v3_start_mini_auction to allow the ticker (service_role) to execute it automatically
CREATE OR REPLACE FUNCTION public.v3_start_mini_auction(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_session public.mini_auction_sessions%ROWTYPE;
  v_first_mini_lot public.auction_lots%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_get_ready_expires_at TIMESTAMPTZ := clock_timestamp() + INTERVAL '5 seconds';
  v_is_service_role BOOLEAN := (current_setting('role', true) = 'service_role');
  v_user_id UUID := public.resolve_user_id();
BEGIN
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  -- CRITICAL FIX: Allow service_role (the automated ticker) to start the mini auction without human input
  IF NOT v_is_service_role AND (v_user_id IS NULL OR v_room.host_id != v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status != 'SELECTION_CLOSED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_SESSION_STATUS');
  END IF;

  IF v_session.total_lots = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NO_MINI_LOTS');
  END IF;

  SELECT * INTO v_first_mini_lot FROM public.auction_lots
  WHERE auction_id = p_auction_id AND is_mini_round = true AND status = 'PENDING'
  ORDER BY lot_index ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NO_PENDING_MINI_LOTS');
  END IF;

  UPDATE public.auction_lots
  SET status = 'GET_READY',
      get_ready_expires_at = v_get_ready_expires_at,
      timer_expires_at = NULL,
      current_bid = base_price,
      highest_bidder_team_id = NULL
  WHERE id = v_first_mini_lot.id;

  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      current_lot_id = v_first_mini_lot.id,
      current_lot_index = v_first_mini_lot.lot_index
  WHERE id = p_auction_id;

  UPDATE public.mini_auction_sessions
  SET status = 'BIDDING',
      updated_at = v_now
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'success', true, 
    'status', 'BIDDING',
    'first_lot_id', v_first_mini_lot.id
  );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;
