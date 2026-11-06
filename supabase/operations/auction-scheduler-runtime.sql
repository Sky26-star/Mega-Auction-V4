-- Local candidate after claims. No cron jobs created or activated.
BEGIN;
CREATE PROCEDURE auction_recovery.run_native_tick(p_budget integer DEFAULT 25)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE t record; expected_epoch bigint; token uuid; execution uuid; c auction_recovery.control%ROWTYPE;
 started timestamptz:=clock_timestamp(); old_tx_timeout text:=current_setting('transaction_timeout'); old_lock_timeout text:=current_setting('lock_timeout');
BEGIN
 PERFORM auction_recovery.require_operator();
 IF p_budget IS NULL OR p_budget NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'INVALID_TICK_BUDGET'; END IF;
 -- PostgreSQL 17's transaction timeout arms even when assigned inside a running
 -- transaction. It terminates a stalled backend; committed claims then require
 -- reconciliation. These settings apply only to this job session.
 PERFORM set_config('transaction_timeout','3s',false);
 PERFORM set_config('lock_timeout','500ms',false);
 <<slice>>
 BEGIN
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
 IF NOT c.enabled OR c.circuit<>'CLOSED' OR c.delivery_owner<>'DATABASE' THEN EXIT slice; END IF;
 UPDATE auction_recovery.control SET last_tick_at=clock_timestamp() WHERE singleton;
 expected_epoch:=c.epoch;
 COMMIT;
 FOR t IN SELECT cl.token FROM auction_recovery.claims cl WHERE cl.state='CLAIMED' AND cl.lease_expires_at<=clock_timestamp() ORDER BY cl.lease_expires_at LIMIT 5 LOOP
  PERFORM auction_recovery.reconcile_claim(t.token);
  COMMIT;
 END LOOP;
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton;
 IF NOT c.enabled OR c.epoch<>expected_epoch THEN EXIT slice; END IF;
 PERFORM auction_recovery.plan_due_workflows(LEAST(5,p_budget-1));
 execution:=auction_recovery.plan_due_auction_actions(10,p_budget-LEAST(5,p_budget-1),'pg_cron');
 COMMIT;
 FOR t IN SELECT id,'WORKFLOW'::text AS kind,created_at FROM auction_recovery.workflow_actions WHERE state='PENDING'
  UNION ALL SELECT a.id,'LOT',a.created_at FROM auction_recovery.lot_actions a JOIN auction_recovery.execution_actions e ON e.action_id=a.id WHERE e.execution_id=execution AND a.state='PENDING'
  ORDER BY created_at,id LIMIT p_budget LOOP
  EXIT WHEN clock_timestamp()>started+interval '5 seconds';
  SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton;
  IF NOT c.enabled OR c.epoch<>expected_epoch THEN EXIT slice; END IF;
  token:=auction_recovery.claim_action(t.id,t.kind,expected_epoch,'pg_cron');
  COMMIT;
  IF token IS NOT NULL THEN
   PERFORM auction_recovery.execute_claim(token,expected_epoch);
   COMMIT;
  END IF;
 END LOOP;
 IF execution IS NOT NULL THEN
  UPDATE auction_recovery.executions e SET state=CASE
   WHEN EXISTS(SELECT 1 FROM auction_recovery.execution_actions x JOIN auction_recovery.lot_actions a ON a.id=x.action_id WHERE x.execution_id=e.id AND a.state='RECONCILIATION_REQUIRED') THEN 'QUARANTINED'
   WHEN EXISTS(SELECT 1 FROM auction_recovery.execution_actions x JOIN auction_recovery.lot_actions a ON a.id=x.action_id WHERE x.execution_id=e.id AND a.state='PENDING') THEN 'PARTIAL' ELSE 'COMPLETED' END,
   completed_at=clock_timestamp() WHERE id=execution;
 END IF;
 COMMIT;
 END slice;
 PERFORM set_config('transaction_timeout',old_tx_timeout,false);
 PERFORM set_config('lock_timeout',old_lock_timeout,false);
END $$;
CREATE FUNCTION public.auction_scheduler_health() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,auction_recovery AS $$
 SELECT jsonb_build_object('schemaVersion',1,'enabled',c.enabled,'owner',c.delivery_owner,
 'epoch',c.epoch,'circuit',c.circuit,'lastTickAt',c.last_tick_at,'lastSuccessAt',c.last_success_at,
 'stale',c.enabled AND (c.last_tick_at IS NULL OR c.last_tick_at<clock_timestamp()-interval '15 seconds'),
 'unknownClaims',(SELECT count(*) FROM auction_recovery.claims WHERE state='UNKNOWN'),
 'quarantinedActions',(SELECT count(*) FROM auction_recovery.lot_actions WHERE state='RECONCILIATION_REQUIRED')+(SELECT count(*) FROM auction_recovery.workflow_actions WHERE state='RECONCILIATION_REQUIRED'),
 'undeliveredAlerts',(SELECT count(*) FROM auction_recovery.alert_outbox WHERE delivered_at IS NULL))
 FROM auction_recovery.control c WHERE singleton;
$$;
REVOKE ALL ON FUNCTION public.auction_scheduler_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auction_scheduler_health() TO service_role;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='auction_monitor') THEN CREATE ROLE auction_monitor NOLOGIN; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='auction_monitor' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN RAISE EXCEPTION 'UNSAFE_EXISTING_MONITOR_ROLE'; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO auction_monitor;
GRANT EXECUTE ON FUNCTION public.auction_scheduler_health() TO auction_monitor;
REVOKE ALL ON PROCEDURE auction_recovery.run_native_tick(integer) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
