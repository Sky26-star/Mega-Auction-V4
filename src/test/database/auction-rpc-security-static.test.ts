import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Auction RPC Security Hardening & Concurrency Static Migration Verification', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const hardeningMigrationFile = path.join(migrationsDir, '20261022100000_auction_rpc_security_hardening.sql');
  const tradeMigrationFile = path.join(migrationsDir, '00060_fix_bot_trade_and_lot_finalization.sql');

  let hardeningSql = '';
  let tradeSql = '';

  beforeAll(() => {
    expect(fs.existsSync(hardeningMigrationFile)).toBe(true);
    hardeningSql = fs.readFileSync(hardeningMigrationFile, 'utf-8');

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
});
