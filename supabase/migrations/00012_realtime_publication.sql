-- Migration: 00012_realtime_publication.sql
-- Description: Ensures core auction tables are included in Supabase Realtime publication and have REPLICA IDENTITY FULL for Postgres Changes streaming

DO $$
BEGIN
  -- Set REPLICA IDENTITY FULL to ensure old/new record payloads are broadcast
  EXECUTE 'ALTER TABLE public.auctions REPLICA IDENTITY FULL';
  EXECUTE 'ALTER TABLE public.auction_lots REPLICA IDENTITY FULL';
  EXECUTE 'ALTER TABLE public.bids REPLICA IDENTITY FULL';
  EXECUTE 'ALTER TABLE public.rooms REPLICA IDENTITY FULL';
  EXECUTE 'ALTER TABLE public.room_participants REPLICA IDENTITY FULL';
  EXECUTE 'ALTER TABLE public.auction_events REPLICA IDENTITY FULL';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Replica identity update skipped or failed: %', SQLERRM;
END $$;

-- Enable Realtime publication for key tables if publication exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auctions;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_lots;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bids;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_participants;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_events;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- Already added
  WHEN OTHERS THEN
    RAISE NOTICE 'Realtime publication alteration note: %', SQLERRM;
END $$;
