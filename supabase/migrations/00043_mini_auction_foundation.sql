-- Migration: 00043_mini_auction_foundation.sql
-- Description: Mini Auction Schema, Preserved Mega Timestamps, Realtime Publication, and Authoritative RPCs

BEGIN;

-- 1. ADD mega_completed_at AND PRESERVATION TRIGGER TO public.auctions
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS mega_completed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.trg_preserve_mega_completed_at_fn() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'COMPLETED'
     AND OLD.status IS DISTINCT FROM 'COMPLETED'
     AND NEW.mega_completed_at IS NULL THEN
    NEW.mega_completed_at := NEW.completed_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_preserve_mega_completed_at ON public.auctions;
CREATE TRIGGER trg_preserve_mega_completed_at
BEFORE UPDATE ON public.auctions
FOR EACH ROW EXECUTE FUNCTION public.trg_preserve_mega_completed_at_fn();


-- 2. CREATE MINI AUCTION TABLES
CREATE TABLE IF NOT EXISTS public.mini_auction_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL UNIQUE REFERENCES public.auctions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'SETUP' CHECK (status IN ('SETUP', 'SELECTION_OPEN', 'SELECTION_CLOSED', 'BIDDING', 'COMPLETED')),
  selection_expires_at TIMESTAMPTZ,
  total_lots INT NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mini_auction_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_team_player_selection UNIQUE(auction_id, team_id, player_id)
);

CREATE TABLE IF NOT EXISTS public.mini_auction_team_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  has_confirmed BOOLEAN NOT NULL DEFAULT false,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_team_mini_status UNIQUE(auction_id, team_id)
);

CREATE TABLE IF NOT EXISTS public.player_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  refund_amount INT NOT NULL CHECK (refund_amount >= 0),
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.auction_lots ADD COLUMN IF NOT EXISTS is_mini_round BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_unique_mini_lot_player ON public.auction_lots(auction_id, player_id) WHERE is_mini_round = true;
CREATE INDEX IF NOT EXISTS idx_mini_auction_sessions_status_expiry ON public.mini_auction_sessions(status, selection_expires_at) WHERE status = 'SELECTION_OPEN';
CREATE INDEX IF NOT EXISTS idx_player_releases_auction_team ON public.player_releases(auction_id, team_id);


-- 3. REALTIME PUBLICATION
ALTER TABLE public.mini_auction_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mini_auction_sessions;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- 4. RPC: v3_initiate_mini_auction (HOST ONLY)
CREATE OR REPLACE FUNCTION public.v3_initiate_mini_auction(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_session public.mini_auction_sessions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  IF v_auction.status != 'COMPLETED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_COMPLETED');
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  IF auth.uid() IS NULL OR v_room.host_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  INSERT INTO public.mini_auction_sessions (auction_id, status, created_at, updated_at)
  VALUES (p_auction_id, 'SETUP', v_now, v_now)
  ON CONFLICT (auction_id) DO NOTHING
  RETURNING * INTO v_session;

  IF v_session.id IS NULL THEN
    SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
    RETURN jsonb_build_object('success', true, 'session_id', v_session.id, 'status', v_session.status, 'already_exists', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'session_id', v_session.id, 'status', v_session.status, 'already_exists', false);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 5. RPC: v3_admin_force_initiate_mini_auction (SERVICE_ROLE ONLY)
CREATE OR REPLACE FUNCTION public.v3_admin_force_initiate_mini_auction(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF current_setting('role', true) != 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SERVICE_ROLE_ONLY');
  END IF;

  INSERT INTO public.mini_auction_sessions (auction_id, status, created_at, updated_at)
  VALUES (p_auction_id, 'SETUP', v_now, v_now)
  ON CONFLICT (auction_id) DO NOTHING
  RETURNING * INTO v_session;

  IF v_session.id IS NULL THEN
    SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
    RETURN jsonb_build_object('success', true, 'session_id', v_session.id, 'status', v_session.status, 'already_exists', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'session_id', v_session.id, 'status', v_session.status, 'already_exists', false);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 6. RPC: v3_release_player (LOCKED TO SETUP PHASE)
CREATE OR REPLACE FUNCTION public.v3_release_player(
  p_auction_id UUID,
  p_player_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_squad_player public.squad_players%ROWTYPE;
  v_player public.players%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Strict precondition: status must be SETUP
  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status != 'SETUP' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_RELEASE_ONLY_ALLOWED_IN_SETUP');
  END IF;

  -- Verify player is in squad
  SELECT * INTO v_squad_player FROM public.squad_players
  WHERE auction_id = p_auction_id AND player_id = p_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_PLAYER_NOT_IN_SQUAD');
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE id = v_squad_player.team_id FOR UPDATE;
  SELECT * INTO v_player FROM public.players WHERE id = p_player_id;
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;

  -- Caller must be team owner or room host
  IF auth.uid() IS NULL OR (v_team.user_id != auth.uid() AND v_room.host_id != auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  -- Delete from active squad
  DELETE FROM public.squad_players WHERE id = v_squad_player.id;

  -- Refund purse and decrement counts
  UPDATE public.teams
  SET purse = purse + v_squad_player.purchase_price,
      players_bought = players_bought - 1,
      overseas_count = overseas_count - (CASE WHEN v_player.is_overseas THEN 1 ELSE 0 END)
  WHERE id = v_team.id;

  -- Record audit log
  INSERT INTO public.player_releases (auction_id, team_id, player_id, refund_amount, released_at)
  VALUES (p_auction_id, v_team.id, p_player_id, v_squad_player.purchase_price, v_now);

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id,
    'team_id', v_team.id,
    'refund_amount', v_squad_player.purchase_price,
    'new_purse', v_team.purse + v_squad_player.purchase_price
  );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 7. RPC: v3_start_mini_selection (HOST ONLY)
CREATE OR REPLACE FUNCTION public.v3_start_mini_selection(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_session public.mini_auction_sessions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_expires_at TIMESTAMPTZ := clock_timestamp() + INTERVAL '60 seconds';
BEGIN
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  IF auth.uid() IS NULL OR v_room.host_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status = 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object('success', true, 'status', v_session.status, 'selection_expires_at', v_session.selection_expires_at, 'already_open', true);
  END IF;

  IF v_session.status != 'SETUP' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_SESSION_STATUS');
  END IF;

  UPDATE public.mini_auction_sessions
  SET status = 'SELECTION_OPEN',
      selection_expires_at = v_expires_at,
      updated_at = v_now
  WHERE id = v_session.id;

  RETURN jsonb_build_object('success', true, 'status', 'SELECTION_OPEN', 'selection_expires_at', v_expires_at);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 8. RPC: v3_toggle_mini_selection (EXPLICIT ADVISORY LOCK & DESIRED STATE OVERRIDE)
CREATE OR REPLACE FUNCTION public.v3_toggle_mini_selection(
  p_auction_id UUID,
  p_player_id UUID,
  p_desired_state BOOLEAN DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_participant public.room_participants%ROWTYPE;
  v_team_status public.mini_auction_team_status%ROWTYPE;
  v_existing_selection public.mini_auction_selections%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_should_select BOOLEAN;
BEGIN
  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status != 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_CLOSED');
  END IF;

  IF v_session.selection_expires_at IS NULL OR v_now >= v_session.selection_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_WINDOW_EXPIRED');
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE auction_id = p_auction_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    SELECT * INTO v_participant FROM public.room_participants rp
    JOIN public.auctions a ON a.room_id = rp.room_id
    WHERE a.id = p_auction_id AND rp.user_id = auth.uid();
    
    IF FOUND AND v_participant.team_id IS NOT NULL THEN
      SELECT * INTO v_team FROM public.teams WHERE id = v_participant.team_id;
    END IF;
  END IF;

  IF v_team.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_NOT_FOUND');
  END IF;

  SELECT * INTO v_team_status FROM public.mini_auction_team_status
  WHERE auction_id = p_auction_id AND team_id = v_team.id;
  IF FOUND AND v_team_status.has_confirmed THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ALREADY_CONFIRMED');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_auction_id::text || v_team.id::text || p_player_id::text));

  SELECT * INTO v_existing_selection FROM public.mini_auction_selections
  WHERE auction_id = p_auction_id AND team_id = v_team.id AND player_id = p_player_id;

  IF p_desired_state IS NOT NULL THEN
    v_should_select := p_desired_state;
  ELSE
    v_should_select := (v_existing_selection.id IS NULL);
  END IF;

  IF v_should_select THEN
    IF v_existing_selection.id IS NULL THEN
      INSERT INTO public.mini_auction_selections (auction_id, team_id, player_id, created_at)
      VALUES (p_auction_id, v_team.id, p_player_id, v_now);
    END IF;
    RETURN jsonb_build_object('success', true, 'selected', true, 'player_id', p_player_id);
  ELSE
    IF v_existing_selection.id IS NOT NULL THEN
      DELETE FROM public.mini_auction_selections
      WHERE id = v_existing_selection.id;
    END IF;
    RETURN jsonb_build_object('success', true, 'selected', false, 'player_id', p_player_id);
  END IF;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 9. RPC: v3_confirm_mini_selections
CREATE OR REPLACE FUNCTION public.v3_confirm_mini_selections(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_participant public.room_participants%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status != 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_CLOSED');
  END IF;

  IF v_session.selection_expires_at IS NULL OR v_now >= v_session.selection_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_WINDOW_EXPIRED');
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE auction_id = p_auction_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    SELECT * INTO v_participant FROM public.room_participants rp
    JOIN public.auctions a ON a.room_id = rp.room_id
    WHERE a.id = p_auction_id AND rp.user_id = auth.uid();
    
    IF FOUND AND v_participant.team_id IS NOT NULL THEN
      SELECT * INTO v_team FROM public.teams WHERE id = v_participant.team_id;
    END IF;
  END IF;

  IF v_team.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_NOT_FOUND');
  END IF;

  INSERT INTO public.mini_auction_team_status (auction_id, team_id, has_confirmed, confirmed_at, updated_at)
  VALUES (p_auction_id, v_team.id, true, v_now, v_now)
  ON CONFLICT (auction_id, team_id)
  DO UPDATE SET has_confirmed = true, confirmed_at = v_now, updated_at = v_now;

  RETURN jsonb_build_object('success', true, 'team_id', v_team.id, 'has_confirmed', true);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 10. RPC: v3_close_mini_selection (HANDLES ZERO LOT COMPLETION ATOMICALLY)
CREATE OR REPLACE FUNCTION public.v3_close_mini_selection(
  p_auction_id UUID,
  p_force BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
  v_session public.mini_auction_sessions%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_is_service_role BOOLEAN := (current_setting('role', true) = 'service_role');
  v_max_lot_index INT;
  v_selected_player_id UUID;
  v_player public.players%ROWTYPE;
  v_count INT := 0;
BEGIN
  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', true, 'status', 'COMPLETED', 'total_lots', v_session.total_lots, 'already_completed', true);
  END IF;

  IF v_session.status = 'SELECTION_CLOSED' THEN
    RETURN jsonb_build_object('success', true, 'status', 'SELECTION_CLOSED', 'total_lots', v_session.total_lots, 'already_closed', true);
  END IF;

  IF v_session.status != 'SELECTION_OPEN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_SESSION_STATUS');
  END IF;

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;

  -- Caller check: service_role or room host
  IF NOT v_is_service_role AND (auth.uid() IS NULL OR v_room.host_id != auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  -- Timer check: non-service-role callers CANNOT force early close
  IF NOT v_is_service_role OR NOT p_force THEN
    IF v_session.selection_expires_at IS NULL OR v_now < v_session.selection_expires_at THEN
      RETURN jsonb_build_object('success', false, 'error', 'ERR_SELECTION_WINDOW_ACTIVE');
    END IF;
  END IF;

  -- Fetch maximum existing lot index
  SELECT COALESCE(MAX(lot_index), 0) INTO v_max_lot_index
  FROM public.auction_lots WHERE auction_id = p_auction_id;

  -- Iterate through distinct nominated players
  FOR v_selected_player_id IN
    SELECT DISTINCT player_id FROM public.mini_auction_selections
    WHERE auction_id = p_auction_id
  LOOP
    SELECT * INTO v_player FROM public.players WHERE id = v_selected_player_id;
    IF FOUND THEN
      v_count := v_count + 1;
      INSERT INTO public.auction_lots (
        auction_id,
        player_id,
        lot_index,
        status,
        base_price,
        current_bid,
        is_mini_round,
        timer_duration_seconds
      ) VALUES (
        p_auction_id,
        v_selected_player_id,
        v_max_lot_index + v_count,
        'PENDING',
        GREATEST(1, FLOOR(v_player.base_price * 0.80)),
        GREATEST(1, FLOOR(v_player.base_price * 0.80)),
        true,
        COALESCE(v_room.timer_duration_seconds, 15)
      );
    END IF;
  END LOOP;

  -- ZERO-LOT PATH: complete immediately and atomically
  IF v_count = 0 THEN
    UPDATE public.mini_auction_sessions
    SET status = 'COMPLETED',
        total_lots = 0,
        closed_at = v_now,
        completed_at = v_now,
        updated_at = v_now
    WHERE id = v_session.id;

    RETURN jsonb_build_object('success', true, 'status', 'COMPLETED', 'total_lots', 0);
  END IF;

  -- NORMAL LOT PATH: transition to SELECTION_CLOSED for review
  UPDATE public.mini_auction_sessions
  SET status = 'SELECTION_CLOSED',
      total_lots = v_count,
      closed_at = v_now,
      updated_at = v_now
  WHERE id = v_session.id;

  RETURN jsonb_build_object('success', true, 'status', 'SELECTION_CLOSED', 'total_lots', v_count);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 11. RPC: v3_start_mini_auction (HOST ONLY)
CREATE OR REPLACE FUNCTION public.v3_start_mini_auction(p_auction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_session public.mini_auction_sessions%ROWTYPE;
  v_first_mini_lot public.auction_lots%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_get_ready_expires_at TIMESTAMPTZ := clock_timestamp() + INTERVAL '5 seconds';
BEGIN
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_AUCTION_NOT_FOUND');
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = v_auction.room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_ROOM_NOT_FOUND');
  END IF;

  IF auth.uid() IS NULL OR v_room.host_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');
  END IF;

  SELECT * INTO v_session FROM public.mini_auction_sessions WHERE auction_id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_SESSION_NOT_FOUND');
  END IF;

  IF v_session.status != 'SELECTION_CLOSED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_SESSION_STATUS');
  END IF;

  IF v_session.total_lots = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NO_MINI_LOTS');
  END IF;

  SELECT * INTO v_first_mini_lot FROM public.auction_lots
  WHERE auction_id = p_auction_id AND is_mini_round = true AND status = 'PENDING'
  ORDER BY lot_index ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NO_PENDING_MINI_LOTS');
  END IF;

  UPDATE public.auction_lots
  SET status = 'GET_READY',
      get_ready_expires_at = v_get_ready_expires_at,
      timer_expires_at = NULL,
      current_bid = base_price,
      highest_bidder_team_id = NULL
  WHERE id = v_first_mini_lot.id;

  UPDATE public.auctions
  SET status = 'IN_PROGRESS',
      current_lot_id = v_first_mini_lot.id,
      current_lot_index = v_first_mini_lot.lot_index
  WHERE id = p_auction_id;

  UPDATE public.mini_auction_sessions
  SET status = 'BIDDING',
      updated_at = v_now
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'BIDDING',
    'first_lot_id', v_first_mini_lot.id,
    'lot_index', v_first_mini_lot.lot_index,
    'get_ready_expires_at', v_get_ready_expires_at
  );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;


-- 12. COMPLETION TRIGGER BRIDGE
CREATE OR REPLACE FUNCTION public.trg_auction_completed_mini_bridge()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.mini_auction_sessions
  SET status = 'COMPLETED',
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE auction_id = NEW.id
    AND status = 'BIDDING';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_auction_completed_mini_bridge ON public.auctions;
CREATE TRIGGER trg_auction_completed_mini_bridge
AFTER UPDATE OF status ON public.auctions
FOR EACH ROW
WHEN (NEW.status = 'COMPLETED')
EXECUTE FUNCTION public.trg_auction_completed_mini_bridge();

COMMIT;
