
CREATE OR REPLACE FUNCTION public.v3_start_mini_selection(p_auction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_session public.mini_auction_sessions%ROWTYPE;
  v_user_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_expires_at TIMESTAMPTZ := clock_timestamp() + INTERVAL '60 seconds';
BEGIN
  v_user_id := public.resolve_user_id();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  SELECT * INTO v_auction
  FROM public.auctions
  WHERE id = p_auction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_auction.room_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  IF v_room.host_id IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  SELECT * INTO v_session
  FROM public.mini_auction_sessions
  WHERE auction_id = p_auction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status = 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', v_session.status,
      'selection_expires_at', v_session.selection_expires_at,
      'already_open', true
    );
  END IF;

  IF v_session.status != 'SETUP' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_SESSION_STATUS');
  END IF;

  UPDATE public.mini_auction_sessions
  SET status = 'SELECTION_OPEN',
      selection_expires_at = v_expires_at,
      updated_at = v_now
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'SELECTION_OPEN',
    'selection_expires_at', v_expires_at
  );
END;
$function$;
