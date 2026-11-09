-- Local candidate after workflows. No cron creation or activation.
BEGIN;
ALTER TABLE auction_recovery.control ADD COLUMN delivery_owner text NOT NULL DEFAULT 'DATABASE' CHECK(delivery_owner IN ('DATABASE','LEGACY'));
CREATE FUNCTION public.auction_scheduler_owner() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,auction_recovery AS $$ SELECT delivery_owner FROM auction_recovery.control WHERE singleton $$;
REVOKE ALL ON FUNCTION public.auction_scheduler_owner() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auction_scheduler_owner() TO service_role;
CREATE TABLE auction_recovery.claims (
 token uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('LOT','WORKFLOW')), epoch bigint NOT NULL,
 owner_name text NOT NULL, worker_id text NOT NULL CHECK(length(worker_id) BETWEEN 1 AND 100),
 state text NOT NULL DEFAULT 'CLAIMED' CHECK(state IN ('CLAIMED','COMPLETED','UNKNOWN','RESOLVED_NO_REPLAY')),
 lease_expires_at timestamptz NOT NULL, result jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX one_unresolved_claim ON auction_recovery.claims(kind,action_id) WHERE state IN ('CLAIMED','UNKNOWN');
CREATE FUNCTION auction_recovery.claim_action(p_action uuid,p_kind text,p_epoch bigint,p_worker text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
DECLARE c auction_recovery.control%ROWTYPE; t uuid;
BEGIN
 PERFORM auction_recovery.require_operator();
 IF p_epoch IS NULL OR p_kind IS NULL OR p_kind NOT IN ('LOT','WORKFLOW') OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_CLAIM'; END IF;
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
 IF NOT c.enabled OR c.circuit<>'CLOSED' OR c.delivery_owner<>'DATABASE' OR c.epoch<>p_epoch THEN RAISE EXCEPTION 'CLAIMS_DISABLED_OR_FENCED'; END IF;
 IF p_kind='LOT' THEN
  PERFORM 1 FROM auction_recovery.lot_actions WHERE id=p_action AND state='PENDING' AND next_attempt_at<=clock_timestamp() FOR UPDATE;
 ELSE PERFORM 1 FROM auction_recovery.workflow_actions WHERE id=p_action AND state='PENDING' FOR UPDATE; END IF;
 IF NOT FOUND THEN
  -- A host or another executor can finish between planning and claiming. That
  -- is a harmless race, not a circuit failure or permission to replay.
  IF (p_kind='LOT' AND EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE id=p_action))
   OR (p_kind='WORKFLOW' AND EXISTS(SELECT 1 FROM auction_recovery.workflow_actions WHERE id=p_action)) THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'ACTION_NOT_FOUND';
 END IF;
 INSERT INTO auction_recovery.claims(action_id,kind,epoch,owner_name,worker_id,lease_expires_at)
 VALUES(p_action,p_kind,p_epoch,session_user,p_worker,clock_timestamp()+interval '30 seconds') ON CONFLICT DO NOTHING RETURNING token INTO t;
 -- Existing/expired claims are never silently stolen.
 RETURN t;
END $$;
CREATE FUNCTION auction_recovery.execute_claim(p_token uuid,p_epoch bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
DECLARE c auction_recovery.control%ROWTYPE; cl auction_recovery.claims%ROWTYPE; r jsonb;
BEGIN
 PERFORM auction_recovery.require_operator();
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT cl FROM auction_recovery.claims WHERE token=p_token FOR UPDATE;
 IF p_epoch IS NULL OR NOT c.enabled OR c.circuit<>'CLOSED' OR c.delivery_owner<>'DATABASE' OR c.epoch<>p_epoch OR cl.epoch<>p_epoch THEN RAISE EXCEPTION 'CLAIM_FENCED'; END IF;
 IF cl.state='COMPLETED' THEN RETURN cl.result; END IF;
 IF cl.state<>'CLAIMED' OR cl.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CLAIM_RECONCILIATION_REQUIRED'; END IF;
 IF cl.kind='LOT' THEN r:=auction_recovery.apply_lot_action(cl.action_id,p_epoch);
 ELSE r:=auction_recovery.apply_workflow(cl.action_id,p_epoch); END IF;
 -- This delivery attempt is complete even on a known safe defer. A later due
 -- action may have a new claim; replaying this token only returns this result.
 UPDATE auction_recovery.claims SET state='COMPLETED',result=r WHERE token=cl.token;
 RETURN r;
END $$;
CREATE FUNCTION auction_recovery.reconcile_claim(p_token uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
DECLARE cl auction_recovery.claims%ROWTYPE; s text; r jsonb;
BEGIN
 PERFORM auction_recovery.require_operator();
 -- If an old action transaction is running, this lock waits for its commit or
 -- rollback before checking outcome. Lease expiry is not process termination.
 PERFORM 1 FROM auction_recovery.control WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT cl FROM auction_recovery.claims WHERE token=p_token FOR UPDATE;
 IF cl.state IN ('COMPLETED','RESOLVED_NO_REPLAY') THEN RETURN cl.state; END IF;
 IF cl.lease_expires_at>clock_timestamp() THEN RAISE EXCEPTION 'VALID_LEASE_REMAINS'; END IF;
 IF cl.kind='LOT' THEN SELECT state,result INTO s,r FROM auction_recovery.lot_actions WHERE id=cl.action_id FOR UPDATE;
 ELSE SELECT state,result INTO s,r FROM auction_recovery.workflow_actions WHERE id=cl.action_id FOR UPDATE; END IF;
 IF s='COMPLETED' THEN UPDATE auction_recovery.claims SET state='COMPLETED',result=r WHERE token=cl.token; RETURN 'COMPLETED'; END IF;
 UPDATE auction_recovery.claims SET state='UNKNOWN' WHERE token=cl.token;
 IF cl.kind='LOT' THEN UPDATE auction_recovery.lot_actions SET state='RECONCILIATION_REQUIRED' WHERE id=cl.action_id;
 ELSE UPDATE auction_recovery.workflow_actions SET state='RECONCILIATION_REQUIRED' WHERE id=cl.action_id; END IF;
 UPDATE auction_recovery.control SET enabled=false,circuit='OPEN' WHERE singleton;
 INSERT INTO auction_recovery.alert_outbox(dedupe_key,kind) VALUES('unknown:'||cl.token,'UNKNOWN_CLAIM') ON CONFLICT DO NOTHING;
 RETURN 'UNKNOWN';
END $$;
CREATE TABLE auction_recovery.claim_dispositions (
 token uuid PRIMARY KEY REFERENCES auction_recovery.claims(token),
 case_id uuid NOT NULL REFERENCES auction_recovery.recovery_cases(id),
 operator_name text NOT NULL, evidence text NOT NULL CHECK(length(btrim(evidence))>=50),
 resolution text NOT NULL CHECK(resolution='NO_REPLAY'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION auction_recovery.resolve_claim_no_replay(p_case uuid,p_token uuid,p_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
DECLARE cl auction_recovery.claims%ROWTYPE;
BEGIN
 PERFORM auction_recovery.require_operator();
 PERFORM 1 FROM auction_recovery.control WHERE singleton AND NOT enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DISPATCHER_MUST_BE_DISABLED'; END IF;
 PERFORM 1 FROM auction_recovery.recovery_cases WHERE id=p_case AND state='OPEN' AND shutdown_evidence IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHUTDOWN_EVIDENCE_REQUIRED'; END IF;
 SELECT * INTO STRICT cl FROM auction_recovery.claims WHERE token=p_token FOR UPDATE;
 IF cl.state<>'UNKNOWN' OR cl.lease_expires_at>clock_timestamp() THEN RAISE EXCEPTION 'UNKNOWN_EXPIRED_CLAIM_REQUIRED'; END IF;
 INSERT INTO auction_recovery.claim_dispositions(token,case_id,operator_name,evidence,resolution) VALUES(p_token,p_case,session_user,p_evidence,'NO_REPLAY');
 UPDATE auction_recovery.claims SET state='RESOLVED_NO_REPLAY' WHERE token=p_token;
 IF cl.kind='LOT' THEN UPDATE auction_recovery.lot_actions SET state='SUPERSEDED' WHERE id=cl.action_id AND state='RECONCILIATION_REQUIRED';
 ELSE UPDATE auction_recovery.workflow_actions SET state='SUPERSEDED' WHERE id=cl.action_id AND state='RECONCILIATION_REQUIRED'; END IF;
 UPDATE auction_recovery.recovery_cases SET approved_hash=NULL,reset_approved_at=NULL WHERE id=p_case;
 INSERT INTO auction_recovery.operator_events(case_id,operator_name,event,epoch)
 SELECT p_case,session_user,'CLAIM_RESOLVED_NO_REPLAY',epoch FROM auction_recovery.control WHERE singleton;
END $$;
CREATE FUNCTION auction_recovery.guard_claim_recovery() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,auction_recovery AS $$ BEGIN
 IF (NEW.reset_approved_at IS NOT NULL OR NEW.activation_approved_at IS NOT NULL OR NEW.state IN ('RESET','ACTIVATED'))
 AND EXISTS(SELECT 1 FROM auction_recovery.claims WHERE state IN ('CLAIMED','UNKNOWN')) THEN RAISE EXCEPTION 'UNRECONCILED_CLAIMS'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recovery_requires_reconciled_claims BEFORE UPDATE ON auction_recovery.recovery_cases FOR EACH ROW EXECUTE FUNCTION auction_recovery.guard_claim_recovery();
-- Known failed actions also need an audited disposition; a completed delivery
-- claim is not proof that the business action succeeded. Never replay or repair
-- financial state here. A new business intent requires separate review.
CREATE TABLE auction_recovery.action_dispositions (
 kind text NOT NULL CHECK(kind IN ('LOT','WORKFLOW')), action_id uuid NOT NULL,
 case_id uuid NOT NULL REFERENCES auction_recovery.recovery_cases(id),
 operator_name text NOT NULL, evidence text NOT NULL CHECK(length(btrim(evidence))>=50),
 resolution text NOT NULL CHECK(resolution='NO_REPLAY'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(kind,action_id)
);
CREATE FUNCTION auction_recovery.resolve_action_no_replay(p_case uuid,p_action uuid,p_kind text,p_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
BEGIN
 PERFORM auction_recovery.require_operator();
 IF p_kind IS NULL OR p_kind NOT IN ('LOT','WORKFLOW') THEN RAISE EXCEPTION 'INVALID_ACTION_KIND'; END IF;
 PERFORM 1 FROM auction_recovery.control WHERE singleton AND NOT enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DISPATCHER_MUST_BE_DISABLED'; END IF;
 PERFORM 1 FROM auction_recovery.recovery_cases WHERE id=p_case AND state='OPEN' AND shutdown_evidence IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHUTDOWN_EVIDENCE_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM auction_recovery.claims WHERE action_id=p_action AND kind=p_kind AND state IN ('CLAIMED','UNKNOWN')) THEN
  RAISE EXCEPTION 'RECONCILE_CLAIM_FIRST'; END IF;
 IF p_kind='LOT' THEN
  UPDATE auction_recovery.lot_actions SET state='SUPERSEDED' WHERE id=p_action AND state='RECONCILIATION_REQUIRED';
 ELSE
  UPDATE auction_recovery.workflow_actions SET state='SUPERSEDED' WHERE id=p_action AND state='RECONCILIATION_REQUIRED';
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'QUARANTINED_ACTION_REQUIRED'; END IF;
 INSERT INTO auction_recovery.action_dispositions(kind,action_id,case_id,operator_name,evidence,resolution)
 VALUES(p_kind,p_action,p_case,session_user,p_evidence,'NO_REPLAY');
 UPDATE auction_recovery.recovery_cases SET approved_hash=NULL,reset_approved_at=NULL WHERE id=p_case;
 INSERT INTO auction_recovery.operator_events(case_id,operator_name,event,epoch)
 SELECT p_case,session_user,'ACTION_RESOLVED_NO_REPLAY',epoch FROM auction_recovery.control WHERE singleton;
END $$;
ALTER TABLE auction_recovery.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.claim_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.action_dispositions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
