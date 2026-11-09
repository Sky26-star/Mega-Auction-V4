-- Apply after auction-action-ledger.sql in a disposable database for validation.
-- Disabled by default. No cron installation or activation occurs in this file.
BEGIN;
ALTER TABLE auction_recovery.control ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0 CHECK(consecutive_failures>=0);
ALTER TABLE auction_recovery.control ADD COLUMN last_tick_at timestamptz;
ALTER TABLE auction_recovery.control ADD COLUMN last_success_at timestamptz;
CREATE TABLE auction_recovery.generations (
  kind text NOT NULL CHECK(kind IN ('LOT','AUCTION','MINI')),
  source_id uuid NOT NULL, generation bigint NOT NULL DEFAULT 1 CHECK(generation>0),
  PRIMARY KEY(kind,source_id)
);
CREATE FUNCTION auction_recovery.generation(p_kind text,p_id uuid) RETURNS bigint
LANGUAGE sql STABLE SET search_path=pg_catalog,auction_recovery AS $$
 SELECT COALESCE((SELECT generation FROM auction_recovery.generations WHERE kind=p_kind AND source_id=p_id),1);
$$;
CREATE FUNCTION auction_recovery.track_generation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,auction_recovery AS $$
DECLARE k text:=TG_ARGV[0]; advance boolean:=false;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF k='LOT' THEN advance:=OLD.status IN ('SOLD','UNSOLD','SKIPPED') AND NEW.status IN ('PENDING','GET_READY','BIDDING');
  ELSIF k='AUCTION' THEN advance:=(OLD.status IS DISTINCT FROM NEW.status AND (OLD.status='PAUSED' OR NEW.status='PAUSED'))
   OR (NEW.status='PAUSED' AND OLD.paused_reason IS DISTINCT FROM NEW.paused_reason);
  ELSE advance:=NEW.status='SELECTION_OPEN' AND OLD.status IS DISTINCT FROM NEW.status;
  END IF;
 END IF;
 INSERT INTO auction_recovery.generations(kind,source_id,generation) VALUES(k,NEW.id,CASE WHEN advance THEN 2 ELSE 1 END)
 ON CONFLICT(kind,source_id) DO UPDATE SET generation=auction_recovery.generations.generation+CASE WHEN advance THEN 1 ELSE 0 END;
 RETURN NEW;
END $$;
CREATE TRIGGER scheduler_lot_generation AFTER INSERT OR UPDATE ON public.auction_lots FOR EACH ROW EXECUTE FUNCTION auction_recovery.track_generation('LOT');
CREATE TRIGGER scheduler_auction_generation AFTER INSERT OR UPDATE ON public.auctions FOR EACH ROW EXECUTE FUNCTION auction_recovery.track_generation('AUCTION');
CREATE TRIGGER scheduler_mini_generation AFTER INSERT OR UPDATE ON public.mini_auction_sessions FOR EACH ROW EXECUTE FUNCTION auction_recovery.track_generation('MINI');

ALTER TABLE auction_recovery.lot_actions DROP CONSTRAINT lot_actions_lot_id_kind_key;
ALTER TABLE auction_recovery.lot_actions ADD COLUMN generation bigint NOT NULL DEFAULT 1;
ALTER TABLE auction_recovery.lot_actions ADD COLUMN auction_generation bigint NOT NULL DEFAULT 1;
ALTER TABLE auction_recovery.lot_actions ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE auction_recovery.lot_actions ADD COLUMN transient_failures integer NOT NULL DEFAULT 0;
ALTER TABLE auction_recovery.lot_actions DROP CONSTRAINT lot_actions_state_check;
ALTER TABLE auction_recovery.lot_actions ADD CONSTRAINT lot_actions_state_check CHECK(state IN ('PENDING','COMPLETED','RECONCILIATION_REQUIRED','SUPERSEDED'));
ALTER TABLE auction_recovery.lot_actions ADD CONSTRAINT lot_action_identity UNIQUE(lot_id,kind,generation,auction_generation);
CREATE TABLE auction_recovery.executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), epoch bigint NOT NULL,
 worker_id text NOT NULL CHECK(length(worker_id) BETWEEN 1 AND 100),
 state text NOT NULL DEFAULT 'PLANNED' CHECK(state IN ('PLANNED','COMPLETED','PARTIAL','QUARANTINED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz
);
CREATE TABLE auction_recovery.execution_actions (
 execution_id uuid NOT NULL REFERENCES auction_recovery.executions(id),
 action_id uuid NOT NULL REFERENCES auction_recovery.lot_actions(id),
 PRIMARY KEY(execution_id,action_id)
);
CREATE TABLE auction_recovery.alert_outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 dedupe_key text NOT NULL UNIQUE, kind text NOT NULL,
 action_id uuid REFERENCES auction_recovery.lot_actions(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 delivered_at timestamptz, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION auction_recovery.require_operator() RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$ BEGIN
 IF session_user<>'postgres' OR COALESCE(current_setting('role',true),'') NOT IN ('none','postgres') THEN
  RAISE EXCEPTION 'SCHEDULER_PRINCIPAL_REQUIRED' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION auction_recovery.plan_due_auction_actions(p_max_auctions integer DEFAULT 10,p_max_actions integer DEFAULT 25,p_worker_id text DEFAULT 'pg_cron')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery,public AS $$
DECLARE c auction_recovery.control%ROWTYPE; a record; l record; eid uuid; aid uuid; n integer:=0;
BEGIN
 PERFORM auction_recovery.require_operator();
 IF p_max_auctions IS NULL OR p_max_actions IS NULL OR p_max_auctions NOT BETWEEN 1 AND 100 OR p_max_actions NOT BETWEEN 1 AND 100
 OR p_worker_id IS NULL OR length(p_worker_id) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PLAN_LIMIT'; END IF;
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
 IF NOT c.enabled OR c.circuit<>'CLOSED' THEN RETURN NULL; END IF;
 UPDATE auction_recovery.control SET last_tick_at=clock_timestamp() WHERE singleton;
 FOR a IN SELECT q.* FROM public.auctions q WHERE q.status='IN_PROGRESS'
  AND EXISTS(SELECT 1 FROM public.auction_lots due_lot WHERE due_lot.auction_id=q.id AND due_lot.id=q.current_lot_id
   AND ((due_lot.status='GET_READY' AND due_lot.get_ready_expires_at<=clock_timestamp()) OR (due_lot.status='BIDDING' AND due_lot.timer_expires_at<=clock_timestamp())))
  AND NOT EXISTS(SELECT 1 FROM auction_recovery.lot_actions x WHERE x.auction_id=q.id AND x.state='RECONCILIATION_REQUIRED')
  ORDER BY id LIMIT p_max_auctions FOR UPDATE SKIP LOCKED LOOP
  EXIT WHEN n>=p_max_actions;
  SELECT * INTO l FROM public.auction_lots WHERE auction_id=a.id AND id=a.current_lot_id;
  IF l.id IS NULL OR NOT ((l.status='GET_READY' AND l.get_ready_expires_at<=clock_timestamp())
    OR (l.status='BIDDING' AND l.timer_expires_at<=clock_timestamp())) THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE auction_id=a.id AND state='RECONCILIATION_REQUIRED') THEN CONTINUE; END IF;
  IF eid IS NULL THEN INSERT INTO auction_recovery.executions(epoch,worker_id) VALUES(c.epoch,p_worker_id) RETURNING id INTO eid; END IF;
  INSERT INTO auction_recovery.lot_actions(auction_id,lot_id,kind,generation,auction_generation)
   VALUES(a.id,l.id,CASE WHEN l.status='GET_READY' THEN 'START_BIDDING' ELSE 'FINALIZE' END,
    auction_recovery.generation('LOT',l.id),auction_recovery.generation('AUCTION',a.id))
   ON CONFLICT(lot_id,kind,generation,auction_generation) DO NOTHING RETURNING id INTO aid;
  IF aid IS NULL THEN SELECT id INTO aid FROM auction_recovery.lot_actions WHERE lot_id=l.id
   AND kind=CASE WHEN l.status='GET_READY' THEN 'START_BIDDING' ELSE 'FINALIZE' END
   AND generation=auction_recovery.generation('LOT',l.id) AND auction_generation=auction_recovery.generation('AUCTION',a.id); END IF;
  INSERT INTO auction_recovery.execution_actions VALUES(eid,aid) ON CONFLICT DO NOTHING;
  n:=n+1;
 END LOOP;
 IF n=0 THEN UPDATE auction_recovery.executions SET state='COMPLETED',completed_at=clock_timestamp() WHERE id=eid; END IF;
 RETURN eid;
END $$;

-- SAFE_DEFER_RACE is intentionally not a global circuit failure. The original
-- financial RPC owns advisory/lot/team locking and due-time validation.
CREATE OR REPLACE FUNCTION auction_recovery.apply_lot_action(p_action uuid,p_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery,public,pg_temp AS $$
DECLARE c auction_recovery.control%ROWTYPE; a auction_recovery.lot_actions%ROWTYPE;
 l public.auction_lots%ROWTYPE; au public.auctions%ROWTYPE; r jsonb; outcome text; code text;
BEGIN
 PERFORM auction_recovery.require_operator();
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
 IF NOT c.enabled OR c.circuit<>'CLOSED' THEN RAISE EXCEPTION 'SCHEDULER_DISABLED'; END IF;
 IF p_epoch IS NULL OR c.epoch<>p_epoch THEN RAISE EXCEPTION 'STALE_SCHEDULER_EPOCH'; END IF;
 SELECT * INTO STRICT a FROM auction_recovery.lot_actions WHERE id=p_action FOR UPDATE;
 IF a.state='COMPLETED' THEN RETURN a.result; END IF;
 IF a.state<>'PENDING' THEN RAISE EXCEPTION 'RECONCILIATION_REQUIRED'; END IF;
 IF a.next_attempt_at>clock_timestamp() THEN RETURN jsonb_build_object('success',false,'outcome','BACKOFF'); END IF;
 -- Serialize host pause/countdown updates with the decision and transition.
 -- Deadlocks with legacy entrypoints are handled as rolled-back transient work.
 SELECT * INTO au FROM public.auctions WHERE id=a.auction_id FOR UPDATE;
 SELECT * INTO l FROM public.auction_lots WHERE id=a.lot_id AND auction_id=a.auction_id;
 IF a.generation<>auction_recovery.generation('LOT',a.lot_id)
 OR a.auction_generation<>auction_recovery.generation('AUCTION',a.auction_id) THEN
  UPDATE auction_recovery.lot_actions SET state='SUPERSEDED',result=jsonb_build_object('success',false,'outcome','SAFE_DEFER_RACE') WHERE id=a.id;
  INSERT INTO auction_recovery.attempts(action_id,epoch,outcome) VALUES(a.id,c.epoch,'DEFERRED');
  RETURN jsonb_build_object('success',false,'outcome','SAFE_DEFER_RACE');
 END IF;
 IF au.status IS DISTINCT FROM 'IN_PROGRESS' OR au.current_lot_id IS DISTINCT FROM a.lot_id
 OR (a.kind='START_BIDDING' AND (l.status IS DISTINCT FROM 'GET_READY' OR l.get_ready_expires_at IS NULL OR l.get_ready_expires_at>clock_timestamp()))
 OR (a.kind='FINALIZE' AND (l.status IS DISTINCT FROM 'BIDDING' OR l.timer_expires_at IS NULL OR l.timer_expires_at>clock_timestamp())) THEN
  INSERT INTO auction_recovery.attempts(action_id,epoch,outcome) VALUES(a.id,c.epoch,'DEFERRED');
  RETURN jsonb_build_object('success',false,'outcome','SAFE_DEFER_RACE');
 END IF;
 BEGIN
  IF a.kind='START_BIDDING' THEN r:=public.v3_start_bidding(a.auction_id,a.lot_id,false);
  ELSE r:=public.v3_finalize_and_advance_lot(a.auction_id,a.lot_id,false); END IF;
  IF r->'success' IS DISTINCT FROM 'true'::jsonb THEN
   IF r->>'error' IN ('ERR_TIMER_NOT_EXPIRED','ERR_LOT_NOT_BIDDING','ERR_LOT_NOT_GET_READY','ERR_NOT_CURRENT_LOT','ERR_CONCURRENT_AUCTION_FINALIZATION_IN_PROGRESS') THEN
    RAISE EXCEPTION 'SAFE_DEFER_RACE' USING ERRCODE='P0002';
   END IF;
   RAISE EXCEPTION 'BUSINESS_TRANSITION_REJECTED';
  END IF;
  UPDATE auction_recovery.lot_actions SET state='COMPLETED',result=r,completed_at=clock_timestamp() WHERE id=a.id;
  INSERT INTO auction_recovery.attempts(action_id,epoch,outcome) VALUES(a.id,c.epoch,'COMPLETED');
  UPDATE auction_recovery.control SET last_success_at=clock_timestamp() WHERE singleton;
  RETURN r;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code='P0002' THEN outcome:='DEFERRED';
  ELSIF code IN ('40001','40P01','55P03') AND a.transient_failures<4 THEN
   outcome:='DEFERRED';
   UPDATE auction_recovery.lot_actions SET transient_failures=transient_failures+1,
    next_attempt_at=clock_timestamp()+make_interval(secs=>power(2,transient_failures+1)::integer) WHERE id=a.id;
  ELSE
   outcome:='FAILED';
   UPDATE auction_recovery.lot_actions SET state='RECONCILIATION_REQUIRED' WHERE id=a.id;
   UPDATE auction_recovery.control SET consecutive_failures=consecutive_failures+1,
    enabled=consecutive_failures+1<5,circuit=CASE WHEN consecutive_failures+1>=5 THEN 'OPEN' ELSE circuit END WHERE singleton;
   INSERT INTO auction_recovery.alert_outbox(dedupe_key,kind,action_id) VALUES('quarantine:'||a.id,'QUARANTINE_FAULT',a.id) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO auction_recovery.attempts(action_id,epoch,outcome,error_code) VALUES(a.id,c.epoch,outcome,code);
  RETURN jsonb_build_object('success',false,'outcome',CASE WHEN outcome='FAILED' THEN 'QUARANTINE_FAULT' ELSE 'SAFE_DEFER_RACE' END);
 END;
END $$;

-- Top-level CALL only. Transaction control is deliberately outside invoker
-- functions and exception blocks. A slice commits each action independently;
-- an interrupted slice is recoverable from its action records.
CREATE PROCEDURE auction_recovery.run_lot_tick(p_max_auctions integer DEFAULT 10,p_max_actions integer DEFAULT 25)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE execution uuid; expected_epoch bigint; task record;
BEGIN
 PERFORM auction_recovery.require_operator();
 execution:=auction_recovery.plan_due_auction_actions(p_max_auctions,p_max_actions,'pg_cron');
 IF execution IS NULL THEN RETURN; END IF;
 SELECT epoch INTO expected_epoch FROM auction_recovery.executions WHERE id=execution;
 COMMIT;
 FOR task IN SELECT a.id FROM auction_recovery.lot_actions a JOIN auction_recovery.execution_actions e ON e.action_id=a.id
 WHERE e.execution_id=execution AND a.state='PENDING' ORDER BY a.created_at,a.id LOOP
  PERFORM auction_recovery.apply_lot_action(task.id,expected_epoch);
  COMMIT;
 END LOOP;
 UPDATE auction_recovery.executions e SET
  state=CASE WHEN EXISTS(SELECT 1 FROM auction_recovery.execution_actions x JOIN auction_recovery.lot_actions a ON a.id=x.action_id WHERE x.execution_id=e.id AND a.state='RECONCILIATION_REQUIRED') THEN 'QUARANTINED'
   WHEN EXISTS(SELECT 1 FROM auction_recovery.execution_actions x JOIN auction_recovery.lot_actions a ON a.id=x.action_id WHERE x.execution_id=e.id AND a.state='PENDING') THEN 'PARTIAL' ELSE 'COMPLETED' END,
  completed_at=clock_timestamp() WHERE id=execution;
 COMMIT;
END $$;

ALTER TABLE auction_recovery.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.execution_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.alert_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON PROCEDURE auction_recovery.run_lot_tick(integer,integer) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
