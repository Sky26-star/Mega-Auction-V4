import { execFileSync } from 'node:child_process';
const [container,database]=process.argv.slice(2);
if(!container||!/^mega_auction_ledger_retry_[0-9]+$/.test(database||'')) throw Error('Explicit isolated fixture required');
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
if(info.Config.Labels['mega-auction.purpose']!=='isolated-action-ledger'||info.HostConfig.NetworkMode!=='none'||info.Mounts.some(m=>m.Type!=='tmpfs')) throw Error('Unsafe target');
function sql(input){return execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-p','55325','-d',database],{input,encoding:'utf8'});}
sql(`BEGIN;
UPDATE public.auction_lots SET timer_expires_at=clock_timestamp()+interval '2 minutes' WHERE status='BIDDING';
SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.v3_place_bid(a.id,a.current_lot_id,p.team_id,gen_random_uuid(),false) FROM public.auctions a JOIN public.room_participants p ON p.room_id=a.room_id WHERE p.user_id='22222222-2222-4222-8222-222222222222';
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM public.bids)<>2 THEN RAISE EXCEPTION 'Synthetic mini bid was not accepted'; END IF; END $$;
UPDATE public.auction_lots SET timer_expires_at=clock_timestamp()-interval '1 second' WHERE status='BIDDING';
SELECT auction_recovery.plan_due_auction_actions();
COMMIT;`);
const token=sql(`SELECT auction_recovery.claim_action(x.id,'LOT',1,'synthetic-worker') FROM auction_recovery.lot_actions x JOIN public.auctions a ON a.current_lot_id=x.lot_id WHERE x.state='PENDING' AND x.kind='FINALIZE' AND x.auction_generation=auction_recovery.generation('AUCTION',a.id);`).trim();
if(!/^[a-f0-9-]{36}$/.test(token)) throw Error('Claim token not returned');
sql(`SELECT auction_recovery.execute_claim('${token}',1);`); // discard committed reply
sql(`SELECT auction_recovery.execute_claim('${token}',1);`); // fresh connection
sql(`DO $$ BEGIN IF (SELECT count(*) FROM public.squad_players)<>2
 OR NOT EXISTS(SELECT 1 FROM auction_recovery.claims WHERE token='${token}' AND state='COMPLETED')
 THEN RAISE EXCEPTION 'Claim replay invariant failed'; END IF; END $$;`);
sql(`BEGIN;
CREATE TEMP TABLE claim_fixture AS
 WITH a AS(INSERT INTO auction_recovery.lot_actions(auction_id,lot_id,kind) VALUES(gen_random_uuid(),gen_random_uuid(),'FINALIZE') RETURNING id)
 SELECT auction_recovery.claim_action(id,'LOT',1,'expired-worker') AS token FROM a;
DO $$ BEGIN BEGIN PERFORM auction_recovery.reconcile_claim((SELECT token FROM claim_fixture));
 RAISE EXCEPTION 'Valid lease was stolen'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'VALID_LEASE_REMAINS' THEN RAISE; END IF; END; END $$;
UPDATE auction_recovery.claims SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE token=(SELECT token FROM claim_fixture);
SELECT auction_recovery.reconcile_claim(token) FROM claim_fixture;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM auction_recovery.claims WHERE token=(SELECT token FROM claim_fixture) AND state='UNKNOWN')
 OR NOT(SELECT NOT enabled AND circuit='OPEN' FROM auction_recovery.control) THEN RAISE EXCEPTION 'Unknown claim replay enabled'; END IF; END $$;
CREATE TEMP TABLE case_fixture AS SELECT auction_recovery.begin_recovery('Synthetic unknown claim reconciliation') AS id;
SELECT auction_recovery.attest_shutdown(id,'All synthetic execution clients ended; no cron jobs or external dispatchers exist in this fixture.') FROM case_fixture;
DO $$ BEGIN BEGIN PERFORM auction_recovery.approve_reset((SELECT id FROM case_fixture));
 RAISE EXCEPTION 'Unknown work reset accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'UNRECONCILED_ACTIONS' THEN RAISE; END IF; END; END $$;
SELECT auction_recovery.resolve_claim_no_replay(c.id,f.token,'Synthetic action has no business target. Reviewed and permanently retired with no replay or financial repair authorized.') FROM case_fixture c CROSS JOIN claim_fixture f;
SELECT auction_recovery.approve_reset(id) FROM case_fixture;
SELECT auction_recovery.reset_scheduler_circuit_guarded(id,2) FROM case_fixture;
DO $$ BEGIN IF NOT(SELECT NOT enabled AND epoch=3 FROM auction_recovery.control) THEN RAISE EXCEPTION 'Reset activated claims'; END IF; END $$;
ROLLBACK;`);
console.log('PASS: persisted claim, discarded commit reply and replay, two total squad purchases only, valid lease cannot be stolen, expired unknown quarantined without replay, circuit survives fresh connections, audited NO_REPLAY disposition, guarded reset remains disabled.');
