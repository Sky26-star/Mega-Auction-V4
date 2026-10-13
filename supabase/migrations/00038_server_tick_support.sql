-- Migration: 00038_server_tick_support.sql
-- Description: Ensures teams table is included in Supabase Realtime publication to sync server-side bot bids' purse deductions to connected clients.

DO $$
BEGIN
  -- Set REPLICA IDENTITY FULL to ensure old/new record payloads are broadcast
  EXECUTE 'ALTER TABLE public.teams REPLICA IDENTITY FULL';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Replica identity update skipped or failed: %', SQLERRM;
END $$;

-- Enable Realtime publication for key tables if publication exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- Already added
  WHEN OTHERS THEN
    RAISE NOTICE 'Realtime publication alteration note: %', SQLERRM;
END $$;
