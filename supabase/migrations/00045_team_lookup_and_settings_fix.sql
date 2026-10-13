-- Migration: 00045_team_lookup_and_settings_fix.sql
-- Description: Fixes team lookup via room_participants, adds ownership check to v3_release_player,
-- and reads timer_duration_seconds from rooms.settings JSONB in v3_close_mini_selection.

-- 1. RPC: v3_confirm_mini_selections
CREATE OR REPLACE FUNCTION public.v3_confirm_mini_selections(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_participant public.room_participants%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- 1. Authorization check
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  -- 2. Identify caller's team via room_participants
  SELECT * INTO v_participant FROM public.room_participants rp
  JOIN public.auctions a ON a.room_id = rp.room_id
  WHERE a.id = p_auction_id AND rp.user_id = auth.uid();
  
  IF FOUND AND v_participant.team_id IS NOT NULL THEN
    SELECT * INTO v_team FROM public.teams WHERE id = v_participant.team_id;
  END IF;

  IF v_team.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_NOT_FOUND');
  END IF;

  -- 3. ACQUIRE TEAM-LEVEL TRANSACTION ADVISORY LOCK (Serializes against concurrent toggles for this team)
  PERFORM pg_advisory_xact_lock(hashtext(p_auction_id::text || v_team.id::text));

  -- 4. Check session state AFTER lock acquisition
  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status != 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_CLOSED');
  END IF;

  v_now := clock_timestamp();
  IF v_session.selection_expires_at IS NULL OR v_now >= v_session.selection_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_WINDOW_EXPIRED');
  END IF;

  -- 5. Mark confirmed atomically under lock
  INSERT INTO public.mini_auction_team_status (auction_id, team_id, has_confirmed, confirmed_at, updated_at)
  VALUES (p_auction_id, v_team.id, true, v_now, v_now)
  ON CONFLICT (auction_id, team_id)
  DO UPDATE SET has_confirmed = true, confirmed_at = v_now, updated_at = v_now;

  RETURN jsonb_build_object('success', true, 'team_id', v_team.id, 'has_confirmed', true);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 2. RPC: v3_toggle_mini_selection
CREATE OR REPLACE FUNCTION public.v3_toggle_mini_selection(
  p_auction_id UUID,
  p_player_id UUID,
  p_desired_state BOOLEAN DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_participant public.room_participants%ROWTYPE;
  v_team_status public.mini_auction_team_status%ROWTYPE;
  v_existing_selection public.mini_auction_selections%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_should_select BOOLEAN;
BEGIN
  -- 1. Identify caller's team via room_participants
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  SELECT * INTO v_participant FROM public.room_participants rp
  JOIN public.auctions a ON a.room_id = rp.room_id
  WHERE a.id = p_auction_id AND rp.user_id = auth.uid();
  
  IF FOUND AND v_participant.team_id IS NOT NULL THEN
    SELECT * INTO v_team FROM public.teams WHERE id = v_participant.team_id;
  END IF;

  IF v_team.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_NOT_FOUND');
  END IF;

  -- 2. ACQUIRE LOCKS IN STRICT HIERARCHICAL ORDER:
  -- Lock 1: Team-level lock (matches v3_confirm_mini_selections to serialize confirm vs toggle)
  PERFORM pg_advisory_xact_lock(hashtext(p_auction_id::text || v_team.id::text));
  -- Lock 2: Player-level lock (serializes concurrent toggles on same player)
  PERFORM pg_advisory_xact_lock(hashtext(p_auction_id::text || v_team.id::text || p_player_id::text));

  -- 3. SELECT & RE-CHECK session state AFTER lock acquisition (eliminating TOCTOU window)
  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status != 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_CLOSED');
  END IF;

  v_now := clock_timestamp();
  IF v_session.selection_expires_at IS NULL OR v_now >= v_session.selection_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_WINDOW_EXPIRED');
  END IF;

  -- 4. SELECT & RE-CHECK team confirmation status AFTER lock acquisition
  SELECT * INTO v_team_status FROM public.mini_auction_team_status
  WHERE auction_id = p_auction_id AND team_id = v_team.id;
  IF FOUND AND v_team_status.has_confirmed THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ALREADY_CONFIRMED');
  END IF;

  -- 5. Check-then-act with explicit desired state
  SELECT * INTO v_existing_selection FROM public.mini_auction_selections
  WHERE auction_id = p_auction_id AND team_id = v_team.id AND player_id = p_player_id;

  IF p_desired_state IS NOT NULL THEN
    v_should_select := p_desired_state;
  ELSE
    v_should_select := (v_existing_selection.id IS NULL);
  END IF;

  IF v_should_select THEN
    IF v_existing_selection.id IS NULL THEN
      INSERT INTO public.mini_auction_selections (auction_id, team_id, player_id, created_at)
      VALUES (p_auction_id, v_team.id, p_player_id, v_now);
    END IF;
    RETURN jsonb_build_object('success', true, 'selected', true, 'player_id', p_player_id);
  ELSE
    IF v_existing_selection.id IS NOT NULL THEN
      DELETE FROM public.mini_auction_selections
      WHERE id = v_existing_selection.id;
    END IF;
    RETURN jsonb_build_object('success', true, 'selected', false, 'player_id', p_player_id);
  END IF;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 3. RPC: v3_release_player (LOCKED TO SETUP PHASE)
CREATE OR REPLACE FUNCTION public.v3_release_player(
  p_auction_id UUID,
  p_player_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_squad_player public.squad_players%ROWTYPE;
  v_player public.players%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_caller_owns_team BOOLEAN := false;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Strict precondition: status must be SETUP
  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status != 'SETUP' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_RELEASE_ONLY_ALLOWED_IN_SETUP');
  END IF;

  -- Verify player is in squad
  SELECT * INTO v_squad_player FROM public.squad_players
  WHERE auction_id = p_auction_id AND player_id = p_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_PLAYER_NOT_IN_SQUAD');
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE id = v_squad_player.team_id FOR UPDATE;
  SELECT * INTO v_player FROM public.players WHERE id = p_player_id;
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;

  -- Caller must be team owner or room host (checked via room_participants)
  SELECT EXISTS (
    SELECT 1 FROM public.room_participants rp
    WHERE rp.team_id = v_team.id AND rp.user_id = auth.uid()
  ) INTO v_caller_owns_team;

  IF auth.uid() IS NULL OR (NOT v_caller_owns_team AND v_room.host_id != auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  -- Delete from active squad
  DELETE FROM public.squad_players WHERE id = v_squad_player.id;

  -- Refund purse and decrement counts
  UPDATE public.teams
  SET purse = purse + v_squad_player.purchase_price,
      players_bought = players_bought - 1,
      overseas_count = overseas_count - (CASE WHEN v_player.is_overseas THEN 1 ELSE 0 END)
  WHERE id = v_team.id;

  -- Record audit log
  INSERT INTO public.player_releases (auction_id, team_id, player_id, refund_amount, released_at)
  VALUES (p_auction_id, v_team.id, p_player_id, v_squad_player.purchase_price, v_now);

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id,
    'team_id', v_team.id,
    'refund_amount', v_squad_player.purchase_price,
    'new_purse', v_team.purse + v_squad_player.purchase_price
  );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 4. RPC: v3_close_mini_selection (HANDLES ZERO LOT COMPLETION ATOMICALLY)
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
        status,
        base_price,
        current_bid,
        is_mini_round,
        timer_duration_seconds
      ) VALUES (
        p_auction_id,
        v_selected_player_id,
        v_max_lot_index + v_count,
        'PENDING',
        GREATEST(1, FLOOR(v_player.base_price * 0.80)),
        GREATEST(1, FLOOR(v_player.base_price * 0.80)),
        true,
        COALESCE((v_room.settings->>'timer_duration_seconds')::int, 15)
      );
    END IF;
  END LOOP;

  -- ZERO-LOT PATH: complete immediately and atomically
  IF v_count = 0 THEN
    UPDATE public.mini_auction_sessions
    SET status = 'COMPLETED',
        total_lots = 0,
        closed_at = v_now,
        completed_at = v_now,
        updated_at = v_now
    WHERE id = v_session.id;

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
