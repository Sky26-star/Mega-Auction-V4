-- Resolve Clerk identities for mini-auction initiation.

CREATE OR REPLACE FUNCTION public.v3_initiate_mini_auction(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_session public.mini_auction_sessions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_user_id UUID := public.resolve_user_id();
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

  IF v_user_id IS NULL OR v_room.host_id != v_user_id THEN
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
