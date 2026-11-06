// Independent process: health read only. No hosted connection is made on import.
// State contains event classifications only, never credentials or database data.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function pollScheduler({ readHealth, stateDirectory, sendAlert, expectedEnabled = false }) {
  mkdirSync(stateDirectory,{recursive:true});
  const path=join(stateDirectory,'scheduler-monitor.json');
  const state=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{sequence:0,active:null,events:[]};
  let kind=null;
  try {
    const h=await readHealth();
    if(!h||h.schemaVersion!==1||typeof h.enabled!=='boolean'||typeof h.stale!=='boolean'
      ||!Number.isSafeInteger(h.unknownClaims)||!Number.isSafeInteger(h.quarantinedActions)) kind='INVALID_HEALTH';
    else if(h.unknownClaims>0) kind='UNKNOWN_EXECUTIONS';
    else if(h.quarantinedActions>0) kind='QUARANTINED_ACTIONS';
    else if(h.enabled&&h.circuit!=='CLOSED') kind='OPEN_CIRCUIT';
    else if(h.stale) kind='STALE_SCHEDULER';
    else if(expectedEnabled&&!h.enabled) kind='UNEXPECTEDLY_DISABLED';
  } catch { kind='DATABASE_UNAVAILABLE'; }
  if(kind!==state.active){
    state.sequence++;
    if(kind!==null||state.active!==null) state.events.push({id:randomUUID(),sequence:state.sequence,kind:kind||'RECOVERED',delivered:false});
    state.active=kind;
  }
  const save=()=>{const temp=join(stateDirectory,`monitor-${randomUUID()}.tmp`);writeFileSync(temp,JSON.stringify(state),{mode:0o600});renameSync(temp,path);};
  save(); // persist before attempting delivery; restart preserves queued alerts
  if(sendAlert){
    for(const event of state.events.filter(e=>!e.delivered).slice(0,10)){
      try { await sendAlert({id:event.id,kind:event.kind,sequence:event.sequence}); event.delivered=true; save(); }
      catch { break; } // bounded retry on next poll; no secret-bearing error logs
    }
  }
  return {kind,pending:state.events.filter(e=>!e.delivered).length};
}

export function monitorExitCode(result, deliveryConfigured) {
  return deliveryConfigured === true
    && Number.isSafeInteger(result?.pending)
    && result.pending === 0 ? 0 : 1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const { Client }=await import('pg');
  const connectionString=process.env.SCHEDULER_MONITOR_DATABASE_URL;
  const stateDirectory=process.env.SCHEDULER_MONITOR_STATE_DIR;
  if(!connectionString||!stateDirectory) throw Error('Monitor database and external state directory are required. Do not log their values.');
  try {const u=new URL(connectionString);if(!['postgres:','postgresql:'].includes(u.protocol)||u.search||u.hash) throw Error();}
  catch {throw Error('Monitor database URL must be PostgreSQL without query overrides; TLS verification is mandatory');}
  const alertUrl=process.env.SCHEDULER_ALERT_URL;
  if(alertUrl){try{const u=new URL(alertUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error();}catch{throw Error('Alert endpoint requires credential-safe HTTPS configuration');}}
  const result=await pollScheduler({stateDirectory,expectedEnabled:process.env.SCHEDULER_MONITOR_EXPECT_ENABLED==='true',
    readHealth:async()=>{
      const client=new Client({connectionString,connectionTimeoutMillis:5000,query_timeout:5000,
        ssl:{rejectUnauthorized:true,...(process.env.SCHEDULER_MONITOR_CA_FILE?{ca:readFileSync(process.env.SCHEDULER_MONITOR_CA_FILE,'utf8')}:{})}});
      try{await client.connect();
        const actor=await client.query("SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb AS elevated FROM pg_roles WHERE rolname=session_user");
        if(actor.rows[0]?.elevated!==false)throw Error('Dedicated monitor login required');
        await client.query('SET ROLE auction_monitor');
        await client.query('SET default_transaction_read_only=on');
        const r=await client.query('SELECT public.auction_scheduler_health() AS health');return r.rows[0]?.health;}
      finally{await client.end().catch(()=>undefined);}
    },
    sendAlert:alertUrl?async event=>{
      const r=await fetch(alertUrl,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{'content-type':'application/json','idempotency-key':event.id},body:JSON.stringify(event)});
      await r.body?.cancel(); if(!r.ok) throw Error('Alert delivery failed');
    }:undefined,
  });
  console.log(JSON.stringify(result));
  if(!alertUrl) console.log('Alert delivery is not configured; events remain queued.');
  if (monitorExitCode(result, Boolean(alertUrl)) !== 0) {
    console.error('Scheduler alert delivery is unavailable or pending; retry required.');
    process.exitCode = 1;
  }
}
