// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pollScheduler, monitorExitCode } from '../../../scripts/scheduler-monitor.mjs';
import { deliverSchedulerAlerts, alertDeliveryExitCode } from '../../../scripts/scheduler-alert-delivery.mjs';
const servers: Server[]=[];
async function listen(server:Server){servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw Error('Address');return `http://127.0.0.1:${a.port}`;}
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>((resolve,reject)=>{s.closeAllConnections();s.close(e=>e?reject(e):resolve());})));});
const healthy={schemaVersion:1,enabled:true,stale:false,circuit:'CLOSED',unknownClaims:0,quarantinedActions:0};
describe('independent scheduler monitor',()=>{
 it('durably queues outages, deduplicates repeated polls, retries delivery and records recovery',async()=>{
  const stateDirectory=mkdtempSync(join(tmpdir(),'ma-monitor-test-'));
  let available=false;let acceptAlerts=false;const delivered:string[]=[];const deliveryIds:string[]=[];
  const endpoint=await listen(createServer((_req,res)=>{res.writeHead(available?200:503,{'content-type':'application/json'});res.end(JSON.stringify(healthy));}));
  const alerts=await listen(createServer((req,res)=>{let text='';req.on('data',c=>{text+=c;});req.on('end',()=>{if(acceptAlerts){const e=JSON.parse(text);delivered.push(e.kind);deliveryIds.push(String(req.headers['idempotency-key']));}res.writeHead(acceptAlerts?200:503);res.end();});}));
  const options={stateDirectory,readHealth:async()=>{const r=await fetch(endpoint);if(!r.ok)throw Error('Unavailable');return r.json();},
   sendAlert:async(event:{id:string;kind:string})=>{const r=await fetch(alerts,{method:'POST',headers:{'idempotency-key':event.id},body:JSON.stringify(event)});await r.body?.cancel();if(!r.ok)throw Error('Retry later');}};
  expect(await pollScheduler(options)).toMatchObject({kind:'DATABASE_UNAVAILABLE',pending:1});
  expect(await pollScheduler(options)).toMatchObject({pending:1});
  acceptAlerts=true;
  expect(await pollScheduler({...options})).toMatchObject({pending:0});
  expect(delivered).toEqual(['DATABASE_UNAVAILABLE']);
  available=true;
  expect(await pollScheduler(options)).toMatchObject({kind:null,pending:0});
  expect(delivered).toEqual(['DATABASE_UNAVAILABLE','RECOVERED']);
  expect(new Set(deliveryIds).size).toBe(2);
 });
 it('detects stopped ticks without depending on scheduler-generated alerts',async()=>{
  const stateDirectory=mkdtempSync(join(tmpdir(),'ma-monitor-stale-'));const sent:string[]=[];
  const result=await pollScheduler({stateDirectory,readHealth:async()=>({...healthy,stale:true}),sendAlert:async (e:{kind:string})=>{sent.push(e.kind);}});
  expect(result.kind).toBe('STALE_SCHEDULER');expect(sent).toEqual(['STALE_SCHEDULER']);
 });
 it('retries an outbox event with the same destination dedupe ID after acknowledgement loss',async()=>{
  const accepted=new Map<string,unknown>();let messages=0;let acknowledged=false;
  const endpoint=await listen(createServer((req,res)=>{let text='';req.on('data',c=>{text+=c;});req.on('end',()=>{const event=JSON.parse(text);expect(event.token).toBeUndefined();accepted.set(String(req.headers['idempotency-key']),event);messages++;res.end();});}));
  const options={claim:async()=>[{id:7,kind:'TEST_EVENT',token:'test-only-claim-token',dedupeKey:'event-7'}],
   send:async(event:{id:string})=>{const r=await fetch(endpoint,{method:'POST',headers:{'idempotency-key':event.id},body:JSON.stringify(event)});await r.body?.cancel();},
   ack:async()=>{if(!acknowledged){acknowledged=true;throw Error('Lost DB acknowledgement');}return true;}};
  expect(await deliverSchedulerAlerts(options)).toMatchObject({delivered:0});
  expect(await deliverSchedulerAlerts(options)).toMatchObject({delivered:1});
  expect(messages).toBe(2);expect(accepted.size).toBe(1);
 });
});

describe('scheduler alert process exit status', () => {
  it('requires a configured receiver and an empty monitor queue', () => {
    expect(monitorExitCode({ pending: 0 }, true)).toBe(0);
    expect(monitorExitCode({ pending: 0 }, false)).toBe(1);
    expect(monitorExitCode({ pending: 1 }, true)).toBe(1);
  });

  it('signals failure when a real monitor delivery attempt is rejected', async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), 'ma-monitor-exit-'));

    const result = await pollScheduler({
      stateDirectory,
      readHealth: async () => ({ ...healthy, stale: true }),
      sendAlert: async () => {
        throw new Error('Simulated receiver outage');
      },
    });

    expect(result).toMatchObject({
      kind: 'STALE_SCHEDULER',
      pending: 1,
    });

    expect(monitorExitCode(result, true)).toBe(1);
  });

  it('signals failure for outbox send and acknowledgement failures', async () => {
    const event = {
      id: 51,
      kind: 'TEST_EVENT',
      token: 'synthetic-token',
      dedupeKey: 'synthetic-dedupe',
    };

    const sendFailure = await deliverSchedulerAlerts({
      claim: async () => [event],
      send: async () => {
        throw new Error('Simulated delivery failure');
      },
      ack: async () => true,
    });

    expect(sendFailure).toMatchObject({
      claimed: 1,
      delivered: 0,
    });
    expect(alertDeliveryExitCode(sendFailure)).toBe(1);

    const ackFailure = await deliverSchedulerAlerts({
      claim: async () => [event],
      send: async () => {},
      ack: async () => false,
    });

    expect(alertDeliveryExitCode(ackFailure)).toBe(1);
    expect(alertDeliveryExitCode({ claimed: 0, delivered: 0 })).toBe(0);
    expect(alertDeliveryExitCode({ claimed: 1, delivered: 1 })).toBe(0);
  });
});
