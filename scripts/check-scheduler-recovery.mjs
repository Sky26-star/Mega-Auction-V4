import { execFileSync } from 'node:child_process';
const [container,database]=process.argv.slice(2);
if(!container||!/^mega_auction_ledger_retry_[0-9]+$/.test(database||'')) throw Error('Isolated fixture target required');
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
if(info.Config.Labels['mega-auction.purpose']!=='isolated-action-ledger'||info.HostConfig.NetworkMode!=='none'||info.Mounts.some(m=>m.Type!=='tmpfs')) throw Error('Unsafe target');
const sql=`BEGIN;
CREATE FUNCTION pg_temp.assert_recovery(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Recovery assertion: %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.expect_rejection(command text,message text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean:=false; BEGIN BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
 IF position(message in SQLERRM)>0 THEN rejected:=true; ELSE RAISE; END IF;
END; IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %',message; END IF; END $$;
SELECT pg_temp.assert_recovery(NOT has_function_privilege('authenticated','auction_recovery.reset_scheduler_circuit_guarded(uuid,bigint)','EXECUTE'),'reset is private');
CREATE TEMP TABLE recovery_fixture AS SELECT auction_recovery.begin_recovery('Synthetic recovery validation') AS id;
SELECT pg_temp.assert_recovery((SELECT NOT enabled AND epoch=2 FROM auction_recovery.control),'begin disables and fences old epoch');
SELECT pg_temp.expect_rejection(format('SELECT auction_recovery.reset_scheduler_circuit_guarded(%L,2)',id),'CURRENT_RECOVERY_APPROVAL_REQUIRED') FROM recovery_fixture;
SELECT auction_recovery.attest_shutdown(id,'Synthetic test: no scheduler cron installed and all test executor connections have completed.') FROM recovery_fixture;
INSERT INTO auction_recovery.lot_actions(auction_id,lot_id,kind,state) VALUES(gen_random_uuid(),gen_random_uuid(),'FINALIZE','RECONCILIATION_REQUIRED');
SELECT pg_temp.expect_rejection(format('SELECT auction_recovery.approve_reset(%L)',id),'UNRECONCILED_ACTIONS') FROM recovery_fixture;
SELECT auction_recovery.resolve_action_no_replay(c.id,a.id,'LOT','Synthetic quarantined action has no valid target; inspected and permanently retired without replay or business repair.')
 FROM recovery_fixture c CROSS JOIN auction_recovery.lot_actions a WHERE a.state='RECONCILIATION_REQUIRED';
SELECT auction_recovery.approve_reset(id) FROM recovery_fixture;
DO $$ BEGIN IF (SELECT count(*) FROM auction_recovery.action_dispositions)<>1 THEN RAISE EXCEPTION 'Missing audited quarantine disposition'; END IF; END $$;
-- Roll back the entire synthetic unknown-case transaction. Its disappearance
-- is not treated as evidence for any real unknown execution.
ROLLBACK;
BEGIN;
CREATE TEMP TABLE recovery_fixture AS SELECT auction_recovery.begin_recovery('Synthetic clean recovery validation') AS id;
SELECT auction_recovery.attest_shutdown(id,'Synthetic test: no cron installed, no remote workers, all local executor connections completed.') FROM recovery_fixture;
SELECT auction_recovery.approve_reset(id) FROM recovery_fixture;
SELECT auction_recovery.reset_scheduler_circuit_guarded(id,2) FROM recovery_fixture;
DO $$ BEGIN IF NOT(SELECT NOT enabled AND circuit='OPEN' AND consecutive_failures=0 AND epoch=3 FROM auction_recovery.control)
 THEN RAISE EXCEPTION 'Reset activated or failed fencing'; END IF;
 BEGIN PERFORM auction_recovery.activate_scheduler((SELECT id FROM recovery_fixture),3);
 RAISE EXCEPTION 'Activation without separate approval accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SEPARATE_ACTIVATION_APPROVAL_REQUIRED' THEN RAISE; END IF; END;
END $$;
SELECT auction_recovery.approve_activation(id) FROM recovery_fixture;
-- Only a rollback-only control fixture, never a cron job or hosted scheduler.
SELECT auction_recovery.activate_scheduler(id,3) FROM recovery_fixture;
DO $$ BEGIN IF NOT(SELECT enabled AND circuit='CLOSED' FROM auction_recovery.control) THEN RAISE EXCEPTION 'Authorized control activation failed'; END IF; END $$;
ROLLBACK;`;
execFileSync('docker',['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-p','55325','-d',database],{input:sql,encoding:'utf8'});
console.log('PASS: disable/epoch fencing, private reset ACL, rejection without evidence and with unknown work, reset remains disabled, separate activation approval required. All test mutations rolled back.');
console.log('PASS: known quarantined action can be permanently retired with evidence; no business replay or repair. Lease/unknown-claim paths have a separate suite.');
