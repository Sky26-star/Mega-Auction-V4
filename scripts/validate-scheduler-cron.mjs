// New local Supabase PG image, synthetic snapshot only. Native job stays
// disabled; temporary principal and idle runtime probes are scheduled locally.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const [source,database]=process.argv.slice(2);
if(!source||!/^mega_auction_ledger_retry_[0-9]+$/.test(database||'')) throw Error('Synthetic source required');
const info=JSON.parse(execFileSync('docker',['inspect',source],{encoding:'utf8'}))[0];
if(info.Config.Labels['mega-auction.purpose']!=='isolated-action-ledger'||info.HostConfig.NetworkMode!=='none'||info.Mounts.some(m=>m.Type!=='tmpfs'))throw Error('Unsafe source');
const target=execFileSync('docker',['run','-d','--pull=never','--network','none','--memory','512m','--memory-swap','768m','--cpus','1','--tmpfs','/work:rw,size=384m','--label','mega-auction.purpose=isolated-cron-validation','--entrypoint','sleep','public.ecr.aws/supabase/postgres:17.6.1.155','infinity'],{encoding:'utf8'}).trim();
console.log('Cron validation container: '+target);
execFileSync('docker',['exec',target,'mkdir','-p','/work/socket']);
execFileSync('docker',['exec',target,'chown','-R','postgres:postgres','/work']);
execFileSync('docker',['exec','-u','postgres',target,'initdb','-D','/work/data','--auth=trust','--no-locale'],{stdio:'pipe'});
execFileSync('docker',['exec','-u','postgres',target,'pg_ctl','-D','/work/data','-l','/work/postgres.log','-o','-p 55325 -k /work/socket -c shared_preload_libraries=pg_cron -c cron.use_background_workers=on','-w','start'],{stdio:'pipe'});
function sql(input){return execFileSync('docker',['exec','-i',target,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-h','/work/socket','-p','55325','-U','postgres','-d','postgres'],{input,encoding:'utf8',maxBuffer:4*1024*1024});}
sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE supabase_admin BYPASSRLS; CREATE ROLE dashboard_user; CREATE ROLE auction_monitor; CREATE ROLE auction_alert_sender;");
const dump=execFileSync('docker',['exec',source,'pg_dump','-Fc','--no-owner','-U','postgres','-p','55325','-d',database],{maxBuffer:16*1024*1024});
execFileSync('docker',['exec','-i',target,'pg_restore','--exit-on-error','--no-owner','-h','/work/socket','-p','55325','-U','postgres','-d','postgres'],{input:dump,stdio:['pipe','pipe','pipe']});
sql("CREATE EXTENSION pg_cron; UPDATE auction_recovery.control SET enabled=false,circuit='OPEN',delivery_owner='DATABASE'; ");

// All rejection cases run inside rollback-only transactions in the
// already-validated network-isolated disposable cron container.
const installerSql = readFileSync('supabase/operations/install-native-scheduler-disabled.sql', 'utf8');

function expectInstallerRejects(setupSql, expectedError) {
  const attempted = installerSql
    .replace(/^BEGIN;\s*$/m, `BEGIN;\n${setupSql}`)
    .replace(/^COMMIT;\s*$/m, 'ROLLBACK;');

  if (attempted === installerSql || !attempted.includes('ROLLBACK;')) {
    throw Error('Installer transaction markers missing');
  }

  try {
    sql(attempted);
  } catch (error) {
    if (String(error.stderr || error.message).includes(expectedError)) {
      return;
    }
    throw error;
  }

  throw Error(`Unsafe installer state accepted: ${expectedError}`);
}

expectInstallerRejects(
  "UPDATE auction_recovery.control SET delivery_owner='LEGACY';",
  'DATABASE_OWNER_REQUIRED'
);
expectInstallerRejects(
  "UPDATE auction_recovery.control SET enabled=true;",
  'DISABLED_INSTALLATION_REQUIRED'
);
expectInstallerRejects(
  "UPDATE auction_recovery.control SET circuit='CLOSED';",
  'OPEN_CIRCUIT_REQUIRED'
);
expectInstallerRejects(
  "DELETE FROM auction_recovery.control WHERE singleton;",
  'SCHEDULER_CONTROL_ROW_REQUIRED'
);
sql(installerSql);
sql("SELECT cron.schedule('ma-validation-principal-probe','1 second','SELECT auction_recovery.require_operator();');");
let success=false;
try{
 for(let i=0;i<30;i++){
  const count=sql("SELECT count(*) FROM cron.job_run_details r JOIN cron.job j ON j.jobid=r.jobid WHERE j.jobname='ma-validation-principal-probe' AND r.status='succeeded';");
  if(Number(count.trim())>0){success=true;break;}
  await new Promise(r=>setTimeout(r,500));
 }
}finally{sql("SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='ma-validation-principal-probe';");}
if(!success)throw Error('Cron principal probe did not succeed; inspect preserved cron job history');
// Principal equality alone does not prove transaction-controlling CALL works
// inside the real cron executor. Exercise its commits only with no active rooms.
sql(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.auctions WHERE status NOT IN ('COMPLETED','MINI_AUCTION'))
 OR EXISTS(SELECT 1 FROM public.mini_auction_sessions WHERE status NOT IN ('SETUP','COMPLETED'))
 OR EXISTS(SELECT 1 FROM auction_recovery.workflow_actions WHERE state NOT IN ('COMPLETED','SUPERSEDED'))
 OR EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE state NOT IN ('COMPLETED','SUPERSEDED'))
 OR EXISTS(SELECT 1 FROM auction_recovery.claims WHERE state IN ('CLAIMED','UNKNOWN'))
 THEN RAISE EXCEPTION 'Runtime cron probe requires synthetic idle auctions'; END IF; END $$;
UPDATE auction_recovery.control SET enabled=true,circuit='CLOSED';
SELECT cron.schedule('ma-validation-runtime-probe','1 second','CALL auction_recovery.run_native_tick(25);');`);
let runtimeSuccess=false;
try{
 for(let i=0;i<30;i++){
  if(Number(sql("SELECT count(*) FROM cron.job_run_details r JOIN cron.job j ON j.jobid=r.jobid WHERE j.jobname='ma-validation-runtime-probe' AND r.status='succeeded';").trim())>0){runtimeSuccess=true;break;}
  await new Promise(r=>setTimeout(r,500));
 }
}finally{sql("SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='ma-validation-runtime-probe'; UPDATE auction_recovery.control SET enabled=false,circuit='OPEN';");}
if(!runtimeSuccess)throw Error('Real cron CALL did not complete; inspect preserved job history');
let timeoutVerified=false;
try{sql("DO $$ BEGIN PERFORM set_config('transaction_timeout','100ms',false); PERFORM pg_sleep(1); END $$;");}
catch(error){timeoutVerified=String(error.stderr||'').includes('transaction timeout');}
if(!timeoutVerified)throw Error('PostgreSQL 17 transaction deadline not enforced');
sql(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='mega-auction-native-tick' AND username='postgres' AND NOT active)
 OR NOT EXISTS(SELECT 1 FROM auction_recovery.control WHERE singleton AND delivery_owner='DATABASE' AND NOT enabled AND circuit='OPEN') THEN RAISE EXCEPTION 'Auction scheduler activated unexpectedly'; END IF; END $$;`);
console.log('PASS: real pg_cron postgres principal and transaction-controlling idle native CALL; PostgreSQL 17 transaction deadline enforced; native job installed disabled, dispatcher remains disabled. Probes deactivated; history preserved.');
