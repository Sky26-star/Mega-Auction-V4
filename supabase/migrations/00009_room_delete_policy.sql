-- Migration: 00009_room_delete_policy.sql
-- Description: Add RLS DELETE Policy for public.rooms and Security Definer delete_room RPC
-- Target Database: PostgreSQL 15+ (Supabase)

-- 1. RLS Policy for Room Hosts to Delete Their Own Rooms
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'rooms' AND policyname = 'Host can delete own room'
  ) THEN
    CREATE POLICY "Host can delete own room" ON public.rooms
      FOR DELETE USING (auth.uid() = host_id);
  END IF;
END $$;

-- 2. Trusted SECURITY DEFINER RPC for Atomic Room Deletion
CREATE OR REPLACE FUNCTION public.delete_room(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id UUID;
BEGIN
  -- Verify Caller Authentication
  IF auth.role() != 'authenticated' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: User must be authenticated to delete a room';
  END IF;

  -- Verify Room Ownership
  SELECT id INTO v_room_id
  FROM public.rooms
  WHERE id = p_room_id AND host_id = auth.uid();

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NOT_HOST: Only the room host can delete this room';
  END IF;

  -- Delete Room (Triggers SQL ON DELETE CASCADE across auctions, teams, room_participants)
  DELETE FROM public.rooms WHERE id = p_room_id AND host_id = auth.uid();

  RETURN jsonb_build_object('success', true, 'room_id', p_room_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_room(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_room(UUID) TO authenticated, service_role;
