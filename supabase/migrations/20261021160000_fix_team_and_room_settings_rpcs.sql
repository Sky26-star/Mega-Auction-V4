-- Migration: 20261021160000_fix_team_and_room_settings_rpcs.sql
-- Description: Implement update_my_team, remove_room_participant, update_room_settings RPCs and host lot update policy for Clerk & Mega Auction V4

-- 1. RPC: update_my_team
CREATE OR REPLACE FUNCTION public.update_my_team(
  p_team_id uuid,
  p_team_name text,
  p_team_short_name text,
  p_team_color text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := public.resolve_user_id();
  v_team RECORD;
  v_participant RECORD;
  v_auction RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated to update team identity';
  END IF;

  -- Validate Name
  IF length(trim(p_team_name)) < 2 THEN
    RAISE EXCEPTION 'INVALID_TEAM_NAME: Team name must be at least 2 characters';
  END IF;
  IF length(trim(p_team_name)) > 30 THEN
    RAISE EXCEPTION 'INVALID_TEAM_NAME: Team name cannot exceed 30 characters';
  END IF;

  -- Validate Short Name
  IF length(trim(p_team_short_name)) < 2 OR length(trim(p_team_short_name)) > 5 THEN
    RAISE EXCEPTION 'INVALID_SHORT_NAME: Short name must be between 2 and 5 characters';
  END IF;

  -- Validate Color Hex
  IF p_team_color !~* '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'INVALID_COLOR: Team color must be a valid 6-digit hex code (e.g. #FF5733)';
  END IF;

  -- Find team
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
  IF v_team IS NULL THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND: Team not found';
  END IF;

  -- Verify ownership: Caller must be the assigned participant of this team
  SELECT rp.* INTO v_participant
  FROM public.room_participants rp
  JOIN public.auctions a ON a.room_id = rp.room_id
  WHERE a.id = v_team.auction_id
    AND rp.user_id = v_user_id
    AND rp.team_id = p_team_id;

  IF v_participant IS NULL THEN
    RAISE EXCEPTION 'NOT_TEAM_OWNER: You do not own this team';
  END IF;

  -- Verify auction is in LOBBY (freeze identity once live)
  SELECT * INTO v_auction FROM public.auctions WHERE id = v_team.auction_id;
  IF v_auction IS NULL OR v_auction.status != 'LOBBY' THEN
    RAISE EXCEPTION 'AUCTION_NOT_LOBBY: Team identity cannot be changed after the auction starts';
  END IF;

  -- Enforce uniqueness of short code within the room
  IF EXISTS (
    SELECT 1 FROM public.teams
    WHERE auction_id = v_team.auction_id
      AND id != p_team_id
      AND upper(trim(short_name)) = upper(trim(p_team_short_name))
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_SHORT_NAME: A team with this short code already exists in this auction room. Please choose a different code.';
  END IF;

  -- Update ONLY identity columns
  UPDATE public.teams
  SET
    name = trim(p_team_name),
    short_name = upper(trim(p_team_short_name)),
    color = trim(p_team_color)
  WHERE id = p_team_id;

  RETURN jsonb_build_object(
    'success', true,
    'team_id', p_team_id,
    'name', trim(p_team_name),
    'short_name', upper(trim(p_team_short_name)),
    'color', trim(p_team_color)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_team(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_team(uuid, text, text, text) TO authenticated, service_role, anon;

-- 2. RPC: remove_room_participant
CREATE OR REPLACE FUNCTION public.remove_room_participant(p_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := public.resolve_user_id();
  v_participant RECORD;
  v_room RECORD;
  v_auction RECORD;
  v_removed_team_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated';
  END IF;

  SELECT * INTO v_participant
  FROM public.room_participants
  WHERE id = p_participant_id;

  IF v_participant IS NULL THEN
    RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND: Participant not found';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_participant.room_id;

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND: Room not found';
  END IF;

  -- Authorization — only self or host
  IF v_participant.user_id != v_user_id AND v_room.host_id != v_user_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only the participant or the room host can remove';
  END IF;

  -- Host cannot be removed
  IF v_participant.role = 'HOST' THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_HOST: The host cannot be removed from the room';
  END IF;

  -- Verify auction is not active
  SELECT * INTO v_auction
  FROM public.auctions
  WHERE room_id = v_room.id;

  IF v_auction IS NOT NULL AND v_auction.status != 'LOBBY' THEN
    RAISE EXCEPTION 'AUCTION_ACTIVE: Participant removal is only allowed while the auction is in LOBBY state';
  END IF;

  v_removed_team_id := v_participant.team_id;

  IF v_removed_team_id IS NOT NULL THEN
    DELETE FROM public.teams WHERE id = v_removed_team_id;
  END IF;

  DELETE FROM public.room_participants WHERE id = p_participant_id;

  RETURN jsonb_build_object(
    'success', true,
    'removed_participant_id', p_participant_id,
    'removed_user_id', v_participant.user_id,
    'removed_team_id', v_removed_team_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_room_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_room_participant(uuid) TO authenticated, service_role, anon;

-- 3. RPC: update_room_settings
CREATE OR REPLACE FUNCTION public.update_room_settings(
  p_room_id uuid,
  p_room_name text,
  p_room_settings jsonb,
  p_default_purse int,
  p_timer_duration_seconds int,
  p_max_squad_size int,
  p_bots jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := public.resolve_user_id();
  v_room RECORD;
  v_auction RECORD;
  v_purse_lakhs INT;
  v_bot_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: User must be authenticated to update room settings';
  END IF;

  IF length(trim(p_room_name)) < 3 THEN
    RAISE EXCEPTION 'INVALID_ROOM_NAME: Room name must be at least 3 characters';
  END IF;
  IF length(trim(p_room_name)) > 50 THEN
    RAISE EXCEPTION 'INVALID_ROOM_NAME: Room name cannot exceed 50 characters';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id;

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND: Room not found';
  END IF;

  IF v_room.host_id != v_user_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only the room host can edit room settings';
  END IF;

  IF v_room.status != 'OPEN' THEN
    RAISE EXCEPTION 'NOT_IN_LOBBY: Cannot edit settings after auction has started';
  END IF;

  SELECT * INTO v_auction
  FROM public.auctions
  WHERE room_id = p_room_id;

  IF v_auction IS NOT NULL AND v_auction.status != 'LOBBY' THEN
    RAISE EXCEPTION 'NOT_IN_LOBBY: Cannot edit settings after auction has started';
  END IF;

  -- Normalize purse to Lakhs (if <= 1000, Crores -> Lakhs e.g. 100 -> 10000)
  v_purse_lakhs := p_default_purse;
  IF v_purse_lakhs <= 1000 THEN
    v_purse_lakhs := v_purse_lakhs * 100;
  END IF;

  -- 1. Update Room Record
  UPDATE public.rooms
  SET
    name = trim(p_room_name),
    settings = p_room_settings,
    updated_at = NOW()
  WHERE id = p_room_id;

  -- 2. Update Auction Lots & Teams if auction exists
  IF v_auction IS NOT NULL THEN
    -- Update all teams purse and initial_purse in this lobby auction
    UPDATE public.teams
    SET
      purse = v_purse_lakhs,
      initial_purse = v_purse_lakhs
    WHERE auction_id = v_auction.id;

    -- Update timer_duration_seconds for pending lots
    UPDATE public.auction_lots
    SET timer_duration_seconds = p_timer_duration_seconds
    WHERE auction_id = v_auction.id AND status = 'PENDING';
  END IF;

  -- 3. Provision / cleanup bots atomically
  v_bot_count := jsonb_array_length(COALESCE(p_bots, '[]'::jsonb));
  PERFORM public.provision_room_bots(p_room_id, COALESCE(p_bots, '[]'::jsonb));

  RETURN jsonb_build_object(
    'success', true,
    'room_id', p_room_id,
    'name', trim(p_room_name),
    'settings', p_room_settings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_room_settings(uuid, text, jsonb, int, int, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_room_settings(uuid, text, jsonb, int, int, int, jsonb) TO authenticated, service_role, anon;

-- 4. Host UPDATE policy on auction_lots during LOBBY
DROP POLICY IF EXISTS "Host can update auction lots in lobby" ON public.auction_lots;
CREATE POLICY "Host can update auction lots in lobby" ON public.auction_lots
  FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = auction_lots.auction_id
        AND r.host_id = public.resolve_user_id()
        AND r.status = 'OPEN'
        AND a.status = 'LOBBY'
    )
  );
