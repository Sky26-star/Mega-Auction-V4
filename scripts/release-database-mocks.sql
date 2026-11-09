-- Disposable database only. Refuse a real Supabase installation.
DO $$ BEGIN
  IF current_database() NOT IN ('mega_auction_release_check', 'mega_auction_test')
    OR to_regnamespace('net') IS NOT NULL OR to_regnamespace('vault') IS NOT NULL THEN
    RAISE EXCEPTION 'Release checks require a fresh disposable database without pg_net/Vault';
  END IF;
END $$;
CREATE SCHEMA net;
CREATE SCHEMA vault;
REVOKE ALL ON SCHEMA net, vault FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE net._http_response (id bigint PRIMARY KEY, status_code integer, timed_out boolean, error_msg text, content text);
CREATE TABLE net.release_requests (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb, timeout_milliseconds integer);
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO net.release_requests(url, headers, body, timeout_milliseconds)
  VALUES (url, headers, body, timeout_milliseconds) RETURNING id;
$$;
CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
CREATE FUNCTION pg_temp.release_assert(result boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF result IS DISTINCT FROM true THEN RAISE EXCEPTION 'Release assertion failed: %', label; END IF; END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.release_assert(boolean,text) TO authenticated;
