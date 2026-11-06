import { execFileSync } from 'node:child_process';
const [container,database] = process.argv.slice(2);
if (!container || !/^mega_auction_ledger_retry_[0-9]+$/.test(database || '')) throw Error('Explicit isolated fixture target required');
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
if(info.Config.Labels['mega-auction.purpose']!=='isolated-action-ledger'||info.HostConfig.NetworkMode!=='none'||info.Mounts.some(m=>m.Type!=='tmpfs')) throw Error('Unsafe target');
function sql(input){return execFileSync('docker',['exec','-i',container,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-p','55325','-d',database],{input,encoding:'utf8'});}
sql(`BEGIN;
CREATE FUNCTION pg_temp.assert_engine(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Engine assertion: %',msg; END IF; END $$;
SELECT pg_temp.assert_engine((SELECT count(*)=1 FROM public.rooms WHERE code='RLSCHK'),'synthetic fixture present');
SELECT pg_temp.assert_engine((SELECT enabled AND circuit='CLOSED' FROM auction_recovery.control),'test-only enabled control');
SELECT pg_temp.assert_engine(NOT has_function_privilege('anon','auction_recovery.plan_due_auction_actions(integer,integer,text)','EXECUTE'),'anon planner denied');
SELECT pg_temp.assert_engine(NOT has_function_privilege('authenticated','auction_recovery.plan_due_auction_actions(integer,integer,text)','EXECUTE'),'human planner denied');
UPDATE public.auction_lots SET timer_expires_at=clock_timestamp()-interval '1 second' WHERE status='BIDDING';
SELECT auction_recovery.plan_due_auction_actions();
SELECT auction_recovery.plan_due_auction_actions();
SELECT pg_temp.assert_engine((SELECT count(*)=1 FROM auction_recovery.lot_actions x JOIN public.auctions a ON a.current_lot_id=x.lot_id WHERE x.kind='FINALIZE' AND x.state='PENDING'),'planner deduplicates same due action');
-- Genuine authoritative timer change after planning, before execution.
UPDATE public.auction_lots SET timer_expires_at=clock_timestamp()+interval '1 hour' WHERE status='BIDDING';
SELECT pg_temp.assert_engine((SELECT auction_recovery.apply_lot_action(x.id,1)->>'outcome'='SAFE_DEFER_RACE'
 FROM auction_recovery.lot_actions x JOIN public.auctions a ON a.current_lot_id=x.lot_id WHERE x.kind='FINALIZE' AND x.state='PENDING'),'timer extension safely defers');
SELECT pg_temp.assert_engine((SELECT consecutive_failures=0 AND enabled AND circuit='CLOSED' FROM auction_recovery.control),'race leaves healthy circuit');
UPDATE public.auctions SET status='PAUSED',paused_reason='{"remaining_ms":15000}' WHERE status='IN_PROGRESS';
SELECT pg_temp.assert_engine((SELECT auction_recovery.generation('AUCTION',id)=2 FROM public.auctions),'pause advances lifecycle');
SELECT pg_temp.assert_engine((SELECT auction_recovery.apply_lot_action(x.id,1)->>'outcome'='SAFE_DEFER_RACE'
 FROM auction_recovery.lot_actions x JOIN public.auctions a ON a.current_lot_id=x.lot_id WHERE x.kind='FINALIZE' AND x.state='PENDING'),'stale action does not execute');
UPDATE public.auctions SET status='IN_PROGRESS',paused_reason=NULL WHERE status='PAUSED';
SELECT pg_temp.assert_engine((SELECT auction_recovery.generation('AUCTION',id)=3 FROM public.auctions),'resume advances lifecycle');
UPDATE public.auction_lots SET timer_expires_at=clock_timestamp()-interval '1 second' WHERE status='BIDDING';
SELECT auction_recovery.plan_due_auction_actions();
SELECT pg_temp.assert_engine((SELECT count(*)=1 FROM auction_recovery.lot_actions x JOIN public.auctions a ON a.current_lot_id=x.lot_id WHERE x.kind='FINALIZE' AND x.state='PENDING'),'new generation has one eligible action');
SELECT pg_temp.assert_engine((SELECT count(*)=1 FROM auction_recovery.lot_actions WHERE state='SUPERSEDED'),'stale action remains terminal');
SELECT pg_temp.assert_engine((SELECT auction_recovery.apply_lot_action(x.id,1)->>'success'='true'
 FROM auction_recovery.lot_actions x JOIN public.auctions a ON a.current_lot_id=x.lot_id WHERE x.kind='FINALIZE' AND x.auction_generation=3),'new generation completes normally');
SELECT pg_temp.assert_engine((SELECT count(*)=1 FROM public.squad_players),'previous sold squad untouched');
SELECT pg_temp.assert_engine((SELECT count(*)=1 FROM public.auction_lots WHERE status='UNSOLD'),'unsold transition preserved');
DO $$ DECLARE rejected boolean:=false; BEGIN BEGIN PERFORM auction_recovery.plan_due_auction_actions(0); EXCEPTION WHEN raise_exception THEN rejected:=true; END; IF NOT rejected THEN RAISE EXCEPTION 'Unbounded/invalid planner accepted'; END IF; END $$;
ROLLBACK;`);
// Fault injection is transaction-local to this synthetic database. Simulate a
// partial business write that raises; the executor's subtransaction must undo
// it while preserving earlier independently committed sold work.
sql(`BEGIN;
CREATE TEMP TABLE before_fault AS SELECT id,purse,players_bought FROM public.teams;
DO $inject$ DECLARE arguments text; BEGIN
 SELECT pg_get_function_arguments('public.v3_finalize_and_advance_lot(uuid,uuid,boolean)'::regprocedure) INTO arguments;
 EXECUTE format($definition$CREATE OR REPLACE FUNCTION public.v3_finalize_and_advance_lot(%s) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $body$
 BEGIN UPDATE public.teams SET purse=purse-100; RAISE EXCEPTION 'SYNTHETIC_PARTIAL_FAILURE'; END $body$;$definition$,arguments);
END $inject$;
UPDATE public.auction_lots SET timer_expires_at=clock_timestamp()-interval '1 second' WHERE status='BIDDING';
SELECT auction_recovery.plan_due_auction_actions();
SELECT auction_recovery.apply_lot_action(id,1) FROM auction_recovery.lot_actions WHERE state='PENDING' AND kind='FINALIZE';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.teams t JOIN before_fault b USING(id) WHERE (t.purse,t.players_bought) IS DISTINCT FROM (b.purse,b.players_bought))
 OR (SELECT count(*) FROM public.squad_players)<>1
 OR NOT EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE state='RECONCILIATION_REQUIRED')
 OR NOT EXISTS(SELECT 1 FROM auction_recovery.alert_outbox WHERE kind='QUARANTINE_FAULT')
 OR (SELECT count(*) FROM auction_recovery.lot_actions WHERE state='COMPLETED')<>2
 THEN RAISE EXCEPTION 'Partial failure lost prior completion or leaked partial financial writes'; END IF;
END $$;
ROLLBACK;`);
console.log('PASS: planner deduplication/bounds, API privilege checks, timer extension safe-defer, pause/resume generations, stale action rejection, fresh-generation unsold completion and prior squad preservation. Fixtures rolled back.');
console.log('PASS: injected partial business failure rolls back its purse writes, preserves earlier committed completion/squad, quarantines pending work and queues an alert. Injection rolled back.');
