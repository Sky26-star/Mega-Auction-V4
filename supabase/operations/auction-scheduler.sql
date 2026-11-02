-- Run after enabling pg_cron, pg_net and supabase_vault in the selected hosted
-- Supabase project. Installation is disabled by default and sends no HTTP calls.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regclass('net._http_response') IS NULL THEN
    RAISE EXCEPTION 'Enable Supabase Vault and pg_net before installing the auction scheduler';
  END IF;
END;
$preflight$;

CREATE SCHEMA IF NOT EXISTS auction_private;
REVOKE ALL ON SCHEMA auction_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auction_private.scheduler_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  request_id bigint,
  requested_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  failures integer NOT NULL DEFAULT 0,
  last_outcome text NOT NULL DEFAULT 'disabled',
  last_http_status integer
);
ALTER TABLE auction_private.scheduler_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auction_private.scheduler_state FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO auction_private.scheduler_state (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION auction_private.resume_is_due(reason text)
RETURNS boolean LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN COALESCE((reason::jsonb->>'resume_expires_at')::numeric <= extract(epoch FROM now()) * 1000, false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION auction_private.has_due_work()
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public, auction_private
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.auctions a JOIN public.auction_lots l ON l.auction_id = a.id
      AND (l.id = a.current_lot_id OR (a.current_lot_id IS NULL AND l.lot_index = a.current_lot_index))
    WHERE a.status = 'IN_PROGRESS'
      AND ((l.status = 'GET_READY' AND l.get_ready_expires_at <= now())
        OR (l.status = 'BIDDING' AND l.timer_expires_at <= now()))
  ) OR EXISTS (
    SELECT 1 FROM public.auctions a WHERE a.status = 'PAUSED'
      AND auction_private.resume_is_due(a.paused_reason)
  ) OR EXISTS (
    SELECT 1 FROM public.mini_auction_sessions s
    WHERE s.status = 'SELECTION_OPEN' AND s.selection_expires_at <= now()
  );
$function$;

CREATE OR REPLACE FUNCTION auction_private.dispatch_tick()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auction_private
AS $function$
DECLARE
  state auction_private.scheduler_state%ROWTYPE;
  response record;
  endpoint text;
  credential text;
  result jsonb;
  succeeded boolean := false;
  failure_count integer;
  queued_request bigint;
BEGIN
  -- Serializes cron calls even if a previous invocation is still processing.
  SELECT * INTO state FROM auction_private.scheduler_state
    WHERE singleton FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN 'busy'; END IF;
  IF NOT state.enabled THEN RETURN 'disabled'; END IF;

  IF state.request_id IS NOT NULL THEN
    SELECT status_code, timed_out, error_msg, content INTO response
    FROM net._http_response WHERE id = state.request_id;
    IF NOT FOUND AND state.requested_at > now() - interval '15 seconds' THEN
      RETURN 'awaiting_response';
    END IF;
    IF FOUND THEN
      BEGIN
        result := response.content::jsonb;
        succeeded := response.status_code = 200 AND NOT COALESCE(response.timed_out, false)
          AND response.error_msg IS NULL AND result->>'success' = 'true'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(result->'actions', '[]'::jsonb)) item
            WHERE right(item->>'action', 7) = '_FAILED');
      EXCEPTION WHEN OTHERS THEN succeeded := false;
      END;
      IF response.status_code IN (401, 403, 404) THEN
        UPDATE auction_private.scheduler_state SET enabled = false, request_id = NULL,
          last_outcome = 'configuration_error', last_http_status = response.status_code WHERE singleton;
        RETURN 'configuration_error';
      END IF;
    END IF;
    IF NOT COALESCE(succeeded, false) THEN
      failure_count := LEAST(state.failures + 1, 10);
      UPDATE auction_private.scheduler_state SET request_id = NULL, failures = failure_count,
        next_attempt_at = now() + make_interval(secs => LEAST(30, power(2, failure_count)::integer)),
        last_outcome = 'retrying', last_http_status = response.status_code WHERE singleton;
      RETURN 'retrying';
    END IF;
    UPDATE auction_private.scheduler_state SET request_id = NULL, failures = 0,
      last_outcome = 'healthy', last_http_status = 200 WHERE singleton;
  END IF;

  IF now() < state.next_attempt_at THEN RETURN 'backoff'; END IF;
  -- Human bidding and Realtime do not need polling HTTP requests. Dispatch only
  -- at a timer boundary, mini-selection expiry, or scheduled resume.
  IF NOT auction_private.has_due_work() THEN
    UPDATE auction_private.scheduler_state SET last_outcome = 'idle'
      WHERE singleton AND last_outcome IS DISTINCT FROM 'idle';
    RETURN 'idle';
  END IF;

  SELECT decrypted_secret INTO endpoint FROM vault.decrypted_secrets WHERE name = 'mega_auction_tick_url';
  SELECT decrypted_secret INTO credential FROM vault.decrypted_secrets WHERE name = 'mega_auction_tick_secret';
  IF endpoint IS NULL OR endpoint !~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+/api/auction/tick$'
    OR credential IS NULL OR length(credential) < 32 OR credential ~ '[[:space:]]' THEN
    UPDATE auction_private.scheduler_state SET enabled = false, last_outcome = 'configuration_error' WHERE singleton;
    RETURN 'configuration_error';
  END IF;

  SELECT net.http_post(url := endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-auction-tick-secret', credential),
    body := '{}'::jsonb, timeout_milliseconds := 10000) INTO queued_request;
  UPDATE auction_private.scheduler_state SET request_id = queued_request, requested_at = now(),
    last_outcome = 'requested' WHERE singleton;
  RETURN 'requested';
END;
$function$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auction_private FROM PUBLIC, anon, authenticated, service_role;
-- Only the database owner schedules this function. No API role can call it.
COMMIT;
