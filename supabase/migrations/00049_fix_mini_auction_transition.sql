-- Migration: 00049_fix_mini_auction_transition.sql

BEGIN;

-- 1. Update Auctions Status check constraint to include 'MINI_AUCTION'
ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_status_check;
ALTER TABLE public.auctions ADD CONSTRAINT auctions_status_check CHECK (status IN ('LOBBY','READY','STARTING','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED','MINI_AUCTION'));

-- 2. Update v3_finalize_and_advance_lot to handle MINI_AUCTION transition
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
  v_unsold_count INT;
  v_eligible_teams INT;
  v_room_settings JSONB;
  v_max_squad_size INT;
  v_new_auction_status TEXT;
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

    v_new_auction_status := 'IN_PROGRESS';
  ELSE
    -- NO MORE PENDING LOTS
    -- Check if we can transition to MINI_AUCTION instead of COMPLETED
    
    SELECT r.settings INTO v_room_settings
    FROM public.auctions a JOIN public.rooms r ON a.room_id = r.id 
    WHERE a.id = p_auction_id;
    
    v_max_squad_size := COALESCE((v_room_settings->>'max_squad_size')::int, 25);
    
    SELECT COUNT(*) INTO v_unsold_count 
    FROM public.auction_lots 
    WHERE auction_id = p_auction_id AND status = 'UNSOLD';
    
    SELECT COUNT(*) INTO v_eligible_teams 
    FROM public.teams 
    WHERE auction_id = p_auction_id AND players_bought < v_max_squad_size AND purse > 0;
    
    IF v_unsold_count > 0 AND v_eligible_teams > 0 THEN
      UPDATE public.auctions
      SET status = 'MINI_AUCTION',
          current_lot_id = NULL
      WHERE id = p_auction_id;
      
      -- Seed the mini auction session
      INSERT INTO public.mini_auction_sessions (auction_id, status, created_at, updated_at)
      VALUES (p_auction_id, 'SETUP', v_now, v_now)
      ON CONFLICT (auction_id) DO NOTHING;

      v_new_auction_status := 'MINI_AUCTION';
    ELSE
      UPDATE public.auctions
      SET status = 'COMPLETED',
          current_lot_id = NULL,
          completed_at = v_now
      WHERE id = p_auction_id;
      
      v_new_auction_status := 'COMPLETED';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lot_id', p_lot_id,
    'status', v_final_status,
    'next_lot_id', v_next_lot.id,
    'auction_status', v_new_auction_status
  );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;

COMMIT;
