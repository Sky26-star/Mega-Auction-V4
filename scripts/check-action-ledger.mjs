// Fresh disposable Docker database only. Never accepts a database URL.
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const container = process.argv[2];
const database = process.argv[4] || 'mega_auction_ledger_test';
if (!/^mega_auction_ledger_(test|retry_[0-9]+)$/.test(database)) throw new Error('Unsafe test database name');
if (!container) throw new Error('Pass the isolated-action-ledger container name');
const details = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
if (details.Config.Labels['mega-auction.purpose'] !== 'isolated-action-ledger'
  || details.HostConfig.NetworkMode !== 'none' || details.Mounts.some(m => m.Type !== 'tmpfs')) {
  throw new Error('Unsafe test container');
}
function sql(input) {
  return execFileSync('docker', ['exec','-i',container,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-q','-U','postgres','-p','55325','-d',database],
    { input, encoding: 'utf8', maxBuffer: 1024 * 1024 });
}
if (process.argv[3] !== '--crash-stage') {
sql(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.rooms)
THEN RAISE EXCEPTION 'Requires fresh synthetic fixture database'; END IF; END $$;`);
const fixture = readFileSync('scripts/release-database-assertions.sql','utf8')
  .split("UPDATE public.auction_lots SET timer_expires_at")[0]
  // Legacy HTTP-scheduler checks belong to its own suite. This candidate uses
  // auction_recovery; assert its schema and function ACLs explicitly below.
  .split('\n').filter(line => !line.includes('auction_private')).join('\n');
sql(`BEGIN;
CREATE FUNCTION pg_temp.release_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.release_assert(boolean,text) TO authenticated,service_role;
-- Guarded synthetic setup exercises the historical service-role lifecycle.
UPDATE auction_recovery.control SET delivery_owner='LEGACY';
${fixture}
UPDATE auction_recovery.control SET delivery_owner='DATABASE';
SET LOCAL ROLE service_role;
DO $$ DECLARE signature regprocedure; result jsonb; args text; BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'public.v3_start_bidding(uuid,uuid)'::regprocedure,'public.v3_start_bidding(uuid,uuid,boolean)'::regprocedure,
 'public.v3_finalize_and_advance_lot(uuid,uuid)'::regprocedure,'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)'::regprocedure,
 'public.v3_close_mini_selection(uuid,boolean)'::regprocedure,'public.v3_start_mini_auction(uuid)'::regprocedure,'public.resume_auction(uuid)'::regprocedure,
 'public.activate_lot_timer(uuid,uuid)'::regprocedure,'public.process_lot_expiry(uuid,uuid)'::regprocedure,'public.advance_lot(uuid)'::regprocedure] LOOP
 SELECT string_agg('NULL::'||type::regtype::text,',' ORDER BY ord) INTO args FROM pg_proc p,unnest(p.proargtypes) WITH ORDINALITY x(type,ord) WHERE p.oid=signature;
 EXECUTE format('SELECT public.%I(%s)',(SELECT proname FROM pg_proc WHERE oid=signature),args) INTO result;
 PERFORM pg_temp.release_assert(result->>'error'='DATABASE_SCHEDULER_OWNS_TICKS','service-role timer fenced: '||signature);
 END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.release_assert((SELECT NOT enabled AND circuit='OPEN' FROM auction_recovery.control),'installs disabled');
SELECT pg_temp.release_assert(NOT has_function_privilege('authenticated','auction_recovery.apply_lot_action(uuid,bigint)','EXECUTE'),'browser executor denied');
SELECT pg_temp.release_assert(NOT has_schema_privilege('service_role','auction_recovery','USAGE'),'service role cannot impersonate cron');
UPDATE public.auction_lots SET timer_expires_at=clock_timestamp()-interval '1 second' WHERE status='BIDDING';
INSERT INTO auction_recovery.lot_actions(auction_id,lot_id,kind) SELECT id,current_lot_id,'FINALIZE' FROM public.auctions;
-- Disposable fixture only; no cron job or hosted scheduler is activated.
UPDATE auction_recovery.control SET enabled=true,circuit='CLOSED';
COMMIT;`);
// Commit a real business operation, discard its returned output, then reconnect.
sql(`SELECT auction_recovery.apply_lot_action(id,1) FROM auction_recovery.lot_actions;`);
sql(`DO $$ BEGIN
IF (SELECT count(*) FROM public.squad_players) <> 1 OR
 (SELECT count(*) FROM auction_recovery.attempts WHERE outcome='COMPLETED') <> 1
THEN RAISE EXCEPTION 'First operation did not commit'; END IF; END $$;`);
sql(`SELECT auction_recovery.apply_lot_action(id,1) FROM auction_recovery.lot_actions;`);
sql(`DO $$ BEGIN
IF (SELECT count(*) FROM public.squad_players) <> 1 OR
 (SELECT count(*) FROM auction_recovery.attempts) <> 1 OR
 NOT EXISTS(SELECT 1 FROM public.teams t JOIN public.room_participants p ON p.team_id=t.id
 WHERE p.user_id='22222222-2222-4222-8222-222222222222' AND t.purse=9900 AND t.players_bought=1)
THEN RAISE EXCEPTION 'Duplicate application changed financial state'; END IF;
END $$;`);
// A caller cannot use an old control epoch, including for a completed action.
sql(`DO $$ DECLARE rejected boolean:=false; BEGIN
BEGIN PERFORM auction_recovery.apply_lot_action((SELECT id FROM auction_recovery.lot_actions LIMIT 1),0);
EXCEPTION WHEN raise_exception THEN rejected:=true; END;
IF NOT rejected THEN RAISE EXCEPTION 'Stale epoch accepted'; END IF; END $$;`);
} else {
  sql(`DO $$ BEGIN IF (SELECT count(*) FROM auction_recovery.lot_actions)<>1 OR
    NOT EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE kind='FINALIZE' AND state='COMPLETED')
    THEN RAISE EXCEPTION 'Crash stage requires completed synthetic first stage'; END IF; END $$;`);
}
function asyncSql(input) {
  return new Promise(resolve => {
    const child = execFile('docker', ['exec','-i',container,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-q','-U','postgres','-p','55325','-d',database],
      { encoding:'utf8' }, (error,stdout,stderr) => resolve({ error,stdout,stderr }));
    child.stdin.end(input);
  });
}
sql(`UPDATE public.auction_lots SET get_ready_expires_at=clock_timestamp()-interval '1 second' WHERE status='GET_READY';
INSERT INTO auction_recovery.lot_actions(auction_id,lot_id,kind) SELECT id,current_lot_id,'START_BIDDING' FROM public.auctions;`);
const marker = `ledger_crash_${Date.now()}`;
const interrupted = asyncSql(`SET application_name='${marker}'; BEGIN;
SELECT auction_recovery.apply_lot_action(id,1) FROM auction_recovery.lot_actions WHERE kind='START_BIDDING';
SELECT pg_sleep(30); COMMIT;`);
let barrier = false;
for (let i=0;i<40;i++) {
  const active = sql(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='${marker}' AND wait_event='PgSleep';`);
  if (active.trim()==='1') { barrier=true; break; }
  await new Promise(resolve => setTimeout(resolve,100));
}
if (!barrier) throw new Error('Crash injection barrier not reached');
// Only terminate the uniquely labelled test connection in the verified disposable
// database. This never targets a user database process or a hosted connection.
sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='${marker}' AND wait_event='PgSleep';`);
if (!(await interrupted).error) throw new Error('Injected connection termination did not occur');
sql(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE kind='START_BIDDING' AND state<>'PENDING')
OR EXISTS(SELECT 1 FROM public.auction_lots WHERE id IN(SELECT lot_id FROM auction_recovery.lot_actions WHERE kind='START_BIDDING') AND status<>'GET_READY')
THEN RAISE EXCEPTION 'Business and completion did not roll back together'; END IF; END $$;`);
const competitors = await Promise.all([1,2].map(() => asyncSql(`SELECT auction_recovery.apply_lot_action(id,1) FROM auction_recovery.lot_actions WHERE kind='START_BIDDING';`)));
if (competitors.some(result => result.error)) throw new Error('Concurrent executor failed');
sql(`DO $$ BEGIN IF (SELECT count(*) FROM auction_recovery.attempts t JOIN auction_recovery.lot_actions a ON a.id=t.action_id WHERE a.kind='START_BIDDING')<>1
OR NOT EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE kind='START_BIDDING' AND state='COMPLETED')
THEN RAISE EXCEPTION 'Concurrent duplicate action applied'; END IF; END $$;`);
console.log('PASS: disabled installation, API ACL checks, real sold transition, discarded-result reconnect, duplicate financial invariants, stale epoch rejection, terminated pre-commit transaction rollback, two real concurrent connections.');
console.log('NOT TESTED: HTTP loss, database crash, generation changes, mini/resume recovery or operator reset.');
