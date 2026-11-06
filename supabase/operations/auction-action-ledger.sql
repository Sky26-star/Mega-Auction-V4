-- Local validation candidate. Not a hosted installation/activation script.
-- Only lot-scoped transitions are implemented here. No cron job is created.
BEGIN;
CREATE SCHEMA IF NOT EXISTS auction_recovery;
REVOKE ALL ON SCHEMA auction_recovery FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE auction_recovery.control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0),
  circuit text NOT NULL DEFAULT 'OPEN' CHECK (circuit IN ('OPEN','CLOSED')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO auction_recovery.control(singleton) VALUES(true);
CREATE TABLE auction_recovery.lot_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Retain immutable source IDs without blocking existing authorized cleanup.
  auction_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('START_BIDDING','FINALIZE')),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','COMPLETED','RECONCILIATION_REQUIRED')),
  result jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(lot_id,kind),
  CHECK ((state='COMPLETED') = (completed_at IS NOT NULL AND result IS NOT NULL))
);
CREATE TABLE auction_recovery.attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES auction_recovery.lot_actions(id),
  epoch bigint NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('COMPLETED','FAILED','DEFERRED')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON auction_recovery.lot_actions(state,created_at) WHERE state <> 'COMPLETED';
CREATE INDEX ON auction_recovery.attempts(action_id,id);
ALTER TABLE auction_recovery.control ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.lot_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA auction_recovery FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auction_recovery FROM PUBLIC, anon, authenticated, service_role;

-- SECURITY INVOKER intentionally preserves the real database caller. No JWT
-- impersonation and no service-role flag. Existing RPCs keep their authorization.
CREATE FUNCTION auction_recovery.apply_lot_action(p_action uuid,p_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, auction_recovery, public, pg_temp
AS $function$
DECLARE c auction_recovery.control%ROWTYPE;
  a auction_recovery.lot_actions%ROWTYPE;
  l public.auction_lots%ROWTYPE;
  r jsonb; failure text;
BEGIN
  IF session_user <> 'postgres' OR current_setting('role',true) NOT IN ('none','postgres') THEN
    RAISE EXCEPTION 'SCHEDULER_PRINCIPAL_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
  IF NOT c.enabled OR c.circuit <> 'CLOSED' THEN
    RAISE EXCEPTION 'SCHEDULER_DISABLED';
  END IF;
  IF p_epoch IS NULL OR c.epoch <> p_epoch THEN RAISE EXCEPTION 'STALE_SCHEDULER_EPOCH'; END IF;
  SELECT * INTO STRICT a FROM auction_recovery.lot_actions WHERE id=p_action FOR UPDATE;
  IF a.state='COMPLETED' THEN RETURN a.result; END IF;
  IF a.state <> 'PENDING' THEN RAISE EXCEPTION 'RECONCILIATION_REQUIRED'; END IF;

  -- The subtransaction rolls back business writes on exceptions OR a returned
  -- failure. The outer transaction records a classified failed attempt.
  BEGIN
    -- Preserve the RPC's advisory-before-row lock ordering.
    SELECT * INTO STRICT l FROM public.auction_lots WHERE id=a.lot_id AND auction_id=a.auction_id;
    IF a.kind='START_BIDDING' THEN
      IF l.status <> 'GET_READY' THEN RAISE EXCEPTION 'ACTION_STATE_MISMATCH'; END IF;
      IF l.get_ready_expires_at IS NULL OR l.get_ready_expires_at > clock_timestamp() THEN
        INSERT INTO auction_recovery.attempts(action_id,epoch,outcome) VALUES(a.id,c.epoch,'DEFERRED');
        RETURN jsonb_build_object('success',false,'error','NOT_DUE');
      END IF;
      r := public.v3_start_bidding(a.auction_id,a.lot_id,false);
    ELSE
      IF l.status <> 'BIDDING' THEN RAISE EXCEPTION 'ACTION_STATE_MISMATCH'; END IF;
      IF l.timer_expires_at IS NULL OR l.timer_expires_at > clock_timestamp() THEN
        INSERT INTO auction_recovery.attempts(action_id,epoch,outcome) VALUES(a.id,c.epoch,'DEFERRED');
        RETURN jsonb_build_object('success',false,'error','NOT_DUE');
      END IF;
      r := public.v3_finalize_and_advance_lot(a.auction_id,a.lot_id,false);
    END IF;
    IF r->'success' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'BUSINESS_TRANSITION_REJECTED'; END IF;
    UPDATE auction_recovery.lot_actions SET state='COMPLETED',result=r,completed_at=clock_timestamp() WHERE id=a.id;
    INSERT INTO auction_recovery.attempts(action_id,epoch,outcome) VALUES(a.id,c.epoch,'COMPLETED');
    RETURN r;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS failure = RETURNED_SQLSTATE;
    INSERT INTO auction_recovery.attempts(action_id,epoch,outcome,error_code) VALUES(a.id,c.epoch,'FAILED',failure);
    UPDATE auction_recovery.lot_actions SET state='RECONCILIATION_REQUIRED' WHERE id=a.id;
    UPDATE auction_recovery.control SET enabled=false,circuit='OPEN',updated_at=clock_timestamp() WHERE singleton;
    RETURN jsonb_build_object('success',false,'error','RECONCILIATION_REQUIRED');
  END;
END;
$function$;
REVOKE ALL ON FUNCTION auction_recovery.apply_lot_action(uuid,bigint) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
