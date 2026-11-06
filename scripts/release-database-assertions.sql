-- Native identities: malicious metadata must never grant admin or steal a profile.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
 ('11111111-1111-4111-8111-111111111111', 'release-host@example.invalid', '{"username":"release_owner","display_name":"Host","is_admin":true}'),
 ('22222222-2222-4222-8222-222222222222', 'release-guest@example.invalid', '{"username":"release_owner","full_name":"Guest"}');
SELECT pg_temp.release_assert((SELECT count(*) = 2 FROM public.profiles WHERE id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222') AND NOT is_admin), 'signup creates separate unprivileged profiles');
SELECT pg_temp.release_assert((SELECT username = 'manager_22222222222242228222222222222222' FROM public.profiles WHERE id='22222222-2222-4222-8222-222222222222'), 'duplicate usernames use UUID fallback');
SELECT pg_temp.release_assert(NOT has_column_privilege('authenticated','public.profiles','is_admin','UPDATE'), 'admin column cannot be changed by users');
SELECT pg_temp.release_assert(NOT has_schema_privilege('authenticated','auction_private','USAGE'), 'scheduler schema is private');
SELECT pg_temp.release_assert(NOT has_function_privilege('authenticated','auction_private.dispatch_tick()','EXECUTE'), 'scheduler is not callable by clients');
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='disabled', 'scheduler starts disabled');
SELECT pg_temp.release_assert(NOT auction_private.resume_is_due('bad json'), 'malformed paused reason cannot break cron');

INSERT INTO public.player_sets(id,name,created_by,is_public) VALUES ('33333333-3333-4333-8333-333333333333','Release fixture','11111111-1111-4111-8111-111111111111',true);
INSERT INTO public.players(id,player_set_id,name,role,base_price) VALUES
 ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','Release Batter','BATSMAN',100),
 ('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','Release Bowler','BOWLER',100);

SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.release_assert(public.resolve_user_id()='11111111-1111-4111-8111-111111111111', 'native UUID resolves without Clerk mapping');
SELECT public.create_room_with_team('RLSCHK','Release room','{"max_squad_size":25,"max_overseas":8,"timer_duration_seconds":15}'::jsonb,
 '33333333-3333-4333-8333-333333333333','Host Team','HOST','#C9A227',10000,NULL);
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.join_room_with_team('RLSCHK','Guest Team','GUEST','#C9A227');
RESET ROLE;
SELECT pg_temp.release_assert((SELECT count(*)=2 FROM public.room_participants p JOIN public.rooms r ON r.id=p.room_id WHERE r.code='RLSCHK'), 'native host and guest create/join room');

SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.v3_start_auction((SELECT id FROM public.rooms WHERE code='RLSCHK'));
RESET ROLE;
SELECT pg_temp.release_assert((SELECT count(*)=2 FROM public.auction_lots l JOIN public.auctions a ON a.id=l.auction_id JOIN public.rooms r ON r.id=a.room_id WHERE r.code='RLSCHK'), 'starting auction creates player lots');

-- Exercise the real human bid and sold/unsold lifecycle, not a JS simulation.
UPDATE public.auction_lots SET get_ready_expires_at=now()-interval '1 second' WHERE id IN (SELECT current_lot_id FROM public.auctions);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT public.v3_start_bidding(id,current_lot_id) FROM public.auctions;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.v3_place_bid(a.id,a.current_lot_id,p.team_id,gen_random_uuid(),false)
FROM public.auctions a JOIN public.room_participants p ON p.room_id=a.room_id
WHERE p.user_id='22222222-2222-4222-8222-222222222222';
RESET ROLE;
SELECT pg_temp.release_assert((SELECT count(*)=1 FROM public.bids), 'native guest bid is persisted');
UPDATE public.auction_lots SET timer_expires_at=now()-interval '1 second' WHERE status='BIDDING';
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT public.v3_finalize_and_advance_lot(id,current_lot_id) FROM public.auctions;
RESET ROLE;
SELECT pg_temp.release_assert((SELECT count(*)=1 FROM public.auction_lots WHERE status='SOLD'), 'winning bid is sold');
SELECT pg_temp.release_assert((SELECT count(*)=1 FROM public.squad_players WHERE purchase_price=100), 'sold player reaches squad at persisted price');
SELECT pg_temp.release_assert((SELECT t.purse=9900 AND t.players_bought=1 FROM public.teams t JOIN public.room_participants p ON p.team_id=t.id WHERE p.user_id='22222222-2222-4222-8222-222222222222'), 'sold transition updates purse and roster once');
UPDATE public.auction_lots SET get_ready_expires_at=now()-interval '1 second' WHERE status='GET_READY';
SET LOCAL ROLE service_role;
SELECT public.v3_start_bidding(id,current_lot_id) FROM public.auctions;
RESET ROLE;
UPDATE public.auction_lots SET timer_expires_at=now()-interval '1 second' WHERE status='BIDDING';
SET LOCAL ROLE service_role;
SELECT public.v3_finalize_and_advance_lot(id,current_lot_id) FROM public.auctions;
RESET ROLE;
SELECT pg_temp.release_assert((SELECT count(*)=1 FROM public.auction_lots WHERE status='UNSOLD'), 'next player without a bid becomes unsold');
UPDATE public.auctions SET status='COMPLETED',current_lot_id=NULL;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.v3_initiate_mini_auction(id) FROM public.auctions;
RESET ROLE;
SELECT pg_temp.release_assert((SELECT count(*)=1 FROM public.mini_auction_sessions WHERE status='SETUP'), 'native host can initiate mini auction');

-- Restore an active timer fixture for dispatcher tests below.
UPDATE public.auctions a SET status='IN_PROGRESS',current_lot_id=(SELECT id FROM public.auction_lots l WHERE l.auction_id=a.id ORDER BY lot_index LIMIT 1);
UPDATE public.auction_lots SET status='GET_READY' WHERE id IN (SELECT current_lot_id FROM public.auctions);

-- Due-only dispatch: no idle HTTP traffic, exactly one in-flight request.
UPDATE auction_private.scheduler_state SET enabled=true;
UPDATE public.auction_lots SET get_ready_expires_at=now()+interval '1 minute', timer_expires_at=now()+interval '1 minute' WHERE status IN ('GET_READY','BIDDING');
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='idle', 'future timers do not invoke Vercel');
SELECT pg_temp.release_assert((SELECT count(*)=0 FROM net.release_requests), 'idle HTTP queue is empty');
INSERT INTO vault.decrypted_secrets VALUES ('mega_auction_tick_url','https://release-check.vercel.app/api/auction/tick'), ('mega_auction_tick_secret',repeat('x',64));
UPDATE public.auction_lots SET status='GET_READY',get_ready_expires_at=now()-interval '1 second' WHERE id IN (SELECT current_lot_id FROM public.auctions);
SELECT pg_temp.release_assert(auction_private.has_due_work(), 'get-ready expiry is detected');
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='requested', 'due timer queues authenticated request');
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='awaiting_response', 'pending request cannot overlap');
SELECT pg_temp.release_assert((SELECT count(*)=1 FROM net.release_requests WHERE headers->>'x-auction-tick-secret'=repeat('x',64) AND timeout_milliseconds=25000), 'HTTP carries shared secret and timeout');
INSERT INTO net._http_response SELECT request_id,503,false,NULL,'{"success":false}' FROM auction_private.scheduler_state;
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='retrying', 'temporary HTTP failure retries');
SELECT pg_temp.release_assert((SELECT enabled AND failures=1 FROM auction_private.scheduler_state), '503 does not permanently disable auction');
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='backoff', 'failed request observes backoff');
UPDATE auction_private.scheduler_state SET next_attempt_at=now();
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='requested', 'retry resumes after backoff');
INSERT INTO net._http_response SELECT request_id,200,false,NULL,'{"schemaVersion":1,"success":true,"failureCount":0,"actions":[]}' FROM auction_private.scheduler_state;
UPDATE public.auction_lots SET get_ready_expires_at=now()+interval '1 minute' WHERE status='GET_READY';
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='idle', 'healthy response clears pending request');
SELECT pg_temp.release_assert((SELECT request_id IS NULL AND failures=0 FROM auction_private.scheduler_state), 'successful recovery resets failure counter');

UPDATE public.auctions SET status='PAUSED',paused_reason=jsonb_build_object('resume_expires_at',extract(epoch FROM now()-interval '1 second')*1000)::text;
SELECT pg_temp.release_assert(auction_private.has_due_work(), 'persisted resume countdown is detected');
UPDATE public.auctions SET status='COMPLETED',paused_reason=NULL;
UPDATE public.mini_auction_sessions SET status='SELECTION_OPEN',selection_expires_at=now()-interval '1 second';
SELECT pg_temp.release_assert(auction_private.has_due_work(), 'mini selection closes even with completed parent auction');
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='requested', 'mini deadline queues tick');
INSERT INTO net._http_response SELECT request_id,401,false,NULL,'{"success":false}' FROM auction_private.scheduler_state;
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='configuration_error', 'invalid scheduler credential disables dispatch');
SELECT pg_temp.release_assert((SELECT NOT enabled FROM auction_private.scheduler_state), 'unauthorized polling stops');

-- Explicit response contracts: redirects, followed login HTML, legacy payloads,
-- missing outcome fields and contradictory success flags must fail closed.
DO $responses$
DECLARE fixture record; response_id bigint := 10000;
BEGIN
  FOR fixture IN SELECT * FROM (VALUES
    (302, NULL::text),
    (307, NULL::text),
    (200, '<html>Vercel login</html>'),
    (200, '{"success":true,"actions":[]}'),
    (200, '{"schemaVersion":1,"success":true,"failureCount":0,"actions":[{"action":"RESUME","status":"failed"}]}'),
    (200, '{"schemaVersion":1,"success":true,"failureCount":0,"actions":[{"action":"X"}]}'),
    (200, '{"schemaVersion":1,"success":true,"failureCount":0,"actions":[null]}'),
    (403, '{"success":false}')
  ) cases(code, payload) LOOP
    response_id := response_id + 1;
    UPDATE auction_private.scheduler_state SET enabled=true, failures=0,
      request_id=response_id, requested_at=now(), next_attempt_at=now();
    INSERT INTO net._http_response VALUES(response_id,fixture.code,false,NULL,fixture.payload);
    PERFORM pg_temp.release_assert(auction_private.dispatch_tick()='configuration_error', 'invalid HTTP/response contract opens configuration circuit');
    PERFORM pg_temp.release_assert((SELECT NOT enabled AND request_id IS NULL FROM auction_private.scheduler_state), 'configuration circuit disables without another request');
  END LOOP;
END;
$responses$;

-- A non-suffixed action failure must never be called healthy, even in HTTP 200.
UPDATE auction_private.scheduler_state SET enabled=true, failures=0, request_id=11000,requested_at=now(),next_attempt_at=now();
INSERT INTO net._http_response VALUES(11000,200,false,NULL,'{"schemaVersion":1,"success":false,"failureCount":1,"actions":[{"action":"CUSTOM","status":"failed"}]}');
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='retrying', 'explicit failure count controls retry');

-- The response window exceeds the 25s HTTP timeout, which exceeds the 20s
-- function budget. A lost response is retried only after the reconciliation window.
UPDATE auction_private.scheduler_state SET enabled=true, failures=0, request_id=12000,requested_at=now()-interval '26 seconds',next_attempt_at=now();
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='awaiting_response', 'pending transport has reconciliation headroom');
UPDATE auction_private.scheduler_state SET requested_at=now()-interval '31 seconds';
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='retrying', 'lost HTTP response is recoverable');

-- Five consecutive failures stop permanently until reviewed by the operator.
DO $circuit$
DECLARE attempt integer;
BEGIN
  UPDATE auction_private.scheduler_state SET enabled=true, failures=0;
  FOR attempt IN 1..5 LOOP
    UPDATE auction_private.scheduler_state SET request_id=13000+attempt, requested_at=now(), next_attempt_at=now();
    INSERT INTO net._http_response VALUES(13000+attempt,503,false,NULL,'{"success":false}');
    PERFORM pg_temp.release_assert(auction_private.dispatch_tick()=CASE WHEN attempt=5 THEN 'retry_exhausted' ELSE 'retrying' END, 'bounded retry outcome');
  END LOOP;
  PERFORM pg_temp.release_assert((SELECT NOT enabled AND failures=5 FROM auction_private.scheduler_state), 'retry exhaustion disables dispatcher');
  PERFORM pg_temp.release_assert(auction_private.dispatch_tick()='disabled', 'circuit never auto-restarts');
END;
$circuit$;

-- Never transmit a Vercel bypass secret using pg_net's redirect-following HTTP.
INSERT INTO vault.decrypted_secrets VALUES ('mega_auction_vercel_bypass_secret','disposable-fixture-not-a-real-credential');
UPDATE auction_private.scheduler_state SET enabled=true, failures=0,request_id=NULL,next_attempt_at=now();
SELECT pg_temp.release_assert(auction_private.dispatch_tick()='unsupported_protected_transport', 'unsafe bypass configuration fails before queuing HTTP');
SELECT pg_temp.release_assert((SELECT NOT enabled FROM auction_private.scheduler_state), 'unsupported transport stays disabled');
DELETE FROM vault.decrypted_secrets WHERE name='mega_auction_vercel_bypass_secret';

-- A queue failure must also consume the retry budget instead of throwing forever.
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) RETURNS bigint
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'disposable queue failure'; END; $$;
UPDATE auction_private.scheduler_state SET enabled=true, failures=0,request_id=NULL,next_attempt_at=now();
DO $enqueue$
DECLARE attempt integer;
BEGIN
  FOR attempt IN 1..5 LOOP
    UPDATE auction_private.scheduler_state SET next_attempt_at=now();
    PERFORM pg_temp.release_assert(auction_private.dispatch_tick()=CASE WHEN attempt=5 THEN 'retry_exhausted' ELSE 'enqueue_failed' END, 'queue failures consume bounded budget');
  END LOOP;
  PERFORM pg_temp.release_assert((SELECT NOT enabled AND failures=5 FROM auction_private.scheduler_state), 'queue failure circuit stays disabled');
END;
$enqueue$;
