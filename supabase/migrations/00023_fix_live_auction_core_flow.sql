-- Migration: 00023_fix_live_auction_core_flow.sql
-- Description: Authoritative fix for Player Master Data stats/age/flag mapping, Lot Expiry tolerance, and Live Auction state pipeline

BEGIN;

-- 1. Update get_authoritative_auction_state to include age, batting_hand, and stats in v_queue and v_current_player
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

  -- Fetch current lot
  IF v_auction.current_lot_id IS NOT NULL THEN
    SELECT al.* INTO v_active_lot
    FROM public.auction_lots al
    WHERE al.id = v_auction.current_lot_id;
  END IF;

  IF v_active_lot.id IS NULL THEN
    SELECT al.* INTO v_active_lot
    FROM public.auction_lots al
    WHERE al.auction_id = v_auction.id AND al.lot_index = v_auction.current_lot_index;
  END IF;

  -- Build timer state if active lot exists
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

    SELECT p.* INTO v_current_player
    FROM public.players p
    WHERE p.id = v_active_lot.player_id;

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

  -- Fetch teams list
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'auction_id', t.auction_id,
      'name', t.name,
      'short_name', t.short_name,
      'color', t.color,
      'purse', t.purse,
      'initial_purse', t.initial_purse,
      'players_bought', t.players_bought,
      'overseas_count', t.overseas_count,
      'is_bot', t.is_bot
    ) ORDER BY t.name ASC
  ), '[]'::jsonb) INTO v_teams
  FROM public.teams t
  WHERE t.auction_id = v_auction.id;

  -- Fetch player queue with full master data (age, batting_hand, stats)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'playerId', p.id,
      'name', p.name,
      'category', p.category,
      'role', p.role,
      'country', p.country,
      'age', p.age,
      'battingHand', p.batting_hand,
      'basePrice', al.base_price,
      'auctionOrder', al.lot_index + 1,
      'status', CASE
                  WHEN al.status IN ('BIDDING', 'ACTIVE') THEN 'LIVE'
                  WHEN al.status = 'SOLD' THEN 'SOLD'
                  WHEN al.status = 'UNSOLD' THEN 'UNSOLD'
                  ELSE 'UPCOMING'
                END,
      'image_url', p.image_url,
      'stats', jsonb_build_object(
        'matches', COALESCE(p.matches, 0),
        'runs', COALESCE(p.runs, 0),
        'average', COALESCE(p.batting_average, 0),
        'strikeRate', COALESCE(p.strike_rate, 0),
        'hundreds', COALESCE(p.hundreds, 0),
        'fifties', COALESCE(p.fifties, 0),
        'highest', COALESCE(p.highest_score, 0),
        'wickets', COALESCE(p.wickets, 0),
        'economy', COALESCE(p.economy_rate, 0),
        'bestBowling', COALESCE(p.best_bowling, '')
      )
    ) ORDER BY al.lot_index ASC
  ), '[]'::jsonb) INTO v_queue
  FROM public.auction_lots al
  JOIN public.players p ON p.id = al.player_id
  WHERE al.auction_id = v_auction.id;

  RETURN jsonb_build_object(
    'success', true,
    'auctionId', v_auction.id,
    'roomId', p_room_id,
    'lotId', COALESCE(v_active_lot.id, NULL),
    'auctionStatus', CASE
                       WHEN v_auction.status = 'IN_PROGRESS' THEN 'LIVE'
                       WHEN v_auction.status = 'PAUSED' THEN 'PAUSED'
                       WHEN v_auction.status = 'COMPLETED' THEN 'COMPLETED'
                       ELSE 'NOT_STARTED'
                     END,
    'currentPlayerIndex', v_auction.current_lot_index,
    'currentCategory', COALESCE(v_current_player.category, NULL),
    'currentBid', v_effective_bid,
    'highestBidderId', CASE WHEN v_bid_count > 0 THEN COALESCE(v_active_lot.highest_bidder_team_id, NULL) ELSE NULL END,
    'bidCount', v_bid_count,
    'timerExpiresAt', v_timer_expires_iso,
    'timerDurationSeconds', v_timer_sec,
    'isGetReady', v_is_get_ready,
    'getReadyExpiresAt', v_get_ready_expires_iso,
    'currentPlayer', CASE WHEN v_current_player.id IS NOT NULL THEN jsonb_build_object(
      'playerId', v_current_player.id,
      'name', v_current_player.name,
      'category', v_current_player.category,
      'role', v_current_player.role,
      'country', v_current_player.country,
      'age', v_current_player.age,
      'battingHand', v_current_player.batting_hand,
      'basePrice', COALESCE(v_active_lot.base_price, v_current_player.base_price),
      'auctionOrder', v_active_lot.lot_index + 1,
      'status', 'LIVE',
      'image_url', v_current_player.image_url,
      'stats', jsonb_build_object(
        'matches', COALESCE(v_current_player.matches, 0),
        'runs', COALESCE(v_current_player.runs, 0),
        'average', COALESCE(v_current_player.batting_average, 0),
        'strikeRate', COALESCE(v_current_player.strike_rate, 0),
        'hundreds', COALESCE(v_current_player.hundreds, 0),
        'fifties', COALESCE(v_current_player.fifties, 0),
        'highest', COALESCE(v_current_player.highest_score, 0),
        'wickets', COALESCE(v_current_player.wickets, 0),
        'economy', COALESCE(v_current_player.economy_rate, 0),
        'bestBowling', COALESCE(v_current_player.best_bowling, '')
      )
    ) ELSE NULL END,
    'teamsList', v_teams,
    'playerQueue', v_queue
  );
END;
$$;

-- 2. Update process_lot_expiry to allow 1-second wall-clock skew tolerance
CREATE OR REPLACE FUNCTION public.process_lot_expiry(
  p_auction_id UUID,
  p_target_lot_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction RECORD;
  v_lot RECORD;
  v_player RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_winning_team RECORD;
  v_seq INT;
  v_advance_res JSONB;
  v_is_overseas BOOLEAN := false;
BEGIN
  -- Level 1 Lock: auctions row
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.id = p_auction_id
  FOR UPDATE;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'AUCTION_NOT_FOUND');
  END IF;

  IF v_auction.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', true, 'status', 'AUCTION_COMPLETED');
  END IF;

  -- Level 2 Lock: current active lot
  IF v_auction.current_lot_id IS NOT NULL THEN
    SELECT al.* INTO v_lot
    FROM public.auction_lots al
    WHERE al.id = v_auction.current_lot_id
    FOR UPDATE;
  END IF;

  IF v_lot.id IS NULL THEN
    SELECT al.* INTO v_lot
    FROM public.auction_lots al
    WHERE al.auction_id = p_auction_id AND al.lot_index = v_auction.current_lot_index
    FOR UPDATE;
  END IF;

  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NO_ACTIVE_LOT');
  END IF;

  -- Idempotency Guard 1: Target lot mismatch (already advanced)
  IF p_target_lot_id IS NOT NULL AND v_lot.id != p_target_lot_id THEN
    RETURN jsonb_build_object('success', true, 'status', 'ALREADY_PROCESSED', 'message', 'Target lot has already been advanced');
  END IF;

  -- Idempotency Guard 2: Lot already finalized
  IF v_lot.status IN ('SOLD', 'UNSOLD', 'SKIPPED') THEN
    RETURN jsonb_build_object('success', true, 'status', 'ALREADY_PROCESSED', 'message', 'Lot already finalized');
  END IF;

  -- Verify timer actually expired using DB wall clock with 1-second tolerance
  IF v_lot.timer_expires_at IS NOT NULL AND (v_now + INTERVAL '1 second') < v_lot.timer_expires_at THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'NOT_EXPIRED',
      'seconds_remaining', ceil(EXTRACT(EPOCH FROM (v_lot.timer_expires_at - v_now)))
    );
  END IF;

  -- Fetch player details for overseas check
  SELECT p.* INTO v_player FROM public.players p WHERE p.id = v_lot.player_id;
  v_is_overseas := COALESCE(v_player.is_overseas, (v_player.country IS NOT NULL AND v_player.country != 'India'));

  -- Finalize current lot: SOLD or UNSOLD
  IF v_lot.highest_bidder_team_id IS NOT NULL AND v_lot.current_bid > 0 THEN
    -- Level 3 Lock: winning team row
    SELECT t.* INTO v_winning_team
    FROM public.teams t
    WHERE t.id = v_lot.highest_bidder_team_id
    FOR UPDATE;

    IF v_winning_team.id IS NULL THEN
      RAISE EXCEPTION 'WINNING_TEAM_NOT_FOUND: Team % does not exist in auction %', v_lot.highest_bidder_team_id, p_auction_id;
    END IF;

    UPDATE public.auction_lots
    SET status = 'SOLD',
        winning_team_id = v_lot.highest_bidder_team_id,
        winning_bid = v_lot.current_bid
    WHERE id = v_lot.id;

    -- Authoritative Squad Insertion
    INSERT INTO public.squad_players (
      auction_id, team_id, player_id, lot_id, purchase_price, bought_at
    ) VALUES (
      p_auction_id, v_lot.highest_bidder_team_id, v_lot.player_id, v_lot.id, v_lot.current_bid, NOW()
    );

    -- Single Authoritative Team Accounting Update
    UPDATE public.teams
    SET purse = GREATEST(0, purse - v_lot.current_bid),
        players_bought = players_bought + 1,
        overseas_count = CASE WHEN v_is_overseas THEN overseas_count + 1 ELSE overseas_count END
    WHERE id = v_lot.highest_bidder_team_id;

    -- Emit LOT_SOLD event
    v_seq := public._emit_auction_event(
      p_auction_id,
      'LOT_SOLD',
      jsonb_build_object(
        'lot_id', v_lot.id,
        'lot_index', v_lot.lot_index,
        'winning_team_id', v_lot.highest_bidder_team_id,
        'winning_bid', v_lot.current_bid,
        'player_id', v_lot.player_id
      ),
      NULL
    );
  ELSE
    -- Finalize as UNSOLD
    UPDATE public.auction_lots
    SET status = 'UNSOLD'
    WHERE id = v_lot.id;

    v_seq := public._emit_auction_event(
      p_auction_id,
      'LOT_UNSOLD',
      jsonb_build_object(
        'lot_id', v_lot.id,
        'lot_index', v_lot.lot_index,
        'player_id', v_lot.player_id
      ),
      NULL
    );
  END IF;

  -- Delegate lot advancement to advance_lot()
  v_advance_res := public.advance_lot(p_auction_id);

  RETURN jsonb_build_object(
    'success', true,
    'status', 'EXPIRED_AND_FINALIZED',
    'final_lot_id', v_lot.id,
    'final_status', CASE WHEN v_lot.highest_bidder_team_id IS NOT NULL THEN 'SOLD' ELSE 'UNSOLD' END,
    'advance_result', v_advance_res
  );
END;
$$;

COMMIT;
