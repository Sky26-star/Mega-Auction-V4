-- Local candidate, after engine/recovery. No cron or hosted activation.
BEGIN;
CREATE TABLE auction_recovery.workflow_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_id uuid NOT NULL,
 subject_id uuid NOT NULL, generation bigint NOT NULL, auction_generation bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('MINI_CLOSE','MINI_START','RESUME')),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','COMPLETED','SUPERSEDED','RECONCILIATION_REQUIRED')),
 result jsonb, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(subject_id,generation,auction_generation,kind),
 CHECK((state='COMPLETED')=(completed_at IS NOT NULL AND result IS NOT NULL))
);
CREATE TABLE auction_recovery.mini_start_intents (
 session_id uuid NOT NULL, generation bigint NOT NULL, auction_generation bigint NOT NULL, auction_id uuid NOT NULL,
 host_id uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(session_id,generation,auction_generation)
);
CREATE FUNCTION public.request_mini_start(p_auction_id uuid,p_session_id uuid,p_closed_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auction_recovery,pg_temp AS $$
DECLARE s public.mini_auction_sessions%ROWTYPE; h uuid; g bigint; ag bigint; action_id uuid;
BEGIN
 SELECT r.host_id INTO h FROM public.rooms r JOIN public.auctions a ON a.room_id=r.id WHERE a.id=p_auction_id;
 IF auth.uid() IS NULL OR h IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'HOST_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auction_recovery.control WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT s FROM public.mini_auction_sessions WHERE id=p_session_id AND auction_id=p_auction_id FOR UPDATE;
 g:=auction_recovery.generation('MINI',s.id);
 ag:=auction_recovery.generation('AUCTION',p_auction_id);
 IF s.closed_at IS DISTINCT FROM p_closed_at OR p_closed_at IS NULL THEN RAISE EXCEPTION 'STALE_MINI_REVIEW'; END IF;
 IF s.status NOT IN ('SELECTION_CLOSED','BIDDING') THEN RAISE EXCEPTION 'MINI_NOT_READY'; END IF;
 INSERT INTO auction_recovery.mini_start_intents(session_id,generation,auction_generation,auction_id,host_id) VALUES(s.id,g,ag,p_auction_id,h) ON CONFLICT DO NOTHING;
 INSERT INTO auction_recovery.workflow_actions(auction_id,subject_id,generation,auction_generation,kind)
 VALUES(p_auction_id,s.id,g,ag,'MINI_START') ON CONFLICT DO NOTHING;
 SELECT id INTO action_id FROM auction_recovery.workflow_actions WHERE subject_id=s.id AND generation=g AND auction_generation=ag AND kind='MINI_START';
 RETURN jsonb_build_object('success',true,'action_id',action_id,'generation',g);
END $$;
REVOKE ALL ON FUNCTION public.request_mini_start(uuid,uuid,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.request_mini_start(uuid,uuid,timestamptz) TO authenticated;

-- Derive the private transition from the authoritative implementation. Only its
-- caller check changes: real postgres plus a current persisted host intent.
-- No JWT/role impersonation; all lot/session updates and locks stay identical.
DO $clone$
DECLARE src text; auth_check text:='IF NOT v_is_service_role AND (v_user_id IS NULL OR v_room.host_id != v_user_id) THEN';
BEGIN
 src:=pg_get_functiondef('public.v3_start_mini_auction(uuid)'::regprocedure);
 IF position(auth_check in src)=0 OR position('CREATE OR REPLACE FUNCTION public.v3_start_mini_auction(' in src)<>1 THEN
  RAISE EXCEPTION 'MINI_START_SOURCE_DRIFT_REQUIRES_REVIEW';
 END IF;
 src:=replace(src,'CREATE OR REPLACE FUNCTION public.v3_start_mini_auction(','CREATE OR REPLACE FUNCTION auction_recovery.start_mini_transition(');
 src:=replace(src,auth_check,$replacement$
 PERFORM auction_recovery.require_operator();
 IF NOT EXISTS(SELECT 1 FROM auction_recovery.mini_start_intents i JOIN public.mini_auction_sessions s ON s.id=i.session_id
 WHERE i.auction_id=p_auction_id AND i.generation=auction_recovery.generation('MINI',s.id) AND i.auction_generation=auction_recovery.generation('AUCTION',p_auction_id) AND i.host_id=v_room.host_id) THEN
 $replacement$);
 EXECUTE src;
END $clone$;

-- In LEGACY ownership, synchronous host start records intent and result atomically.
-- In DATABASE ownership, direct host start is rejected; hosts must call
-- request_mini_start and let the native scheduler execute the transition.
-- The original business body remains private and non-API-callable.
DO $legacy$
DECLARE src text;
BEGIN
 src:=pg_get_functiondef('public.v3_start_mini_auction(uuid)'::regprocedure);
 src:=replace(src,'CREATE OR REPLACE FUNCTION public.v3_start_mini_auction(','CREATE OR REPLACE FUNCTION auction_recovery.legacy_host_start_transition(');
 EXECUTE src;
END $legacy$;
CREATE OR REPLACE FUNCTION public.v3_start_mini_auction(p_auction_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auction_recovery,pg_temp AS $$
DECLARE s public.mini_auction_sessions%ROWTYPE; h uuid; g bigint; ag bigint; w auction_recovery.workflow_actions%ROWTYPE; r jsonb;
BEGIN
 SELECT room.host_id INTO h FROM public.rooms room JOIN public.auctions a ON a.room_id=room.id WHERE a.id=p_auction_id;
 IF NOT COALESCE((auth.uid() IS NOT NULL AND h=auth.uid()) OR (current_setting('role',true)='service_role' AND auth.role()='service_role'),false) THEN
  RETURN jsonb_build_object('success',false,'error','ERR_UNAUTHORIZED');
 END IF;
 PERFORM 1 FROM auction_recovery.control WHERE singleton FOR UPDATE;
 -- Direct legacy mini starts are forbidden under database ownership.
 -- Hosts must use request_mini_start; only native recovery applies the transition.
 IF (SELECT delivery_owner FROM auction_recovery.control WHERE singleton)
    IS DISTINCT FROM 'LEGACY' THEN
  RETURN jsonb_build_object(
    'success',false,
    'error','DATABASE_SCHEDULER_OWNS_TICKS'
  );
 END IF;
 SELECT * INTO s FROM public.mini_auction_sessions WHERE auction_id=p_auction_id FOR UPDATE;
 IF s.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','ERR_SESSION_NOT_FOUND'); END IF;
 g:=auction_recovery.generation('MINI',s.id);
 ag:=auction_recovery.generation('AUCTION',p_auction_id);
 IF auth.uid() IS NOT NULL AND h=auth.uid() THEN
  INSERT INTO auction_recovery.mini_start_intents(session_id,generation,auction_generation,auction_id,host_id) VALUES(s.id,g,ag,p_auction_id,h) ON CONFLICT DO NOTHING;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auction_recovery.mini_start_intents WHERE session_id=s.id AND generation=g AND auction_generation=ag AND host_id=h) THEN
  RETURN jsonb_build_object('success',false,'error','HOST_INTENT_REQUIRED'); END IF;
 INSERT INTO auction_recovery.workflow_actions(auction_id,subject_id,generation,auction_generation,kind) VALUES(p_auction_id,s.id,g,ag,'MINI_START') ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT w FROM auction_recovery.workflow_actions WHERE subject_id=s.id AND generation=g AND auction_generation=ag AND kind='MINI_START' FOR UPDATE;
 IF w.state='COMPLETED' THEN RETURN w.result; END IF;
 IF w.state<>'PENDING' THEN RETURN jsonb_build_object('success',false,'error','WORKFLOW_RECONCILIATION_REQUIRED'); END IF;
 r:=auction_recovery.legacy_host_start_transition(p_auction_id);
 IF r->'success'='true'::jsonb THEN
  UPDATE auction_recovery.workflow_actions SET state='COMPLETED',result=r,completed_at=clock_timestamp() WHERE id=w.id;
 END IF;
 RETURN r;
END $$;

CREATE FUNCTION auction_recovery.workflow_resume_due(p_reason text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$ BEGIN
 RETURN COALESCE((p_reason::jsonb->>'resume_expires_at')::numeric<=extract(epoch FROM now())*1000,false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END $$;
CREATE FUNCTION auction_recovery.plan_due_workflows(p_limit integer DEFAULT 25) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery,public AS $$
DECLARE c auction_recovery.control%ROWTYPE; r record; n integer:=0; quarantined uuid;
BEGIN
 PERFORM auction_recovery.require_operator();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PLAN_LIMIT'; END IF;
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
 IF NOT c.enabled OR c.circuit<>'CLOSED' THEN RETURN 0; END IF;
 FOR r IN SELECT s.auction_id,s.id,auction_recovery.generation('MINI',s.id) AS generation,
 CASE WHEN s.status='SELECTION_OPEN' THEN 'MINI_CLOSE' ELSE 'MINI_START' END AS kind
 FROM public.mini_auction_sessions s WHERE (s.status='SELECTION_OPEN' AND s.selection_expires_at<=clock_timestamp())
 OR (s.status='SELECTION_CLOSED' AND EXISTS(SELECT 1 FROM auction_recovery.mini_start_intents i WHERE i.session_id=s.id
 AND i.generation=auction_recovery.generation('MINI',s.id) AND i.auction_generation=auction_recovery.generation('AUCTION',s.auction_id))) ORDER BY s.id LIMIT p_limit LOOP
 INSERT INTO auction_recovery.workflow_actions(auction_id,subject_id,generation,auction_generation,kind) VALUES(r.auction_id,r.id,r.generation,auction_recovery.generation('AUCTION',r.auction_id),r.kind)
 ON CONFLICT DO NOTHING; n:=n+1;
 END LOOP;
 FOR r IN SELECT a.id FROM public.auctions a WHERE status='PAUSED' AND auction_recovery.workflow_resume_due(a.paused_reason) IS DISTINCT FROM false
 AND NOT EXISTS(SELECT 1 FROM auction_recovery.workflow_actions w WHERE w.auction_id=a.id AND w.state='RECONCILIATION_REQUIRED') ORDER BY id LIMIT p_limit-n LOOP
  BEGIN
   IF (SELECT (paused_reason::jsonb->>'resume_expires_at')::numeric<=extract(epoch FROM clock_timestamp())*1000 FROM public.auctions WHERE id=r.id) THEN
    INSERT INTO auction_recovery.workflow_actions(auction_id,subject_id,generation,auction_generation,kind)
    VALUES(r.id,r.id,auction_recovery.generation('AUCTION',r.id),auction_recovery.generation('AUCTION',r.id),'RESUME') ON CONFLICT DO NOTHING;
    n:=n+1;
   END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
   INSERT INTO auction_recovery.workflow_actions(auction_id,subject_id,generation,auction_generation,kind,state)
   VALUES(r.id,r.id,auction_recovery.generation('AUCTION',r.id),auction_recovery.generation('AUCTION',r.id),'RESUME','RECONCILIATION_REQUIRED') ON CONFLICT DO NOTHING RETURNING id INTO quarantined;
   IF quarantined IS NOT NULL THEN
    INSERT INTO auction_recovery.alert_outbox(dedupe_key,kind) VALUES('workflow:'||quarantined,'INVALID_RESUME_STATE') ON CONFLICT DO NOTHING;
   END IF;
  END;
 END LOOP;
 RETURN n;
END $$;

CREATE FUNCTION auction_recovery.apply_workflow(p_action uuid,p_epoch bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,auction_recovery,public AS $$
DECLARE c auction_recovery.control%ROWTYPE; w auction_recovery.workflow_actions%ROWTYPE;
 s public.mini_auction_sessions%ROWTYPE; au public.auctions%ROWTYPE; r jsonb; current_gen bigint;
BEGIN
 PERFORM auction_recovery.require_operator();
 SELECT * INTO STRICT c FROM auction_recovery.control WHERE singleton FOR UPDATE;
 IF p_epoch IS NULL OR NOT c.enabled OR c.circuit<>'CLOSED' OR c.epoch<>p_epoch THEN RAISE EXCEPTION 'DISABLED_OR_STALE_EPOCH'; END IF;
 SELECT * INTO STRICT w FROM auction_recovery.workflow_actions WHERE id=p_action FOR UPDATE;
 IF w.state='COMPLETED' THEN RETURN w.result; END IF;
 IF w.state<>'PENDING' THEN RAISE EXCEPTION 'WORKFLOW_RECONCILIATION_REQUIRED'; END IF;
 SELECT * INTO STRICT au FROM public.auctions WHERE id=w.auction_id FOR UPDATE;
 current_gen:=auction_recovery.generation(CASE WHEN w.kind='RESUME' THEN 'AUCTION' ELSE 'MINI' END,w.subject_id);
 IF current_gen<>w.generation OR w.auction_generation<>auction_recovery.generation('AUCTION',w.auction_id) THEN
 UPDATE auction_recovery.workflow_actions SET state='SUPERSEDED' WHERE id=w.id;
 RETURN jsonb_build_object('success',false,'outcome','SAFE_DEFER_RACE'); END IF;
 BEGIN
  IF w.kind='RESUME' THEN
   IF au.status<>'PAUSED' OR NOT COALESCE((au.paused_reason::jsonb->>'resume_expires_at')::numeric<=extract(epoch FROM clock_timestamp())*1000,false) THEN RETURN jsonb_build_object('success',false,'outcome','SAFE_DEFER_RACE'); END IF;
   r:=public.resume_auction(w.auction_id);
  ELSE
   SELECT * INTO STRICT s FROM public.mini_auction_sessions WHERE id=w.subject_id AND auction_id=w.auction_id FOR UPDATE;
   IF w.kind='MINI_CLOSE' THEN
    IF s.status NOT IN ('SELECTION_OPEN','SELECTION_CLOSED','COMPLETED') OR (s.status='SELECTION_OPEN' AND (s.selection_expires_at IS NULL OR s.selection_expires_at>clock_timestamp())) THEN RETURN jsonb_build_object('success',false,'outcome','SAFE_DEFER_RACE'); END IF;
    IF s.status='SELECTION_OPEN' AND EXISTS(SELECT 1 FROM public.auction_lots WHERE auction_id=w.auction_id AND is_mini_round) THEN RAISE EXCEPTION 'INCONSISTENT_OPEN_MINI_POOL'; END IF;
    r:=public.v3_close_mini_selection(w.auction_id,false);
   ELSE
    IF NOT EXISTS(SELECT 1 FROM auction_recovery.mini_start_intents i JOIN public.rooms h ON h.id=au.room_id WHERE i.session_id=s.id AND i.generation=w.generation AND i.auction_generation=w.auction_generation AND i.host_id=h.host_id) THEN RAISE EXCEPTION 'HOST_INTENT_REQUIRED'; END IF;
    IF s.status='SELECTION_CLOSED' AND (s.total_lots<1
     OR (SELECT count(*) FROM public.auction_lots WHERE auction_id=w.auction_id AND is_mini_round AND status='PENDING')<>s.total_lots
     OR (SELECT count(DISTINCT player_id) FROM public.auction_lots WHERE auction_id=w.auction_id AND is_mini_round)<>s.total_lots) THEN RAISE EXCEPTION 'INCONSISTENT_CLOSED_MINI_POOL'; END IF;
    IF s.status='BIDDING' AND au.status='IN_PROGRESS' AND EXISTS(SELECT 1 FROM public.auction_lots WHERE id=au.current_lot_id AND auction_id=au.id AND is_mini_round AND status IN ('GET_READY','BIDDING')) THEN
     r:=jsonb_build_object('success',true,'status','BIDDING','already_started',true);
    ELSE r:=auction_recovery.start_mini_transition(w.auction_id); END IF;
   END IF;
  END IF;
  IF r->'success' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'WORKFLOW_TRANSITION_REJECTED'; END IF;
  UPDATE auction_recovery.workflow_actions SET state='COMPLETED',result=r,completed_at=clock_timestamp() WHERE id=w.id;
  UPDATE auction_recovery.control SET last_success_at=clock_timestamp() WHERE singleton;
  RETURN r;
 EXCEPTION WHEN OTHERS THEN
  UPDATE auction_recovery.workflow_actions SET state='RECONCILIATION_REQUIRED' WHERE id=w.id;
  UPDATE auction_recovery.control SET enabled=false,circuit='OPEN',consecutive_failures=consecutive_failures+1 WHERE singleton;
  INSERT INTO auction_recovery.alert_outbox(dedupe_key,kind) VALUES('workflow:'||w.id,'WORKFLOW_QUARANTINE') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('success',false,'outcome','QUARANTINE_FAULT');
 END;
END $$;
CREATE PROCEDURE auction_recovery.run_workflow_tick(p_limit integer DEFAULT 25)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE w record; e bigint;
BEGIN
 PERFORM auction_recovery.require_operator();
 PERFORM auction_recovery.plan_due_workflows(p_limit);
 SELECT epoch INTO e FROM auction_recovery.control WHERE singleton;
 COMMIT;
 FOR w IN SELECT id FROM auction_recovery.workflow_actions WHERE state='PENDING' ORDER BY created_at,id LIMIT p_limit LOOP
  PERFORM auction_recovery.apply_workflow(w.id,e);
  COMMIT;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION auction_recovery.state_hash() RETURNS text LANGUAGE sql STABLE
SET search_path=pg_catalog,auction_recovery AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
  'actions',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM auction_recovery.lot_actions a),
  'workflows',(SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY id),'[]'::jsonb) FROM auction_recovery.workflow_actions w),
  'intents',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY session_id,generation,auction_generation),'[]'::jsonb) FROM auction_recovery.mini_start_intents i),
  'generations',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY kind,source_id),'[]'::jsonb) FROM auction_recovery.generations g),
  'reconciliation',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY action_id),'[]'::jsonb) FROM auction_recovery.reconciliations r)
 )::text,'UTF8')),'hex');
$$;
CREATE FUNCTION auction_recovery.guard_workflow_recovery() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,auction_recovery AS $$ BEGIN
 IF (NEW.reset_approved_at IS NOT NULL OR NEW.activation_approved_at IS NOT NULL OR NEW.state IN ('RESET','ACTIVATED'))
 AND EXISTS(SELECT 1 FROM auction_recovery.workflow_actions WHERE state='RECONCILIATION_REQUIRED') THEN
  RAISE EXCEPTION 'UNRECONCILED_WORKFLOWS';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recovery_requires_reconciled_workflows BEFORE UPDATE ON auction_recovery.recovery_cases
FOR EACH ROW EXECUTE FUNCTION auction_recovery.guard_workflow_recovery();
ALTER TABLE auction_recovery.workflow_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_recovery.mini_start_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON PROCEDURE auction_recovery.run_workflow_tick(integer) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
