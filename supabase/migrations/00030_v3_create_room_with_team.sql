-- Atomic room creation and team creation for Host
CREATE OR REPLACE FUNCTION public.create_room_with_team(
  p_room_name TEXT,
  p_room_settings JSONB,
  p_player_set_id UUID,
  p_team_name TEXT,
  p_team_short_name TEXT,
  p_team_color TEXT,
  p_default_purse INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room_id UUID;
  v_auction_id UUID;
  v_team_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated to create a room';
  END IF;

  -- 1. Create Room
  INSERT INTO public.rooms (name, settings, host_id, status)
  VALUES (trim(p_room_name), p_room_settings, v_user_id, 'LOBBY')
  RETURNING id INTO v_room_id;

  -- 2. Create Auction
  INSERT INTO public.auctions (room_id, player_set_id, status)
  VALUES (v_room_id, p_player_set_id, 'SETUP')
  RETURNING id INTO v_auction_id;

  -- 3. Create Team
  INSERT INTO public.teams (
    auction_id, name, short_name, color, purse, initial_purse, is_bot
  ) VALUES (
    v_auction_id,
    trim(p_team_name),
    upper(trim(p_team_short_name)),
    COALESCE(trim(p_team_color), '#C9A227'),
    p_default_purse,
    p_default_purse,
    false
  ) RETURNING id INTO v_team_id;

  -- 4. Add Participant (Host)
  INSERT INTO public.room_participants (
    room_id, user_id, team_id, role, is_bot, is_connected
  ) VALUES (
    v_room_id, v_user_id, v_team_id, 'HOST', false, true
  );

  RETURN jsonb_build_object(
    'room_id', v_room_id,
    'auction_id', v_auction_id,
    'team_id', v_team_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_room_with_team(TEXT, JSONB, UUID, TEXT, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_room_with_team(TEXT, JSONB, UUID, TEXT, TEXT, TEXT, INT) TO authenticated, service_role;
