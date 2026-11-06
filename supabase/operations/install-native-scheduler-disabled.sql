-- PROPOSED HOSTED OPERATION: requires separate explicit approval.
-- Validated only against a disposable pg_cron cluster before release.
BEGIN;
DO $$ BEGIN
 PERFORM auction_recovery.require_operator();
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN RAISE EXCEPTION 'PG_CRON_REQUIRED'; END IF;
 IF (SELECT count(*) FROM auction_recovery.control) <> 1 THEN
   RAISE EXCEPTION 'SCHEDULER_CONTROL_ROW_REQUIRED';
 END IF;
 PERFORM 1 FROM auction_recovery.control WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULER_CONTROL_ROW_REQUIRED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM auction_recovery.control WHERE singleton AND delivery_owner='DATABASE') THEN
   RAISE EXCEPTION 'DATABASE_OWNER_REQUIRED';
 END IF;
 IF EXISTS (SELECT 1 FROM auction_recovery.control WHERE singleton AND enabled) THEN
   RAISE EXCEPTION 'DISABLED_INSTALLATION_REQUIRED';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM auction_recovery.control WHERE singleton AND circuit='OPEN') THEN
   RAISE EXCEPTION 'OPEN_CIRCUIT_REQUIRED';
 END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE active AND (command ILIKE '%dispatch_tick%' OR command ILIKE '%auction/tick%')) THEN RAISE EXCEPTION 'LEGACY_CRON_MUST_BE_FENCED_FIRST'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='mega-auction-native-tick') THEN RAISE EXCEPTION 'EXISTING_JOB_REQUIRES_REVIEW'; END IF;
END $$;
SELECT cron.schedule('mega-auction-native-tick','1 second','CALL auction_recovery.run_native_tick(25);');
SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='mega-auction-native-tick';
DO $$ BEGIN IF (SELECT count(*) FROM cron.job WHERE jobname='mega-auction-native-tick') <> 1 OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='mega-auction-native-tick' AND username='postgres' AND NOT active AND schedule='1 second' AND command='CALL auction_recovery.run_native_tick(25);') OR NOT EXISTS(SELECT 1 FROM auction_recovery.control WHERE singleton AND delivery_owner='DATABASE' AND NOT enabled AND circuit='OPEN')
 THEN RAISE EXCEPTION 'EXPECTED_DISABLED_POSTGRES_JOB_NOT_INSTALLED'; END IF; END $$;
COMMIT;
