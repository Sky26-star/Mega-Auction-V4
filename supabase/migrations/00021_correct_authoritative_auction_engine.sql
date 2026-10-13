-- Migration: 00021_correct_authoritative_auction_engine.sql
-- Description: Authoritative, safe engine correction for Mega Auction
-- 1. Correct Lot Expiry & Single-Place Squad/Purse/Player Accounting (No Error Swallowing)
-- 2. Authoritative Bot Strategy Integration via bot_lot_state & Deterministic UUID Idempotency
-- 3. Official IPL Bid Increment Matrix matching src/lib/auction/bid-increments.ts
-- 4. Multi-Client Concurrency Protection via PostgreSQL Row Locks (auctions, auction_lots, teams)

BEGIN;

-- Extension for deterministic UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. AUTHORITATIVE EXPIRY FINALIZATION & ACCOUNTING: public.process_lot_expiry
-- ============================================================
DROP FUNCTION IF EXISTS public.process_lot_expiry(UUID, UUID);

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

  -- Verify timer actually expired using DB wall clock
  IF v_lot.timer_expires_at IS NOT NULL AND v_now < v_lot.timer_expires_at THEN
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

    -- Authoritative Squad Insertion (NO Exception Swallowing)
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

REVOKE ALL ON FUNCTION public.process_lot_expiry(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_lot_expiry(UUID, UUID) TO authenticated, service_role;


-- ============================================================
-- 2. PRIVATE AUTHORITATIVE BID ENGINE: public._process_bid_internal
-- ============================================================
DROP FUNCTION IF EXISTS public._process_bid_internal(UUID, UUID, INT, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public._process_bid_internal(
  p_auction_id UUID,
  p_team_id UUID DEFAULT NULL,
  p_amount INT DEFAULT NULL,
  p_request_id UUID DEFAULT NULL,
  p_is_bot BOOLEAN DEFAULT false
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
  v_team RECORD;
  v_player RECORD;
  v_existing_bid RECORD;
  v_get_ready_expires TIMESTAMPTZ;

  v_target_team_id UUID := p_team_id;
  v_target_amount INT := p_amount;
  v_request_id UUID := p_request_id;
  v_bid_id UUID;
  v_bid_number INT;
  v_seq INT;

  v_min_increment INT;
  v_max_squad_size INT;
  v_max_overseas INT;
  v_timer_sec INT;

  v_min_required_bid INT;
  v_is_overseas BOOLEAN := false;
  v_new_expires_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Level 1 Lock: auctions row
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.id = p_auction_id
  FOR UPDATE;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_FOUND');
  END IF;

  IF v_auction.status != 'IN_PROGRESS' THEN
    RETURN jsonb_build_object('success', false, 'error', CASE v_auction.status
      WHEN 'PAUSED' THEN 'AUCTION_PAUSED'
      WHEN 'COMPLETED' THEN 'AUCTION_COMPLETED'
      ELSE 'AUCTION_NOT_ACTIVE'
    END);
  END IF;

  -- Level 2 Lock: current active auction_lot row
  IF v_auction.current_lot_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_ACTIVE_LOT');
  END IF;

  SELECT al.* INTO v_lot
  FROM public.auction_lots al
  WHERE al.id = v_auction.current_lot_id
  FOR UPDATE;

  IF v_lot.id IS NULL OR v_lot.status NOT IN ('BIDDING', 'ACTIVE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'LOT_NOT_ACTIVE');
  END IF;

  -- Fetch player details
  SELECT p.* INTO v_player FROM public.players p WHERE p.id = v_lot.player_id;
  v_is_overseas := COALESCE(v_player.is_overseas, (v_player.country IS NOT NULL AND v_player.country != 'India'));

  -- Read room settings
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = v_auction.room_id;
  v_max_squad_size := COALESCE(NULLIF((v_room.settings->>'max_squad_size')::int, 0), 25);
  v_max_overseas := COALESCE(NULLIF((v_room.settings->>'max_overseas')::int, 0), 8);
  v_timer_sec := COALESCE(v_lot.timer_duration_seconds, NULLIF((v_room.settings->>'timer_duration_seconds')::int, 0), 15);

  -- GET READY Phase Guard
  v_get_ready_expires := public._get_lot_get_ready_expires_at(v_lot.timer_expires_at, v_timer_sec);
  IF v_get_ready_expires IS NOT NULL AND v_now < v_get_ready_expires THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_GETTING_READY', 'message', 'Bidding disabled during GET READY phase');
  END IF;

  -- Wall-Clock Expiry Check
  IF v_lot.timer_expires_at IS NOT NULL AND v_now >= v_lot.timer_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'LOT_EXPIRED');
  END IF;

  -- Calculate minimum required bid according to OFFICIAL IPL INCREMENT RULES (Lakhs)
  -- Matching src/lib/auction/bid-increments.ts:
  -- Opening bid (highest_bidder_team_id IS NULL or current_bid = 0) => base_price
  -- <= 300L (3 Cr)    => +25L (0.25 Cr)
  -- <= 600L (6 Cr)    => +50L (0.50 Cr)
  -- <= 1000L (10 Cr)  => +75L (0.75 Cr)
  -- <= 1500L (15 Cr)  => +100L (1.00 Cr)
  -- <= 2000L (20 Cr)  => +150L (1.50 Cr)
  -- <= 2500L (25 Cr)  => +175L (1.75 Cr)
  -- > 2500L           => +200L (2.00 Cr)
  IF v_lot.highest_bidder_team_id IS NULL OR v_lot.current_bid = 0 THEN
    v_min_required_bid := v_lot.base_price;
  ELSE
    v_min_increment := CASE
      WHEN v_lot.current_bid <= 300 THEN 25
      WHEN v_lot.current_bid <= 600 THEN 50
      WHEN v_lot.current_bid <= 1000 THEN 75
      WHEN v_lot.current_bid <= 1500 THEN 100
      WHEN v_lot.current_bid <= 2000 THEN 150
      WHEN v_lot.current_bid <= 2500 THEN 175
      ELSE 200
    END;
    v_min_required_bid := v_lot.current_bid + v_min_increment;
  END IF;

  -- AUTHORITATIVE BOT SELECTION & BOT IDEMPOTENCY (Via bot_lot_state)
  IF p_is_bot AND v_target_team_id IS NULL THEN
    SELECT bls.team_id INTO v_target_team_id
    FROM public.bot_lot_state bls
    JOIN public.teams t ON t.id = bls.team_id
    WHERE bls.lot_id = v_lot.id
      AND bls.is_interested = true
      AND bls.has_bid_current_price = false
      AND (v_lot.highest_bidder_team_id IS NULL OR t.id != v_lot.highest_bidder_team_id)
      AND bls.max_per_player_budget >= v_min_required_bid
      AND t.purse >= v_min_required_bid
      AND t.players_bought < v_max_squad_size
      AND (NOT v_is_overseas OR t.overseas_count < v_max_overseas)
      AND (bls.next_bid_eligible_at IS NULL OR v_now >= bls.next_bid_eligible_at)
    ORDER BY t.id ASC
    LIMIT 1;

    IF v_target_team_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_ELIGIBLE_BOTS');
    END IF;

    v_target_amount := v_min_required_bid;

    -- Deterministic bot request_id via uuid_generate_v5
    v_request_id := uuid_generate_v5(
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
      v_lot.id::text || ':' || v_target_team_id::text || ':' || v_target_amount::text
    );
  END IF;

  -- HUMAN IDEMPOTENCY CHECK
  IF v_request_id IS NOT NULL THEN
    SELECT b.*, ae.sequence, (ae.payload->>'timer_expires_at')::timestamptz AS timer_expires_at
    INTO v_existing_bid
    FROM public.bids b
    LEFT JOIN public.auction_events ae
      ON ae.auction_id = b.auction_id
     AND (ae.payload->>'bid_id')::uuid = b.id
    WHERE b.request_id = v_request_id;

    IF v_existing_bid.id IS NOT NULL THEN
      IF v_existing_bid.auction_id != p_auction_id
         OR v_existing_bid.team_id != v_target_team_id
         OR v_existing_bid.amount != v_target_amount THEN
        RAISE EXCEPTION 'IDEMPOTENCY_PARAMETER_MISMATCH: request_id % was previously submitted with different parameters', v_request_id;
      END IF;

      RETURN jsonb_build_object(
        'success', v_existing_bid.is_valid,
        'is_duplicate', true,
        'bid_id', v_existing_bid.id,
        'auction_id', v_existing_bid.auction_id,
        'lot_id', v_existing_bid.lot_id,
        'team_id', v_existing_bid.team_id,
        'amount', v_existing_bid.amount,
        'highest_bidder_team_id', v_existing_bid.team_id,
        'timer_expires_at', v_existing_bid.timer_expires_at,
        'sequence', v_existing_bid.sequence,
        'request_id', v_existing_bid.request_id
      );
    END IF;
  ELSE
    v_request_id := gen_random_uuid();
  END IF;

  -- Level 3 Lock: bidding team row
  SELECT t.* INTO v_team
  FROM public.teams t
  WHERE t.id = v_target_team_id AND t.auction_id = p_auction_id
  FOR UPDATE;

  IF v_team.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TEAM_NOT_FOUND');
  END IF;

  -- Outbid Lock: Cannot bid against oneself
  IF v_lot.highest_bidder_team_id = v_target_team_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_HIGHEST_BIDDER');
  END IF;

  -- Bid Amount Check
  IF v_target_amount IS NULL OR v_target_amount < v_min_required_bid THEN
    RETURN jsonb_build_object('success', false, 'error', 'BID_TOO_LOW', 'min_required', v_min_required_bid);
  END IF;

  -- Squad Size Check
  IF v_team.players_bought >= v_max_squad_size THEN
    RETURN jsonb_build_object('success', false, 'error', 'BID_SQUAD_FULL');
  END IF;

  -- Overseas Count Check
  IF v_is_overseas AND v_team.overseas_count >= v_max_overseas THEN
    RETURN jsonb_build_object('success', false, 'error', 'BID_OVERSEAS_LIMIT');
  END IF;

  -- Purse Check
  IF v_target_amount > v_team.purse THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_PURSE', 'purse', v_team.purse, 'required', v_target_amount);
  END IF;

  -- Calculate next bid number
  SELECT COALESCE(MAX(bid_number), 0) + 1 INTO v_bid_number
  FROM public.bids
  WHERE lot_id = v_lot.id;

  -- Reset lot timer atomically from DB clock
  v_new_expires_at := clock_timestamp() + (v_timer_sec * INTERVAL '1 second');

  -- Insert bid record
  INSERT INTO public.bids (
    auction_id, lot_id, team_id, amount, request_id, is_bot, is_valid, rejection_reason, bid_number, created_at
  ) VALUES (
    p_auction_id, v_lot.id, v_target_team_id, v_target_amount, v_request_id, p_is_bot, true, NULL, v_bid_number, NOW()
  ) RETURNING id INTO v_bid_id;

  -- Update lot state
  UPDATE public.auction_lots
  SET current_bid = v_target_amount,
      highest_bidder_team_id = v_target_team_id,
      timer_expires_at = v_new_expires_at
  WHERE id = v_lot.id;

  -- Update bot_lot_state for interested bots
  UPDATE public.bot_lot_state
  SET has_bid_current_price = (team_id = v_target_team_id),
      next_bid_eligible_at = CASE WHEN team_id = v_target_team_id THEN clock_timestamp() + INTERVAL '2 seconds' ELSE next_bid_eligible_at END,
      updated_at = NOW()
  WHERE lot_id = v_lot.id;

  -- Emit BID_PLACED event
  v_seq := public._emit_auction_event(
    p_auction_id,
    'BID_PLACED',
    jsonb_build_object(
      'bid_id', v_bid_id,
      'lot_id', v_lot.id,
      'team_id', v_target_team_id,
      'amount', v_target_amount,
      'bid_number', v_bid_number,
      'is_bot', p_is_bot,
      'timer_expires_at', v_new_expires_at,
      'request_id', v_request_id
    ),
    CASE WHEN p_is_bot THEN NULL ELSE auth.uid() END
  );

  RETURN jsonb_build_object(
    'success', true,
    'bid_id', v_bid_id,
    'auction_id', p_auction_id,
    'lot_id', v_lot.id,
    'team_id', v_target_team_id,
    'amount', v_target_amount,
    'highest_bidder_team_id', v_target_team_id,
    'timer_expires_at', v_new_expires_at,
    'sequence', v_seq,
    'request_id', v_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public._process_bid_internal(UUID, UUID, INT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._process_bid_internal(UUID, UUID, INT, UUID, BOOLEAN) TO service_role;


-- ============================================================
-- 3. PUBLIC BOT EXECUTION ENDPOINT: public.execute_bot_bids
-- ============================================================
CREATE OR REPLACE FUNCTION public.execute_bot_bids(
  p_auction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._process_bid_internal(
    p_auction_id,
    NULL,
    NULL,
    NULL,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_bot_bids(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_bot_bids(UUID) TO service_role;

COMMIT;
