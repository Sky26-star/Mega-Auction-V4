// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import crypto, { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { executeAuctionTick } from '@/lib/auction/auction-orchestrator';
import { resolveDisposableDatabaseTarget } from './disposable-db-guard';

const disposableDatabase = resolveDisposableDatabaseTarget(process.env);
if (!disposableDatabase.configured) {
  console.warn(`[DB TEST SKIPPED] ${disposableDatabase.reason}`);
}
const LOCAL_PG_URL = disposableDatabase.configured ? disposableDatabase.connectionString : '';
const SUPABASE_URL = 'http://127.0.0.1:55321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface TableFingerprint {
  count: number;
  hash: string;
}

interface SchemaFingerprint {
  functionsHash: string;
  privilegesHash: string;
}

async function computeTableFingerprints(c: Client): Promise<Record<string, TableFingerprint>> {
  const tables = ['profiles', 'rooms', 'auctions', 'teams', 'room_participants', 'auction_lots', 'bids'];
  const result: Record<string, TableFingerprint> = {};

  for (const table of tables) {
    const res = await c.query(
      `SELECT row_to_json(t) AS row_data FROM (SELECT * FROM public.${table} ORDER BY id ASC) t;`
    );
    const count = res.rows.length;
    const hasher = crypto.createHash('sha256');
    for (const row of res.rows) {
      hasher.update(JSON.stringify(row.row_data));
    }
    result[table] = { count, hash: hasher.digest('hex') };
  }
  return result;
}

async function computeSchemaFingerprints(c: Client): Promise<SchemaFingerprint> {
  const funcs = await c.query(`
    SELECT p.proname, p.prosrc, p.prosecdef, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN ('v3_place_bid', 'v3_finalize_and_advance_lot', 'v3_start_bidding', 'v3_close_mini_selection')
    ORDER BY p.proname, args;
  `);
  const funcHasher = crypto.createHash('sha256');
  for (const row of funcs.rows) {
    funcHasher.update(JSON.stringify(row));
  }

  const privs = await c.query(`
    SELECT routine_name, specific_name, grantee, privilege_type 
    FROM information_schema.routine_privileges 
    WHERE specific_schema = 'public' 
      AND routine_name IN ('v3_place_bid', 'v3_finalize_and_advance_lot', 'v3_start_bidding', 'v3_close_mini_selection')
    ORDER BY routine_name, specific_name, grantee, privilege_type;
  `);
  const privHasher = crypto.createHash('sha256');
  for (const row of privs.rows) {
    privHasher.update(JSON.stringify(row));
  }

  return {
    functionsHash: funcHasher.digest('hex'),
    privilegesHash: privHasher.digest('hex'),
  };
}

describe.skipIf(!disposableDatabase.configured)('Auction Worker & Orchestrator End-to-End Real Runtime Integration Suite', () => {
  let pgClient: Client;
  let supabase: SupabaseClient;

  let initialTableFingerprints: Record<string, TableFingerprint> = {};
  let initialSchemaFingerprints: SchemaFingerprint = { functionsHash: '', privilegesHash: '' };
  let pgConnected = false;

  const roomId = randomUUID();
  const auctionId = randomUUID();
  const hostUserId = randomUUID();
  const botTeamId = randomUUID();
  const humanTeamId = randomUUID();
  const playerId1 = randomUUID();
  const playerId2 = randomUUID();
  const lotId1 = randomUUID();
  const lotId2 = randomUUID();
  const playerSetId = '00000000-0000-0000-0000-000000000202';

  beforeAll(async () => {
    if (!SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for worker runtime integration test.');
    }

    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    pgClient = new Client({ connectionString: LOCAL_PG_URL, connectionTimeoutMillis: 20000 });
    try {
      await pgClient.connect();
      pgConnected = true;
    } catch {
      throw new Error(
        'Could not connect to the configured disposable PostgreSQL target at 127.0.0.1:55325.'
      );
    }

    // 1. Capture baseline fingerprints before test fixture creation
    initialTableFingerprints = await computeTableFingerprints(pgClient);
    initialSchemaFingerprints = await computeSchemaFingerprints(pgClient);

    // 2. Ensure hardening migration is active
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261022100000_auction_rpc_security_hardening.sql');
    let sql = fs.readFileSync(migrationPath, 'utf8');
    await pgClient.query(sql);

    // 3. Insert test fixtures directly into database
    await pgClient.query(`
      INSERT INTO public.profiles (id, username, display_name)
      VALUES ($1, 'worker_host_user', 'Worker Host User');
    `, [hostUserId]);

    await pgClient.query(`
      INSERT INTO public.rooms (id, name, code, host_id, settings, status)
      VALUES ($1, 'Worker Flow Room', 'WK01', $2, '{"max_squad_size": 25, "max_overseas": 8, "timer_duration_seconds": 15, "bot_difficulty": "Normal"}'::jsonb, 'OPEN');
    `, [roomId, hostUserId]);

    await pgClient.query(`
      INSERT INTO public.auctions (id, room_id, player_set_id, status, current_lot_id, current_lot_index)
      VALUES ($1, $2, $3, 'IN_PROGRESS', NULL, 1);
    `, [auctionId, roomId, playerSetId]);

    await pgClient.query(`
      INSERT INTO public.teams (id, auction_id, name, short_name, purse, initial_purse, is_bot, players_bought, overseas_count)
      VALUES 
        ($1, $3, 'Worker Human Team', 'WHT', 10000, 10000, false, 0, 0),
        ($2, $3, 'Worker Bot Team', 'WBT', 10000, 10000, true, 0, 0);
    `, [humanTeamId, botTeamId, auctionId]);

    await pgClient.query(`
      INSERT INTO public.room_participants (room_id, user_id, team_id, role, is_bot)
      VALUES 
        ($1, $2, $3, 'HOST', false),
        ($1, NULL, $4, 'MEMBER', true);
    `, [roomId, hostUserId, humanTeamId, botTeamId]);

    await pgClient.query(`
      INSERT INTO public.players (id, player_set_id, name, role, base_price, is_overseas)
      VALUES 
        ($1, $3, 'Worker Star Batter', 'BATSMAN', 200, false),
        ($2, $3, 'Worker Fast Bowler', 'BOWLER', 200, false);
    `, [playerId1, playerId2, playerSetId]);

    // Lot 1: GET_READY lot with expired get_ready timer
    await pgClient.query(`
      INSERT INTO public.auction_lots (id, auction_id, lot_index, player_id, base_price, current_bid, status, timer_duration_seconds, get_ready_expires_at)
      VALUES ($1, $2, 1, $3, 200, 200, 'GET_READY', 15, clock_timestamp() - INTERVAL '2 seconds');
    `, [lotId1, auctionId, playerId1]);

    // Lot 2: PENDING lot
    await pgClient.query(`
      INSERT INTO public.auction_lots (id, auction_id, lot_index, player_id, base_price, current_bid, status, timer_duration_seconds)
      VALUES ($1, $2, 2, $3, 200, 200, 'PENDING', 15);
    `, [lotId2, auctionId, playerId2]);

    await pgClient.query(`
      UPDATE public.auctions SET current_lot_id = $1 WHERE id = $2;
    `, [lotId1, auctionId]);
  }, 45000);

  afterAll(async () => {
    try {
      if (pgConnected) {
        // Cleanly delete fixtures cascading from room
        await pgClient.query(`DELETE FROM public.rooms WHERE id = $1;`, [roomId]);
        await pgClient.query(`DELETE FROM public.players WHERE id IN ($1, $2);`, [playerId1, playerId2]);
        await pgClient.query(`DELETE FROM public.profiles WHERE id = $1;`, [hostUserId]);

        // Verify database state is 100% restored to baseline fingerprints
        const postTableFingerprints = await computeTableFingerprints(pgClient);
        const postSchemaFingerprints = await computeSchemaFingerprints(pgClient);

        for (const table of Object.keys(initialTableFingerprints)) {
          expect(postTableFingerprints[table]!.count).toBe(initialTableFingerprints[table]!.count);
          expect(postTableFingerprints[table]!.hash).toBe(initialTableFingerprints[table]!.hash);
        }

        expect(postSchemaFingerprints.functionsHash).toBe(initialSchemaFingerprints.functionsHash);
        expect(postSchemaFingerprints.privilegesHash).toBe(initialSchemaFingerprints.privilegesHash);
      }
    } catch (cleanupErr) {
      console.error('[WORKER LIFECYCLE CLEANUP ERROR]', cleanupErr);
    } finally {
      if (pgConnected) {
        await pgClient.end();
      }
    }
  }, 30000);

  it('1. Worker tick detects expired GET_READY lot and transitions it to BIDDING', async () => {
    // Invoke real executeAuctionTick with server-side service-role client
    const tickResult = await executeAuctionTick(supabase);

    const startAction = tickResult.actions.find(
      (a: any) => a.auction === auctionId && a.lot === lotId1 && a.action === 'START_BIDDING'
    );
    expect(startAction).toBeDefined();

    // Verify in database: status is now BIDDING and timer_expires_at is set
    const lotRes = await pgClient.query(`SELECT status, timer_expires_at FROM public.auction_lots WHERE id = $1;`, [lotId1]);
    expect(lotRes.rows[0].status).toBe('BIDDING');
    expect(new Date(lotRes.rows[0].timer_expires_at).getTime()).toBeGreaterThan(Date.now());
  }, 30000);

  it('2. Worker tick evaluates bot candidates and submits authoritative bot bid via service-role RPC', async () => {
    // Ensure sufficient time has elapsed for bot reaction delay (delayMs is typically 500-1200ms)
    await pgClient.query(`
      UPDATE public.auction_lots 
      SET timer_expires_at = clock_timestamp() + INTERVAL '10 seconds'
      WHERE id = $1;
    `, [lotId1]);

    // Invoke executeAuctionTick while lot is BIDDING
    const tickResult = await executeAuctionTick(supabase);

    const botBidAction = tickResult.actions.find(
      (a: any) => a.auction === auctionId && a.lot === lotId1 && a.action === 'BOT_BID'
    );

    expect(botBidAction).toBeDefined();
    expect(botBidAction.result).toBe('APPLIED');
    expect(botBidAction.team).toBe(botTeamId);
    expect(botBidAction.amount).toBe(200); // base price

    // Verify bid row in PostgreSQL
    const bidRes = await pgClient.query(`SELECT team_id, amount, is_bot FROM public.bids WHERE lot_id = $1;`, [lotId1]);
    expect(bidRes.rows.length).toBe(1);
    expect(bidRes.rows[0].team_id).toBe(botTeamId);
    expect(bidRes.rows[0].amount).toBe(200);
    expect(bidRes.rows[0].is_bot).toBe(true);

    // Verify lot highest bidder
    const lotRes = await pgClient.query(`SELECT highest_bidder_team_id, current_bid FROM public.auction_lots WHERE id = $1;`, [lotId1]);
    expect(lotRes.rows[0].highest_bidder_team_id).toBe(botTeamId);
    expect(lotRes.rows[0].current_bid).toBe(200);
  }, 30000);

  it('3. Worker tick does not finalize lot before timer expires (p_force: false due-only)', async () => {
    // Current timer is active; ticking again should not finalize early
    const tickResult = await executeAuctionTick(supabase);

    const finAction = tickResult.actions.find(
      (a: any) => a.auction === auctionId && a.lot === lotId1 && a.action === 'FINALIZE_LOT'
    );
    expect(finAction).toBeUndefined();

    // Lot remains in BIDDING
    const lotRes = await pgClient.query(`SELECT status FROM public.auction_lots WHERE id = $1;`, [lotId1]);
    expect(lotRes.rows[0].status).toBe('BIDDING');
  }, 30000);

  it('4. Worker tick finalizes lot upon timer expiration, records sale, updates purse/squad, and advances to next lot', async () => {
    // Simulate timer expiration on lot 1
    await pgClient.query(`
      UPDATE public.auction_lots
      SET timer_expires_at = clock_timestamp() - INTERVAL '2 seconds'
      WHERE id = $1;
    `, [lotId1]);

    // Invoke executeAuctionTick
    const tickResult = await executeAuctionTick(supabase);

    const finAction = tickResult.actions.find(
      (a: any) => a.auction === auctionId && a.lot === lotId1 && a.action === 'FINALIZE_LOT'
    );
    expect(finAction).toBeDefined();

    // Verify lot 1 is SOLD in PostgreSQL
    const lot1Res = await pgClient.query(`SELECT status, winning_team_id, winning_bid FROM public.auction_lots WHERE id = $1;`, [lotId1]);
    expect(lot1Res.rows[0].status).toBe('SOLD');
    expect(lot1Res.rows[0].winning_team_id).toBe(botTeamId);
    expect(lot1Res.rows[0].winning_bid).toBe(200);

    // Verify bot team purse deduction and players_bought increment
    const teamRes = await pgClient.query(`SELECT purse, players_bought FROM public.teams WHERE id = $1;`, [botTeamId]);
    expect(teamRes.rows[0].purse).toBe(9800); // 10000 - 200
    expect(teamRes.rows[0].players_bought).toBe(1);

    // Verify player is in squad_players
    const squadRes = await pgClient.query(`SELECT team_id, player_id, purchase_price FROM public.squad_players WHERE lot_id = $1;`, [lotId1]);
    expect(squadRes.rows.length).toBe(1);
    expect(squadRes.rows[0].team_id).toBe(botTeamId);
    expect(squadRes.rows[0].player_id).toBe(playerId1);
    expect(squadRes.rows[0].purchase_price).toBe(200);

    // Verify lot 2 is advanced to GET_READY and current_lot_id on auction is updated
    const lot2Res = await pgClient.query(`SELECT status, get_ready_expires_at FROM public.auction_lots WHERE id = $1;`, [lotId2]);
    expect(lot2Res.rows[0].status).toBe('GET_READY');

    const auctionRes = await pgClient.query(`SELECT current_lot_id, current_lot_index FROM public.auctions WHERE id = $1;`, [auctionId]);
    expect(auctionRes.rows[0].current_lot_id).toBe(lotId2);
    expect(auctionRes.rows[0].current_lot_index).toBe(2);
  }, 30000);
});
