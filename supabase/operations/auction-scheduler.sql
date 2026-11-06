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
  valid_result boolean := false;
  failed_actions integer;
  invalid_actions integer;
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
    IF NOT FOUND AND state.requested_at > now() - interval '30 seconds' THEN
      RETURN 'awaiting_response';
    END IF;
    IF FOUND THEN
      BEGIN
        result := response.content::jsonb;
        IF jsonb_typeof(result) = 'object' AND result->'schemaVersion' = '1'::jsonb
          AND jsonb_typeof(result->'actions') = 'array'
          AND jsonb_typeof(result->'failureCount') = 'number'
          AND (result->>'failureCount') ~ '^[0-9]+$'
          AND jsonb_typeof(result->'success') = 'boolean' THEN
          SELECT count(*) FILTER (WHERE item->>'status' = 'failed'),
            count(*) FILTER (WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
              OR jsonb_typeof(item->'action') IS DISTINCT FROM 'string'
              OR item->>'status' IS NULL
              OR item->>'status' NOT IN ('succeeded', 'failed', 'skipped'))
          INTO failed_actions, invalid_actions
          FROM jsonb_array_elements(result->'actions') item;
          valid_result := invalid_actions = 0
            AND (result->>'failureCount')::numeric = failed_actions
            AND (result->>'success')::boolean = (failed_actions = 0);
        END IF;
        succeeded := response.status_code = 200 AND NOT COALESCE(response.timed_out, false)
          AND response.error_msg IS NULL AND COALESCE(valid_result, false)
          AND failed_actions = 0;
      EXCEPTION WHEN OTHERS THEN valid_result := false; succeeded := false;
      END;
      -- pg_net 0.20.4 follows redirects internally. A final login HTML page is
      -- also a configuration failure. Never attach a Vercel bypass secret to
      -- this transport; use a separately reviewed no-redirect transport instead.
      IF response.status_code BETWEEN 300 AND 399
        OR (response.status_code BETWEEN 400 AND 499 AND response.status_code NOT IN (408, 425, 429))
        OR (response.status_code BETWEEN 200 AND 299 AND NOT COALESCE(valid_result, false)) THEN
        UPDATE auction_private.scheduler_state SET enabled = false, request_id = NULL,
          last_outcome = 'configuration_error', last_http_status = response.status_code WHERE singleton;
        RAISE WARNING 'Mega Auction scheduler disabled: invalid configuration/response (HTTP %). Operator review required.', response.status_code;
        RETURN 'configuration_error';
      END IF;
    END IF;
    IF NOT COALESCE(succeeded, false) THEN
      failure_count := LEAST(state.failures + 1, 5);
      UPDATE auction_private.scheduler_state SET request_id = NULL, failures = failure_count,
        enabled = failure_count < 5,
        next_attempt_at = now() + make_interval(secs => LEAST(30, power(2, failure_count)::integer)),
        last_outcome = CASE WHEN failure_count >= 5 THEN 'retry_exhausted' ELSE 'retrying' END,
        last_http_status = response.status_code WHERE singleton;
      IF failure_count >= 5 THEN
        RAISE WARNING 'Mega Auction scheduler circuit opened after 5 consecutive failures. Operator review required.';
        RETURN 'retry_exhausted';
      END IF;
      RETURN 'retrying';
    END IF;
    UPDATE auction_private.scheduler_state SET request_id = NULL, failures = 0,
      last_outcome = 'healthy', last_http_status = 200 WHERE singleton;
    state.failures := 0;
  END IF;

  IF now() < state.next_attempt_at THEN RETURN 'backoff'; END IF;
  -- Human bidding and Realtime do not need polling HTTP requests. Dispatch only
  -- at a timer boundary, mini-selection expiry, or scheduled resume.
  IF NOT auction_private.has_due_work() THEN
    UPDATE auction_private.scheduler_state SET last_outcome = 'idle'
      WHERE singleton AND last_outcome IS DISTINCT FROM 'idle';
    RETURN 'idle';
  END IF;

  -- A bypass secret here would be forwarded by libcurl on redirects. Refuse
  -- such a configuration without ever reading or transmitting that secret.
  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'mega_auction_vercel_bypass_secret') THEN
    UPDATE auction_private.scheduler_state SET enabled = false, last_outcome = 'unsupported_protected_transport' WHERE singleton;
    RAISE WARNING 'Mega Auction scheduler disabled: protected endpoint requires a reviewed no-redirect transport.';
    RETURN 'unsupported_protected_transport';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'mega_auction_tick_url') <> 1
    OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'mega_auction_tick_secret') <> 1 THEN
    UPDATE auction_private.scheduler_state SET enabled = false, last_outcome = 'configuration_error' WHERE singleton;
    RAISE WARNING 'Mega Auction scheduler disabled: missing or duplicate tick configuration.';
    RETURN 'configuration_error';
  END IF;

  SELECT decrypted_secret INTO endpoint FROM vault.decrypted_secrets WHERE name = 'mega_auction_tick_url';
  SELECT decrypted_secret INTO credential FROM vault.decrypted_secrets WHERE name = 'mega_auction_tick_secret';
  IF endpoint IS NULL OR endpoint !~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+/api/auction/tick$'
    OR credential IS NULL OR length(credential) < 32 OR credential ~ '[[:space:]]' THEN
    UPDATE auction_private.scheduler_state SET enabled = false, last_outcome = 'configuration_error' WHERE singleton;
    RAISE WARNING 'Mega Auction scheduler disabled: invalid tick URL or credential format.';
    RETURN 'configuration_error';
  END IF;

  BEGIN
    SELECT net.http_post(url := endpoint,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-auction-tick-secret', credential),
      body := '{}'::jsonb, timeout_milliseconds := 25000) INTO queued_request;
  EXCEPTION WHEN OTHERS THEN queued_request := NULL;
  END;
  IF queued_request IS NULL THEN
    failure_count := LEAST(state.failures + 1, 5);
    UPDATE auction_private.scheduler_state SET failures = failure_count, enabled = failure_count < 5,
      next_attempt_at = now() + make_interval(secs => LEAST(30, power(2, failure_count)::integer)),
      last_outcome = CASE WHEN failure_count >= 5 THEN 'retry_exhausted' ELSE 'enqueue_failed' END,
      last_http_status = NULL WHERE singleton;
    IF failure_count >= 5 THEN
      RAISE WARNING 'Mega Auction scheduler circuit opened after 5 enqueue failures. Operator review required.';
      RETURN 'retry_exhausted';
    END IF;
    RETURN 'enqueue_failed';
  END IF;
  UPDATE auction_private.scheduler_state SET request_id = queued_request, requested_at = now(),
    last_outcome = 'requested' WHERE singleton;
  RETURN 'requested';
END;
$function$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auction_private FROM PUBLIC, anon, authenticated, service_role;
-- Only the database owner schedules this function. No API role can call it.
COMMIT;
