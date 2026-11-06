import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Auction RPC C6/C7 completion migration', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/20261026210000_harden_auction_rpc_grants_and_auth.sql'
  );
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const normalized = migration.replace(/\s+/g, ' ').toLowerCase();

  it('removes implicit PUBLIC and API-role EXECUTE defaults for application migrations', () => {
    expect(normalized).toContain(
      'alter default privileges for role postgres revoke execute on functions from public;'
    );
    expect(normalized).toContain(
      'alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, service_role;'
    );
    expect(normalized).toContain("acl.grantee in ( 0, 'anon'::pg_catalog.regrole, 'authenticated'::pg_catalog.regrole, 'service_role'::pg_catalog.regrole )");
    expect(normalized).toContain("raise exception 'c6 failed: future functions retain implicit public/api-role execute defaults'");
  });

  it('enforces safe search paths for every public SECURITY DEFINER routine', () => {
    expect(normalized).toContain("where n.nspname = 'public' and p.prosecdef and not (");
    expect(normalized).toContain("raise exception 'c7 failed: a public security definer function has an unreviewed search_path'");
    expect(normalized).toContain(
      'alter function public.trg_auction_completed_mini_bridge() set search_path = pg_catalog, public, pg_temp;'
    );
    expect(normalized).toContain(
      'alter function public.trg_preserve_mega_completed_at_fn() set search_path = pg_catalog, public, pg_temp;'
    );
  });

  it('requires authoritative-state membership and private player-set ownership checks', () => {
    expect(migration).toContain("'ERR_ROOM_MEMBERSHIP_REQUIRED'");
    expect(migration).toContain('r.host_id = v_user_id OR rp.user_id = v_user_id');
    expect(migration).toContain('ps.is_public OR ps.created_by = v_user_id');
    expect(migration).toContain('public.resolve_user_id()');
  });
});
