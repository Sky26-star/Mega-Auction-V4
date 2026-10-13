-- Migration: 00028_v3_start_auction.sql
-- Description: Phase 2C V3 Start Implementation

-- 1. v3_start_auction
CREATE OR REPLACE FUNCTION public.v3_start_auction(p_room_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_first_lot public.auction_lots%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_get_ready_expires_at TIMESTAMPTZ;
BEGIN
  -- VERIFY ROOM AND HOST
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  IF auth.uid() IS NULL OR v_room.host_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  -- LOCK AUCTION
  SELECT * INTO v_auction FROM public.auctions WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  -- CHECK VALID START STATES
  IF v_auction.status IN ('IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_ALREADY_STARTED');
  END IF;

  -- LOCK FIRST PENDING LOT
  SELECT * INTO v_first_lot
  FROM public.auction_lots
  WHERE auction_id = v_auction.id AND status = 'PENDING'
  ORDER BY lot_index ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NO_PENDING_LOTS');
  END IF;

  -- UPDATE LOT TO GET_READY
  v_get_ready_expires_at := v_now + INTERVAL '5 seconds';

  UPDATE public.auction_lots
  SET status = 'GET_READY',
      get_ready_expires_at = v_get_ready_expires_at,
      timer_expires_at = NULL,
      current_bid = base_price,
      highest_bidder_team_id = NULL
  WHERE id = v_first_lot.id;

  -- UPDATE AUCTION
  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      current_lot_id = v_first_lot.id,
      current_lot_index = v_first_lot.lot_index,
      started_at = COALESCE(started_at, v_now)
  WHERE id = v_auction.id;

  RETURN jsonb_build_object(
    'success', true,
    'auction_id', v_auction.id,
    'room_id', p_room_id,
    'lot_id', v_first_lot.id,
    'lot_index', v_first_lot.lot_index,
    'status', 'IN_PROGRESS',
    'lot_status', 'GET_READY',
    'get_ready_expires_at', v_get_ready_expires_at,
    'current_bid', v_first_lot.base_price
  );
END;
$$ LANGUAGE plpgsql VOLATILE;

-- 2. v3_start_bidding
CREATE OR REPLACE FUNCTION public.v3_start_bidding(
  p_auction_id UUID,
  p_lot_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_lot public.auction_lots%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_timer_expires_at TIMESTAMPTZ;
BEGIN
  -- VERIFY LOT IS THE CURRENT LOT
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  IF v_auction.current_lot_id != p_lot_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NOT_CURRENT_LOT');
  END IF;

  -- LOCK LOT
  SELECT * INTO v_lot FROM public.auction_lots WHERE id = p_lot_id AND auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_FOUND');
  END IF;

  -- IDEMPOTENCY / EARLY RETURN
  IF v_lot.status = 'BIDDING' THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', true,
      'lot_id', v_lot.id,
      'status', 'BIDDING',
      'timer_expires_at', v_lot.timer_expires_at
    );
  END IF;

  -- VERIFY CORRECT STATE
  IF v_lot.status != 'GET_READY' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_GET_READY');
  END IF;

  -- VERIFY EXPIRY
  IF v_lot.get_ready_expires_at IS NULL OR v_now < v_lot.get_ready_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_GET_READY_NOT_EXPIRED');
  END IF;

  -- TRANSITION
  v_timer_expires_at := v_now + (v_lot.timer_duration_seconds * INTERVAL '1 second');

  UPDATE public.auction_lots
  SET status = 'BIDDING',
      timer_expires_at = v_timer_expires_at
  WHERE id = v_lot.id;

  RETURN jsonb_build_object(
    'success', true,
    'lot_id', v_lot.id,
    'status', 'BIDDING',
    'timer_expires_at', v_timer_expires_at
  );
END;
$$ LANGUAGE plpgsql VOLATILE;
