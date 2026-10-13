
CREATE OR REPLACE FUNCTION public.v3_confirm_mini_selections(
  p_auction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_session public.mini_auction_sessions%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_participant public.room_participants%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- Resolve Clerk identity to the internal UUID.
  v_user_id := public.resolve_user_id();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'ERR_UNAUTHORIZED'
    );
  END IF;

  -- Identify caller's team.
  SELECT rp.* INTO v_participant
  FROM public.room_participants rp
  JOIN public.auctions a ON a.room_id = rp.room_id
  WHERE a.id = p_auction_id
    AND rp.user_id = v_user_id;

  IF FOUND AND v_participant.team_id IS NOT NULL THEN
    SELECT * INTO v_team
    FROM public.teams
    WHERE id = v_participant.team_id;
  END IF;

  IF v_team.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'ERR_TEAM_NOT_FOUND'
    );
  END IF;

  -- Preserve team-level transaction locking.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_auction_id::text || v_team.id::text)
  );

  -- Re-check session after acquiring the lock.
  SELECT * INTO v_session
  FROM public.mini_auction_sessions
  WHERE auction_id = p_auction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'ERR_SESSION_NOT_FOUND'
    );
  END IF;

  IF v_session.status != 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'ERR_SELECTION_CLOSED'
    );
  END IF;

  v_now := clock_timestamp();

  IF v_session.selection_expires_at IS NULL
     OR v_now >= v_session.selection_expires_at THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'ERR_SELECTION_WINDOW_EXPIRED'
    );
  END IF;

  -- Mark confirmed atomically under the team lock.
  INSERT INTO public.mini_auction_team_status (
    auction_id, team_id, has_confirmed, confirmed_at, updated_at
  )
  VALUES (
    p_auction_id, v_team.id, true, v_now, v_now
  )
  ON CONFLICT (auction_id, team_id)
  DO UPDATE SET
    has_confirmed = true,
    confirmed_at = v_now,
    updated_at = v_now;

  RETURN jsonb_build_object(
    'success', true,
    'team_id', v_team.id,
    'has_confirmed', true
  );
END;
$function$;
