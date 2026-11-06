// Clean intended-source snapshot. Never copies .env, backups or arbitrary
// untracked files. Uses cached dependencies only after comparing lockfiles.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
const snapshot=mkdtempSync(join(tmpdir(),'ma-scheduler-linux-'));
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const extra=['src/lib/auction/tick-result.ts','src/test/unit/auction-tick-transport.test.ts',
 'supabase/operations/auction-action-ledger.sql','supabase/operations/auction-scheduler-engine.sql',
 'supabase/operations/auction-scheduler-recovery.sql','scripts/check-action-ledger.mjs',
 'scripts/check-scheduler-engine.mjs','scripts/check-scheduler-recovery.mjs',
 'supabase/operations/auction-scheduler-workflows.sql','supabase/operations/auction-scheduler-claims.sql',
 'supabase/operations/auction-scheduler-runtime.sql','supabase/operations/auction-scheduler-alerts.sql',
 'supabase/operations/auction-scheduler-fencing.sql',
 'supabase/operations/install-native-scheduler-disabled.sql','scripts/scheduler-monitor.mjs',
 'scripts/scheduler-alert-delivery.mjs','src/test/unit/scheduler-monitor.test.ts',
 'src/test/unit/mini-start-intent.test.tsx','scripts/check-scheduler-workflows.mjs',
 'scripts/check-scheduler-claims.mjs','scripts/validate-scheduler-database.mjs',
 'scripts/validate-scheduler-cron.mjs','scripts/check-scheduler-restart.mjs',
 'scripts/check-scheduler-http-recovery.mjs','scripts/build-scheduler-migration.mjs',
 'supabase/migrations/20261105120000_native_scheduler_recovery.sql'];
for(const path of new Set([...tracked,...extra])){
 if(path.startsWith('.env')&&path!=='.env.example') throw Error('Unexpected tracked environment file');
 if(path.startsWith('scratch/')||path.startsWith('src/app/api/diag/')) throw Error('Unexpected diagnostic/scratch source');
 const target=join(snapshot,'source',path); mkdirSync(dirname(target),{recursive:true}); copyFileSync(path,target);
}
execFileSync('tar',['-cf',join(snapshot,'source.tar'),'-C',join(snapshot,'source'),'.']);
const databaseContainer=process.argv[process.argv.indexOf('--database-container')+1];
const databaseOnly=process.argv.includes('--database-container');
if(databaseOnly){const target=JSON.parse(execFileSync('docker',['inspect',databaseContainer],{encoding:'utf8'}))[0];
 if(target.Config.Labels['mega-auction.purpose']!=='isolated-action-ledger'||target.HostConfig.NetworkMode!=='none'||target.Mounts.some(m=>m.Type!=='tmpfs'))throw Error('Unsafe strict database target');}
if(databaseOnly&&process.argv.includes('--prepare-database')){
 const base=['exec','-i',databaseContainer,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-p','55325'];
 const present=execFileSync('docker',[...base,'-d','postgres'],{input:"SELECT count(*) FROM pg_database WHERE datname='mega_auction_test';",encoding:'utf8'}).trim();
 if(present!=='0')throw Error('Strict fixture already exists; refusing to replace it');
 execFileSync('docker',['exec',databaseContainer,'createdb','-U','postgres','-p','55325','mega_auction_test']);
 const migrations=[...new Set([...tracked.filter(p=>p.startsWith('supabase/migrations/')&&p.endsWith('.sql')),'supabase/migrations/20261105120000_native_scheduler_recovery.sql'])].sort();
 for(const path of ['scripts/ci-db-bootstrap.sql',...migrations])execFileSync('docker',[...base,'-d','mega_auction_test'],{input:readFileSync(path,'utf8').replace(/\r\n/g,'\n'),encoding:'utf8',maxBuffer:4*1024*1024});
 console.log('Prepared new strict fixture with '+migrations.length+' canonical migrations; no existing database replaced.');
}
const id=execFileSync('docker',['run','-d','--pull=never','--read-only','--network',databaseOnly?`container:${databaseContainer}`:'none',
 '--memory',databaseOnly?'512m':'1536m','--memory-swap',databaseOnly?'768m':'2560m','--cpus','1',
 '--env','CIRCLE_NODE_TOTAL=2','--env','NODE_OPTIONS=--max-old-space-size=768',
 '--label','mega-auction.purpose=scheduler-clean-linux','--tmpfs','/work:rw,size=1024m',
 '--tmpfs','/tmp:rw,size=256m','--entrypoint','sleep','mega-auction-ci-audit:20261103','infinity'],{encoding:'utf8'}).trim();
console.log(`Isolated build container: ${id}`);
execFileSync('docker',['exec','-i',id,'tar','-xf','-','-C','/work'],{input:readFileSync(join(snapshot,'source.tar'))});
const runner=`const fs=require('node:fs'), cp=require('node:child_process'), crypto=require('node:crypto');
process.chdir('/work');
if(JSON.stringify(JSON.parse(fs.readFileSync('package-lock.json')))!==JSON.stringify(JSON.parse(fs.readFileSync('/verification/package-lock.json')))) throw Error('Cached dependency lockfile mismatch');
console.log(fs.readFileSync('/etc/os-release','utf8').split('\\n')[0],process.version);
console.log('Using image-cached dependencies with matching lockfile; npm ci was not rerun.');
fs.symlinkSync('/verification/node_modules','node_modules','dir');
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://scheduler-db.example.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'build-only-public-key',NEXT_PUBLIC_APP_URL:'https://scheduler-app.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'build-only-server-key',AUCTION_TICK_SECRET:crypto.randomBytes(32).toString('hex'),NEXT_TELEMETRY_DISABLED:'1'});
if(${databaseOnly}){
 process.env.DISPOSABLE_TEST_DATABASE_URL='postgresql://postgres:postgrespassword@127.0.0.1:55325/mega_auction_test';
 cp.execFileSync('/verification/node_modules/.bin/vitest',['run','src/test/database/auction-rpc-concurrency.integration.test.ts','src/test/database/auction-rpc-security.integration.test.ts','--no-file-parallelism','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/work/db-test-results.json'],{stdio:'inherit'});
 cp.execFileSync('node',['scripts/verify-ci-db-test-results.mjs','/work/db-test-results.json'],{stdio:'inherit'});
 cp.execFileSync('node',['scripts/check-release-database.mjs'],{stdio:'inherit'});
}else{
 cp.execFileSync('/verification/node_modules/.bin/tsc',['--noEmit','--incremental','false'],{stdio:'inherit'});
 cp.execFileSync('npm',['run','build'],{stdio:'inherit'});
}`;
execFileSync('docker',['exec',id,'node','-e',runner],{stdio:'inherit'});
console.log(databaseOnly?'PASS: strict Linux database integration suites completed.':'PASS: clean Linux TypeScript and production build, including diagnostic-route exclusion. Container/artifacts preserved.');
