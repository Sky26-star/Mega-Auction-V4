-- Migration 00054: Clerk Identity Bridge & Safe Provisioning

-- 1. Ensure clerk_user_mappings table exists
CREATE TABLE IF NOT EXISTS public.clerk_user_mappings (
  clerk_user_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on the mappings table
ALTER TABLE public.clerk_user_mappings ENABLE ROW LEVEL SECURITY;

-- Deny all access from authenticated/anon roles (Service Role bypasses this)
DROP POLICY IF EXISTS "Deny all access to clerk_user_mappings" ON public.clerk_user_mappings;
CREATE POLICY "Deny all access to clerk_user_mappings" ON public.clerk_user_mappings
  FOR ALL TO public
  USING (false);

-- 2. The Identity Resolver (Strict & Safe)
CREATE OR REPLACE FUNCTION public.resolve_user_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub TEXT;
  v_role TEXT;
  v_uuid UUID;
BEGIN
  -- Extract raw subject and role from JWT strictly using auth.jwt() when available
  v_sub := auth.jwt()->>'sub';
  v_role := auth.jwt()->>'role';

  -- Fallback for environments where auth.jwt() might be missing the subject
  IF v_sub IS NULL THEN
    v_sub := coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    );
  END IF;

  IF v_role IS NULL THEN
    v_role := coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  END IF;

  IF v_sub IS NULL THEN
    RETURN NULL;
  END IF;

  -- If service_role, return NULL. service_role shouldn't pretend to be a human user implicitly.
  IF v_role = 'service_role' THEN
    RETURN NULL;
  END IF;

  -- Legacy Supabase UUID logic: Try casting directly
  BEGIN
    v_uuid := v_sub::uuid;
    RETURN v_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- It's a Clerk string ID
  END;

  -- Clerk Token mapping logic
  SELECT profile_id INTO v_uuid FROM public.clerk_user_mappings WHERE clerk_user_id = v_sub;
  
  RETURN v_uuid;
END;
$$;

-- Revoke public access to ensure safety, grant to authenticated only
REVOKE ALL ON FUNCTION public.resolve_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_user_id() TO authenticated;


-- Audited RPC Migrations

-- Audited migration for create_room_with_team
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
  v_user_id UUID := public.resolve_user_id();
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

-- Audited migration for join_room_with_team
CREATE OR REPLACE FUNCTION public.join_room_with_team(
  p_room_code TEXT,
  p_team_name TEXT,
  p_team_short_name TEXT,
  p_team_color TEXT DEFAULT '#C9A227'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := public.resolve_user_id();
  v_room RECORD;
  v_existing_participant RECORD;
  v_manager_count INT;
  v_team_id UUID;
  v_default_purse INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated to join a room';
  END IF;

  -- 1. Find Room & Auction
  SELECT r.*, a.id AS auction_id INTO v_room
  FROM public.rooms r
  LEFT JOIN public.auctions a ON a.room_id = r.id
  WHERE r.code = upper(trim(p_room_code));

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND: Room code % not found', p_room_code;
  END IF;

  -- 2. Check if User is already a participant
  SELECT rp.* INTO v_existing_participant
  FROM public.room_participants rp
  WHERE rp.room_id = v_room.id AND rp.user_id = v_user_id;

  IF v_existing_participant.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'room_id', v_room.id,
      'already_joined', true,
      'participant_id', v_existing_participant.id
    );
  END IF;

  -- 3. Check Room Status
  IF v_room.status NOT IN ('OPEN', 'LOBBY') THEN
    RAISE EXCEPTION 'ROOM_NOT_OPEN: Room is no longer open for joining';
  END IF;

  -- 4. STRICT MANAGER CAPACITY ENFORCEMENT (MAX 10 MANAGERS)
  SELECT COUNT(*) INTO v_manager_count
  FROM public.room_participants
  WHERE room_id = v_room.id;

  IF v_manager_count >= 10 THEN
    RAISE EXCEPTION 'EXCEEDS_MANAGER_CAPACITY: Room has reached maximum capacity of 10 managers';
  END IF;

  -- 5. Create Team & Add Participant
  -- Default purse is in Crores, DB stores in Lakhs (x100)
  v_default_purse := COALESCE((v_room.settings->>'default_purse')::int * 100, 10000);

  INSERT INTO public.teams (
    auction_id, name, short_name, color, purse, initial_purse, is_bot
  ) VALUES (
    v_room.auction_id,
    trim(p_team_name),
    upper(trim(p_team_short_name)),
    COALESCE(trim(p_team_color), '#C9A227'),
    v_default_purse,
    v_default_purse,
    false
  ) RETURNING id INTO v_team_id;

  INSERT INTO public.room_participants (
    room_id, user_id, team_id, role, is_bot, is_connected
  ) VALUES (
    v_room.id, v_user_id, v_team_id, 'MEMBER', false, true
  );

  RETURN jsonb_build_object(
    'room_id', v_room.id,
    'already_joined', false,
    'team_id', v_team_id
  );
END;
$$;

-- Audited migration for delete_room
CREATE OR REPLACE FUNCTION public.delete_room(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id UUID;
BEGIN
  -- Verify Caller Authentication
  IF auth.role() != 'authenticated' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated to delete a room';
  END IF;

  -- Verify Room Ownership
  SELECT id INTO v_room_id
  FROM public.rooms
  WHERE id = p_room_id AND host_id = public.resolve_user_id();

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NOT_HOST: Only the room host can delete this room';
  END IF;

  -- Delete Room (Triggers SQL ON DELETE CASCADE across auctions, teams, room_participants)
  DELETE FROM public.rooms WHERE id = p_room_id AND host_id = public.resolve_user_id();

  RETURN jsonb_build_object('success', true, 'room_id', p_room_id);
END;
$$;

-- Audited migration for start_auction
CREATE OR REPLACE FUNCTION public.start_auction(
  p_auction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction RECORD;
  v_room RECORD;
  v_lot0 RECORD;
  v_timer_sec INT;
  v_seq INT;
  v_eval_res JSONB;
BEGIN
  -- Verify host permission if authenticated
  IF auth.role() = 'authenticated' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = p_auction_id AND r.host_id = public.resolve_user_id()
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED_HOST_ONLY: Only the room host can start the auction';
    END IF;
  END IF;

  -- LEVEL 1 LOCK: auctions row
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.id = p_auction_id
  FOR UPDATE;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_FOUND');
  END IF;

  IF v_auction.status NOT IN ('LOBBY', 'READY') THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_ALREADY_STARTED');
  END IF;

  -- Read room settings for timer duration
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = v_auction.room_id;
  v_timer_sec := COALESCE(NULLIF((v_room.settings->>'timer_duration_seconds')::int, 0), 15);

  -- LEVEL 2 LOCK: lot 0
  SELECT al.* INTO v_lot0
  FROM public.auction_lots al
  WHERE al.auction_id = p_auction_id AND al.lot_index = 0
  FOR UPDATE;

  IF v_lot0.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'LOT_ZERO_NOT_FOUND');
  END IF;

  -- Transition auction & lot 0
  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      started_at = clock_timestamp(),
      current_lot_index = 0,
      current_lot_id = v_lot0.id
  WHERE id = p_auction_id;

  UPDATE public.auction_lots
  SET status = 'BIDDING',
      timer_expires_at = clock_timestamp() + (v_timer_sec * INTERVAL '1 second')
  WHERE id = v_lot0.id;

  -- Evaluate bot interests for lot 0
  v_eval_res := public.evaluate_bot_interests(p_auction_id, v_lot0.id);

  -- Emit events
  PERFORM public._emit_auction_event(p_auction_id, 'AUCTION_STARTED', jsonb_build_object('started_at', clock_timestamp()), CASE WHEN auth.role() = 'authenticated' THEN public.resolve_user_id() ELSE NULL END);
  v_seq := public._emit_auction_event(
    p_auction_id,
    'LOT_STARTED',
    jsonb_build_object(
      'lot_id', v_lot0.id,
      'lot_index', 0,
      'player_id', v_lot0.player_id,
      'base_price', v_lot0.base_price,
      'timer_expires_at', (clock_timestamp() + (v_timer_sec * INTERVAL '1 second'))
    ),
    CASE WHEN auth.role() = 'authenticated' THEN public.resolve_user_id() ELSE NULL END
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'IN_PROGRESS',
    'current_lot_id', v_lot0.id,
    'sequence', v_seq
  );
END;
$$;

-- Audited migration for pause_auction
CREATE OR REPLACE FUNCTION public.pause_auction(
  p_auction_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction RECORD;
  v_lot RECORD;
  v_remaining_ms INT;
  v_seq INT;
BEGIN
  -- Verify host permission if authenticated
  IF auth.role() = 'authenticated' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = p_auction_id AND r.host_id = public.resolve_user_id()
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED_HOST_ONLY: Only room host can pause auction';
    END IF;
  END IF;

  -- LEVEL 1 LOCK: auctions row
  SELECT a.* INTO v_auction FROM public.auctions a WHERE a.id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_FOUND'); END IF;
  IF v_auction.status != 'IN_PROGRESS' THEN RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_IN_PROGRESS'); END IF;

  -- LEVEL 2 LOCK: current active lot
  SELECT al.* INTO v_lot FROM public.auction_lots al WHERE al.id = v_auction.current_lot_id FOR UPDATE;

  -- Calculate remaining interval in milliseconds
  v_remaining_ms := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_lot.timer_expires_at - clock_timestamp())) * 1000));

  -- Encode paused_reason as structured JSON string
  UPDATE public.auctions
  SET status = 'PAUSED',
      paused_by = CASE WHEN auth.role() = 'authenticated' THEN public.resolve_user_id() ELSE NULL END,
      paused_reason = jsonb_build_object('remaining_ms', v_remaining_ms, 'reason', COALESCE(p_reason, 'Host paused auction'))::text
  WHERE id = p_auction_id;

  UPDATE public.auction_lots
  SET timer_expires_at = NULL
  WHERE id = v_lot.id;

  v_seq := public._emit_auction_event(
    p_auction_id,
    'AUCTION_PAUSED',
    jsonb_build_object('remaining_ms', v_remaining_ms, 'reason', p_reason),
    CASE WHEN auth.role() = 'authenticated' THEN public.resolve_user_id() ELSE NULL END
  );

  RETURN jsonb_build_object('success', true, 'status', 'PAUSED', 'remaining_ms', v_remaining_ms, 'sequence', v_seq);
END;
$$;

-- Audited migration for resume_auction
CREATE OR REPLACE FUNCTION public.resume_auction(
  p_auction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction RECORD;
  v_room RECORD;
  v_lot RECORD;
  v_remaining_ms INT;
  v_new_expires_at TIMESTAMPTZ;
  v_seq INT;
BEGIN
  -- Verify host permission if authenticated
  IF auth.role() = 'authenticated' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = p_auction_id AND r.host_id = public.resolve_user_id()
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED_HOST_ONLY: Only room host can resume auction';
    END IF;
  END IF;

  -- LEVEL 1 LOCK: auctions row
  SELECT a.* INTO v_auction FROM public.auctions a WHERE a.id = p_auction_id FOR UPDATE;
  IF v_auction.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_FOUND'); END IF;
  IF v_auction.status != 'PAUSED' THEN RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_PAUSED'); END IF;

  -- LEVEL 2 LOCK: current active lot
  SELECT al.* INTO v_lot FROM public.auction_lots al WHERE al.id = v_auction.current_lot_id FOR UPDATE;
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = v_auction.room_id;

  -- Safely decode remaining_ms from paused_reason JSON with robust fallbacks
  BEGIN
    v_remaining_ms := (v_auction.paused_reason::jsonb->>'remaining_ms')::int;
  EXCEPTION WHEN OTHERS THEN
    v_remaining_ms := COALESCE(NULLIF((v_room.settings->>'timer_duration_seconds')::int, 0), 15) * 1000;
  END;

  v_remaining_ms := GREATEST(1000, LEAST(COALESCE(v_remaining_ms, 15000), 60000));
  v_new_expires_at := clock_timestamp() + (v_remaining_ms * INTERVAL '1 millisecond');

  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      paused_by = NULL,
      paused_reason = NULL
  WHERE id = p_auction_id;

  UPDATE public.auction_lots
  SET timer_expires_at = v_new_expires_at
  WHERE id = v_lot.id;

  v_seq := public._emit_auction_event(
    p_auction_id,
    'AUCTION_RESUMED',
    jsonb_build_object('timer_expires_at', v_new_expires_at),
    CASE WHEN auth.role() = 'authenticated' THEN public.resolve_user_id() ELSE NULL END
  );

  RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS', 'timer_expires_at', v_new_expires_at, 'sequence', v_seq);
END;
$$;

-- Audited migration for initialize_and_start_auction
CREATE OR REPLACE FUNCTION public.initialize_and_start_auction(
  p_room_id UUID,
  p_player_set_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room RECORD;
  v_auction RECORD;
  v_target_set_id UUID;
  v_first_lot_id UUID := NULL;
  v_existing_lots INT := 0;
  v_total_lots_inserted INT := 0;
  v_timer_sec INT := 15;
BEGIN
  -- Read room details
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = p_room_id;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND: Room % does not exist', p_room_id;
  END IF;

  v_timer_sec := COALESCE(NULLIF((v_room.settings->>'timer_duration_seconds')::int, 0), 15);

  -- Host Authorization Guard
  IF auth.role() = 'authenticated' AND v_room.host_id != public.resolve_user_id() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NOT_HOST: Only the room host can start the auction';
  END IF;

  -- Read or create auction row with Level 1 lock
  SELECT a.* INTO v_auction FROM public.auctions a WHERE a.room_id = p_room_id ORDER BY a.created_at DESC LIMIT 1 FOR UPDATE;

  -- If auction is ALREADY IN_PROGRESS, return state
  IF v_auction.id IS NOT NULL AND v_auction.status = 'IN_PROGRESS' THEN
    RETURN public.get_authoritative_auction_state(p_room_id);
  END IF;

  IF v_auction.id IS NULL THEN
    v_target_set_id := COALESCE(p_player_set_id, (v_room.settings->>'player_set_id')::uuid);
    IF v_target_set_id IS NULL THEN
      SELECT id INTO v_target_set_id FROM public.player_sets LIMIT 1;
    END IF;

    INSERT INTO public.auctions (
      room_id, player_set_id, status, current_lot_index, created_at
    ) VALUES (
      p_room_id, v_target_set_id, 'LOBBY', 0, NOW()
    ) RETURNING * INTO v_auction;
  END IF;

  -- Determine player set
  v_target_set_id := COALESCE(p_player_set_id, v_auction.player_set_id, (v_room.settings->>'player_set_id')::uuid);
  IF v_target_set_id IS NULL THEN
    SELECT id INTO v_target_set_id FROM public.player_sets LIMIT 1;
  END IF;

  -- Check existing lots
  SELECT COUNT(*) INTO v_existing_lots FROM public.auction_lots WHERE auction_id = v_auction.id;

  IF v_existing_lots = 0 THEN
    INSERT INTO public.auction_lots (
      id, auction_id, player_id, lot_index, status, base_price, current_bid, timer_duration_seconds, created_at
    )
    SELECT
      gen_random_uuid(),
      v_auction.id,
      p.id,
      (ROW_NUMBER() OVER (
        ORDER BY
          CASE UPPER(p.category)
            WHEN 'MARQUEE' THEN 1
            WHEN 'ICON' THEN 1
            WHEN 'A' THEN 2
            WHEN 'ELITE' THEN 2
            WHEN 'B' THEN 3
            WHEN 'PREMIER' THEN 3
            WHEN 'C' THEN 4
            WHEN 'CORE' THEN 4
            WHEN 'D' THEN 5
            WHEN 'RISING' THEN 5
            ELSE 6
          END ASC,
          p.name ASC
      ) - 1)::int AS lot_index,
      CASE WHEN ROW_NUMBER() OVER (
        ORDER BY
          CASE UPPER(p.category)
            WHEN 'MARQUEE' THEN 1
            WHEN 'ICON' THEN 1
            WHEN 'A' THEN 2
            WHEN 'ELITE' THEN 2
            WHEN 'B' THEN 3
            WHEN 'PREMIER' THEN 3
            WHEN 'C' THEN 4
            WHEN 'CORE' THEN 4
            WHEN 'D' THEN 5
            WHEN 'RISING' THEN 5
            ELSE 6
          END ASC,
          p.name ASC
      ) = 1 THEN 'BIDDING' ELSE 'PENDING' END AS status,
      p.base_price,
      p.base_price,
      v_timer_sec,
      NOW()
    FROM public.players p
    WHERE p.player_set_id = v_target_set_id;

    GET DIAGNOSTICS v_total_lots_inserted = ROW_COUNT;
  END IF;

  -- Resolve Lot 0's ID
  SELECT id INTO v_first_lot_id
  FROM public.auction_lots
  WHERE auction_id = v_auction.id AND lot_index = 0
  LIMIT 1;

  -- TWO-PHASE TIMER START: Set status to BIDDING but keep timer_expires_at = NULL until client signals ready via activate_lot_timer RPC
  UPDATE public.auction_lots
  SET status = 'BIDDING',
      highest_bidder_team_id = NULL,
      timer_duration_seconds = v_timer_sec,
      timer_expires_at = NULL
  WHERE id = v_first_lot_id;

  -- Update auction row to IN_PROGRESS & reset current_lot_index to 0
  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      current_lot_index = 0,
      current_lot_id = v_first_lot_id,
      total_lots = COALESCE(NULLIF(v_total_lots_inserted, 0), v_existing_lots),
      started_at = clock_timestamp()
  WHERE id = v_auction.id;

  -- Update room status to LOCKED
  UPDATE public.rooms
  SET status = 'LOCKED',
      updated_at = NOW()
  WHERE id = p_room_id;

  RETURN public.get_authoritative_auction_state(p_room_id);
END;
$$;

-- Audited migration for provision_room_bots
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
  WHERE r.id = p_room_id AND r.host_id = public.resolve_user_id();

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
$function$;


-- Migration: 00038_server_tick_support.sql
-- Description: Ensures teams table is included in Supabase Realtime publication to sync server-side bot bids' purse deductions to connected clients.

DO $$
BEGIN
  -- Set REPLICA IDENTITY FULL to ensure old/new record payloads are broadcast
  EXECUTE 'ALTER TABLE public.teams REPLICA IDENTITY FULL';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Replica identity update skipped or failed: %', SQLERRM;
END $$;

DROP POLICY IF EXISTS "Teams viewable by room participants" ON public.teams;
CREATE POLICY "Teams viewable by room participants" ON public.teams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = teams.auction_id AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );

DROP POLICY IF EXISTS "Host can insert teams" ON public.teams;
CREATE POLICY "Host can insert teams" ON public.teams
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = teams.auction_id
        AND r.host_id = public.resolve_user_id()
        AND r.status = 'OPEN'
        AND a.status = 'LOBBY'
    )
  );

DROP POLICY IF EXISTS "Host can update teams" ON public.teams;
CREATE POLICY "Host can update teams" ON public.teams
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = teams.auction_id
        AND r.host_id = public.resolve_user_id()
        AND r.status = 'OPEN'
        AND a.status = 'LOBBY'
    )
  );

DROP POLICY IF EXISTS "Host can delete teams" ON public.teams;
CREATE POLICY "Host can delete teams" ON public.teams
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = teams.auction_id
        AND r.host_id = public.resolve_user_id()
        AND r.status = 'OPEN'
        AND a.status = 'LOBBY'
    )
  );

DROP POLICY IF EXISTS "Auctions viewable by room participants" ON public.auctions;
CREATE POLICY "Auctions viewable by room participants" ON public.auctions
  FOR SELECT USING (
    public.is_room_participant(auctions.room_id, public.resolve_user_id())
  );

DROP POLICY IF EXISTS "Host can create auction" ON public.auctions;
CREATE POLICY "Host can create auction" ON public.auctions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rooms r WHERE r.id = auctions.room_id AND r.host_id = public.resolve_user_id()
    )
  );

DROP POLICY IF EXISTS "Authenticated users can create rooms" ON public.rooms;
CREATE POLICY "Authenticated users can create rooms" ON public.rooms
  FOR INSERT WITH CHECK (public.resolve_user_id() = host_id);

DROP POLICY IF EXISTS "Host can update room settings" ON public.rooms;
CREATE POLICY "Host can update room settings" ON public.rooms
  FOR UPDATE USING (public.resolve_user_id() = host_id AND status = 'OPEN');

DROP POLICY IF EXISTS "Host can delete own room" ON public.rooms;
CREATE POLICY "Host can delete own room" ON public.rooms
      FOR DELETE USING (public.resolve_user_id() = host_id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (public.resolve_user_id() = id);



