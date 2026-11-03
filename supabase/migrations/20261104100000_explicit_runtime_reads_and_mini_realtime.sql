-- Supply runtime reads explicitly instead of relying on legacy Supabase
-- default grants. Preserve all existing RLS expressions and RPC write paths.
BEGIN;

DO $preflight$
DECLARE
  relation regclass;
BEGIN
  FOREACH relation IN ARRAY ARRAY[
    'public.profiles'::regclass, 'public.rooms'::regclass,
    'public.room_participants'::regclass, 'public.player_sets'::regclass,
    'public.players'::regclass, 'public.auctions'::regclass,
    'public.teams'::regclass, 'public.auction_lots'::regclass,
    'public.squad_players'::regclass, 'public.bids'::regclass,
    'public.auction_events'::regclass, 'public.bot_lot_state'::regclass,
    'public.mini_auction_sessions'::regclass,
    'public.mini_auction_selections'::regclass,
    'public.mini_auction_team_status'::regclass,
    'public.player_releases'::regclass, 'public.trades'::regclass,
    'public.trade_logs'::regclass, 'public.clerk_user_mappings'::regclass,
    'public.player_set_players'::regclass
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid = relation AND c.relowner = 'postgres'::regrole
        AND c.relrowsecurity AND NOT c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'Expected postgres-owned application table with RLS: %', relation;
    END IF;

    -- RLS does not protect TRUNCATE. Neither browser clients nor the worker
    -- need maintenance, trigger creation or FK-creation privileges.
    EXECUTE format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE %s FROM PUBLIC, anon, authenticated, service_role',
      relation
    );
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'Required supabase_realtime publication is missing';
  END IF;
END;
$preflight$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES
  FROM PUBLIC, anon, authenticated, service_role;

-- Browser mini-selection and trade hooks, plus server-side mini-expiry reads.
-- Clear old defaults too, so both legacy and modern projects converge on
-- read-only API access. Mutations remain owned RPCs.
REVOKE ALL ON TABLE
  public.mini_auction_sessions,
  public.mini_auction_selections,
  public.mini_auction_team_status,
  public.player_releases,
  public.trades,
  public.trade_logs
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.mini_auction_sessions,
  public.mini_auction_selections,
  public.mini_auction_team_status,
  public.player_releases,
  public.trades,
  public.trade_logs
TO authenticated, service_role;

-- The hook filters by auction_id, including when a selection is deleted.
ALTER TABLE public.mini_auction_selections REPLICA IDENTITY FULL;
ALTER TABLE public.mini_auction_team_status REPLICA IDENTITY FULL;

DO $publication$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['mini_auction_selections', 'mini_auction_team_status'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = relation
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', relation);
    END IF;
  END LOOP;
END;
$publication$;

COMMIT;
