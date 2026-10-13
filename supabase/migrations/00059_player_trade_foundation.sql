-- Migration: 00059_player_trade_foundation.sql
-- Description: Player-to-Player Trade System Schema, Realtime Publication, RLS, and Atomic RPCs

BEGIN;

-- 1. CREATE TRADES TABLE
CREATE TABLE IF NOT EXISTS public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  proposer_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  receiver_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  proposer_player_ids UUID[] NOT NULL,
  receiver_player_ids UUID[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' 
    CHECK (status IN ('PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  parent_trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  proposer_notes TEXT,
  response_notes TEXT,
  fair_value_score JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,
  CONSTRAINT check_different_teams CHECK (proposer_team_id <> receiver_team_id),
  CONSTRAINT check_has_proposer_players CHECK (array_length(proposer_player_ids, 1) >= 1 AND array_length(proposer_player_ids, 1) <= 3),
  CONSTRAINT check_has_receiver_players CHECK (array_length(receiver_player_ids, 1) >= 1 AND array_length(receiver_player_ids, 1) <= 3)
);

-- 2. CREATE TRADE LOGS AUDIT TABLE
CREATE TABLE IF NOT EXISTS public.trade_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('PROPOSED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  actor_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  actor_user_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. INDEXES FOR HIGH-THROUGHPUT LOOKUPS
CREATE INDEX IF NOT EXISTS idx_trades_auction_status ON public.trades(auction_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_proposer_team ON public.trades(proposer_team_id);
CREATE INDEX IF NOT EXISTS idx_trades_receiver_team ON public.trades(receiver_team_id);
CREATE INDEX IF NOT EXISTS idx_trades_parent ON public.trades(parent_trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_logs_trade ON public.trade_logs(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_logs_auction ON public.trade_logs(auction_id);

-- 4. ENABLE RLS
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_logs ENABLE ROW LEVEL SECURITY;

-- 5. RLS POLICIES FOR TRADES
DROP POLICY IF EXISTS "Trades viewable by room participants" ON public.trades;
CREATE POLICY "Trades viewable by room participants" ON public.trades
  FOR SELECT TO public
  USING (
    public.is_room_participant(room_id, public.resolve_user_id())
    OR EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = trades.room_id AND r.host_id = public.resolve_user_id()
    )
  );

-- Direct client mutations forbidden (mutations must go through secure RPCs)
DROP POLICY IF EXISTS "Deny direct inserts to trades" ON public.trades;
CREATE POLICY "Deny direct inserts to trades" ON public.trades
  FOR INSERT TO public WITH CHECK (false);

DROP POLICY IF EXISTS "Deny direct updates to trades" ON public.trades;
CREATE POLICY "Deny direct updates to trades" ON public.trades
  FOR UPDATE TO public USING (false);

DROP POLICY IF EXISTS "Deny direct deletes to trades" ON public.trades;
CREATE POLICY "Deny direct deletes to trades" ON public.trades
  FOR DELETE TO public USING (false);

-- RLS POLICIES FOR TRADE LOGS
DROP POLICY IF EXISTS "Trade logs viewable by room participants" ON public.trade_logs;
CREATE POLICY "Trade logs viewable by room participants" ON public.trade_logs
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.trades t
      WHERE t.id = trade_logs.trade_id
      AND (
        public.is_room_participant(t.room_id, public.resolve_user_id())
        OR EXISTS (
          SELECT 1 FROM public.rooms r
          WHERE r.id = t.room_id AND r.host_id = public.resolve_user_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Deny direct writes to trade_logs" ON public.trade_logs;
CREATE POLICY "Deny direct writes to trade_logs" ON public.trade_logs
  FOR ALL TO public USING (false);

-- 6. REALTIME PUBLICATION
ALTER TABLE public.trades REPLICA IDENTITY FULL;
ALTER TABLE public.squad_players REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.trades;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.squad_players;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;


-- 7. SECURE RPC: v3_propose_trade
CREATE OR REPLACE FUNCTION public.v3_propose_trade(
  p_auction_id UUID,
  p_proposer_team_id UUID,
  p_receiver_team_id UUID,
  p_proposer_player_ids UUID[],
  p_receiver_player_ids UUID[],
  p_notes TEXT DEFAULT NULL,
  p_parent_trade_id UUID DEFAULT NULL,
  p_fair_value JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_mini_session public.mini_auction_sessions%ROWTYPE;
  v_user_id UUID := public.resolve_user_id();
  v_is_participant BOOLEAN;
  v_is_host BOOLEAN;
  v_proposer_team public.teams%ROWTYPE;
  v_receiver_team public.teams%ROWTYPE;
  v_parent_trade public.trades%ROWTYPE;
  v_max_squad_size INT;
  v_max_overseas INT;
  v_p_count INT := array_length(p_proposer_player_ids, 1);
  v_r_count INT := array_length(p_receiver_player_ids, 1);
  v_player_check_count INT;
  v_p_overseas_delta INT;
  v_r_overseas_delta INT;
  v_trade_id UUID;
  v_expires_at TIMESTAMPTZ := clock_timestamp() + INTERVAL '24 hours';
  v_now TIMESTAMPTZ := clock_timestamp();
  v_status TEXT := 'PENDING';
BEGIN
  -- 1. Verify auction exists
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  -- 2. Verify room exists
  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  -- 3. Verify unlock conditions
  IF v_auction.status != 'COMPLETED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_MEGA_AUCTION_NOT_COMPLETED');
  END IF;

  -- Check mini session if exists
  SELECT * INTO v_mini_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
  IF FOUND AND v_mini_session.status != 'COMPLETED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_MINI_AUCTION_NOT_COMPLETED');
  END IF;

  -- 4. Validate team existence
  SELECT * INTO v_proposer_team FROM public.teams WHERE id = p_proposer_team_id AND auction_id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_TEAM_NOT_FOUND');
  END IF;

  SELECT * INTO v_receiver_team FROM public.teams WHERE id = p_receiver_team_id AND auction_id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_RECEIVER_TEAM_NOT_FOUND');
  END IF;

  IF p_proposer_team_id = p_receiver_team_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_CANNOT_TRADE_WITH_SELF');
  END IF;

  -- 5. Verify caller authorization
  v_is_host := (v_user_id IS NOT NULL AND v_room.host_id = v_user_id);

  SELECT EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = v_room.id 
      AND user_id = v_user_id 
      AND team_id = p_proposer_team_id
  ) INTO v_is_participant;

  -- Caller must be participant of proposer team, or host managing a bot team
  IF NOT v_is_participant AND NOT (v_is_host AND v_proposer_team.is_bot) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED_FOR_TEAM');
  END IF;

  -- 6. Validate player count bounds (1 to 3)
  IF v_p_count IS NULL OR v_p_count < 1 OR v_p_count > 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_PROPOSER_PLAYER_COUNT');
  END IF;

  IF v_r_count IS NULL OR v_r_count < 1 OR v_r_count > 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_RECEIVER_PLAYER_COUNT');
  END IF;

  -- 7. Validate player ownership
  SELECT COUNT(*) INTO v_player_check_count
  FROM public.squad_players
  WHERE auction_id = p_auction_id 
    AND team_id = p_proposer_team_id 
    AND player_id = ANY(p_proposer_player_ids);

  IF v_player_check_count != v_p_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_PLAYERS_NOT_OWNED');
  END IF;

  SELECT COUNT(*) INTO v_player_check_count
  FROM public.squad_players
  WHERE auction_id = p_auction_id 
    AND team_id = p_receiver_team_id 
    AND player_id = ANY(p_receiver_player_ids);

  IF v_player_check_count != v_r_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_RECEIVER_PLAYERS_NOT_OWNED');
  END IF;

  -- 8. Validate squad size & overseas limits
  v_max_squad_size := COALESCE((v_room.settings->>'max_squad_size')::int, 25);
  v_max_overseas := COALESCE((v_room.settings->>'max_overseas')::int, 8);

  IF (v_proposer_team.players_bought - v_p_count + v_r_count) > v_max_squad_size THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_SQUAD_LIMIT_EXCEEDED');
  END IF;

  IF (v_receiver_team.players_bought - v_r_count + v_p_count) > v_max_squad_size THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_RECEIVER_SQUAD_LIMIT_EXCEEDED');
  END IF;

  -- Calculate overseas deltas
  SELECT COUNT(*) INTO v_p_overseas_delta
  FROM public.players
  WHERE id = ANY(p_proposer_player_ids) AND is_overseas = true;

  SELECT COUNT(*) INTO v_r_overseas_delta
  FROM public.players
  WHERE id = ANY(p_receiver_player_ids) AND is_overseas = true;

  IF (v_proposer_team.overseas_count - v_p_overseas_delta + v_r_overseas_delta) > v_max_overseas THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_OVERSEAS_LIMIT_EXCEEDED');
  END IF;

  IF (v_receiver_team.overseas_count - v_r_overseas_delta + v_p_overseas_delta) > v_max_overseas THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_RECEIVER_OVERSEAS_LIMIT_EXCEEDED');
  END IF;

  -- 9. Check and validate counteroffer if p_parent_trade_id is provided
  IF p_parent_trade_id IS NOT NULL THEN
    SELECT * INTO v_parent_trade 
    FROM public.trades 
    WHERE id = p_parent_trade_id 
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_PARENT_TRADE_NOT_FOUND');
    END IF;

    -- Validate parent belongs to same auction and room
    IF v_parent_trade.auction_id != p_auction_id OR v_parent_trade.room_id != v_room.id THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_PARENT_TRADE_MISMATCH');
    END IF;

    -- Validate parent is still PENDING
    IF v_parent_trade.status != 'PENDING' THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_PARENT_TRADE_NOT_PENDING');
    END IF;

    -- Validate parent has not expired
    IF v_parent_trade.expires_at IS NOT NULL AND v_parent_trade.expires_at <= v_now THEN
      UPDATE public.trades
      SET status = 'EXPIRED', updated_at = v_now
      WHERE id = p_parent_trade_id;

      RETURN jsonb_build_object('success', false, 'error', 'ERR_PARENT_TRADE_EXPIRED');
    END IF;

    -- Validate countering team was the parent trade's receiver
    IF v_parent_trade.receiver_team_id != p_proposer_team_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_COUNTER_TEAM_NOT_RECEIVER');
    END IF;

    -- Validate new receiver is the parent trade's proposer
    IF v_parent_trade.proposer_team_id != p_receiver_team_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_COUNTER_TARGET_MISMATCH');
    END IF;

    -- Valid counteroffer: mark parent trade as COUNTERED so it cannot be accepted or modified
    UPDATE public.trades
    SET status = 'COUNTERED', updated_at = v_now
    WHERE id = p_parent_trade_id;

    -- Log that parent trade was countered
    INSERT INTO public.trade_logs (
      trade_id,
      auction_id,
      action,
      actor_team_id,
      actor_user_id,
      payload
    ) VALUES (
      p_parent_trade_id,
      p_auction_id,
      'COUNTERED',
      p_proposer_team_id,
      v_user_id,
      jsonb_build_object('countered_by_team_id', p_proposer_team_id)
    );
  END IF;

  -- 10. Insert trade (all new trades/counteroffers start with status PENDING)
  INSERT INTO public.trades (
    auction_id,
    room_id,
    proposer_team_id,
    receiver_team_id,
    proposer_player_ids,
    receiver_player_ids,
    status,
    parent_trade_id,
    proposer_notes,
    fair_value_score,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_auction_id,
    v_room.id,
    p_proposer_team_id,
    p_receiver_team_id,
    p_proposer_player_ids,
    p_receiver_player_ids,
    'PENDING',
    p_parent_trade_id,
    p_notes,
    p_fair_value,
    v_expires_at,
    v_now,
    v_now
  ) RETURNING id INTO v_trade_id;

  -- 11. Log action
  INSERT INTO public.trade_logs (
    trade_id,
    auction_id,
    action,
    actor_team_id,
    actor_user_id,
    payload
  ) VALUES (
    v_trade_id,
    p_auction_id,
    CASE WHEN p_parent_trade_id IS NOT NULL THEN 'COUNTERED' ELSE 'PROPOSED' END,
    p_proposer_team_id,
    v_user_id,
    jsonb_build_object(
      'proposer_player_ids', p_proposer_player_ids,
      'receiver_player_ids', p_receiver_player_ids,
      'parent_trade_id', p_parent_trade_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', v_trade_id,
    'status', 'PENDING'
  );
END;
$$;


-- 8. SECURE RPC: v3_respond_trade
CREATE OR REPLACE FUNCTION public.v3_respond_trade(
  p_trade_id UUID,
  p_action TEXT,
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
  v_is_host BOOLEAN;
  v_is_receiver BOOLEAN;
  v_is_proposer BOOLEAN;
  v_proposer_team public.teams%ROWTYPE;
  v_receiver_team public.teams%ROWTYPE;
  v_all_trade_players UUID[];
  v_max_squad_size INT;
  v_max_overseas INT;
  v_p_count INT;
  v_r_count INT;
  v_p_overseas_delta INT;
  v_r_overseas_delta INT;
  v_ownership_check INT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- 1. Fetch trade with row lock
  SELECT * INTO v_trade FROM public.trades WHERE id = p_trade_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_NOT_FOUND');
  END IF;

  IF v_trade.status != 'PENDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_NOT_ACTIVE', 'status', v_trade.status);
  END IF;

  -- Check expiry
  IF v_trade.expires_at IS NOT NULL AND v_now > v_trade.expires_at THEN
    UPDATE public.trades SET status = 'EXPIRED', updated_at = v_now WHERE id = p_trade_id;
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TRADE_EXPIRED');
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = v_trade.room_id;
  v_is_host := (v_user_id IS NOT NULL AND v_room.host_id = v_user_id);

  -- Fetch team metadata for authorization checks
  SELECT * INTO v_proposer_team FROM public.teams WHERE id = v_trade.proposer_team_id AND auction_id = v_trade.auction_id;
  SELECT * INTO v_receiver_team FROM public.teams WHERE id = v_trade.receiver_team_id AND auction_id = v_trade.auction_id;

  -- Check team associations
  SELECT EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = v_trade.room_id AND user_id = v_user_id AND team_id = v_trade.receiver_team_id
  ) INTO v_is_receiver;

  SELECT EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = v_trade.room_id AND user_id = v_user_id AND team_id = v_trade.proposer_team_id
  ) INTO v_is_proposer;

  -- 2. HANDLE CANCEL ACTION (Proposer can cancel)
  IF p_action = 'CANCEL' THEN
    IF NOT v_is_proposer AND NOT (v_is_host AND v_proposer_team.is_bot) THEN
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

  -- 3. HANDLE REJECT ACTION (Receiver can reject)
  IF p_action = 'REJECT' THEN
    IF NOT v_is_receiver AND NOT (v_is_host AND v_receiver_team.is_bot) THEN
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

  -- 4. HANDLE ACCEPT ACTION (Receiver can accept -> Atomic execution)
  IF p_action = 'ACCEPT' THEN
    -- Only receiving team participant can accept; host may only accept on behalf of a bot receiver team,
    -- but host can NEVER accept a trade that their own team proposed.
    IF NOT v_is_receiver AND NOT (v_is_host AND v_receiver_team.is_bot AND NOT v_is_proposer) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED_TO_ACCEPT');
    END IF;

    v_p_count := array_length(v_trade.proposer_player_ids, 1);
    v_r_count := array_length(v_trade.receiver_player_ids, 1);
    v_all_trade_players := v_trade.proposer_player_ids || v_trade.receiver_player_ids;

    -- Deadlock-free team row locking in deterministic ascending UUID order
    IF v_trade.proposer_team_id < v_trade.receiver_team_id THEN
      SELECT * INTO v_proposer_team 
      FROM public.teams 
      WHERE id = v_trade.proposer_team_id AND auction_id = v_trade.auction_id 
      FOR UPDATE;

      SELECT * INTO v_receiver_team 
      FROM public.teams 
      WHERE id = v_trade.receiver_team_id AND auction_id = v_trade.auction_id 
      FOR UPDATE;
    ELSE
      SELECT * INTO v_receiver_team 
      FROM public.teams 
      WHERE id = v_trade.receiver_team_id AND auction_id = v_trade.auction_id 
      FOR UPDATE;

      SELECT * INTO v_proposer_team 
      FROM public.teams 
      WHERE id = v_trade.proposer_team_id AND auction_id = v_trade.auction_id 
      FOR UPDATE;
    END IF;

    IF v_proposer_team.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_TEAM_NOT_FOUND');
    END IF;

    IF v_receiver_team.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_RECEIVER_TEAM_NOT_FOUND');
    END IF;

    -- Row lock all involved squad players in deterministic order
    PERFORM id 
    FROM public.squad_players 
    WHERE auction_id = v_trade.auction_id 
      AND player_id = ANY(v_all_trade_players)
    ORDER BY id ASC
    FOR UPDATE;

    -- Revalidate current ownership of proposer players
    SELECT COUNT(*) INTO v_ownership_check
    FROM public.squad_players
    WHERE auction_id = v_trade.auction_id
      AND team_id = v_trade.proposer_team_id
      AND player_id = ANY(v_trade.proposer_player_ids);

    IF v_ownership_check != v_p_count THEN
      UPDATE public.trades SET status = 'EXPIRED', updated_at = v_now WHERE id = p_trade_id;
      RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_PLAYER_NO_LONGER_OWNED');
    END IF;

    -- Revalidate current ownership of receiver players
    SELECT COUNT(*) INTO v_ownership_check
    FROM public.squad_players
    WHERE auction_id = v_trade.auction_id
      AND team_id = v_trade.receiver_team_id
      AND player_id = ANY(v_trade.receiver_player_ids);

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

    SELECT COUNT(*) INTO v_p_overseas_delta
    FROM public.players
    WHERE id = ANY(v_trade.proposer_player_ids) AND is_overseas = true;

    SELECT COUNT(*) INTO v_r_overseas_delta
    FROM public.players
    WHERE id = ANY(v_trade.receiver_player_ids) AND is_overseas = true;

    IF (v_proposer_team.overseas_count - v_p_overseas_delta + v_r_overseas_delta) > v_max_overseas THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_PROPOSER_OVERSEAS_LIMIT_EXCEEDED');
    END IF;

    IF (v_receiver_team.overseas_count - v_r_overseas_delta + v_p_overseas_delta) > v_max_overseas THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_RECEIVER_OVERSEAS_LIMIT_EXCEEDED');
    END IF;

    -- 5. ATOMIC SWAP EXECUTION
    -- Transfer Proposer Players -> Receiver Team
    UPDATE public.squad_players
    SET team_id = v_trade.receiver_team_id
    WHERE auction_id = v_trade.auction_id AND player_id = ANY(v_trade.proposer_player_ids);

    -- Transfer Receiver Players -> Proposer Team
    UPDATE public.squad_players
    SET team_id = v_trade.proposer_team_id
    WHERE auction_id = v_trade.auction_id AND player_id = ANY(v_trade.receiver_player_ids);

    -- Update denormalized stats on teams
    UPDATE public.teams
    SET players_bought = players_bought - v_p_count + v_r_count,
        overseas_count = overseas_count - v_p_overseas_delta + v_r_overseas_delta
    WHERE id = v_trade.proposer_team_id;

    UPDATE public.teams
    SET players_bought = players_bought - v_r_count + v_p_count,
        overseas_count = overseas_count - v_r_overseas_delta + v_p_overseas_delta
    WHERE id = v_trade.receiver_team_id;

    -- Mark trade as ACCEPTED
    UPDATE public.trades
    SET status = 'ACCEPTED',
        response_notes = p_notes,
        finalized_at = v_now,
        updated_at = v_now
    WHERE id = p_trade_id;

    -- Auto-expire any competing pending trades involving these players (SKIP LOCKED avoids lock-inversion deadlock with concurrent accepts)
    WITH competing_trades AS (
      SELECT id
      FROM public.trades
      WHERE auction_id = v_trade.auction_id
        AND status = 'PENDING'
        AND id != p_trade_id
        AND (
          proposer_player_ids && v_all_trade_players
          OR receiver_player_ids && v_all_trade_players
        )
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.trades t
    SET status = 'EXPIRED',
        updated_at = v_now
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
      jsonb_build_object(
        'proposer_player_ids', v_trade.proposer_player_ids,
        'receiver_player_ids', v_trade.receiver_player_ids,
        'notes', p_notes
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'trade_id', p_trade_id,
      'status', 'ACCEPTED'
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_ACTION');
END;
$$;

COMMIT;
