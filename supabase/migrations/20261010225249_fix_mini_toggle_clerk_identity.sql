
CREATE OR REPLACE FUNCTION public.v3_toggle_mini_selection(
  p_auction_id uuid,
  p_player_id uuid,
  p_desired_state boolean DEFAULT NULL::boolean
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
  v_team_status public.mini_auction_team_status%ROWTYPE;
  v_existing_selection public.mini_auction_selections%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_should_select boolean;
BEGIN
  -- Resolve the Clerk identity to the internal UUID.
  v_user_id := public.resolve_user_id();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
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
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_NOT_FOUND');
  END IF;

  -- Preserve hierarchical locking.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_auction_id::text || v_team.id::text)
  );

  PERFORM pg_advisory_xact_lock(
    hashtext(p_auction_id::text || v_team.id::text || p_player_id::text)
  );

  -- Re-check session state after acquiring locks.
  SELECT * INTO v_session
  FROM public.mini_auction_sessions
  WHERE auction_id = p_auction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status != 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_CLOSED');
  END IF;

  v_now := clock_timestamp();

  IF v_session.selection_expires_at IS NULL
     OR v_now >= v_session.selection_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_WINDOW_EXPIRED');
  END IF;

  -- Preserve team confirmation checks.
  SELECT * INTO v_team_status
  FROM public.mini_auction_team_status
  WHERE auction_id = p_auction_id
    AND team_id = v_team.id;

  IF FOUND AND v_team_status.has_confirmed THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ALREADY_CONFIRMED');
  END IF;

  -- Preserve explicit desired-state behavior.
  SELECT * INTO v_existing_selection
  FROM public.mini_auction_selections
  WHERE auction_id = p_auction_id
    AND team_id = v_team.id
    AND player_id = p_player_id;

  IF p_desired_state IS NOT NULL THEN
    v_should_select := p_desired_state;
  ELSE
    v_should_select := (v_existing_selection.id IS NULL);
  END IF;

  IF v_should_select THEN
    IF v_existing_selection.id IS NULL THEN
      INSERT INTO public.mini_auction_selections
        (auction_id, team_id, player_id, created_at)
      VALUES
        (p_auction_id, v_team.id, p_player_id, v_now);
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'selected', true,
      'player_id', p_player_id
    );
  ELSE
    IF v_existing_selection.id IS NOT NULL THEN
      DELETE FROM public.mini_auction_selections
      WHERE id = v_existing_selection.id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'selected', false,
      'player_id', p_player_id
    );
  END IF;
END;
$function$;
