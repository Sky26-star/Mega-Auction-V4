-- Migration: 00046_mini_auction_rls.sql
-- Description: Enable Row Level Security on mini auction tables (mini_auction_sessions,
-- mini_auction_selections, mini_auction_team_status, player_releases).
-- Pattern: Matches existing tables (auction_lots, squad_players) — SELECT for room
-- participants only; no direct INSERT/UPDATE/DELETE for authenticated role.
-- All writes go through SECURITY DEFINER RPCs exclusively.

BEGIN;

-- ============================================================
-- 1. mini_auction_sessions
-- ============================================================
ALTER TABLE public.mini_auction_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Mini sessions viewable by room participants"
ON public.mini_auction_sessions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.auctions a
    WHERE a.id = mini_auction_sessions.auction_id
      AND is_room_participant(a.room_id, auth.uid())
  )
);
-- No INSERT/UPDATE/DELETE policies — all writes via SECURITY DEFINER RPCs only.

-- ============================================================
-- 2. mini_auction_selections
-- ============================================================
ALTER TABLE public.mini_auction_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Mini selections viewable by room participants"
ON public.mini_auction_selections FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.auctions a
    WHERE a.id = mini_auction_selections.auction_id
      AND is_room_participant(a.room_id, auth.uid())
  )
);
-- No INSERT/UPDATE/DELETE policies — all writes via SECURITY DEFINER RPCs only.

-- ============================================================
-- 3. mini_auction_team_status
-- ============================================================
ALTER TABLE public.mini_auction_team_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Mini team status viewable by room participants"
ON public.mini_auction_team_status FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.auctions a
    WHERE a.id = mini_auction_team_status.auction_id
      AND is_room_participant(a.room_id, auth.uid())
  )
);
-- No INSERT/UPDATE/DELETE policies — all writes via SECURITY DEFINER RPCs only.

-- ============================================================
-- 4. player_releases
-- ============================================================
ALTER TABLE public.player_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Player releases viewable by room participants"
ON public.player_releases FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.auctions a
    WHERE a.id = player_releases.auction_id
      AND is_room_participant(a.room_id, auth.uid())
  )
);
-- No INSERT/UPDATE/DELETE policies — all writes via SECURITY DEFINER RPCs only.

COMMIT;
