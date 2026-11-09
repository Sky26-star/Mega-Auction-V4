import { execFile, execFileSync } from 'node:child_process';
const [container,database]=process.argv.slice(2);
if(!container||!/^mega_auction_ledger_retry_[0-9]+$/.test(database||'')) throw Error('Explicit isolated fixture required');
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
if(info.Config.Labels['mega-auction.purpose']!=='isolated-action-ledger'||info.HostConfig.NetworkMode!=='none'||info.Mounts.some(m=>m.Type!=='tmpfs')) throw Error('Unsafe target');
function sql(input){return execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-p','55325','-d',database],{input,encoding:'utf8'});}
sql(`BEGIN;
UPDATE public.mini_auction_sessions SET status='SELECTION_OPEN',selection_expires_at=clock_timestamp()-interval '1 second';
SELECT auction_recovery.plan_due_workflows();
SELECT auction_recovery.apply_workflow(id,1) FROM auction_recovery.workflow_actions WHERE kind='MINI_CLOSE';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.mini_auction_sessions WHERE status='COMPLETED' AND total_lots=0)
OR NOT EXISTS(SELECT 1 FROM public.auctions WHERE status='COMPLETED') THEN RAISE EXCEPTION 'Zero nomination terminal behavior changed'; END IF; END $$;
ROLLBACK;`);
sql(`BEGIN;
UPDATE public.mini_auction_sessions SET status='SELECTION_OPEN',selection_expires_at=clock_timestamp()-interval '1 second';
INSERT INTO public.mini_auction_selections(auction_id,team_id,player_id)
SELECT a.id,t.id,l.player_id FROM public.auctions a JOIN public.teams t ON t.auction_id=a.id JOIN public.auction_lots l ON l.auction_id=a.id AND l.status='UNSOLD' ORDER BY t.id LIMIT 1;
SELECT public.v3_close_mini_selection(auction_id,false) FROM public.mini_auction_sessions;
DO $$ BEGIN IF (SELECT delivery_owner FROM auction_recovery.control WHERE singleton) IS DISTINCT FROM 'DATABASE' THEN RAISE EXCEPTION 'Expected DATABASE fixture before legacy compatibility test'; END IF; END $$;
UPDATE auction_recovery.control SET delivery_owner='LEGACY' WHERE singleton;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.v3_start_mini_auction(auction_id) FROM public.mini_auction_sessions;
SELECT public.v3_start_mini_auction(auction_id) FROM public.mini_auction_sessions;
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM auction_recovery.workflow_actions WHERE kind='MINI_START' AND state='COMPLETED')<>1
OR (SELECT count(*) FROM auction_recovery.mini_start_intents)<>1 THEN RAISE EXCEPTION 'Synchronous host start did not atomically record intent/result'; END IF; END $$;
ROLLBACK;`);
sql(`BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.rooms WHERE code='RLSCHK') OR NOT EXISTS(SELECT 1 FROM public.mini_auction_sessions WHERE status='SETUP') THEN RAISE EXCEPTION 'Fresh synthetic mini fixture required'; END IF; END $$;
UPDATE public.mini_auction_sessions SET status='SELECTION_OPEN',selection_expires_at=clock_timestamp()-interval '1 second';
INSERT INTO public.mini_auction_selections(auction_id,team_id,player_id)
 SELECT a.id,t.id,l.player_id FROM public.auctions a JOIN public.teams t ON t.auction_id=a.id
 JOIN public.auction_lots l ON l.auction_id=a.id AND l.status='UNSOLD' ORDER BY t.id LIMIT 1;
SELECT auction_recovery.plan_due_workflows();
SELECT auction_recovery.apply_workflow(id,1) FROM auction_recovery.workflow_actions WHERE kind='MINI_CLOSE';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.mini_auction_sessions WHERE status='SELECTION_CLOSED' AND total_lots=1)
 THEN RAISE EXCEPTION 'Mini close failed'; END IF; END $$;
SELECT auction_recovery.plan_due_workflows();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM auction_recovery.workflow_actions WHERE kind='MINI_START') THEN RAISE EXCEPTION 'Unauthorized automatic start planned'; END IF; END $$;
DO $$ BEGIN IF (SELECT delivery_owner FROM auction_recovery.control WHERE singleton) IS DISTINCT FROM 'DATABASE' THEN RAISE EXCEPTION 'Expected DATABASE owner'; END IF; END $$;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE outcome jsonb; BEGIN
 SELECT public.v3_start_mini_auction(auction_id)
 INTO STRICT outcome FROM public.mini_auction_sessions;
 IF outcome->>'error' IS DISTINCT FROM 'DATABASE_SCHEDULER_OWNS_TICKS'
 THEN RAISE EXCEPTION 'Authenticated host bypassed DATABASE scheduler';
 END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM auction_recovery.mini_start_intents)
 OR EXISTS(SELECT 1 FROM auction_recovery.workflow_actions WHERE kind='MINI_START')
 THEN RAISE EXCEPTION 'Rejected direct start created an intent or workflow';
 END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN PERFORM public.request_mini_start((SELECT id FROM public.auctions LIMIT 1),(SELECT id FROM public.mini_auction_sessions LIMIT 1),(SELECT closed_at FROM public.mini_auction_sessions LIMIT 1));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Non-host approval accepted'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.request_mini_start(s.auction_id,s.id,'2000-01-01'::timestamptz) FROM public.mini_auction_sessions s;
RAISE EXCEPTION 'Stale mini review accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'STALE_MINI_REVIEW' THEN RAISE; END IF; END; END $$;
SELECT public.request_mini_start(s.auction_id,s.id,s.closed_at) FROM public.mini_auction_sessions s;
RESET ROLE;
COMMIT;`);
// Fresh backend, no JWT: persisted host intent is required and sufficient for
// the reviewed private postgres transition. It never fabricates a user token.
// Competing real connections: host synchronous start and native recovery both
// observe the same durable intent. Shared control/auction locks serialize them.
function asyncSql(input){return new Promise((resolve,reject)=>{
 const child=execFile('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-p','55325','-d',database],{encoding:'utf8'},(error,stdout,stderr)=>error?reject(Error(stderr)):resolve(stdout));child.stdin.end(input);
});}
await Promise.all([
 asyncSql(`SELECT auction_recovery.apply_workflow(id,1) FROM auction_recovery.workflow_actions WHERE kind='MINI_START';`),
 asyncSql(`BEGIN; SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true); SET LOCAL ROLE authenticated; DO $$ DECLARE outcome jsonb; BEGIN SELECT public.v3_start_mini_auction(auction_id) INTO STRICT outcome FROM public.mini_auction_sessions; IF outcome->>'error' IS DISTINCT FROM 'DATABASE_SCHEDULER_OWNS_TICKS' THEN RAISE EXCEPTION 'Concurrent host call bypassed DATABASE scheduler'; END IF; END $$; COMMIT;`),
]);
sql(`SELECT auction_recovery.apply_workflow(id,1) FROM auction_recovery.workflow_actions WHERE kind='MINI_START';
DO $$ BEGIN IF (SELECT count(*) FROM public.auction_lots WHERE is_mini_round)<>1
 OR NOT EXISTS(SELECT 1 FROM public.mini_auction_sessions WHERE status='BIDDING')
 OR (SELECT count(*) FROM public.squad_players)<>1 THEN RAISE EXCEPTION 'Mini duplicate/recovery invariant failed'; END IF; END $$;
UPDATE public.auction_lots SET get_ready_expires_at=clock_timestamp()-interval '1 second' WHERE status='GET_READY';
SELECT public.v3_start_bidding(id,current_lot_id,false) FROM public.auctions;
UPDATE public.auctions SET status='PAUSED',paused_reason=jsonb_build_object('remaining_ms',15000,'resume_expires_at',extract(epoch FROM clock_timestamp()-interval '1 second')*1000)::text;
SELECT auction_recovery.plan_due_workflows();
SELECT auction_recovery.apply_workflow(id,1) FROM auction_recovery.workflow_actions WHERE kind='RESUME';
SELECT auction_recovery.apply_workflow(id,1) FROM auction_recovery.workflow_actions WHERE kind='RESUME';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.auctions WHERE status='IN_PROGRESS' AND paused_reason IS NULL)
 OR (SELECT count(*) FROM auction_recovery.workflow_actions WHERE kind='RESUME' AND state='COMPLETED')<>1
 THEN RAISE EXCEPTION 'Durable resume failed'; END IF; END $$;`);
console.log('PASS: mini close, no start without host intent, non-host denial, persisted approval across connections, cron principal without JWT, duplicate mini start, no duplicate mini lots/squad, persisted resume and duplicate resume.');
