import { execFile,execFileSync,spawn } from 'node:child_process';
import { createServer } from 'node:http';
const [container,database]=process.argv.slice(2);
if(!container||!/^mega_auction_ledger_retry_[0-9]+$/.test(database||''))throw Error('Isolated fixture required');
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
if(info.Config.Labels['mega-auction.purpose']!=='isolated-action-ledger'||info.HostConfig.NetworkMode!=='none'||info.Mounts.some(m=>m.Type!=='tmpfs'))throw Error('Unsafe target');
const args=['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-p','55325','-d',database];
const sql=input=>execFileSync('docker',args,{input,encoding:'utf8'}).trim();
const code='H'+String(Date.now()).slice(-5);const nonce=Date.now();
sql(`BEGIN;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.create_room_with_team('${code}','HTTP recovery fixture','{"max_squad_size":25,"max_overseas":8,"timer_duration_seconds":15}'::jsonb,'33333333-3333-4333-8333-333333333333','Host','HOST','#C9A227',10000,NULL);
SELECT public.v3_start_auction(id) FROM public.rooms WHERE code='${code}';
RESET ROLE;
UPDATE public.auction_lots l SET get_ready_expires_at=clock_timestamp()-interval '1 second' FROM public.auctions a JOIN public.rooms r ON r.id=a.room_id WHERE l.id=a.current_lot_id AND r.code='${code}';
SELECT public.v3_start_bidding(a.id,a.current_lot_id,false) FROM public.auctions a JOIN public.rooms r ON r.id=a.room_id WHERE r.code='${code}';
SET LOCAL ROLE authenticated;
SELECT public.v3_place_bid(a.id,a.current_lot_id,p.team_id,gen_random_uuid(),false) FROM public.auctions a JOIN public.rooms r ON r.id=a.room_id JOIN public.room_participants p ON p.room_id=r.id WHERE r.code='${code}' AND p.user_id='11111111-1111-4111-8111-111111111111';
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM public.bids b JOIN public.auctions a ON a.id=b.auction_id JOIN public.rooms r ON r.id=a.room_id WHERE r.code='${code}')<>1 THEN RAISE EXCEPTION 'HTTP fixture bid rejected'; END IF; END $$;
UPDATE public.auction_lots l SET timer_expires_at=clock_timestamp()-interval '1 second' FROM public.auctions a JOIN public.rooms r ON r.id=a.room_id WHERE l.id=a.current_lot_id AND r.code='${code}';
SELECT auction_recovery.plan_due_auction_actions(); COMMIT;`);
const action=(kind)=>`SELECT x.id FROM auction_recovery.lot_actions x JOIN public.auctions a ON a.current_lot_id=x.lot_id JOIN public.rooms r ON r.id=a.room_id WHERE r.code='${code}' AND x.kind='${kind}' AND x.state='PENDING'`;
const token=sql(`SELECT auction_recovery.claim_action((${action('FINALIZE')}),'LOT',1,'http-fixture');`);
if(!/^[a-f0-9-]{36}$/.test(token))throw Error('Missing fixture claim');
let first=true;
const server=createServer((req,res)=>{
 if(req.method!=='POST'||req.headers['x-auction-tick-secret']!=='synthetic-http-secret'){res.writeHead(401);res.end();return;}
 try{const result=sql(`SELECT auction_recovery.execute_claim('${token}',1);`);
  if(first){first=false;res.destroy();}else{res.setHeader('content-type','application/json');res.end(result);}
 }catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const url=`http://127.0.0.1:${server.address().port}`;
 const worker=expectedFailure=>new Promise((resolve,reject)=>{
  const program=`fetch(${JSON.stringify(url)},{method:'POST',redirect:'manual',headers:{'x-auction-tick-secret':'synthetic-http-secret'}}).then(async r=>{if(${expectedFailure}||!r.ok||!(await r.json()).success)process.exitCode=1;}).catch(()=>{if(!${expectedFailure})process.exitCode=1;});`;
  execFile(process.execPath,['-e',program],{timeout:10000},error=>error?reject(Error('Synthetic HTTP worker failed')):resolve());
 });
 await worker(true); // real committed action, response connection destroyed
 await worker(false); // new process, same execution identity
 sql(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.teams t JOIN public.room_participants p ON p.team_id=t.id JOIN public.rooms r ON r.id=p.room_id WHERE r.code='${code}' AND t.purse=9900 AND t.players_bought=1)
 OR (SELECT count(*) FROM public.squad_players s JOIN public.auctions a ON a.id=s.auction_id JOIN public.rooms r ON r.id=a.room_id WHERE r.code='${code}')<>1 THEN RAISE EXCEPTION 'Lost HTTP response duplicated financial effects'; END IF; END $$;`);
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

sql(`UPDATE public.auction_lots l SET get_ready_expires_at=clock_timestamp()-interval '1 second' FROM public.auctions a JOIN public.rooms r ON r.id=a.room_id WHERE l.id=a.current_lot_id AND r.code='${code}'; SELECT auction_recovery.plan_due_auction_actions();`);
const liveToken=sql(`SELECT auction_recovery.claim_action((${action('START_BIDDING')}),'LOT',1,'live-transaction');`);
if(!/^[a-f0-9-]{36}$/.test(liveToken))throw Error('Missing live claim');
sql(`UPDATE auction_recovery.claims SET lease_expires_at=clock_timestamp()+interval '1 second' WHERE token='${liveToken}';`);
const live=spawn('docker',args,{stdio:['pipe','pipe','pipe']});
const exited=new Promise((resolve,reject)=>{live.on('error',reject);live.on('exit',status=>status===0?resolve():reject(Error('Live transaction failed')));});
const ready=new Promise((resolve,reject)=>{let out='';live.stdout.on('data',c=>{out+=c;if(out.includes('CLAIM_APPLIED'))resolve();});live.on('exit',()=>reject(Error('Missing transaction barrier')));});
try{
 live.stdin.write(`BEGIN; SELECT auction_recovery.execute_claim('${liveToken}',1);\n\\echo CLAIM_APPLIED\n`);
 await ready;await new Promise(resolve=>setTimeout(resolve,1200));
 const reconciled=new Promise((resolve,reject)=>{const child=execFile('docker',args,{encoding:'utf8',timeout:10000},(error,out)=>error?reject(Error('Reconciler failed')):resolve(out.trim()));child.stdin.end(`SET application_name='lease_reconciler_${nonce}'; SELECT auction_recovery.reconcile_claim('${liveToken}');`);});
 let blocked=false;
 for(let i=0;i<30;i++){if(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='lease_reconciler_${nonce}' AND wait_event_type='Lock';`)==='1'){blocked=true;break;}await new Promise(r=>setTimeout(r,100));}
 if(!blocked)throw Error('Reconciler did not wait for the live transaction');
 live.stdin.end('COMMIT;\n');await exited;
 if(await reconciled!=='COMPLETED')throw Error('Expired live transaction was not reconciled after commit');
}finally{if(!live.stdin.writableEnded)live.stdin.end('ROLLBACK;\n');}
console.log('PASS: real HTTP response destroyed after business commit; new worker process replays same claim without duplicate purse/squad effects. Expired lease while transaction remains open waits for its commit and reconciles completed state.');
