-- 00039_v3_auction_ticker_robustness.sql
-- Adds p_force parameter to bypass DB clock check for authoritative server tickers

CREATE OR REPLACE FUNCTION public.v3_start_bidding(
  p_auction_id UUID,
  p_lot_id UUID,
  p_force BOOLEAN DEFAULT false
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
  IF NOT p_force OR current_setting('role', true) != 'service_role' THEN
    IF v_lot.get_ready_expires_at IS NULL OR v_now < v_lot.get_ready_expires_at THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_GET_READY_NOT_EXPIRED');
    END IF;
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
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.v3_finalize_and_advance_lot(
  p_auction_id UUID,
  p_lot_id UUID,
  p_force BOOLEAN DEFAULT false
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

  -- Bypassing the timer check if p_force is true and the caller is service_role
  IF NOT p_force OR current_setting('role', true) != 'service_role' THEN
    IF v_lot.timer_expires_at IS NULL OR v_now < v_lot.timer_expires_at THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_TIMER_NOT_EXPIRED');
    END IF;
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
