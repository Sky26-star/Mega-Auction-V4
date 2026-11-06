import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const container=process.argv[2];
if(!container) throw Error('Explicit isolated-action-ledger container required');
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
if(info.Config.Labels['mega-auction.purpose']!=='isolated-action-ledger'||info.HostConfig.NetworkMode!=='none'||info.Mounts.some(m=>m.Type!=='tmpfs')||Object.keys(info.HostConfig.PortBindings||{}).length) throw Error('Unsafe target');
const database=`mega_auction_ledger_retry_${Date.now()}`;
execFileSync('docker',['exec',container,'createdb','-U','postgres','-p','55325',database]);
function sql(input){return execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-p','55325','-d',database],{input,encoding:'utf8',maxBuffer:4*1024*1024});}
const candidate='supabase/migrations/20261105120000_native_scheduler_recovery.sql';
const files=[...new Set([...execFileSync('git',['ls-files','supabase/migrations/*.sql'],{encoding:'utf8'}).trim().split(/\r?\n/),...(existsSync(candidate)?[candidate]:[])])].sort();
execFileSync(process.execPath,['scripts/build-scheduler-migration.mjs'],{stdio:'inherit'});
for(const file of ['scripts/ci-db-bootstrap.sql',...files]){
 sql(readFileSync(file,'utf8').replace(/\r\n/g,'\n'));
}
console.log(`Canonical migrations: ${files.length}; fresh database: ${database}`);
sql('CALL auction_recovery.run_lot_tick();'); // disabled installation sends no work
for(const [script,args] of [
 ['scripts/check-action-ledger.mjs',[container,'--fresh',database]],
 ['scripts/check-scheduler-engine.mjs',[container,database]],
 ['scripts/check-scheduler-recovery.mjs',[container,database]],
]) execFileSync(process.execPath,[script,...args],{stdio:'inherit'});
sql("UPDATE public.auction_lots SET timer_expires_at=clock_timestamp()-interval '1 second' WHERE status='BIDDING';");
// Actual top-level procedure call, outside an explicit transaction. Its internal
// commits are exercised against synthetic data only; no cron is installed.
sql('CALL auction_recovery.run_lot_tick();');
sql(`DO $$ BEGIN IF (SELECT count(*) FROM public.auction_lots WHERE status='UNSOLD')<>1
 OR (SELECT count(*) FROM public.squad_players)<>1
 OR NOT EXISTS(SELECT 1 FROM auction_recovery.executions WHERE state='COMPLETED')
 THEN RAISE EXCEPTION 'Top-level transaction slice failed'; END IF; END $$;`);
console.log('PASS: top-level procedure commits real unsold work and preserves previous squad. No cron jobs created.');
execFileSync(process.execPath,['scripts/check-scheduler-workflows.mjs',container,database],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/check-scheduler-claims.mjs',container,database],{stdio:'inherit'});
sql(`BEGIN;
SET LOCAL ROLE auction_monitor;
SELECT public.auction_scheduler_health();
RESET ROLE;
INSERT INTO auction_recovery.alert_outbox(dedupe_key,kind) VALUES('synthetic-outbox-check','TEST_EVENT');
SET LOCAL ROLE auction_alert_sender;
SELECT public.claim_scheduler_alerts(10);
RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM auction_recovery.alert_outbox WHERE dedupe_key='synthetic-outbox-check' AND delivery_token IS NOT NULL AND attempts=1)
THEN RAISE EXCEPTION 'Alert claim failed'; END IF; END $$;
DO $$ BEGIN IF has_table_privilege('auction_monitor','auction_recovery.control','UPDATE') OR has_schema_privilege('auction_monitor','auction_recovery','USAGE')
THEN RAISE EXCEPTION 'Monitor overprivileged'; END IF; END $$;
ROLLBACK;`);
console.log('PASS: restricted monitor health read, alert delivery claim/lease, no direct monitor mutation privileges.');
execFileSync(process.execPath,['scripts/check-scheduler-http-recovery.mjs',container,database],{stdio:'inherit'});
sql("UPDATE public.auction_lots SET timer_expires_at=clock_timestamp()-interval '1 second' WHERE status='BIDDING';");
sql('CALL auction_recovery.run_native_tick(25);');
sql(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.auctions WHERE status='IN_PROGRESS')
 OR NOT(SELECT enabled AND circuit='CLOSED' FROM auction_recovery.control)
 THEN RAISE EXCEPTION 'Native claimed execution failed'; END IF; END $$;`);
console.log('PASS: actual bounded native procedure plans, claims, commits and summarizes due work.');
console.log('VALIDATED_FIXTURE='+database);
