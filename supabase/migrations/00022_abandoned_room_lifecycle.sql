-- Migration: 00022_abandoned_room_lifecycle.sql
-- Description: Production-Quality Abandoned Room Lifecycle & Safe Auto-Cleanup for Mega Auction
-- 1. Add last_activity_at column to public.rooms
-- 2. Extend rooms.status check constraint to include 'EXPIRED'
-- 3. Touch room activity function for meaningful interactions
-- 4. Authoritative PL/pgSQL function: mark_abandoned_rooms_expired
-- 5. Authoritative PL/pgSQL function: cleanup_expired_abandoned_rooms (Guarantees COMPLETED auctions are NEVER touched)

BEGIN;

-- 1. Add last_activity_at column if not exists
ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Update status check constraint to include 'EXPIRED'
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('OPEN', 'LOCKED', 'COMPLETED', 'CANCELLED', 'EXPIRED'));

-- 3. Touch activity helper function
CREATE OR REPLACE FUNCTION public.touch_room_activity(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.rooms
  SET last_activity_at = NOW(),
      updated_at = NOW()
  WHERE id = p_room_id AND status = 'OPEN';
END;
$$;

-- 4. Mark Abandoned Rooms Expired (Authoritative & Idempotent)
-- Only targets WAITING (status = 'OPEN') rooms with NO active or completed auction that have been inactive
CREATE OR REPLACE FUNCTION public.mark_abandoned_rooms_expired(
  p_inactivity_hours INT DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - (p_inactivity_hours || ' hours')::INTERVAL;
  v_marked_count INT := 0;
  v_room_record RECORD;
BEGIN
  FOR v_room_record IN
    SELECT r.id
    FROM public.rooms r
    WHERE r.status = 'OPEN'
      AND r.last_activity_at < v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.auctions a
        WHERE a.room_id = r.id AND a.status IN ('IN_PROGRESS', 'PAUSED', 'COMPLETED')
      )
    FOR UPDATE OF r
  LOOP
    UPDATE public.rooms
    SET status = 'EXPIRED',
        updated_at = NOW()
    WHERE id = v_room_record.id;
    v_marked_count := v_marked_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'marked_count', v_marked_count,
    'cutoff', v_cutoff,
    'inactivity_hours', p_inactivity_hours
  );
END;
$$;

-- 5. Safe Cleanup Function (HARD GUARD: Never touches rooms with completed auctions or active lots)
CREATE OR REPLACE FUNCTION public.cleanup_expired_abandoned_rooms(
  p_expired_retention_days INT DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - (p_expired_retention_days || ' days')::INTERVAL;
  v_deleted_count INT := 0;
  v_room_record RECORD;
BEGIN
  FOR v_room_record IN
    SELECT r.id
    FROM public.rooms r
    WHERE r.status = 'EXPIRED'
      AND r.updated_at < v_cutoff
      -- ABSOLUTE SAFETY GUARD: Never delete if room has ANY auction records
      AND NOT EXISTS (
        SELECT 1 FROM public.auctions a WHERE a.room_id = r.id
      )
    FOR UPDATE OF r
  LOOP
    DELETE FROM public.rooms WHERE id = v_room_record.id;
    v_deleted_count := v_deleted_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'cutoff', v_cutoff,
    'retention_days', p_expired_retention_days
  );
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.touch_room_activity(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_rooms_expired(INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_abandoned_rooms(INT) TO authenticated, service_role;

COMMIT;
