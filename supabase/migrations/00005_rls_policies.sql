-- Migration: 00005_rls_policies.sql
-- Description: Row Level Security (RLS) policies for all Mega Auction V1 tables

-- Enable RLS on all 12 tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squad_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_lot_state ENABLE ROW LEVEL SECURITY;

-- Helper Function for RLS room membership checks (bypasses RLS recursion)
CREATE OR REPLACE FUNCTION public.is_room_participant(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = p_room_id AND user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_room_participant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_room_participant(UUID, UUID) TO authenticated, service_role;

-- 1. PROFILES POLICIES
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- 2. ROOMS POLICIES
CREATE POLICY "Rooms viewable by authenticated users" ON public.rooms
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create rooms" ON public.rooms
  FOR INSERT WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Host can update room settings" ON public.rooms
  FOR UPDATE USING (auth.uid() = host_id AND status = 'OPEN');

-- 3. ROOM PARTICIPANTS POLICIES
CREATE POLICY "Room participants viewable by room members" ON public.room_participants
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_room_participant(room_id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.rooms r WHERE r.id = room_participants.room_id AND r.host_id = auth.uid()
    )
  );

CREATE POLICY "Users can join rooms" ON public.room_participants
  FOR INSERT WITH CHECK (auth.uid() = user_id OR is_bot = true);

CREATE POLICY "Host can manage room participants" ON public.room_participants
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.rooms r WHERE r.id = room_participants.room_id AND r.host_id = auth.uid()
    )
    OR auth.uid() = user_id
  );

-- 4. PLAYER SETS POLICIES
CREATE POLICY "Public or owned player sets viewable" ON public.player_sets
  FOR SELECT USING (is_public = true OR created_by = auth.uid());

CREATE POLICY "Users can create player sets" ON public.player_sets
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "Owner can update player sets" ON public.player_sets
  FOR UPDATE USING (created_by = auth.uid());

CREATE POLICY "Owner can delete player sets" ON public.player_sets
  FOR DELETE USING (created_by = auth.uid());

-- 5. PLAYERS POLICIES
CREATE POLICY "Players viewable via player set" ON public.players
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.player_sets ps
      WHERE ps.id = players.player_set_id AND (ps.is_public = true OR ps.created_by = auth.uid())
    )
  );

CREATE POLICY "Player set owner can modify players" ON public.players
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.player_sets ps
      WHERE ps.id = players.player_set_id AND ps.created_by = auth.uid()
    )
  );

-- 6. AUCTIONS POLICIES
CREATE POLICY "Auctions viewable by room participants" ON public.auctions
  FOR SELECT USING (
    public.is_room_participant(auctions.room_id, auth.uid())
  );

CREATE POLICY "Host can create auction" ON public.auctions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rooms r WHERE r.id = auctions.room_id AND r.host_id = auth.uid()
    )
  );

-- 7. TEAMS POLICIES
CREATE POLICY "Teams viewable by room participants" ON public.teams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = teams.auction_id AND public.is_room_participant(a.room_id, auth.uid())
    )
  );

-- 8. AUCTION LOTS POLICIES
CREATE POLICY "Auction lots viewable by room participants" ON public.auction_lots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = auction_lots.auction_id AND public.is_room_participant(a.room_id, auth.uid())
    )
  );

-- 9. SQUAD PLAYERS POLICIES
CREATE POLICY "Squad players viewable by room participants" ON public.squad_players
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = squad_players.auction_id AND public.is_room_participant(a.room_id, auth.uid())
    )
  );

-- 10. BIDS POLICIES
CREATE POLICY "Bids viewable by room participants" ON public.bids
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = bids.auction_id AND public.is_room_participant(a.room_id, auth.uid())
    )
  );

-- 11. AUCTION EVENTS POLICIES
CREATE POLICY "Auction events viewable by room participants" ON public.auction_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = auction_events.auction_id AND public.is_room_participant(a.room_id, auth.uid())
    )
  );

-- 12. BOT LOT STATE POLICIES
CREATE POLICY "Bot state viewable by room participants" ON public.bot_lot_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.auction_lots al
      JOIN public.auctions a ON a.id = al.auction_id
      WHERE al.id = bot_lot_state.lot_id AND public.is_room_participant(a.room_id, auth.uid())
    )
  );
