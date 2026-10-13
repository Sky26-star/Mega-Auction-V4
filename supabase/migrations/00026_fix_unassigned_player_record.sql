-- Migration 00026: Fix unassigned player record bug
CREATE OR REPLACE FUNCTION public.get_authoritative_auction_state(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Using %ROWTYPE safely initializes the variables to a row of NULLs.
  -- This entirely prevents the "record is not assigned yet" (55000) exceptions
  -- that occur when a SELECT INTO a generic RECORD variable returns 0 rows.
  v_auction public.auctions%ROWTYPE;
  v_active_lot public.auction_lots%ROWTYPE;
  v_current_player public.players%ROWTYPE;
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
  -- 1. Fetch room's active auction
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.room_id = p_room_id
  ORDER BY a.created_at DESC
  LIMIT 1;

  -- Because v_auction is a %ROWTYPE, accessing its fields is always safe.
  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'NO_AUCTION_FOUND',
      'message', 'No auction exists for this room'
    );
  END IF;

  -- 2. Safely fetch current lot.
  -- Even if this returns 0 rows, v_active_lot remains a valid row filled with NULLs.
  SELECT al.* INTO v_active_lot
  FROM public.auction_lots al
  WHERE (v_auction.current_lot_id IS NOT NULL AND al.id = v_auction.current_lot_id)
     OR (v_auction.current_lot_id IS NULL AND al.auction_id = v_auction.id AND al.lot_index = v_auction.current_lot_index)
  LIMIT 1;

  -- 3. Safely fetch current player.
  -- This query is executed unconditionally. If v_active_lot.id is NULL,
  -- it returns 0 rows, and v_current_player cleanly remains a row of NULLs.
  SELECT p.* INTO v_current_player
  FROM public.players p
  WHERE v_active_lot.id IS NOT NULL AND p.id = v_active_lot.player_id
  LIMIT 1;

  -- 4. Build timer state if active lot exists.
  -- We only check .id IS NOT NULL. Do NOT check v_active_lot IS NOT NULL
  -- because for %ROWTYPE that requires ALL fields to be non-null.
  IF v_active_lot.id IS NOT NULL THEN
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

  -- 5. Fetch teams with proper squad counts
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

  -- 6. Return comprehensive state.
  -- Every field access is guaranteed safe because variables are %ROWTYPE.
  RETURN jsonb_build_object(
    'success', true,
    'status', v_auction.status,
    'auctionId', v_auction.id,
    'roomId', v_auction.room_id,
    'lotId', v_active_lot.id,
    'lotIndex', v_auction.current_lot_index,
    'isUnsoldRound', v_auction.is_unsold_round,
    'playerId', v_active_lot.player_id,
    'currentBid', v_effective_bid,
    'highestBidderId', v_active_lot.highest_bidder_team_id,
    'winningTeamId', v_active_lot.winning_team_id,
    'winningBid', v_active_lot.winning_bid,
    'bidCount', v_bid_count,
    'timerDurationSeconds', v_timer_sec,
    'timerExpiresAt', v_timer_expires_iso,
    'isGetReady', v_is_get_ready,
    'getReadyExpiresAt', v_get_ready_expires_iso,
    'lotStatus', COALESCE(v_active_lot.status, 'PENDING'),
    'teams', COALESCE(v_teams, '[]'::jsonb),
    'queue', COALESCE(v_queue, '[]'::jsonb),
    'player_stats', CASE WHEN v_current_player.id IS NOT NULL THEN jsonb_build_object(
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
