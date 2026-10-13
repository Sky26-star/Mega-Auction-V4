-- Migration: 00036_v3_auction_core_security_definer.sql
-- Description: Elevate v3_place_bid and v3_finalize_and_advance_lot to SECURITY DEFINER.

-- 1. v3_place_bid
CREATE OR REPLACE FUNCTION public.v3_place_bid(
  p_auction_id UUID,
  p_lot_id UUID,
  p_team_id UUID,
  p_request_id UUID,
  p_is_bot BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  v_lot public.auction_lots%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_room_settings JSONB;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_min_increment INT;
  v_min_required_bid INT;
  v_max_squad_size INT;
  v_max_overseas INT;
  v_is_overseas BOOLEAN;
  v_existing_bid public.bids%ROWTYPE;
  v_bid_number INT;
  v_bid_id UUID;
  v_new_expires_at TIMESTAMPTZ;
BEGIN
  -- IDEMPOTENCY CHECK
  SELECT * INTO v_existing_bid FROM public.bids WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_existing_bid.auction_id != p_auction_id OR v_existing_bid.team_id != p_team_id OR v_existing_bid.lot_id != p_lot_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_DUPLICATE_REQUEST');
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', true,
      'bid_id', v_existing_bid.id,
      'auction_id', v_existing_bid.auction_id,
      'lot_id', v_existing_bid.lot_id,
      'team_id', v_existing_bid.team_id,
      'amount', v_existing_bid.amount,
      'request_id', v_existing_bid.request_id
    );
  END IF;

  -- LOT LOCK
  SELECT * INTO v_lot FROM public.auction_lots WHERE id = p_lot_id AND auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_FOUND');
  END IF;

  -- AUTO-TRANSITION GET_READY -> BIDDING
  IF v_lot.status = 'GET_READY' THEN
    IF v_lot.get_ready_expires_at IS NOT NULL AND v_now >= v_lot.get_ready_expires_at THEN
      v_lot.status := 'BIDDING';
      v_lot.timer_expires_at := v_now + (v_lot.timer_duration_seconds * INTERVAL '1 second');
      UPDATE public.auction_lots
      SET status = 'BIDDING', timer_expires_at = v_lot.timer_expires_at
      WHERE id = v_lot.id;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_BIDDING');
    END IF;
  END IF;

  IF v_lot.status != 'BIDDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_BIDDING');
  END IF;

  IF v_lot.timer_expires_at IS NOT NULL AND v_now >= v_lot.timer_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TIMER_EXPIRED');
  END IF;

  IF v_lot.highest_bidder_team_id = p_team_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ALREADY_HIGHEST_BIDDER');
  END IF;

  -- TEAM LOCK
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id AND auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_NOT_FOUND');
  END IF;

  -- FETCH SETTINGS & PLAYER
  SELECT r.settings INTO v_room_settings
  FROM public.auctions a JOIN public.rooms r ON a.room_id = r.id WHERE a.id = p_auction_id;

  SELECT is_overseas INTO v_is_overseas FROM public.players WHERE id = v_lot.player_id;

  v_max_squad_size := COALESCE((v_room_settings->>'max_squad_size')::int, 25);
  v_max_overseas := COALESCE((v_room_settings->>'max_overseas')::int, 8);

  -- CALCULATE REQUIRED BID
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

  -- VALIDATIONS
  IF v_team.purse < v_min_required_bid THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INSUFFICIENT_PURSE');
  END IF;

  IF v_team.players_bought >= v_max_squad_size THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SQUAD_LIMIT_REACHED');
  END IF;

  IF v_is_overseas AND v_team.overseas_count >= v_max_overseas THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_OVERSEAS_LIMIT');
  END IF;

  -- APPLY BID
  SELECT COALESCE(MAX(bid_number), 0) + 1 INTO v_bid_number FROM public.bids WHERE lot_id = v_lot.id;
  v_new_expires_at := v_now + (v_lot.timer_duration_seconds * INTERVAL '1 second');

  INSERT INTO public.bids (
    auction_id, lot_id, team_id, amount, request_id, is_bot, is_valid, bid_number, created_at
  ) VALUES (
    p_auction_id, v_lot.id, p_team_id, v_min_required_bid, p_request_id, p_is_bot, true, v_bid_number, v_now
  ) RETURNING id INTO v_bid_id;

  UPDATE public.auction_lots
  SET current_bid = v_min_required_bid,
      highest_bidder_team_id = p_team_id,
      timer_expires_at = v_new_expires_at
  WHERE id = v_lot.id;

  RETURN jsonb_build_object(
    'success', true,
    'auction_id', p_auction_id,
    'lot_id', p_lot_id,
    'team_id', p_team_id,
    'bid_id', v_bid_id,
    'amount', v_min_required_bid,
    'current_bid', v_min_required_bid,
    'highest_bidder_team_id', p_team_id,
    'timer_expires_at', v_new_expires_at,
    'sequence', v_bid_number,
    'request_id', p_request_id
  );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;

-- 2. v3_finalize_and_advance_lot
CREATE OR REPLACE FUNCTION public.v3_finalize_and_advance_lot(
  p_auction_id UUID,
  p_lot_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_lot public.auction_lots%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_next_lot public.auction_lots%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_is_overseas BOOLEAN;
  v_final_status TEXT;
BEGIN
  -- LOCK CURRENT LOT
  SELECT * INTO v_lot FROM public.auction_lots WHERE id = p_lot_id AND auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_FOUND');
  END IF;

  IF v_lot.status != 'BIDDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_BIDDING');
  END IF;

  IF v_lot.timer_expires_at IS NULL OR v_now < v_lot.timer_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TIMER_NOT_EXPIRED');
  END IF;

  -- PROCESS WINNER OR UNSOLD
  IF v_lot.highest_bidder_team_id IS NOT NULL THEN
    -- LOCK TEAM
    SELECT * INTO v_team FROM public.teams WHERE id = v_lot.highest_bidder_team_id FOR UPDATE;

    -- DOUBLE CHECK FUNDS JUST IN CASE
    IF v_team.purse < v_lot.current_bid THEN
      RAISE EXCEPTION 'ERR_INSUFFICIENT_PURSE_DURING_FINALIZATION';
    END IF;

    SELECT is_overseas INTO v_is_overseas FROM public.players WHERE id = v_lot.player_id;

    -- DEDUCT AND ASSIGN
    UPDATE public.teams
    SET purse = purse - v_lot.current_bid,
        players_bought = players_bought + 1,
        overseas_count = overseas_count + (CASE WHEN v_is_overseas THEN 1 ELSE 0 END)
    WHERE id = v_team.id;

    INSERT INTO public.squad_players (auction_id, team_id, player_id, lot_id, purchase_price)
    VALUES (p_auction_id, v_team.id, v_lot.player_id, v_lot.id, v_lot.current_bid);

    v_final_status := 'SOLD';

    UPDATE public.auction_lots
    SET status = 'SOLD',
        winning_team_id = v_team.id,
        winning_bid = v_lot.current_bid
    WHERE id = v_lot.id;
  ELSE
    v_final_status := 'UNSOLD';
    UPDATE public.auction_lots
    SET status = 'UNSOLD'
    WHERE id = v_lot.id;
  END IF;

  -- ATOMIC ADVANCE TO NEXT LOT
  SELECT * INTO v_next_lot
  FROM public.auction_lots
  WHERE auction_id = p_auction_id AND status = 'PENDING'
  ORDER BY lot_index ASC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.auction_lots
    SET status = 'GET_READY',
        get_ready_expires_at = v_now + INTERVAL '5 seconds',
        timer_expires_at = NULL,
        current_bid = base_price,
        highest_bidder_team_id = NULL
    WHERE id = v_next_lot.id;

    UPDATE public.auctions
    SET current_lot_id = v_next_lot.id,
        current_lot_index = v_next_lot.lot_index
    WHERE id = p_auction_id;
  ELSE
    UPDATE public.auctions
    SET status = 'COMPLETED',
        current_lot_id = NULL,
        completed_at = v_now
    WHERE id = p_auction_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lot_id', p_lot_id,
    'status', v_final_status,
    'next_lot_id', v_next_lot.id,
    'auction_status', CASE WHEN v_next_lot.id IS NULL THEN 'COMPLETED' ELSE 'IN_PROGRESS' END
  );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;
