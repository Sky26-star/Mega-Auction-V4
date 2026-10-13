-- Migration: 00044_mini_selection_confirm_lock.sql
-- Description: Adds team-level advisory locks to v3_confirm_mini_selections and v3_toggle_mini_selection
-- Prevents interleaving of concurrent selection toggles with selection confirmation for the same team.

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

  -- 2. Identify caller's team
  SELECT * INTO v_team FROM public.teams WHERE auction_id = p_auction_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    SELECT * INTO v_participant FROM public.room_participants rp
    JOIN public.auctions a ON a.room_id = rp.room_id
    WHERE a.id = p_auction_id AND rp.user_id = auth.uid();
    
    IF FOUND AND v_participant.team_id IS NOT NULL THEN
      SELECT * INTO v_team FROM public.teams WHERE id = v_participant.team_id;
    END IF;
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
  -- 1. Identify caller's team
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE auction_id = p_auction_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    SELECT * INTO v_participant FROM public.room_participants rp
    JOIN public.auctions a ON a.room_id = rp.room_id
    WHERE a.id = p_auction_id AND rp.user_id = auth.uid();
    
    IF FOUND AND v_participant.team_id IS NOT NULL THEN
      SELECT * INTO v_team FROM public.teams WHERE id = v_participant.team_id;
    END IF;
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
