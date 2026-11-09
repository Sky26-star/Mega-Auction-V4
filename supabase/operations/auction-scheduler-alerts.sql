-- Local candidate. External delivery remains a separately provisioned process.
BEGIN;
ALTER TABLE auction_recovery.alert_outbox ADD COLUMN delivery_token uuid;
ALTER TABLE auction_recovery.alert_outbox ADD COLUMN delivery_lease_until timestamptz;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='auction_alert_sender') THEN CREATE ROLE auction_alert_sender NOLOGIN; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='auction_alert_sender' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN RAISE EXCEPTION 'UNSAFE_EXISTING_ALERT_ROLE'; END IF;
END $$;
CREATE FUNCTION public.claim_scheduler_alerts(p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auction_recovery AS $$
DECLARE r record; payload jsonb:='[]'::jsonb; t uuid;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_ALERT_LIMIT'; END IF;
 FOR r IN SELECT * FROM auction_recovery.alert_outbox WHERE delivered_at IS NULL AND next_attempt_at<=clock_timestamp()
 AND (delivery_lease_until IS NULL OR delivery_lease_until<=clock_timestamp()) ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  t:=gen_random_uuid();
  UPDATE auction_recovery.alert_outbox SET delivery_token=t,delivery_lease_until=clock_timestamp()+interval '30 seconds',
   attempts=attempts+1,next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(300,power(2,LEAST(attempts,8))::integer)) WHERE id=r.id;
  payload:=payload||jsonb_build_array(jsonb_build_object('id',r.id,'kind',r.kind,'dedupeKey',r.dedupe_key,'token',t));
 END LOOP;
 RETURN payload;
END $$;
CREATE FUNCTION public.ack_scheduler_alert(p_id bigint,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auction_recovery AS $$ BEGIN
 UPDATE auction_recovery.alert_outbox SET delivered_at=clock_timestamp(),delivery_lease_until=NULL
 WHERE id=p_id AND delivery_token=p_token AND delivered_at IS NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_scheduler_alerts(integer),public.ack_scheduler_alert(bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public TO auction_alert_sender;
GRANT EXECUTE ON FUNCTION public.claim_scheduler_alerts(integer),public.ack_scheduler_alert(bigint,uuid) TO auction_alert_sender;
COMMIT;
