-- Normalize default_purse for bot teams when provisioning bots.
-- Since default_purse from room settings is in Crores, we must convert to Lakhs
-- if the value is <= 1000.

CREATE OR REPLACE FUNCTION public.provision_room_bots(p_room_id uuid, p_bots jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_room RECORD;
  v_bot_count INT;
  v_existing_humans INT;
  v_bot_elem JSONB;
  v_team_id UUID;
  v_default_purse INT;
  v_bot_name TEXT;
  v_bot_short TEXT;
  v_bot_color TEXT;
BEGIN
  -- 1. Verify Caller is Authenticated
  IF auth.role() != 'authenticated' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated to provision bots';
  END IF;

  -- 2. Verify Caller is Room Host & Get Room + Auction Details
  SELECT r.*, a.id AS auction_id INTO v_room
  FROM public.rooms r
  JOIN public.auctions a ON a.room_id = r.id
  WHERE r.id = p_room_id AND r.host_id = auth.uid();

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NOT_HOST: Only the room host can provision bot opponents';
  END IF;

  -- 3. Verify Room & Auction Status
  IF v_room.status != 'OPEN' THEN
    RAISE EXCEPTION 'ROOM_NOT_OPEN: Bots can only be provisioned while room is open';
  END IF;

  -- 4. Calculate Bot Count & Manager Limits
  v_bot_count := jsonb_array_length(COALESCE(p_bots, '[]'::jsonb));
  IF v_bot_count < 0 OR v_bot_count > 9 THEN
    RAISE EXCEPTION 'INVALID_BOT_COUNT: Bot count must be between 0 and 9';
  END IF;

  SELECT COUNT(*) INTO v_existing_humans
  FROM public.room_participants
  WHERE room_id = p_room_id AND is_bot = false;

  IF (v_existing_humans + v_bot_count) > 10 THEN
    RAISE EXCEPTION 'EXCEEDS_MANAGER_CAPACITY: Total room managers cannot exceed 10';
  END IF;

  -- Parse default purse from room settings (in Crores)
  v_default_purse := COALESCE((v_room.settings->>'default_purse')::int, 100);

  -- Normalize to Lakhs if it is <= 1000 (meaning it was provided in Crores)
  IF v_default_purse <= 1000 THEN
    v_default_purse := v_default_purse * 100;
  END IF;

  -- 5. Idempotent Cleanup of Previous Bot Teams/Participants for this Room
  DELETE FROM public.room_participants WHERE room_id = p_room_id AND is_bot = true;
  DELETE FROM public.teams WHERE auction_id = v_room.auction_id AND is_bot = true;

  -- 6. Loop over p_bots JSONB array and insert teams + participants atomically
  IF v_bot_count > 0 THEN
    FOR v_bot_elem IN SELECT * FROM jsonb_array_elements(p_bots)
    LOOP
      v_bot_name := trim(v_bot_elem->>'name');
      v_bot_short := upper(trim(v_bot_elem->>'shortName'));
      IF v_bot_short IS NULL OR v_bot_short = '' THEN
        v_bot_short := upper(trim(v_bot_elem->>'short_name'));
      END IF;
      v_bot_color := trim(v_bot_elem->>'color');

      IF v_bot_name IS NULL OR v_bot_name = '' OR v_bot_short IS NULL OR v_bot_short = '' THEN
        RAISE EXCEPTION 'INVALID_BOT_DATA: Bot name and short name are required';
      END IF;

      -- Insert Bot Team Row
      INSERT INTO public.teams (
        auction_id,
        name,
        short_name,
        color,
        purse,
        initial_purse,
        is_bot
      ) VALUES (
        v_room.auction_id,
        v_bot_name,
        v_bot_short,
        COALESCE(v_bot_color, '#C9A227'),
        v_default_purse,
        v_default_purse,
        true
      )
      RETURNING id INTO v_team_id;

      -- Insert Bot Room Participant Row
      INSERT INTO public.room_participants (
        room_id,
        user_id,
        team_id,
        role,
        is_bot,
        is_connected
      ) VALUES (
        p_room_id,
        NULL,
        v_team_id,
        'MEMBER',
        true,
        true
      );
    END LOOP;
  END IF;

  -- 7. Persist Bot Settings into rooms.settings JSONB
  UPDATE public.rooms
  SET settings = jsonb_set(
    jsonb_set(settings, '{bot_count}', to_jsonb(v_bot_count)),
    '{bots}',
    p_bots
  ),
  updated_at = clock_timestamp()
  WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success', true,
    'room_id', p_room_id,
    'auction_id', v_room.auction_id,
    'bot_count', v_bot_count
  );
END;
$function$
