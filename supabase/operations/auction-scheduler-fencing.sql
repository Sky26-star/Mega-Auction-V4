-- Database-side fence also covers older immutable application deployments.
-- Original timer business bodies/ACLs remain behind mode-aware wrappers.
BEGIN;
DO $fence$
DECLARE signature text; p record; src text; original_name text; arguments text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.v3_start_bidding(uuid,uuid)','public.v3_start_bidding(uuid,uuid,boolean)',
  'public.v3_finalize_and_advance_lot(uuid,uuid)','public.v3_finalize_and_advance_lot(uuid,uuid,boolean)',
  'public.v3_close_mini_selection(uuid,boolean)','public.v3_start_mini_auction(uuid)','public.resume_auction(uuid)',
  'public.activate_lot_timer(uuid,uuid)','public.process_lot_expiry(uuid,uuid)','public.advance_lot(uuid)'
 ] LOOP
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=signature::regprocedure;
  IF p.prorettype<>'jsonb'::regtype OR NOT p.prosecdef OR cardinality(p.proargnames)<>p.pronargs THEN
   RAISE EXCEPTION 'TIMER_RPC_SIGNATURE_DRIFT: %',signature;
  END IF;
  original_name:='legacy_timer_'||p.proname||'_'||p.pronargs;
  src:=pg_get_functiondef(p.oid);
  IF position(format('CREATE OR REPLACE FUNCTION public.%I(',p.proname) in src)<>1 THEN RAISE EXCEPTION 'TIMER_RPC_SOURCE_DRIFT'; END IF;
  src:=replace(src,format('CREATE OR REPLACE FUNCTION public.%I(',p.proname),format('CREATE OR REPLACE FUNCTION auction_recovery.%I(',original_name));
  EXECUTE src;
  SELECT string_agg(format('%I',name),',' ORDER BY position) INTO arguments FROM unnest(p.proargnames) WITH ORDINALITY x(name,position);
  EXECUTE format($wrapper$
   CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
   SET search_path=pg_catalog,auction_recovery,public,pg_temp AS $body$
   BEGIN
    IF current_setting('role',true)='service_role' AND COALESCE((SELECT delivery_owner FROM auction_recovery.control WHERE singleton),'DATABASE')<>'LEGACY' THEN
     RETURN jsonb_build_object('success',false,'error','DATABASE_SCHEDULER_OWNS_TICKS');
    END IF;
    RETURN auction_recovery.%I(%s);
   END $body$;
  $wrapper$,p.proname,pg_get_function_arguments(p.oid),original_name,arguments);
 END LOOP;
END $fence$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auction_recovery FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
