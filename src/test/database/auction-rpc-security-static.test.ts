import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Auction RPC Security Hardening & Concurrency Static Migration Verification', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const hardeningMigrationFile = path.join(migrationsDir, '20261022100000_auction_rpc_security_hardening.sql');
  const rpcGapMigrationFile = path.join(migrationsDir, '20261026180000_close_auction_rpc_security_gaps.sql');
  const botGuardMigrationFile = path.join(migrationsDir, '20261025160000_guard_stale_bot_bids_and_drops.sql');
  const tradeMigrationFile = path.join(migrationsDir, '00060_fix_bot_trade_and_lot_finalization.sql');

  let hardeningSql = '';
  let rpcGapSql = '';
  let botGuardSql = '';
  let tradeSql = '';

  beforeAll(() => {
    expect(fs.existsSync(hardeningMigrationFile)).toBe(true);
    hardeningSql = fs.readFileSync(hardeningMigrationFile, 'utf-8');
    expect(fs.existsSync(rpcGapMigrationFile)).toBe(true);
    rpcGapSql = fs.readFileSync(rpcGapMigrationFile, 'utf-8');
    expect(fs.existsSync(botGuardMigrationFile)).toBe(true);
    botGuardSql = fs.readFileSync(botGuardMigrationFile, 'utf-8');

    if (fs.existsSync(tradeMigrationFile)) {
      tradeSql = fs.readFileSync(tradeMigrationFile, 'utf-8');
    }
  });

  it('1. Wraps complete hardening migration in an atomic transaction (BEGIN / COMMIT)', () => {
    expect(hardeningSql.trimStart()).toMatch(/^--[\s\S]*?BEGIN;/);
    expect(hardeningSql.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('2. Enforces caller authorization in v3_place_bid before idempotency lookup', () => {
    const authIndex = hardeningSql.indexOf('CALLER AUTHORIZATION');
    const idempotencyIndex = hardeningSql.indexOf('IDEMPOTENCY CHECK');
    expect(authIndex).toBeGreaterThan(-1);
    expect(idempotencyIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(idempotencyIndex);
    expect(hardeningSql).toContain("RETURN jsonb_build_object('success', false, 'error', 'ERR_REQUEST_ID_REQUIRED');");
  });

  it('3. Rejects forged bot bids (p_is_bot=true) from non-service_role callers', () => {
    expect(hardeningSql).toContain("IF COALESCE(p_is_bot, false) AND NOT v_is_service_role THEN");
    expect(hardeningSql).toContain("RETURN jsonb_build_object('success', false, 'error', 'ERR_BOT_BID_FORBIDDEN');");
  });

  it('4. Rejects anonymous and unauthorized human bidders in v3_place_bid', () => {
    expect(hardeningSql).toContain("IF v_user_id IS NULL THEN");
    expect(hardeningSql).toContain("RETURN jsonb_build_object('success', false, 'error', 'ERR_UNAUTHORIZED');");
    expect(hardeningSql).toContain("rp.user_id = v_user_id");
    expect(hardeningSql).toContain("rp.team_id = p_team_id");
    expect(hardeningSql).toContain("rp.is_bot = false");
    expect(hardeningSql).toContain("RETURN jsonb_build_object('success', false, 'error', 'ERR_TEAM_MEMBERSHIP_REQUIRED');");
  });

  it('5. Protects team identity: human callers cannot bid on bot teams and vice-versa', () => {
    expect(hardeningSql).toContain("IF v_team.is_bot AND NOT v_is_service_role THEN");
    expect(hardeningSql).toContain("IF NOT v_team.is_bot AND COALESCE(p_is_bot, false) THEN");
  });

  it('6. Preserves distributed concurrency control (advisory lock) in v3_finalize_and_advance_lot from 00060', () => {
    expect(hardeningSql).toContain("pg_try_advisory_xact_lock(hashtext('auction_lock_' || p_auction_id::text))");
    expect(hardeningSql).toContain("ERR_CONCURRENT_AUCTION_FINALIZATION_IN_PROGRESS");
  });

  it('7. Hardens timer force bypass in v3_finalize_and_advance_lot and v3_start_bidding against non-service_role', () => {
    expect(hardeningSql).toContain("IF NOT COALESCE(p_force, false) OR NOT v_is_service_role THEN");
    expect(hardeningSql).toContain("ERR_TIMER_NOT_EXPIRED");
    expect(hardeningSql).toContain("ERR_GET_READY_NOT_EXPIRED");
  });

  it('8. Revokes public/anon access from v3_place_bid and restricts lifecycle RPCs to service_role', () => {
    const normalized = hardeningSql.replace(/\s+/g, ' ');
    // v3_place_bid
    expect(normalized).toContain("REVOKE ALL ON FUNCTION public.v3_place_bid(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC, anon;");
    expect(normalized).toContain("GRANT EXECUTE ON FUNCTION public.v3_place_bid(uuid, uuid, uuid, uuid, boolean) TO authenticated, service_role;");

    // v3_start_bidding
    expect(normalized).toContain("REVOKE ALL ON FUNCTION public.v3_start_bidding(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(normalized).toContain("GRANT EXECUTE ON FUNCTION public.v3_start_bidding(uuid, uuid) TO service_role;");
    expect(normalized).toContain("REVOKE ALL ON FUNCTION public.v3_start_bidding(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;");
    expect(normalized).toContain("GRANT EXECUTE ON FUNCTION public.v3_start_bidding(uuid, uuid, boolean) TO service_role;");

    // v3_close_mini_selection
    expect(normalized).toContain("REVOKE ALL ON FUNCTION public.v3_close_mini_selection(uuid, boolean) FROM PUBLIC, anon, authenticated;");
    expect(normalized).toContain("GRANT EXECUTE ON FUNCTION public.v3_close_mini_selection(uuid, boolean) TO service_role;");

    // v3_finalize_and_advance_lot
    expect(normalized).toContain("REVOKE ALL ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(normalized).toContain("GRANT EXECUTE ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid) TO service_role;");
    expect(normalized).toContain("REVOKE ALL ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;");
    expect(normalized).toContain("GRANT EXECUTE ON FUNCTION public.v3_finalize_and_advance_lot(uuid, uuid, boolean) TO service_role;");
  });

  it('9. Includes exhaustive postflight assertion DO block testing effective privileges', () => {
    expect(hardeningSql).toContain("DO $assertions$");
    expect(hardeningSql).toContain("has_function_privilege('anon', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE')");
    expect(hardeningSql).toContain("has_function_privilege('authenticated', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE')");
    expect(hardeningSql).toContain("has_function_privilege('authenticated', 'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)', 'EXECUTE')");
    expect(hardeningSql).toContain("has_function_privilege('service_role', 'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)', 'EXECUTE')");
    expect(hardeningSql).toContain("has_function_privilege('service_role', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE')");
  });

  it('10. Preserves 00060 migration without destructive deletion or replacement', () => {
    if (tradeSql) {
      expect(tradeSql).toContain("CREATE OR REPLACE FUNCTION public.v3_respond_trade");
      expect(tradeSql).toContain("v_is_service_role");
      expect(tradeSql).toContain("squad_players");
    }
  });

interface ParsedPrivileges {
  grants: Array<{ func: string; args: string; roles: string[] }>;
  revokes: Array<{ func: string; args: string; roles: string[] }>;
  searchPaths: Record<string, string>;
}

function parsePrivilegeStatements(sql: string): ParsedPrivileges {
  const grants: Array<{ func: string; args: string; roles: string[] }> = [];
  const revokes: Array<{ func: string; args: string; roles: string[] }> = [];
  const searchPaths: Record<string, string> = {};

  const grantRegex = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\s\S]+?)\s+TO\s+([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = grantRegex.exec(sql)) !== null) {
    const funcsClause = match[1]!;
    const roles = match[2]!.split(',').map((r) => r.trim());
    const funcRegex = /([a-zA-Z0-9_.]+)\s*\(([^)]*)\)/g;
    let fm: RegExpExecArray | null;
    while ((fm = funcRegex.exec(funcsClause)) !== null) {
      grants.push({ func: fm[1]!, args: fm[2]!.replace(/\s+/g, ' ').trim(), roles });
    }
  }

  const revokeRegex = /REVOKE\s+(?:ALL(?:\s+ON)?|EXECUTE)\s+ON\s+FUNCTION\s+([\s\S]+?)\s+FROM\s+([^;]+);/gi;
  while ((match = revokeRegex.exec(sql)) !== null) {
    const funcsClause = match[1]!;
    const roles = match[2]!.split(',').map((r) => r.trim());
    const funcRegex = /([a-zA-Z0-9_.]+)\s*\(([^)]*)\)/g;
    let fm: RegExpExecArray | null;
    while ((fm = funcRegex.exec(funcsClause)) !== null) {
      revokes.push({ func: fm[1]!, args: fm[2]!.replace(/\s+/g, ' ').trim(), roles });
    }
  }

  const searchPathRegex = /ALTER\s+FUNCTION\s+([a-zA-Z0-9_.]+)\s*\(([^)]*)\)\s+SET\s+search_path\s*=\s*([^;]+);/gi;
  while ((match = searchPathRegex.exec(sql)) !== null) {
    const sig = `${match[1]!}(${match[2]!.replace(/\s+/g, ' ').trim()})`;
    searchPaths[sig] = match[3]!.replace(/\s+/g, ' ').trim();
  }

  return { grants, revokes, searchPaths };
}

  it('11. Guards bot bids with a locked snapshot and maximum valuation before calling the authoritative RPC', () => {
    const normalized = botGuardSql.replace(/\s+/g, ' ');
    expect(normalized).toContain('SELECT * INTO v_lot FROM public.auction_lots WHERE id = p_lot_id AND auction_id = p_auction_id FOR UPDATE;');
    expect(botGuardSql).toContain("ERR_STALE_BOT_DECISION");
    expect(botGuardSql).toContain("ERR_BOT_MAXIMUM_BID_EXCEEDED");
    expect(botGuardSql).toContain('v_result := public.v3_place_bid(p_auction_id, p_lot_id, p_team_id, p_request_id, true);');
    expect(normalized).toContain('p_maximum_bid IS NULL OR v_min_required_bid > p_maximum_bid');
  });

  it('12. Makes DROP durable and keeps both bot-only RPCs inaccessible to browser roles', () => {
    const normalized = botGuardSql.replace(/\s+/g, ' ');
    expect(normalized).toContain('ADD COLUMN IF NOT EXISTS is_dropped BOOLEAN NOT NULL DEFAULT false;');
    expect(botGuardSql).toContain('NEW.is_dropped := true;');
    expect(botGuardSql).toContain('NEW.is_interested := false;');

    // Structural privilege verification
    const spec = parsePrivilegeStatements(botGuardSql);
    const botBidRevoke = spec.revokes.find((r) => r.func === 'public.v3_place_bot_bid');
    expect(botBidRevoke).toBeDefined();
    expect(botBidRevoke!.roles).toContain('PUBLIC');
    expect(botBidRevoke!.roles).toContain('anon');
    expect(botBidRevoke!.roles).toContain('authenticated');

    const botBidGrant = spec.grants.find((g) => g.func === 'public.v3_place_bot_bid');
    expect(botBidGrant).toBeDefined();
    expect(botBidGrant!.roles).toContain('service_role');
    expect(botBidGrant!.roles).not.toContain('anon');
    expect(botBidGrant!.roles).not.toContain('authenticated');

    const dropRevoke = spec.revokes.find((r) => r.func === 'public.v3_mark_bot_drop');
    expect(dropRevoke).toBeDefined();
    expect(dropRevoke!.roles).toContain('PUBLIC');
    expect(dropRevoke!.roles).toContain('anon');
    expect(dropRevoke!.roles).toContain('authenticated');

    const dropGrant = spec.grants.find((g) => g.func === 'public.v3_mark_bot_drop');
    expect(dropGrant).toBeDefined();
    expect(dropGrant!.roles).toContain('service_role');
  });

  it('13. Gives service-role bot bids only through the guarded RPC', () => {
    const spec = parsePrivilegeStatements(rpcGapSql);

    // v3_place_bid must be revoked from service_role and granted to authenticated
    const placeBidRevoke = spec.revokes.find((r) => r.func === 'public.v3_place_bid');
    expect(placeBidRevoke).toBeDefined();
    expect(placeBidRevoke!.roles).toContain('service_role');
    expect(placeBidRevoke!.roles).toContain('anon');

    const placeBidGrant = spec.grants.find((g) => g.func === 'public.v3_place_bid');
    expect(placeBidGrant).toBeDefined();
    expect(placeBidGrant!.roles).toContain('authenticated');
    expect(placeBidGrant!.roles).not.toContain('service_role');

    // v3_place_bot_bid must be granted to service_role
    const botBidGrant = spec.grants.find((g) => g.func === 'public.v3_place_bot_bid');
    expect(botBidGrant).toBeDefined();
    expect(botBidGrant!.roles).toContain('service_role');

    // Postflight assertions testing effective privileges in migration
    expect(rpcGapSql).toContain("'service_role', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE'");
    expect(rpcGapSql).toContain("'service_role', 'public.v3_place_bot_bid(uuid,uuid,uuid,uuid,integer,uuid,integer,integer)', 'EXECUTE'");
  });

  it('14. Restricts room and mini-auction RPC grants to their supported callers', () => {
    const spec = parsePrivilegeStatements(rpcGapSql);

    // create_room_with_team
    const createRevoke = spec.revokes.find((r) => r.func === 'public.create_room_with_team');
    expect(createRevoke).toBeDefined();
    expect(createRevoke!.roles).toContain('service_role');
    expect(createRevoke!.roles).toContain('anon');

    const createGrant = spec.grants.find((g) => g.func === 'public.create_room_with_team');
    expect(createGrant).toBeDefined();
    expect(createGrant!.roles).toContain('authenticated');
    expect(createGrant!.roles).not.toContain('service_role');

    // join_room_with_team
    const joinRevoke = spec.revokes.find((r) => r.func === 'public.join_room_with_team');
    expect(joinRevoke).toBeDefined();
    expect(joinRevoke!.roles).toContain('service_role');

    const joinGrant = spec.grants.find((g) => g.func === 'public.join_room_with_team');
    expect(joinGrant).toBeDefined();
    expect(joinGrant!.roles).toContain('authenticated');

    expect(rpcGapSql).toContain("has_function_privilege('anon', 'public.v3_initiate_mini_auction(uuid)', 'EXECUTE')");
  });

  it('15. Pins the reviewed SECURITY DEFINER search paths and blocks app-role schema creation', () => {
    const normalized = rpcGapSql.replace(/\s+/g, ' ');
    expect(normalized).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;');

    const spec = parsePrivilegeStatements(rpcGapSql);
    expect(spec.searchPaths['public.v3_place_bid(uuid, uuid, uuid, uuid, boolean)']).toBe('pg_catalog, public, pg_temp');
    expect(spec.searchPaths['public.v3_place_bot_bid(uuid, uuid, uuid, uuid, integer, uuid, integer, integer)']).toBe('pg_catalog, public, pg_temp');
    expect(spec.searchPaths['public.create_room_with_team(text, text, jsonb, uuid, text, text, text, integer, uuid[])']).toBe('pg_catalog, public, pg_temp');
  });

  it('16. Leaves lifecycle overloads exact and room creation argument names aligned with the app', () => {
    expect(rpcGapSql).toContain("'public.v3_start_bidding(uuid,uuid)'::pg_catalog.regprocedure");
    expect(rpcGapSql).toContain("'public.v3_start_bidding(uuid,uuid,boolean)'::pg_catalog.regprocedure");
    expect(rpcGapSql).toContain("'public.v3_finalize_and_advance_lot(uuid,uuid)'::pg_catalog.regprocedure");
    expect(rpcGapSql).toContain("'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)'::pg_catalog.regprocedure");
  });
});
