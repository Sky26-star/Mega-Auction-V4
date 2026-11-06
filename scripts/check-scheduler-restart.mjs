// Crash only the PostgreSQL child inside our new sleep-owned test container.
// The container and its tmpfs stay alive; previous/user databases are untouched.
import { execFile, execFileSync } from 'node:child_process';
const container=process.argv[2];
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
if(info.Config.Labels['mega-auction.purpose']!=='isolated-cron-validation'||info.HostConfig.NetworkMode!=='none'||info.Mounts.some(m=>m.Type!=='tmpfs')) throw Error('Unsafe restart target');
const args=['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-h','/work/socket','-p','55325','-U','postgres','-d','postgres'];
const sql=input=>execFileSync('docker',args,{input,encoding:'utf8'}).trim();
if(sql("SELECT count(*) FROM public.rooms WHERE code='RLSCHK';")!=='1'||sql('SELECT enabled FROM auction_recovery.control WHERE singleton;')!=='f')throw Error('Expected disabled synthetic snapshot');
const digest=`SELECT auction_recovery.state_hash()||':'||COALESCE((SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY token)::text) FROM auction_recovery.claims c),'empty')||':'||(SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.teams t);`;
const before=sql(digest);
const marker=`scheduler_crash_${Date.now()}`;
const active=new Promise(resolve=>{
 const child=execFile('docker',args,{encoding:'utf8'},error=>resolve(error));
 child.stdin.end(`SET application_name='${marker}'; BEGIN;
UPDATE public.teams SET purse=purse-1;
SELECT pg_sleep(30); COMMIT;`);
});
let reached=false;
for(let i=0;i<40;i++){
 if(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${marker}' AND wait_event='PgSleep';`)==='1'){reached=true;break;}
 await new Promise(r=>setTimeout(r,100));
}
if(!reached)throw Error('Crash barrier not reached');
execFileSync('docker',['exec','-u','postgres',container,'pg_ctl','-D','/work/data','-m','immediate','-w','stop'],{stdio:'pipe'});
if(!(await active))throw Error('Expected interrupted backend failure');
execFileSync('docker',['exec','-u','postgres',container,'pg_ctl','-D','/work/data','-l','/work/postgres.log','-o','-p 55325 -k /work/socket -c shared_preload_libraries=pg_cron -c cron.use_background_workers=on','-w','start'],{stdio:'pipe'});
if(sql(digest)!==before)throw Error('Business/ledger state changed across crash recovery');
if(sql("SELECT count(*) FROM cron.job WHERE active AND jobname IN ('mega-auction-native-tick','ma-validation-principal-probe','ma-validation-runtime-probe');")!=='0')throw Error('Scheduler job activated on restart');
console.log('PASS: actual PostgreSQL immediate shutdown/restart, uncommitted synthetic purse change rolled back, durable actions/claims/generations preserved, native/probe jobs remain inactive.');
