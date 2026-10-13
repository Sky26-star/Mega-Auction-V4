-- Fix remaining RLS policies using auth.uid() that crash Clerk identity resolution in Realtime

-- 1. room_participants
DROP POLICY IF EXISTS "Room participants viewable by room members" ON public.room_participants;
CREATE POLICY "Room participants viewable by room members" ON public.room_participants
  FOR SELECT TO public
  USING (
    user_id = public.resolve_user_id()
    OR is_room_participant(room_id, public.resolve_user_id())
    OR EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id AND r.host_id = public.resolve_user_id()
    )
  );

DROP POLICY IF EXISTS "Users can join rooms" ON public.room_participants;
CREATE POLICY "Users can join rooms" ON public.room_participants
  FOR INSERT TO public
  WITH CHECK (
    user_id = public.resolve_user_id()
    OR is_bot = true
  );

DROP POLICY IF EXISTS "Host can manage room participants" ON public.room_participants;
CREATE POLICY "Host can manage room participants" ON public.room_participants
  FOR ALL TO public
  USING (
    user_id = public.resolve_user_id()
    OR EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id AND r.host_id = public.resolve_user_id()
    )
  );

-- 2. player_sets
DROP POLICY IF EXISTS "Public or owned player sets viewable" ON public.player_sets;
CREATE POLICY "Public or owned player sets viewable" ON public.player_sets
  FOR SELECT TO public
  USING (is_public = true OR created_by = public.resolve_user_id());

DROP POLICY IF EXISTS "Users can create player sets" ON public.player_sets;
CREATE POLICY "Users can create player sets" ON public.player_sets
  FOR INSERT TO public
  WITH CHECK (created_by = public.resolve_user_id());

DROP POLICY IF EXISTS "Owner can update player sets" ON public.player_sets;
CREATE POLICY "Owner can update player sets" ON public.player_sets
  FOR UPDATE TO public
  USING (created_by = public.resolve_user_id());

DROP POLICY IF EXISTS "Owner can delete player sets" ON public.player_sets;
CREATE POLICY "Owner can delete player sets" ON public.player_sets
  FOR DELETE TO public
  USING (created_by = public.resolve_user_id());

-- 3. players
DROP POLICY IF EXISTS "Players viewable via player set" ON public.players;
CREATE POLICY "Players viewable via player set" ON public.players
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.player_sets ps
      WHERE ps.id = players.player_set_id
      AND (ps.is_public = true OR ps.created_by = public.resolve_user_id())
    )
  );

DROP POLICY IF EXISTS "Player set owner can modify players" ON public.players;
CREATE POLICY "Player set owner can modify players" ON public.players
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.player_sets ps
      WHERE ps.id = players.player_set_id
      AND ps.created_by = public.resolve_user_id()
    )
  );

-- 4. auction_lots
DROP POLICY IF EXISTS "Auction lots viewable by room participants" ON public.auction_lots;
CREATE POLICY "Auction lots viewable by room participants" ON public.auction_lots
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = auction_lots.auction_id
      AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );

-- 5. squad_players
DROP POLICY IF EXISTS "Squad players viewable by room participants" ON public.squad_players;
CREATE POLICY "Squad players viewable by room participants" ON public.squad_players
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = squad_players.auction_id
      AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );

-- 6. bids
DROP POLICY IF EXISTS "Bids viewable by room participants" ON public.bids;
CREATE POLICY "Bids viewable by room participants" ON public.bids
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = bids.auction_id
      AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );

-- 7. auction_events
DROP POLICY IF EXISTS "Auction events viewable by room participants" ON public.auction_events;
CREATE POLICY "Auction events viewable by room participants" ON public.auction_events
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = auction_events.auction_id
      AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );

-- 8. bot_lot_state
DROP POLICY IF EXISTS "Bot state viewable by room participants" ON public.bot_lot_state;
CREATE POLICY "Bot state viewable by room participants" ON public.bot_lot_state
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auction_lots al
      JOIN public.auctions a ON a.id = al.auction_id
      WHERE al.id = bot_lot_state.lot_id
      AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );

-- 9. mini_auction_sessions
DROP POLICY IF EXISTS "Mini sessions viewable by room participants" ON public.mini_auction_sessions;
CREATE POLICY "Mini sessions viewable by room participants" ON public.mini_auction_sessions
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = mini_auction_sessions.auction_id
      AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );

-- 10. mini_auction_selections
DROP POLICY IF EXISTS "Mini selections viewable by room participants" ON public.mini_auction_selections;
CREATE POLICY "Mini selections viewable by room participants" ON public.mini_auction_selections
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = mini_auction_selections.auction_id
      AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );

-- 11. mini_auction_team_status
DROP POLICY IF EXISTS "Mini team status viewable by room participants" ON public.mini_auction_team_status;
CREATE POLICY "Mini team status viewable by room participants" ON public.mini_auction_team_status
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = mini_auction_team_status.auction_id
      AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );

-- 12. player_releases
DROP POLICY IF EXISTS "Player releases viewable by room participants" ON public.player_releases;
CREATE POLICY "Player releases viewable by room participants" ON public.player_releases
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      WHERE a.id = player_releases.auction_id
      AND public.is_room_participant(a.room_id, public.resolve_user_id())
    )
  );
