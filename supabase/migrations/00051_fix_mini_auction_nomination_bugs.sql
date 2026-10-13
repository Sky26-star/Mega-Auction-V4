-- supabase/migrations/00051_fix_mini_auction_nomination_bugs.sql

-- 1. Fix v3_close_mini_selection to properly complete the Mega Auction when nominations = 0
CREATE OR REPLACE FUNCTION public.v3_close_mini_selection(
  p_auction_id UUID,
  p_force BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_is_service_role BOOLEAN := (current_setting('role', true) = 'service_role');
  v_max_lot_index INT;
  v_selected_player_id UUID;
  v_player public.players%ROWTYPE;
  v_count INT := 0;
BEGIN
  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', true, 'status', 'COMPLETED', 'total_lots', v_session.total_lots, 'already_completed', true);
  END IF;

  IF v_session.status = 'SELECTION_CLOSED' THEN
    RETURN jsonb_build_object('success', true, 'status', 'SELECTION_CLOSED', 'total_lots', v_session.total_lots, 'already_closed', true);
  END IF;

  IF v_session.status != 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_SESSION_STATUS');
  END IF;

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;

  -- Caller check: service_role or room host
  IF NOT v_is_service_role AND (auth.uid() IS NULL OR v_room.host_id != auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  -- Timer check: non-service-role callers CANNOT force early close
  IF NOT v_is_service_role OR NOT p_force THEN
    IF v_session.selection_expires_at IS NULL OR v_now < v_session.selection_expires_at THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_WINDOW_ACTIVE');
    END IF;
  END IF;

  -- Fetch maximum existing lot index
  SELECT COALESCE(MAX(lot_index), 0) INTO v_max_lot_index
  FROM public.auction_lots WHERE auction_id = p_auction_id;

  -- Iterate through distinct nominated players
  FOR v_selected_player_id IN
    SELECT DISTINCT player_id FROM public.mini_auction_selections
    WHERE auction_id = p_auction_id
  LOOP
    SELECT * INTO v_player FROM public.players WHERE id = v_selected_player_id;
    IF FOUND THEN
      v_count := v_count + 1;
      INSERT INTO public.auction_lots (
        auction_id,
        player_id,
        lot_index,
        base_price,
        status,
        is_mini_round
      ) VALUES (
        p_auction_id,
        v_player.id,
        v_max_lot_index + v_count,
        FLOOR(v_player.base_price * 0.8), -- 20% discount
        'PENDING',
        true
      );
    END IF;
  END LOOP;

  -- ZERO NOMINATIONS PATH: transition both session and auction to COMPLETED
  IF v_count = 0 THEN
    UPDATE public.mini_auction_sessions
    SET status = 'COMPLETED',
        total_lots = 0,
        closed_at = v_now,
        completed_at = v_now,
        updated_at = v_now
    WHERE id = v_session.id;

    -- CRITICAL FIX: Also close the Mega Auction so the room is not permanently stuck
    UPDATE public.auctions
    SET status = 'COMPLETED',
        current_lot_id = NULL,
        completed_at = v_now
    WHERE id = p_auction_id;

    RETURN jsonb_build_object('success', true, 'status', 'COMPLETED', 'total_lots', 0);
  END IF;

  -- NORMAL LOT PATH: transition to SELECTION_CLOSED for review
  UPDATE public.mini_auction_sessions
  SET status = 'SELECTION_CLOSED',
      total_lots = v_count,
      closed_at = v_now,
      updated_at = v_now
  WHERE id = v_session.id;

  RETURN jsonb_build_object('success', true, 'status', 'SELECTION_CLOSED', 'total_lots', v_count);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 2. Fix v3_initiate_mini_auction to prevent old selections from leaking into a fresh session
CREATE OR REPLACE FUNCTION public.v3_initiate_mini_auction(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_session public.mini_auction_sessions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  IF v_auction.status != 'MINI_AUCTION' THEN
    -- Fallback compatibility: some callers might expect it to be COMPLETED depending on timing, 
    -- but architecture now sets it to MINI_AUCTION. We allow both for safety.
    IF v_auction.status != 'COMPLETED' THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_MINI_AUCTION_PHASE');
    END IF;
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  IF auth.uid() IS NULL OR v_room.host_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  -- Seed the session if it doesn't exist
  INSERT INTO public.mini_auction_sessions (auction_id, status, created_at, updated_at)
  VALUES (p_auction_id, 'SETUP', v_now, v_now)
  ON CONFLICT (auction_id) DO NOTHING
  RETURNING * INTO v_session;

  -- If it already existed, just fetch it
  IF v_session.id IS NULL THEN
    SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
    RETURN jsonb_build_object('success', true, 'session_id', v_session.id, 'status', v_session.status, 'already_exists', true);
  END IF;

  -- CRITICAL FIX: If we just created a FRESH session for this auction, 
  -- we MUST wipe out any leaked nominations from previous aborted sessions in the same auction
  DELETE FROM public.mini_auction_selections WHERE auction_id = p_auction_id;
  DELETE FROM public.mini_auction_team_status WHERE auction_id = p_auction_id;

  RETURN jsonb_build_object('success', true, 'session_id', v_session.id, 'status', v_session.status, 'already_exists', false);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 3. Fix v3_admin_force_initiate_mini_auction to also wipe leaked selections
CREATE OR REPLACE FUNCTION public.v3_admin_force_initiate_mini_auction(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF current_setting('role', true) != 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SERVICE_ROLE_ONLY');
  END IF;

  -- Force reset any existing mini auction state
  DELETE FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
  DELETE FROM public.mini_auction_team_status WHERE auction_id = p_auction_id;
  
  -- CRITICAL FIX: Wipe out leaked nominations
  DELETE FROM public.mini_auction_selections WHERE auction_id = p_auction_id;
  
  -- Reset any mini auction lots
  DELETE FROM public.auction_lots WHERE auction_id = p_auction_id AND is_mini_round = true;

  INSERT INTO public.mini_auction_sessions (auction_id, status, created_at, updated_at)
  VALUES (p_auction_id, 'SETUP', v_now, v_now)
  RETURNING * INTO v_session;

  RETURN jsonb_build_object('success', true, 'session_id', v_session.id, 'status', v_session.status, 'forced', true);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;
