// Delivery is at least once. The destination must deduplicate stable event IDs.
// No external services are contacted on import.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function deliverSchedulerAlerts({claim,send,ack}){
 const events=await claim();
 if(!Array.isArray(events)||events.length>50) throw Error('Invalid alert batch');
 let delivered=0;
 for(const event of events){
  if(!event||!Number.isSafeInteger(event.id)||typeof event.kind!=='string'||typeof event.token!=='string') throw Error('Invalid alert event');
  try{await send({id:`scheduler-outbox-${event.id}`,kind:event.kind,dedupeKey:event.dedupeKey});
   if(await ack(event.id,event.token)) delivered++;
  }catch{/* Lease/backoff makes the event eligible again; never acknowledge a failed send. */}
 }
 return {claimed:events.length,delivered};
}
export function alertDeliveryExitCode(result) {
  return Number.isSafeInteger(result?.claimed)
    && Number.isSafeInteger(result?.delivered)
    && result.claimed >= 0
    && result.delivered === result.claimed ? 0 : 1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const url=process.env.SCHEDULER_ALERT_URL;const database=process.env.SCHEDULER_ALERT_DATABASE_URL;
 try{const u=new URL(url||'');const d=new URL(database||'');
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!['postgres:','postgresql:'].includes(d.protocol)||d.search||d.hash)throw Error();
 }catch{throw Error('Explicit HTTPS receiver and verified-TLS PostgreSQL configuration required; do not log credentials');}
 const {Client}=await import('pg');
 const client=new Client({connectionString:database,connectionTimeoutMillis:5000,query_timeout:5000,
  ssl:{rejectUnauthorized:true,...(process.env.SCHEDULER_ALERT_CA_FILE?{ca:readFileSync(process.env.SCHEDULER_ALERT_CA_FILE,'utf8')}:{})}});
 try{
  await client.connect();
  const actor=await client.query("SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb AS elevated FROM pg_roles WHERE rolname=session_user");
  if(actor.rows[0]?.elevated!==false)throw Error('Dedicated alert login required');
  await client.query('SET ROLE auction_alert_sender');
  const result=await deliverSchedulerAlerts({
   claim:async()=>{const r=await client.query('SELECT public.claim_scheduler_alerts(10) AS events');return r.rows[0].events;},
   send:async event=>{const r=await fetch(url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),
    headers:{'content-type':'application/json','idempotency-key':event.id,...(process.env.SCHEDULER_ALERT_AUTH_TOKEN?{authorization:`Bearer ${process.env.SCHEDULER_ALERT_AUTH_TOKEN}`}:{})},body:JSON.stringify(event)});
    await r.body?.cancel();if(!r.ok)throw Error('Receiver did not acknowledge alert');},
   ack:async(id,token)=>{const r=await client.query('SELECT public.ack_scheduler_alert($1,$2) AS accepted',[id,token]);return r.rows[0].accepted;},
  });console.log(JSON.stringify(result));
  if (alertDeliveryExitCode(result) !== 0) {
    console.error('Alert outbox has undelivered or unacknowledged events; retry required.');
    process.exitCode = 1;
  }
 }catch{console.error('Alert delivery unavailable; undelivered events remain queued.');process.exitCode=1;}
 finally{await client.end().catch(()=>undefined);}
}
