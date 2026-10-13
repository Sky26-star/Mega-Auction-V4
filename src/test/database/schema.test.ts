import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 2A & 2B Static SQL Migration & Schema Specification Verification', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  
  const phase2aFiles = [
    '00001_core_tables.sql',
    '00002_auction_tables.sql',
    '00003_indexes.sql',
    '00004_triggers.sql',
    '00005_rls_policies.sql',
  ];

  const phase2bFiles = [
    '00006_auction_rpcs.sql',
  ];

  let phase2aSql = '';
  let phase2bSql = '';
  let indexSql = '';

  beforeAll(() => {
    phase2aFiles.forEach((file) => {
      const filePath = path.join(migrationsDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      phase2aSql += content + '\n';
      if (file === '00003_indexes.sql') {
        indexSql = content;
      }
    });

    phase2bFiles.forEach((file) => {
      const filePath = path.join(migrationsDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      phase2bSql += content + '\n';
    });
  });

  it('1. Contains all 12 V1 core and auction tables in Phase 2A', () => {
    const requiredTables = [
      'public.profiles',
      'public.rooms',
      'public.player_sets',
      'public.players',
      'public.room_participants',
      'public.auctions',
      'public.teams',
      'public.auction_lots',
      'public.squad_players',
      'public.bids',
      'public.auction_events',
      'public.bot_lot_state',
    ];

    requiredTables.forEach((table) => {
      expect(phase2aSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    });
  });

  it('2. Enforces Bid Idempotency via request_id UNIQUE constraint', () => {
    expect(phase2aSql).toContain('request_id UUID NOT NULL UNIQUE');
  });

  it('3. Enforces Realtime Event Sequence authority and UNIQUE(auction_id, sequence)', () => {
    expect(phase2aSql).toContain('current_sequence INT NOT NULL DEFAULT 0');
    expect(phase2aSql).toContain('CONSTRAINT unique_auction_sequence UNIQUE(auction_id, sequence)');
  });

  it('4. Includes Room Participant heartbeat field last_seen_at', () => {
    expect(phase2aSql).toContain('last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
  });

  it('5. Defines exactly 22 custom performance indexes in 00003_indexes.sql', () => {
    const createIndexMatches = indexSql.match(/CREATE INDEX IF NOT EXISTS/g);
    expect(createIndexMatches).not.toBeNull();
    expect(createIndexMatches?.length).toBe(22);
  });

  it('6. Enables Row Level Security (RLS) on all 12 tables', () => {
    const rlsTables = [
      'public.profiles',
      'public.rooms',
      'public.room_participants',
      'public.player_sets',
      'public.players',
      'public.auctions',
      'public.teams',
      'public.auction_lots',
      'public.squad_players',
      'public.bids',
      'public.auction_events',
      'public.bot_lot_state',
    ];

    rlsTables.forEach((table) => {
      expect(phase2aSql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    });
  });

  it('7. Defines all 8 Phase 2B RPC functions in 00006_auction_rpcs.sql', () => {
    const requiredRpcs = [
      '_emit_auction_event',
      'evaluate_bot_interests',
      'advance_lot',
      '_process_bid_internal',
      'process_bid',
      'execute_bot_bids',
      'process_lot_expiry',
      'start_auction',
      'pause_auction',
      'resume_auction',
    ];

    requiredRpcs.forEach((rpc) => {
      expect(phase2bSql).toContain(`FUNCTION public.${rpc}`);
    });
  });

  it('8. Enforces SECURITY DEFINER and SET search_path = public on all Phase 2B RPCs', () => {
    const requiredRpcs = [
      '_emit_auction_event',
      'evaluate_bot_interests',
      'advance_lot',
      '_process_bid_internal',
      'process_bid',
      'execute_bot_bids',
      'process_lot_expiry',
      'start_auction',
      'pause_auction',
      'resume_auction',
    ];

    expect(requiredRpcs.length).toBe(10);
    const secDefCount = (phase2bSql.match(/SECURITY DEFINER/g) || []).length;
    const searchPathCount = (phase2bSql.match(/SET search_path = public/g) || []).length;

    expect(secDefCount).toBe(requiredRpcs.length);
    expect(searchPathCount).toBe(requiredRpcs.length);
  });

  it('9. Restricts private internal RPC execution privileges from PUBLIC/anon/authenticated', () => {
    expect(phase2bSql).toContain('REVOKE ALL ON FUNCTION public._emit_auction_event(UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;');
    expect(phase2bSql).toContain('REVOKE ALL ON FUNCTION public._process_bid_internal(UUID, UUID, INT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;');
    expect(phase2bSql).toContain('REVOKE ALL ON FUNCTION public.execute_bot_bids(UUID) FROM PUBLIC, anon, authenticated;');
    expect(phase2bSql).toContain('REVOKE ALL ON FUNCTION public.evaluate_bot_interests(UUID, UUID) FROM PUBLIC, anon, authenticated;');
  });

  it('10. Implements Issue #6 Clone-on-Transition Unsold Round and Issue #7 Event Sequencing Helper', () => {
    // Issue #6 Clone-on-Transition checks
    expect(phase2bSql).toContain('GREATEST(1, FLOOR(v_unsold_lot.base_price * 0.5))');
    expect(phase2bSql).toContain('UNSOLD_ROUND_STARTED');
    
    // Issue #7 Event Sequencing check
    expect(phase2bSql).toContain('FUNCTION public._emit_auction_event');
    expect(phase2bSql).toContain('current_sequence = current_sequence + 1');
  });
});
