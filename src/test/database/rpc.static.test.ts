import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 2B Local RPC Static Verification Suite', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const migrationFile = path.join(migrationsDir, '00006_auction_rpcs.sql');

  let rpcSql = '';

  beforeAll(() => {
    expect(fs.existsSync(migrationFile)).toBe(true);
    rpcSql = fs.readFileSync(migrationFile, 'utf-8');
  });

  it('1. Implements Issue #7 Event Sequencing Helper public._emit_auction_event', () => {
    expect(rpcSql).toContain('CREATE OR REPLACE FUNCTION public._emit_auction_event');
    expect(rpcSql).toContain('UPDATE public.auctions');
    expect(rpcSql).toContain('SET current_sequence = current_sequence + 1');
    expect(rpcSql).toContain('INSERT INTO public.auction_events');
  });

  it('2. Implements Issue #6 Clone-on-Transition Unsold Round in advance_lot', () => {
    expect(rpcSql).toContain('CREATE OR REPLACE FUNCTION public.advance_lot');
    expect(rpcSql).toContain('GREATEST(1, FLOOR(v_unsold_lot.base_price * 0.5))');
    expect(rpcSql).toContain('INSERT INTO public.auction_lots');
    expect(rpcSql).toContain('is_unsold_round = true');
    expect(rpcSql).toContain('UNSOLD_ROUND_STARTED');
    expect(rpcSql).toContain('AUCTION_COMPLETED');
  });

  it('3. Implements _process_bid_internal with 4-Level Lock Hierarchy', () => {
    expect(rpcSql).toContain('CREATE OR REPLACE FUNCTION public._process_bid_internal');
    expect(rpcSql).toContain('FOR UPDATE');
    expect(rpcSql).toContain('IDEMPOTENCY_PARAMETER_MISMATCH');
    expect(rpcSql).toContain('BID_EXCEEDS_RESERVE_CAP');
    expect(rpcSql).toContain('BID_SQUAD_FULL');
    expect(rpcSql).toContain('BID_OVERSEAS_LIMIT');
  });

  it('4. Implements public.process_bid with human team ownership verification', () => {
    expect(rpcSql).toContain('CREATE OR REPLACE FUNCTION public.process_bid');
    expect(rpcSql).toContain('UNAUTHORIZED_TEAM_BID');
    expect(rpcSql).toContain('UNAUTHORIZED_BOT_TEAM_BID');
  });

  it('5. Implements Target Lot Idempotency Guard in process_lot_expiry', () => {
    expect(rpcSql).toContain('CREATE OR REPLACE FUNCTION public.process_lot_expiry');
    expect(rpcSql).toContain('p_target_lot_id UUID DEFAULT NULL');
    expect(rpcSql).toContain('p_target_lot_id != v_auction.current_lot_id');
    expect(rpcSql).toContain('ALREADY_PROCESSED');
  });

  it('6. Implements Microsecond Interval Pause/Resume in pause_auction & resume_auction', () => {
    expect(rpcSql).toContain('CREATE OR REPLACE FUNCTION public.pause_auction');
    expect(rpcSql).toContain('CREATE OR REPLACE FUNCTION public.resume_auction');
    expect(rpcSql).toContain('AUCTION_PAUSED');
    expect(rpcSql).toContain('AUCTION_RESUMED');
    expect(rpcSql).toContain('INTERVAL \'1 millisecond\'');
  });

  it('7. Enforces PRIVILEGE REVOCATION from PUBLIC, anon, authenticated on private RPCs', () => {
    expect(rpcSql).toContain('REVOKE ALL ON FUNCTION public._emit_auction_event(UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;');
    expect(rpcSql).toContain('REVOKE ALL ON FUNCTION public._process_bid_internal(UUID, UUID, INT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;');
    expect(rpcSql).toContain('REVOKE ALL ON FUNCTION public.execute_bot_bids(UUID) FROM PUBLIC, anon, authenticated;');
    expect(rpcSql).toContain('REVOKE ALL ON FUNCTION public.evaluate_bot_interests(UUID, UUID) FROM PUBLIC, anon, authenticated;');
  });

  it('8. Implements provision_room_bots RPC with SECURITY DEFINER and 10 manager limit guard', () => {
    const botRpcFile = path.join(migrationsDir, '00008_provision_bots_rpc.sql');
    expect(fs.existsSync(botRpcFile)).toBe(true);
    const botSql = fs.readFileSync(botRpcFile, 'utf-8');

    expect(botSql).toContain('CREATE OR REPLACE FUNCTION public.provision_room_bots');
    expect(botSql).toContain('SECURITY DEFINER');
    expect(botSql).toContain('UNAUTHORIZED_NOT_HOST');
    expect(botSql).toContain('INVALID_BOT_COUNT');
    expect(botSql).toContain('EXCEEDS_MANAGER_CAPACITY');
    expect(botSql).toContain('INSERT INTO public.teams');
    expect(botSql).toContain('INSERT INTO public.room_participants');
    expect(botSql).toContain('REVOKE ALL ON FUNCTION public.provision_room_bots(UUID, JSONB) FROM PUBLIC, anon;');
    expect(botSql).toContain('GRANT EXECUTE ON FUNCTION public.provision_room_bots(UUID, JSONB) TO authenticated, service_role;');
  });
});
