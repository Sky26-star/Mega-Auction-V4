-- Reconcile live schema drift against the reviewed migration baseline.
-- Adds the legacy player-set relation and its missing links, restores the
-- intended team-name uniqueness, pins Clerk profile uniqueness, and removes
-- the profiles -> auth.users FK deliberately dropped by migration 00041.
BEGIN;

CREATE TABLE IF NOT EXISTS public.player_set_players (
  player_id uuid,
  player_set_id uuid
);
ALTER TABLE public.player_set_players ENABLE ROW LEVEL SECURITY;

-- These rows are consumed only by owner-executed SECURITY DEFINER routines.
-- Prevent direct API-role writes (including TRUNCATE, which RLS does not stop).
REVOKE ALL ON TABLE public.player_set_players
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.player_set_players (player_id, player_set_id)
SELECT p.id, p.player_set_id
FROM public.players p
WHERE p.player_set_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.player_set_players psp
    WHERE psp.player_id = p.id
      AND psp.player_set_id = p.player_set_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS clerk_user_mappings_profile_id_key
  ON public.clerk_user_mappings (profile_id);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.clerk_user_mappings'::regclass
      AND conname = 'clerk_user_mappings_profile_id_key'
  ) THEN
    ALTER TABLE public.clerk_user_mappings
      ADD CONSTRAINT clerk_user_mappings_profile_id_key
      UNIQUE USING INDEX clerk_user_mappings_profile_id_key;
  END IF;

  ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_id_fkey;

  IF EXISTS (
    SELECT 1 FROM public.teams
    GROUP BY auction_id, name
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot restore unique_auction_team_name: duplicate team names exist within an auction';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.teams'::regclass
      AND conname = 'unique_auction_team_name'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT unique_auction_team_name UNIQUE (auction_id, name);
  END IF;
END
$migration$;
-- Reassert the reviewed realtime publication state from migration 00012.
ALTER TABLE public.auctions REPLICA IDENTITY FULL;
ALTER TABLE public.auction_lots REPLICA IDENTITY FULL;
ALTER TABLE public.bids REPLICA IDENTITY FULL;
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_participants REPLICA IDENTITY FULL;
ALTER TABLE public.auction_events REPLICA IDENTITY FULL;

DO $publication_repair$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'auctions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.auctions;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'auction_lots') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_lots;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bids') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.bids;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_participants') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.room_participants;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'auction_events') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_events;
    END IF;
  END IF;
END
$publication_repair$;

-- The timing helper is internal and should be callable only by service_role.
REVOKE ALL ON FUNCTION public._get_lot_get_ready_expires_at(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._get_lot_get_ready_expires_at(timestamptz, integer)
  TO service_role;
CREATE OR REPLACE FUNCTION "public"."_process_bid_internal"("p_auction_id" "uuid", "p_team_id" "uuid" DEFAULT NULL::"uuid", "p_amount" integer DEFAULT NULL::integer, "p_request_id" "uuid" DEFAULT NULL::"uuid", "p_is_bot" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
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

CREATE OR REPLACE FUNCTION "public"."advance_lot"("p_auction_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_auction RECORD;
  v_room RECORD;
  v_next_lot RECORD;
  v_cloned_count INT := 0;
  v_timer_sec INT;
  v_timer_expires TIMESTAMPTZ;
  v_next_lot_index INT;
  v_seq INT;
BEGIN
  -- Level 1 Lock: auctions row
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.id = p_auction_id
  FOR UPDATE;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUCTION_NOT_FOUND');
  END IF;

  -- Read room settings for timer duration
  SELECT r.* INTO v_room FROM public.rooms r WHERE r.id = v_auction.room_id;
  v_timer_sec := COALESCE(NULLIF((v_room.settings->>'timer_duration_seconds')::int, 0), 15);

  v_next_lot_index := v_auction.current_lot_index + 1;

  -- Check if next lot exists in sequence with Level 2 lock
  SELECT al.* INTO v_next_lot
  FROM public.auction_lots al
  WHERE al.auction_id = p_auction_id AND al.lot_index = v_next_lot_index
  FOR UPDATE;

  IF v_next_lot.id IS NOT NULL THEN
    v_timer_sec := COALESCE(v_next_lot.timer_duration_seconds, v_timer_sec);
    v_timer_expires := clock_timestamp() + INTERVAL '3 seconds' + (v_timer_sec * INTERVAL '1 second');

    -- Next lot exists: activate with 3-second GET READY transition buffer
    UPDATE public.auctions
    SET current_lot_index = v_next_lot_index,
        current_lot_id = v_next_lot.id
    WHERE id = p_auction_id;

    UPDATE public.auction_lots
    SET status = 'BIDDING',
        timer_duration_seconds = v_timer_sec,
        timer_expires_at = v_timer_expires
    WHERE id = v_next_lot.id;

    PERFORM public.evaluate_bot_interests(p_auction_id, v_next_lot.id);

    v_seq := public._emit_auction_event(
      p_auction_id,
      'LOT_STARTED',
      jsonb_build_object(
        'lot_id', v_next_lot.id,
        'lot_index', v_next_lot_index,
        'player_id', v_next_lot.player_id,
        'base_price', v_next_lot.base_price,
        'timer_expires_at', v_timer_expires,
        'is_unsold_round', v_auction.is_unsold_round
      ),
      NULL
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'LOT_STARTED',
      'current_lot_id', v_next_lot.id,
      'current_lot_index', v_next_lot_index,
      'is_unsold_round', v_auction.is_unsold_round,
      'sequence', v_seq
    );
  END IF;

  -- Current round lots exhausted: check for unsold lots if Round 1
  IF NOT v_auction.is_unsold_round THEN
    -- Set-Based Unsold Lot Cloning for Round 2
    INSERT INTO public.auction_lots (
      id, auction_id, player_id, lot_index, status, base_price, current_bid, timer_duration_seconds, created_at
    )
    SELECT
      gen_random_uuid(),
      p_auction_id,
      al.player_id,
      (v_auction.total_lots + ROW_NUMBER() OVER (ORDER BY al.lot_index ASC) - 1)::int,
      'PENDING',
      GREATEST(1, FLOOR(al.base_price * 0.5)),
      0,
      v_timer_sec,
      NOW()
    FROM public.auction_lots al
    WHERE al.auction_id = p_auction_id AND al.status = 'UNSOLD';

    GET DIAGNOSTICS v_cloned_count = ROW_COUNT;

    IF v_cloned_count > 0 THEN
      UPDATE public.auctions
      SET is_unsold_round = true,
          total_lots = v_auction.total_lots + v_cloned_count
      WHERE id = p_auction_id;

      SELECT al.* INTO v_next_lot
      FROM public.auction_lots al
      WHERE al.auction_id = p_auction_id AND al.lot_index = v_next_lot_index
      FOR UPDATE;

      IF v_next_lot.id IS NOT NULL THEN
        v_timer_expires := clock_timestamp() + INTERVAL '3 seconds' + (v_timer_sec * INTERVAL '1 second');

        UPDATE public.auctions
        SET current_lot_index = v_next_lot.lot_index,
            current_lot_id = v_next_lot.id
        WHERE id = p_auction_id;

        UPDATE public.auction_lots
        SET status = 'BIDDING',
            timer_duration_seconds = v_timer_sec,
            timer_expires_at = v_timer_expires
        WHERE id = v_next_lot.id;

        PERFORM public.evaluate_bot_interests(p_auction_id, v_next_lot.id);

        v_seq := public._emit_auction_event(
          p_auction_id,
          'UNSOLD_ROUND_STARTED',
          jsonb_build_object(
            'cloned_lots', v_cloned_count,
            'current_lot_id', v_next_lot.id,
            'current_lot_index', v_next_lot.lot_index,
            'timer_expires_at', v_timer_expires
          ),
          NULL
        );

        RETURN jsonb_build_object(
          'success', true,
          'status', 'UNSOLD_ROUND_STARTED',
          'current_lot_id', v_next_lot.id,
          'current_lot_index', v_next_lot.lot_index,
          'cloned_lots', v_cloned_count,
          'sequence', v_seq
        );
      END IF;
    END IF;
  END IF;

  -- Auction completed
  UPDATE public.auctions
  SET status = 'COMPLETED',
      completed_at = clock_timestamp()
  WHERE id = p_auction_id;

  UPDATE public.rooms
  SET status = 'COMPLETED',
      updated_at = NOW()
  WHERE id = v_auction.room_id;

  v_seq := public._emit_auction_event(
    p_auction_id,
    'AUCTION_COMPLETED',
    jsonb_build_object(
      'auction_id', p_auction_id,
      'status', 'COMPLETED'
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'AUCTION_COMPLETED',
    'sequence', v_seq
  );
END;
$$;

CREATE OR REPLACE FUNCTION "public"."evaluate_bot_interests"("p_auction_id" "uuid", "p_lot_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_lot RECORD;
  v_player RECORD;
  v_team RECORD;
  v_count INT := 0;
  v_budget INT;
  v_multiplier NUMERIC;
BEGIN
  -- Lock auction lot
  SELECT al.* INTO v_lot
  FROM public.auction_lots al
  WHERE al.id = p_lot_id AND al.auction_id = p_auction_id FOR UPDATE;

  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'LOT_NOT_FOUND');
  END IF;

  -- Fetch player details
  SELECT p.* INTO v_player
  FROM public.players p
  WHERE p.id = v_lot.player_id;

  -- Category budget multipliers
  v_multiplier := CASE v_player.category
    WHEN 'MARQUEE' THEN 0.35
    WHEN 'A' THEN 0.25
    WHEN 'B' THEN 0.18
    WHEN 'C' THEN 0.12
    ELSE 0.08
  END;

  -- Loop through all bot teams in this auction ordered by id
  FOR v_team IN
    SELECT t.* FROM public.teams t
    WHERE t.auction_id = p_auction_id AND t.is_bot = true
    ORDER BY t.id ASC
  LOOP
    -- Calculate max budget ceiling for this player
    v_budget := GREATEST(v_lot.base_price, FLOOR(v_team.initial_purse * v_multiplier));
    v_budget := LEAST(v_budget, v_team.purse);

    INSERT INTO public.bot_lot_state (
      lot_id, team_id, is_interested, max_per_player_budget, has_bid_current_price, updated_at
    )
    VALUES (
      p_lot_id, v_team.id, (v_budget >= v_lot.base_price), v_budget, false, NOW()
    )
    ON CONFLICT (lot_id, team_id) DO UPDATE SET
      max_per_player_budget = EXCLUDED.max_per_player_budget,
      is_interested = EXCLUDED.is_interested,
      updated_at = NOW();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'evaluated_bots', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."process_lot_expiry"("p_auction_id" "uuid", "p_target_lot_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
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
NOTIFY pgrst, 'reload schema';
COMMIT;