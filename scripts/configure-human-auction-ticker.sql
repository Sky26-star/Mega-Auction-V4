-- V1 human-only auction ticker for Supabase Cron + Vercel.
--
-- Prerequisites:
--   1. Deploy the Next.js app to its stable Vercel production URL.
--   2. Set AUCTION_TICK_SECRET in Vercel to a random value of 32+ characters.
--   3. In Supabase Dashboard > Vault, create:
--        name: auction_tick_url     value: https://<your-app>.vercel.app/api/auction/tick
--        name: auction_tick_secret value: the same AUCTION_TICK_SECRET value
--   4. Run this script against the MegaMockAuction project's `postgres` database.
--
-- The cron command reads credentials from Vault at runtime; secret values are
-- never embedded in cron.job.command or this file. It calls the authenticated
-- server route only while an auction is active, every five seconds. Vercel
-- Hobby Cron is intentionally not used because it cannot run at auction speed.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

DO $setup$
DECLARE
  v_tick_url TEXT;
  v_tick_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_tick_url
  FROM vault.decrypted_secrets
  WHERE name = 'auction_tick_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_tick_secret
  FROM vault.decrypted_secrets
  WHERE name = 'auction_tick_secret'
  LIMIT 1;

  IF v_tick_url IS NULL OR v_tick_url !~ '^https://[^[:space:]]+/api/auction/tick$' THEN
    RAISE EXCEPTION 'Vault secret auction_tick_url must be the HTTPS production URL ending in /api/auction/tick';
  END IF;

  IF v_tick_secret IS NULL OR length(v_tick_secret) < 32 OR v_tick_secret ~ '[[:space:]]' THEN
    RAISE EXCEPTION 'Vault secret auction_tick_secret must match the Vercel AUCTION_TICK_SECRET (32+ characters, no whitespace)';
  END IF;

  -- Replace only this named job, keeping the setup repeatable.
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'mega-auction-human-only-tick';

  PERFORM cron.schedule(
    'mega-auction-human-only-tick',
    '5 seconds',
    $job$
      WITH tick_config AS (
        SELECT
          max(decrypted_secret) FILTER (WHERE name = 'auction_tick_url') AS tick_url,
          max(decrypted_secret) FILTER (WHERE name = 'auction_tick_secret') AS tick_secret
        FROM vault.decrypted_secrets
        WHERE name IN ('auction_tick_url', 'auction_tick_secret')
      )
      SELECT net.http_post(
        url := tick_config.tick_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-auction-tick-secret', tick_config.tick_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 4500
      )
      FROM tick_config
      WHERE tick_config.tick_url IS NOT NULL
        AND tick_config.tick_secret IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.auctions
          WHERE status IN ('IN_PROGRESS', 'MINI_AUCTION')
             OR (
               status = 'PAUSED'
               AND paused_reason ~ '"resume_expires_at"[[:space:]]*:'
             )
        );
    $job$
  );
END
$setup$;

-- Verify without reading any secret values:
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'mega-auction-human-only-tick';
