-- Migration: 00007_teams_host_rls.sql
-- Description: Add Host INSERT, UPDATE, DELETE RLS Policies on public.teams for Phase 5 Team Management

-- 1. Host can insert teams for their owned auction
CREATE POLICY "Host can insert teams" ON public.teams
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = teams.auction_id
        AND r.host_id = auth.uid()
        AND r.status = 'OPEN'
        AND a.status = 'LOBBY'
    )
  );

-- 2. Host can update teams for their owned auction
CREATE POLICY "Host can update teams" ON public.teams
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = teams.auction_id
        AND r.host_id = auth.uid()
        AND r.status = 'OPEN'
        AND a.status = 'LOBBY'
    )
  );

-- 3. Host can delete teams for their owned auction
CREATE POLICY "Host can delete teams" ON public.teams
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.auctions a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = teams.auction_id
        AND r.host_id = auth.uid()
        AND r.status = 'OPEN'
        AND a.status = 'LOBBY'
    )
  );
