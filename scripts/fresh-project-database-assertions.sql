-- Executed only by check-fresh-project-database.mjs in its guarded container.
BEGIN;
CREATE FUNCTION pg_temp.assert_fresh(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Fresh-project assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_fresh(boolean, text) TO authenticated, service_role;

SELECT pg_temp.assert_fresh(
  NOT has_function_privilege('service_role', 'public.resolve_user_id()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.resolve_user_id()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.resolve_user_id()', 'EXECUTE'),
  'temporary resolver compatibility grant is absent after final hardening'
);
SELECT pg_temp.assert_fresh(
  NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
    AND NOT has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE'),
  'profile trigger and administrator flag remain protected'
);

DO $$
DECLARE
  relation text;
  actor text;
  privilege text;
BEGIN
  FOR relation IN SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' LOOP
    FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      FOREACH privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
        PERFORM pg_temp.assert_fresh(
          NOT has_table_privilege(actor, 'public.' || relation, privilege),
          actor || ' cannot ' || privilege || ' ' || relation
        );
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH relation IN ARRAY ARRAY[
    'mini_auction_sessions', 'mini_auction_selections', 'mini_auction_team_status',
    'player_releases', 'trades', 'trade_logs'
  ] LOOP
    FOREACH actor IN ARRAY ARRAY['authenticated', 'service_role'] LOOP
      PERFORM pg_temp.assert_fresh(has_table_privilege(actor, 'public.' || relation, 'SELECT'), actor || ' can read ' || relation);
      FOREACH privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
        PERFORM pg_temp.assert_fresh(NOT has_table_privilege(actor, 'public.' || relation, privilege), actor || ' has no direct ' || privilege || ' on ' || relation);
      END LOOP;
    END LOOP;
    PERFORM pg_temp.assert_fresh(NOT has_table_privilege('anon', 'public.' || relation, 'SELECT'), 'anonymous cannot read ' || relation);
  END LOOP;
END;
$$;

-- Verify defaults on an actual future table; roll it back with all fixtures.
CREATE TABLE public.fresh_default_probe(id integer);
SELECT pg_temp.assert_fresh(
  NOT has_table_privilege('anon', 'public.fresh_default_probe', 'TRUNCATE')
    AND NOT has_table_privilege('authenticated', 'public.fresh_default_probe', 'TRIGGER')
    AND NOT has_table_privilege('service_role', 'public.fresh_default_probe', 'MAINTAIN'),
  'future tables do not inherit API maintenance privileges'
);

SELECT pg_temp.assert_fresh(
  (SELECT count(*) = 2 FROM pg_catalog.pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
     AND tablename IN ('mini_auction_selections', 'mini_auction_team_status'))
    AND (SELECT bool_and(relreplident = 'f') FROM pg_catalog.pg_class
         WHERE oid IN ('public.mini_auction_selections'::regclass, 'public.mini_auction_team_status'::regclass)),
  'both mini subscriptions are published with full replica identity'
);

-- Two room identities and an unrelated account: verify real RLS, not just ACLs.
INSERT INTO auth.users(id, email) VALUES
  ('71000000-0000-0000-0000-000000000001', 'fresh-host@example.invalid'),
  ('71000000-0000-0000-0000-000000000002', 'fresh-outsider@example.invalid');
INSERT INTO public.rooms(id, code, name, host_id) VALUES
  ('72000000-0000-0000-0000-000000000001', 'FRESH1', 'Isolated compatibility fixture', '71000000-0000-0000-0000-000000000001');
INSERT INTO public.auctions(id, room_id, player_set_id) VALUES
  ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000202');
INSERT INTO public.teams(id, auction_id, name, short_name, purse, initial_purse) VALUES
  ('74000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'Human One', 'ONE', 10000, 10000),
  ('74000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000001', 'Human Two', 'TWO', 10000, 10000);
INSERT INTO public.room_participants(room_id, user_id, team_id, role) VALUES
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001', 'HOST');
INSERT INTO public.mini_auction_sessions(auction_id) VALUES ('73000000-0000-0000-0000-000000000001');
INSERT INTO public.mini_auction_team_status(auction_id, team_id) VALUES
  ('73000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001');
INSERT INTO public.mini_auction_selections(auction_id, team_id, player_id)
SELECT '73000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001', id
FROM public.players WHERE player_set_id = '00000000-0000-0000-0000-000000000202' ORDER BY id LIMIT 1;
INSERT INTO public.player_releases(auction_id, team_id, player_id, refund_amount)
SELECT auction_id, team_id, player_id, 100 FROM public.mini_auction_selections;
INSERT INTO public.trades(id, auction_id, room_id, proposer_team_id, receiver_team_id, proposer_player_ids, receiver_player_ids)
SELECT '75000000-0000-0000-0000-000000000001', auction_id, '72000000-0000-0000-0000-000000000001',
  team_id, '74000000-0000-0000-0000-000000000002', ARRAY[player_id], ARRAY[player_id]
FROM public.mini_auction_selections;
INSERT INTO public.trade_logs(trade_id, auction_id, action)
VALUES ('75000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'PROPOSED');

SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_fresh((SELECT count(*) = 1 FROM public.mini_auction_sessions), 'member reads mini session');
SELECT pg_temp.assert_fresh((SELECT count(*) = 1 FROM public.mini_auction_selections), 'member reads mini nominations');
SELECT pg_temp.assert_fresh((SELECT count(*) = 1 FROM public.mini_auction_team_status), 'member reads mini confirmation');
SELECT pg_temp.assert_fresh((SELECT count(*) = 1 FROM public.player_releases), 'member reads releases');
SELECT pg_temp.assert_fresh((SELECT count(*) = 1 FROM public.trades), 'member reads trade');
SELECT pg_temp.assert_fresh((SELECT count(*) = 1 FROM public.trade_logs), 'member reads trade log');
DO $$ BEGIN
  BEGIN
    UPDATE public.mini_auction_team_status SET has_confirmed = true;
    RAISE EXCEPTION 'Unexpected direct mini write';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_fresh((SELECT count(*) = 0 FROM public.mini_auction_sessions), 'outsider cannot read mini session');
SELECT pg_temp.assert_fresh((SELECT count(*) = 0 FROM public.mini_auction_selections), 'outsider cannot read nominations');
SELECT pg_temp.assert_fresh((SELECT count(*) = 0 FROM public.mini_auction_team_status), 'outsider cannot read confirmations');
SELECT pg_temp.assert_fresh((SELECT count(*) = 0 FROM public.player_releases), 'outsider cannot read releases');
SELECT pg_temp.assert_fresh((SELECT count(*) = 0 FROM public.trades), 'outsider cannot read trades');
SELECT pg_temp.assert_fresh((SELECT count(*) = 0 FROM public.trade_logs), 'outsider cannot read trade logs');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_fresh((SELECT count(*) = 1 FROM public.mini_auction_sessions), 'worker reads mini expiry without a human identity');
RESET ROLE;
ROLLBACK;
