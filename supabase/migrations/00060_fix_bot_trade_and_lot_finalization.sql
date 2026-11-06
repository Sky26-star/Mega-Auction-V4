-- Migration: 00060_fix_bot_trade_and_lot_finalization.sql
-- Description: Unapplied proposed database migration for:
--   1. Authorizing trusted server (service_role) and room host for bot trade responses in v3_respond_trade
--   2. Ensuring distributed concurrency control and atomic timer expiry verification in v3_finalize_and_advance_lot
-- NOTE: DO NOT APPLY REMOTELY WITHOUT SEPARATE APPROVAL.

BEGIN;

-- ============================================================================
-- 1. UPDATE v3_respond_trade
-- ============================================================================
CREATE OR REPLACE FUNCTION public.v3_respond_trade(
  p_trade_id UUID,
  p_action TEXT, -- 'ACCEPT', 'REJECT', 'CANCEL'
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade public.trades%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_user_id UUID := public.resolve_user_id();
  v_is_service_role BOOLEAN := (current_setting('role', true) = 'service_role');
  v_is_host BOOLEAN := false;
  v_is_receiver BOOLEAN := false;
  v_is_proposer BOOLEAN := false;
  v_proposer_team public.teams%ROWTYPE;
  v_receiver_team public.teams%ROWTYPE;
  v_p_count INT;
  v_r_count INT;
  v_all_trade_players UUID[];
  v_ownership_check INT;
  v_max_squad_size INT;
  v_max_overseas INT;
  v_p_overseas_delta INT;
  v_r_overseas_delta INT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- 1. LOCK AND VALIDATE TRADE
  SELECT * INTO v_trade
  FROM public.trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF v_trade.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_NOT_FOUND');
  END IF;

  IF v_trade.status != 'PENDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_NOT_PENDING');
  END IF;

  IF v_trade.expires_at IS NOT NULL AND v_now >= v_trade.expires_at THEN
    UPDATE public.trades SET status = 'EXPIRED', updated_at = v_now WHERE id = p_trade_id;
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_EXPIRED');
  END IF;

  -- Room context
  SELECT * INTO v_room FROM public.rooms WHERE id = v_trade.room_id;
  IF v_room.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  -- Proposer & Receiver teams
  SELECT * INTO v_proposer_team FROM public.teams WHERE id = v_trade.proposer_team_id;
  SELECT * INTO v_receiver_team FROM public.teams WHERE id = v_trade.receiver_team_id;

  -- User permissions
  IF v_user_id IS NOT NULL THEN
    SELECT (v_room.host_id = v_user_id) INTO v_is_host;

    SELECT EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = v_trade.room_id AND user_id = v_user_id AND team_id = v_trade.receiver_team_id
    ) INTO v_is_receiver;

    SELECT EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = v_trade.room_id AND user_id = v_user_id AND team_id = v_trade.proposer_team_id
    ) INTO v_is_proposer;
  END IF;

  -- 2. HANDLE CANCEL ACTION
  IF p_action = 'CANCEL' THEN
    IF NOT v_is_service_role AND NOT v_is_proposer AND NOT (v_is_host AND v_proposer_team.is_bot) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED_TO_CANCEL');
    END IF;

    UPDATE public.trades
    SET status = 'CANCELLED',
        response_notes = p_notes,
        updated_at = v_now
    WHERE id = p_trade_id;

    INSERT INTO public.trade_logs (trade_id, auction_id, action, actor_team_id, actor_user_id, payload)
    VALUES (p_trade_id, v_trade.auction_id, 'CANCELLED', v_trade.proposer_team_id, v_user_id, jsonb_build_object('notes', p_notes));

    RETURN jsonb_build_object('success', true, 'trade_id', p_trade_id, 'status', 'CANCELLED');
  END IF;

  -- 3. HANDLE REJECT ACTION
  IF p_action = 'REJECT' THEN
    IF NOT v_is_service_role AND NOT v_is_receiver AND NOT (v_is_host AND v_receiver_team.is_bot) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED_TO_REJECT');
    END IF;

    UPDATE public.trades
    SET status = 'REJECTED',
        response_notes = p_notes,
        updated_at = v_now
    WHERE id = p_trade_id;

    INSERT INTO public.trade_logs (trade_id, auction_id, action, actor_team_id, actor_user_id, payload)
    VALUES (p_trade_id, v_trade.auction_id, 'REJECTED', v_trade.receiver_team_id, v_user_id, jsonb_build_object('notes', p_notes));

    RETURN jsonb_build_object('success', true, 'trade_id', p_trade_id, 'status', 'REJECTED');
  END IF;

  -- 4. HANDLE ACCEPT ACTION
  IF p_action = 'ACCEPT' THEN
    -- Authorization:
    -- - Receiver participant can accept
    -- - Host can accept on behalf of a bot receiver, provided the host is not the proposer
    -- NOTE: Trusted bot trade acceptance via service_role is authoritatively established by migration 20261020180000.
    IF NOT v_is_receiver AND NOT (v_is_host AND v_receiver_team.is_bot AND NOT v_is_proposer) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED_TO_ACCEPT');
    END IF;

    v_p_count := array_length(v_trade.proposer_player_ids, 1);
    v_r_count := array_length(v_trade.receiver_player_ids, 1);
    v_all_trade_players := v_trade.proposer_player_ids || v_trade.receiver_player_ids;

    -- Deadlock-free team row locking in ascending UUID order
    IF v_trade.proposer_team_id < v_trade.receiver_team_id THEN
      SELECT * INTO v_proposer_team FROM public.teams WHERE id = v_trade.proposer_team_id AND auction_id = v_trade.auction_id FOR UPDATE;
      SELECT * INTO v_receiver_team FROM public.teams WHERE id = v_trade.receiver_team_id AND auction_id = v_trade.auction_id FOR UPDATE;
    ELSE
      SELECT * INTO v_receiver_team FROM public.teams WHERE id = v_trade.receiver_team_id AND auction_id = v_trade.auction_id FOR UPDATE;
      SELECT * INTO v_proposer_team FROM public.teams WHERE id = v_trade.proposer_team_id AND auction_id = v_trade.auction_id FOR UPDATE;
    END IF;

    IF v_proposer_team.id IS NULL OR v_receiver_team.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_NOT_FOUND');
    END IF;

    -- Row lock all involved squad players
    PERFORM id FROM public.squad_players
    WHERE auction_id = v_trade.auction_id AND player_id = ANY(v_all_trade_players)
    ORDER BY id ASC FOR UPDATE;

    -- Verify current ownership
    SELECT COUNT(*) INTO v_ownership_check FROM public.squad_players
    WHERE auction_id = v_trade.auction_id AND team_id = v_trade.proposer_team_id AND player_id = ANY(v_trade.proposer_player_ids);
    IF v_ownership_check != v_p_count THEN
      UPDATE public.trades SET status = 'EXPIRED', updated_at = v_now WHERE id = p_trade_id;
      RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_PLAYER_NO_LONGER_OWNED');
    END IF;

    SELECT COUNT(*) INTO v_ownership_check FROM public.squad_players
    WHERE auction_id = v_trade.auction_id AND team_id = v_trade.receiver_team_id AND player_id = ANY(v_trade.receiver_player_ids);
    IF v_ownership_check != v_r_count THEN
      UPDATE public.trades SET status = 'EXPIRED', updated_at = v_now WHERE id = p_trade_id;
      RETURN jsonb_build_object('success', false, 'error', 'ERR_RECEIVER_PLAYER_NO_LONGER_OWNED');
    END IF;

    -- Revalidate limits
    v_max_squad_size := COALESCE((v_room.settings->>'max_squad_size')::int, 25);
    v_max_overseas := COALESCE((v_room.settings->>'max_overseas')::int, 8);

    IF (v_proposer_team.players_bought - v_p_count + v_r_count) > v_max_squad_size THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_SQUAD_LIMIT_EXCEEDED');
    END IF;
    IF (v_receiver_team.players_bought - v_r_count + v_p_count) > v_max_squad_size THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_RECEIVER_SQUAD_LIMIT_EXCEEDED');
    END IF;

    SELECT COUNT(*) INTO v_p_overseas_delta FROM public.players WHERE id = ANY(v_trade.proposer_player_ids) AND is_overseas = true;
    SELECT COUNT(*) INTO v_r_overseas_delta FROM public.players WHERE id = ANY(v_trade.receiver_player_ids) AND is_overseas = true;

    IF (v_proposer_team.overseas_count - v_p_overseas_delta + v_r_overseas_delta) > v_max_overseas THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_OVERSEAS_LIMIT_EXCEEDED');
    END IF;
    IF (v_receiver_team.overseas_count - v_r_overseas_delta + v_p_overseas_delta) > v_max_overseas THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_RECEIVER_OVERSEAS_LIMIT_EXCEEDED');
    END IF;

    -- Swap squad player assignments
    UPDATE public.squad_players SET team_id = v_trade.receiver_team_id
    WHERE auction_id = v_trade.auction_id AND player_id = ANY(v_trade.proposer_player_ids);

    UPDATE public.squad_players SET team_id = v_trade.proposer_team_id
    WHERE auction_id = v_trade.auction_id AND player_id = ANY(v_trade.receiver_player_ids);

    -- Update team roster counts
    UPDATE public.teams
    SET players_bought = players_bought - v_p_count + v_r_count,
        overseas_count = overseas_count - v_p_overseas_delta + v_r_overseas_delta
    WHERE id = v_trade.proposer_team_id;

    UPDATE public.teams
    SET players_bought = players_bought - v_r_count + v_p_count,
        overseas_count = overseas_count - v_r_overseas_delta + v_p_overseas_delta
    WHERE id = v_trade.receiver_team_id;

    -- Finalize trade status
    UPDATE public.trades
    SET status = 'ACCEPTED',
        response_notes = p_notes,
        finalized_at = v_now,
        updated_at = v_now
    WHERE id = p_trade_id;

    -- Expire competing pending offers
    WITH competing_trades AS (
      SELECT id FROM public.trades
      WHERE auction_id = v_trade.auction_id
        AND status = 'PENDING'
        AND id != p_trade_id
        AND (proposer_player_ids && v_all_trade_players OR receiver_player_ids && v_all_trade_players)
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.trades t
    SET status = 'EXPIRED', updated_at = v_now
    FROM competing_trades ct
    WHERE t.id = ct.id;

    -- Audit log
    INSERT INTO public.trade_logs (trade_id, auction_id, action, actor_team_id, actor_user_id, payload)
    VALUES (
      p_trade_id,
      v_trade.auction_id,
      'ACCEPTED',
      v_trade.receiver_team_id,
      v_user_id,
      jsonb_build_object('notes', p_notes, 'is_service_role', v_is_service_role)
    );

    RETURN jsonb_build_object('success', true, 'trade_id', p_trade_id, 'status', 'ACCEPTED');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_ACTION');
END;
$$;

-- ============================================================================
-- 2. UPDATE v3_finalize_and_advance_lot (Distributed Concurrency & Timer Boundary)
-- ============================================================================
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
  v_has_mini_session BOOLEAN;
  v_lock_acquired BOOLEAN;
BEGIN
  -- 1. DISTRIBUTED CONCURRENCY CONTROL:
  -- Prevent concurrent tick/finalization transactions across multiple server instances
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('auction_lock_' || p_auction_id::text));
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_CONCURRENT_AUCTION_FINALIZATION_IN_PROGRESS');
  END IF;

  -- 2. LOCK CURRENT LOT
  SELECT * INTO v_lot FROM public.auction_lots WHERE id = p_lot_id AND auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_FOUND');
  END IF;

  IF v_lot.status != 'BIDDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_LOT_NOT_BIDDING');
  END IF;

  -- 3. STRICT TIMER EXPIRY VERIFICATION:
  -- When NOT p_force, verify that clock_timestamp() is strictly >= timer_expires_at.
  -- This prevents stale tick requests from terminating a lot after a valid bid has extended its timer.
  IF NOT p_force THEN
    IF v_lot.timer_expires_at IS NULL OR v_now < v_lot.timer_expires_at THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_TIMER_NOT_EXPIRED');
    END IF;
  END IF;

  -- 4. PROCESS WINNER OR UNSOLD
  IF v_lot.highest_bidder_team_id IS NOT NULL THEN
    -- LOCK TEAM
    SELECT * INTO v_team FROM public.teams WHERE id = v_lot.highest_bidder_team_id FOR UPDATE;

    -- DOUBLE CHECK FUNDS
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

  -- 5. ATOMIC ADVANCE TO NEXT LOT
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
    
    SELECT EXISTS(
      SELECT 1 FROM public.mini_auction_sessions WHERE auction_id = p_auction_id
    ) INTO v_has_mini_session;
    
    IF v_unsold_count > 0 AND v_eligible_teams > 0 AND NOT v_has_mini_session THEN
      UPDATE public.auctions
      SET status = 'MINI_AUCTION',
          current_lot_id = NULL
      WHERE id = p_auction_id;
      
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
