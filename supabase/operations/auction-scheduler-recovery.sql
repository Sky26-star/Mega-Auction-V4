-- Local candidate. Apply after auction-scheduler-engine.sql. No activation.
BEGIN;
CREATE TABLE auction_recovery.recovery_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), epoch bigint NOT NULL,
 operator_name text NOT NULL, reason text NOT NULL CHECK(length(btrim(reason))>=10),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','RESET','ACTIVATED')),
 shutdown_evidence text, snapshot_hash text, approved_hash text,
 reset_approved_at timestamptz, activation_approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX one_open_scheduler_recovery ON auction_recovery.recovery_cases((true)) WHERE state='OPEN';
CREATE TABLE auction_recovery.reconciliations (
 action_id uuid PRIMARY KEY REFERENCES auction_recovery.lot_actions(id),
 case_id uuid NOT NULL REFERENCES auction_recovery.recovery_cases(id),
 operator_name text NOT NULL, evidence text NOT NULL CHECK(length(btrim(evidence))>=30),
 disposition text NOT NULL CHECK(disposition='MANUALLY_QUARANTINED_NO_REPLAY'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE auction_recovery.operator_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, case_id uuid NOT NULL REFERENCES auction_recovery.recovery_cases(id),
 operator_name text NOT NULL, event text NOT NULL, epoch bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION auction_recovery.state_hash() RETURNS text LANGUAGE sql STABLE
SET search_path=pg_catalog,auction_recovery AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
  'actions',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM auction_recovery.lot_actions a),
  'generations',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY kind,source_id),'[]'::jsonb) FROM auction_recovery.generations g),
  'reconciliation',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY action_id),'[]'::jsonb) FROM auction_recovery.reconciliations r)
 )::text,'UTF8')),'hex');
$$;
CREATE FUNCTION auction_recovery.begin_recovery(p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
DECLARE c auction_recovery.control%ROWTYPE; case_id uuid;
BEGIN
 PERFORM auction_recovery.require_operator();
 IF p_reason IS NULL OR length(btrim(p_reason))<10 THEN RAISE EXCEPTION 'RECOVERY_REASON_REQUIRED'; END IF;
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
 UPDATE auction_recovery.control SET enabled=false,circuit='OPEN',epoch=epoch+1 WHERE singleton;
 INSERT INTO auction_recovery.recovery_cases(epoch,operator_name,reason) VALUES(c.epoch+1,session_user,p_reason) RETURNING id INTO case_id;
 INSERT INTO auction_recovery.operator_events(case_id,operator_name,event,epoch) VALUES(case_id,session_user,'DISABLED_AND_FENCED',c.epoch+1);
 RETURN case_id;
END $$;
-- An administrative attestation is recorded as such, never inferred from a
-- missing transport record. It cannot mark business work completed or replay it.
CREATE FUNCTION auction_recovery.attest_shutdown(p_case uuid,p_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
BEGIN
 PERFORM auction_recovery.require_operator();
 PERFORM 1 FROM auction_recovery.control WHERE singleton AND NOT enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DISPATCHER_MUST_BE_DISABLED'; END IF;
 IF p_evidence IS NULL OR length(btrim(p_evidence))<30 THEN RAISE EXCEPTION 'SHUTDOWN_EVIDENCE_REQUIRED'; END IF;
 UPDATE auction_recovery.recovery_cases SET shutdown_evidence=p_evidence,reset_approved_at=NULL,approved_hash=NULL WHERE id=p_case AND state='OPEN';
 IF NOT FOUND THEN RAISE EXCEPTION 'OPEN_RECOVERY_CASE_REQUIRED'; END IF;
END $$;
CREATE FUNCTION auction_recovery.approve_reset(p_case uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
DECLARE h text;
BEGIN
 PERFORM auction_recovery.require_operator();
 PERFORM 1 FROM auction_recovery.control WHERE singleton AND NOT enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DISPATCHER_MUST_BE_DISABLED'; END IF;
 IF EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE state='RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'UNRECONCILED_ACTIONS'; END IF;
 h:=auction_recovery.state_hash();
 UPDATE auction_recovery.recovery_cases SET snapshot_hash=h,approved_hash=h,reset_approved_at=clock_timestamp()
  WHERE id=p_case AND state='OPEN' AND shutdown_evidence IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHUTDOWN_NOT_ATTESTED'; END IF;
 INSERT INTO auction_recovery.operator_events(case_id,operator_name,event,epoch)
  SELECT id,session_user,'RESET_APPROVED',epoch FROM auction_recovery.recovery_cases WHERE id=p_case;
 RETURN h;
END $$;
CREATE FUNCTION auction_recovery.reset_scheduler_circuit_guarded(p_case uuid,p_expected_epoch bigint) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
DECLARE c auction_recovery.control%ROWTYPE; rc auction_recovery.recovery_cases%ROWTYPE;
BEGIN
 PERFORM auction_recovery.require_operator();
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT rc FROM auction_recovery.recovery_cases WHERE id=p_case FOR UPDATE;
 IF p_expected_epoch IS NULL OR c.enabled OR c.epoch<>p_expected_epoch OR rc.epoch<>c.epoch THEN RAISE EXCEPTION 'DISABLED_CURRENT_EPOCH_REQUIRED'; END IF;
 IF rc.state<>'OPEN' OR rc.reset_approved_at IS NULL OR rc.reset_approved_at<clock_timestamp()-interval '15 minutes'
 OR rc.shutdown_evidence IS NULL OR rc.approved_hash IS DISTINCT FROM auction_recovery.state_hash() THEN RAISE EXCEPTION 'CURRENT_RECOVERY_APPROVAL_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE state='RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'UNRECONCILED_ACTIONS'; END IF;
 UPDATE auction_recovery.control SET consecutive_failures=0,enabled=false,circuit='OPEN',epoch=epoch+1 WHERE singleton;
 UPDATE auction_recovery.recovery_cases SET state='RESET',epoch=c.epoch+1 WHERE id=p_case;
 INSERT INTO auction_recovery.operator_events(case_id,operator_name,event,epoch) VALUES(p_case,session_user,'RESET_REMAINS_DISABLED',c.epoch+1);
END $$;
-- A separate administrative approval call is needed; reset never grants it.
CREATE FUNCTION auction_recovery.approve_activation(p_case uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
BEGIN
 PERFORM auction_recovery.require_operator();
 PERFORM 1 FROM auction_recovery.control WHERE singleton AND NOT enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DISPATCHER_MUST_BE_DISABLED'; END IF;
 UPDATE auction_recovery.recovery_cases SET activation_approved_at=clock_timestamp(),approved_hash=auction_recovery.state_hash()
 WHERE id=p_case AND state='RESET';
 IF NOT FOUND THEN RAISE EXCEPTION 'RESET_RECOVERY_CASE_REQUIRED'; END IF;
 INSERT INTO auction_recovery.operator_events(case_id,operator_name,event,epoch)
 SELECT id,session_user,'ACTIVATION_APPROVED',epoch FROM auction_recovery.recovery_cases WHERE id=p_case;
END $$;
CREATE FUNCTION auction_recovery.activate_scheduler(p_case uuid,p_expected_epoch bigint) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery AS $$
DECLARE rc auction_recovery.recovery_cases%ROWTYPE;
BEGIN
 PERFORM auction_recovery.require_operator();
 PERFORM 1 FROM auction_recovery.control WHERE singleton AND NOT enabled AND epoch=p_expected_epoch FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DISABLED_CURRENT_EPOCH_REQUIRED'; END IF;
 SELECT * INTO STRICT rc FROM auction_recovery.recovery_cases WHERE id=p_case FOR UPDATE;
 IF rc.state<>'RESET' OR rc.epoch<>p_expected_epoch OR rc.activation_approved_at IS NULL
 OR rc.activation_approved_at<clock_timestamp()-interval '15 minutes'
 OR rc.approved_hash IS DISTINCT FROM auction_recovery.state_hash()
 OR EXISTS(SELECT 1 FROM auction_recovery.lot_actions WHERE state='RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'SEPARATE_ACTIVATION_APPROVAL_REQUIRED'; END IF;
 UPDATE auction_recovery.control SET enabled=true,circuit='CLOSED' WHERE singleton;
 UPDATE auction_recovery.recovery_cases SET state='ACTIVATED' WHERE id=p_case;
 INSERT INTO auction_recovery.operator_events(case_id,operator_name,event,epoch) VALUES(p_case,session_user,'ACTIVATED',p_expected_epoch);
END $$;
ALTER TABLE auction_recovery.recovery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.operator_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
