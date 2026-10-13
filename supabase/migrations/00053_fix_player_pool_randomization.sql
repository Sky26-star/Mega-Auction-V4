-- supabase/migrations/00053_fix_player_pool_randomization.sql

CREATE OR REPLACE FUNCTION public.create_room_with_team(
  p_room_code TEXT,
  p_room_name TEXT,
  p_room_settings JSONB,
  p_player_set_id UUID,
  p_team_name TEXT,
  p_team_short_name TEXT,
  p_team_color TEXT,
  p_default_purse INT,
  p_player_ids UUID[] DEFAULT NULL
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
  v_timer_sec INT;
  v_inserted_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated to create a room';
  END IF;

  v_timer_sec := COALESCE((p_room_settings->>'timer_duration_seconds')::int, 15);

  -- 1. Create Room (status is 'OPEN')
  INSERT INTO public.rooms (code, name, settings, host_id, status)
  VALUES (trim(p_room_code), trim(p_room_name), p_room_settings, v_user_id, 'OPEN')
  RETURNING id INTO v_room_id;

  -- 2. Create Auction (status is 'LOBBY')
  INSERT INTO public.auctions (room_id, player_set_id, status)
  VALUES (v_room_id, p_player_set_id, 'LOBBY')
  RETURNING id INTO v_auction_id;

  -- 3. Atomically Generate Auction Lots Snapshot
  WITH inserted AS (
    INSERT INTO public.auction_lots (
      auction_id, player_id, lot_index, status, base_price, current_bid, timer_duration_seconds, created_at
    )
    SELECT
      v_auction_id,
      p.id,
      -- CRITICAL FIX: Randomize the order of the players in the auction
      (ROW_NUMBER() OVER (ORDER BY RANDOM()) - 1)::int AS lot_index,
      'PENDING' AS status,
      p.base_price,
      p.base_price,
      v_timer_sec,
      NOW()
    FROM public.players p
    WHERE p.player_set_id = p_player_set_id
      AND (p_player_ids IS NULL OR p.id = ANY(p_player_ids))
    RETURNING id
  )
  SELECT count(*) INTO v_inserted_count FROM inserted;

  -- Strict validation matching legacy snapshot behavior
  IF p_player_ids IS NOT NULL THEN
    IF COALESCE(array_length(p_player_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: At least one player must be selected when p_player_ids is provided';
    END IF;
    
    IF v_inserted_count != array_length(p_player_ids, 1) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Requested % players, but only % exist in the dataset. Invalid or duplicate IDs provided.', array_length(p_player_ids, 1), v_inserted_count;
    END IF;
  END IF;

  -- 4. Create Team
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

  -- 5. Add Participant (Host)
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

REVOKE ALL ON FUNCTION public.create_room_with_team(TEXT, TEXT, JSONB, UUID, TEXT, TEXT, TEXT, INT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_room_with_team(TEXT, TEXT, JSONB, UUID, TEXT, TEXT, TEXT, INT, UUID[]) TO authenticated, service_role;
