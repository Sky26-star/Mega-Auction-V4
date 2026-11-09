-- Requires the scheduler functions and the two named Vault secrets. Keep the
-- scheduler disabled until the deployed API passes its authentication smoke test.
SELECT cron.schedule('mega-auction-tick', '1 second', 'SELECT auction_private.dispatch_tick();');

-- Keep only this scheduler's recent history; do not delete other jobs' records.
SELECT cron.schedule('mega-auction-cron-retention', '*/15 * * * *', $command$
  DELETE FROM cron.job_run_details
  WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname IN ('mega-auction-tick', 'mega-auction-cron-retention'))
    AND end_time < now() - interval '1 hour';
$command$);
