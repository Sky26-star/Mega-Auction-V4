-- 1. Fix get_authoritative_auction_state 500
-- The 500 error is caused by attempting to access a field on an unassigned v_active_lot record
-- when the first SELECT INTO fails (i.e. when current_lot_id is null and we fall through).
CREATE OR REPLACE FUNCTION public.get_authoritative_auction_state(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction RECORD;
  v_active_lot RECORD;
  v_current_player RECORD;
  v_bid_count INT := 0;
  v_effective_bid INT := 0;
  v_timer_sec INT := 15;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_timer_expires_iso TEXT := NULL;
  v_is_get_ready BOOLEAN := false;
  v_get_ready_expires_iso TEXT := NULL;
  v_teams JSONB := '[]'::jsonb;
  v_queue JSONB := '[]'::jsonb;
BEGIN
  -- Fetch room's active auction
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.room_id = p_room_id
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'NO_AUCTION_FOUND',
      'message', 'No auction exists for this room'
    );
  END IF;

  -- Safely fetch current lot using a single SELECT INTO to guarantee assignment
  SELECT al.* INTO v_active_lot
  FROM public.auction_lots al
  WHERE (v_auction.current_lot_id IS NOT NULL AND al.id = v_auction.current_lot_id)
     OR (v_auction.current_lot_id IS NULL AND al.auction_id = v_auction.id AND al.lot_index = v_auction.current_lot_index)
  LIMIT 1;

  -- Safely fetch current player using a single SELECT INTO to guarantee assignment
  SELECT p.* INTO v_current_player
  FROM public.players p
  WHERE v_active_lot IS NOT NULL AND v_active_lot.id IS NOT NULL AND p.id = v_active_lot.player_id
  LIMIT 1;

  -- Build timer state if active lot exists
  IF v_active_lot IS NOT NULL AND v_active_lot.id IS NOT NULL THEN
    v_timer_sec := COALESCE(v_active_lot.timer_duration_seconds, 15);
    IF v_active_lot.timer_expires_at IS NOT NULL THEN
      v_timer_expires_iso := to_char(v_active_lot.timer_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
      -- Check GET READY window
      IF (v_active_lot.timer_expires_at - (v_timer_sec * INTERVAL '1 second')) > v_now THEN
        v_is_get_ready := true;
        v_get_ready_expires_iso := to_char(
          (v_active_lot.timer_expires_at - (v_timer_sec * INTERVAL '1 second')) AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        );
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_bid_count
    FROM public.bids b
    WHERE b.lot_id = v_active_lot.id AND b.is_valid = true;

    -- Effective current bid
    IF v_bid_count > 0 AND v_active_lot.current_bid > 0 THEN
      v_effective_bid := v_active_lot.current_bid;
    ELSE
      v_effective_bid := COALESCE(v_active_lot.base_price, v_current_player.base_price, 200);
    END IF;
  ELSE
    v_effective_bid := 0;
  END IF;

  -- Fetch teams with proper squad counts
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'shortName', t.short_name,
      'color', t.color,
      'purse', t.purse,
      'initial_purse', t.initial_purse,
      'playersBought', COALESCE(
        (SELECT COUNT(*) FROM public.squad_players sp WHERE sp.team_id = t.id), 0
      ),
      'is_bot', t.is_bot
    ) ORDER BY t.name ASC
  ) INTO v_teams
  FROM public.teams t
  WHERE t.auction_id = v_auction.id;

  -- Return comprehensive state
  RETURN jsonb_build_object(
    'success', true,
    'status', v_auction.status,
    'auctionId', v_auction.id,
    'roomId', v_auction.room_id,
    'lotId', CASE WHEN v_active_lot IS NOT NULL THEN v_active_lot.id ELSE NULL END,
    'lotIndex', v_auction.current_lot_index,
    'isUnsoldRound', v_auction.is_unsold_round,
    'playerId', CASE WHEN v_active_lot IS NOT NULL THEN v_active_lot.player_id ELSE NULL END,
    'currentBid', v_effective_bid,
    'highestBidderId', CASE WHEN v_active_lot IS NOT NULL THEN v_active_lot.highest_bidder_team_id ELSE NULL END,
    'winningTeamId', CASE WHEN v_active_lot IS NOT NULL THEN v_active_lot.winning_team_id ELSE NULL END,
    'winningBid', CASE WHEN v_active_lot IS NOT NULL THEN v_active_lot.winning_bid ELSE NULL END,
    'bidCount', v_bid_count,
    'timerDurationSeconds', v_timer_sec,
    'timerExpiresAt', v_timer_expires_iso,
    'isGetReady', v_is_get_ready,
    'getReadyExpiresAt', v_get_ready_expires_iso,
    'lotStatus', CASE WHEN v_active_lot IS NOT NULL THEN v_active_lot.status ELSE 'PENDING' END,
    'teams', COALESCE(v_teams, '[]'::jsonb),
    'queue', COALESCE(v_queue, '[]'::jsonb),
    'player_stats', CASE WHEN v_current_player IS NOT NULL THEN jsonb_build_object(
      'name', v_current_player.name,
      'age', v_current_player.age,
      'category', v_current_player.category,
      'role', v_current_player.role,
      'country', v_current_player.country,
      'batting_hand', v_current_player.batting_hand,
      'base_price', v_current_player.base_price
    ) ELSE NULL END
  );
END;
$$;


-- 2. Fix Initial Purse Crores -> Lakhs conversion
-- When creating teams, we must convert the UI's default purse (Crores) to the database unit (Lakhs)
-- by multiplying by 100, otherwise the purse (140) will be insufficient for bids (e.g. 200 Lakhs).
CREATE OR REPLACE FUNCTION public.provision_bots(p_room_id UUID, p_bot_count INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room RECORD;
  v_default_purse INT;
  v_inserted_count INT := 0;
BEGIN
  -- Read room details and settings
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = p_room_id;
  IF v_room.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
  END IF;

  -- Parse default purse from room settings (in Crores) and convert to Lakhs
  v_default_purse := COALESCE((v_room.settings->>'default_purse')::int * 100, 10000);

  IF v_room.auction_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_STARTED');
  END IF;

  -- High-performance set-based insert to prevent deadlocks and race conditions
  WITH bot_pool AS (
    SELECT id, name, "shortName", color
    FROM jsonb_populate_recordset(null::record, v_room.settings->'bots')
    AS b(id text, name text, "shortName" text, color text)
    LIMIT p_bot_count
  )
  INSERT INTO public.teams (
    auction_id, name, short_name, color, purse, initial_purse, is_bot
  )
  SELECT
    v_room.auction_id,
    b.name,
    b.shortName,
    b.color,
    v_default_purse,
    v_default_purse,
    true
  FROM bot_pool b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.auction_id = v_room.auction_id
    AND t.name = b.name
  );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Bots provisioned successfully',
    'inserted', v_inserted_count
  );
END;
$$;


-- 3. Fix joinTeam RPC initial purse
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
  v_user_id UUID := auth.uid();
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
