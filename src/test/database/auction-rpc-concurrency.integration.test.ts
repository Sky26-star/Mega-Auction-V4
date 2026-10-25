// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { resolveDisposableDatabaseTarget } from './disposable-db-guard';

const disposableDatabase = resolveDisposableDatabaseTarget(process.env);
if (!disposableDatabase.configured) {
  console.warn(`[DB TEST SKIPPED] ${disposableDatabase.reason}`);
}
const LOCAL_PG_URL = disposableDatabase.configured ? disposableDatabase.connectionString : '';

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

describe.skipIf(!disposableDatabase.configured)('Auction RPC Multi-Connection Concurrency & Deadlock Integration Suite', () => {
  let adminClient: Client;
  let bidderClient1: Client;
  let bidderClient2: Client;
  let finalizerClient: Client;

  let initialTableFingerprints: Record<string, TableFingerprint> = {};
  let initialSchemaFingerprints: SchemaFingerprint = { functionsHash: '', privilegesHash: '' };

  const roomId = randomUUID();
  const auctionId = randomUUID();
  const humanUserId1 = randomUUID();
  const humanUserId2 = randomUUID();
  const humanTeamId1 = randomUUID();
  const humanTeamId2 = randomUUID();
  const botTeamId = randomUUID();
  const playerId1 = randomUUID();
  const playerId2 = randomUUID();
  const playerId3 = randomUUID();
  const lotId1 = randomUUID();
  const lotId2 = randomUUID();
  const lotId3 = randomUUID();
  const playerSetId = '00000000-0000-0000-0000-000000000202';

  let adminConnected = false;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: LOCAL_PG_URL, connectionTimeoutMillis: 20000 });
    bidderClient1 = new Client({ connectionString: LOCAL_PG_URL, connectionTimeoutMillis: 20000 });
    bidderClient2 = new Client({ connectionString: LOCAL_PG_URL, connectionTimeoutMillis: 20000 });
    finalizerClient = new Client({ connectionString: LOCAL_PG_URL, connectionTimeoutMillis: 20000 });

    console.log('[CONCURRENCY SETUP] Connecting clients...');
    try {
      await adminClient.connect();
      adminConnected = true;
      console.log('[CONCURRENCY SETUP] admin connected');
      await bidderClient1.connect();
      console.log('[CONCURRENCY SETUP] bidder 1 connected');
      await bidderClient2.connect();
      console.log('[CONCURRENCY SETUP] bidder 2 connected');
      await finalizerClient.connect();
      console.log('[CONCURRENCY SETUP] finalizer connected');
    } catch {
      throw new Error(
        'Could not connect to the configured disposable PostgreSQL target at 127.0.0.1:55325.'
      );
    }

    console.log('[CONCURRENCY SETUP] Computing fingerprints...');
    // 1. Capture baseline fingerprints before creating any fixture
    initialTableFingerprints = await computeTableFingerprints(adminClient);
    initialSchemaFingerprints = await computeSchemaFingerprints(adminClient);

    console.log('[CONCURRENCY SETUP] Applying hardening migration...');
    // 2. Ensure hardening migration is active
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261022100000_auction_rpc_security_hardening.sql');
    let sql = fs.readFileSync(migrationPath, 'utf8');
    await adminClient.query(sql);
    console.log('[CONCURRENCY SETUP] Inserting fixtures...');

    // 3. Create test fixture data
    await adminClient.query(`
      INSERT INTO public.profiles (id, username, display_name)
      VALUES 
        ($1, 'concurrent_user_1', 'Concurrent User 1'),
        ($2, 'concurrent_user_2', 'Concurrent User 2');
    `, [humanUserId1, humanUserId2]);

    await adminClient.query(`
      INSERT INTO public.rooms (id, name, code, host_id, settings, status)
      VALUES ($1, 'Concurrency Test Room', 'CC01', $2, '{"max_squad_size": 25, "max_overseas": 8, "timer_duration_seconds": 15}'::jsonb, 'OPEN');
    `, [roomId, humanUserId1]);

    await adminClient.query(`
      INSERT INTO public.auctions (id, room_id, player_set_id, status, current_lot_id, current_lot_index)
      VALUES ($1, $2, $3, 'IN_PROGRESS', NULL, 1);
    `, [auctionId, roomId, playerSetId]);

    await adminClient.query(`
      INSERT INTO public.teams (id, auction_id, name, short_name, purse, initial_purse, is_bot, players_bought, overseas_count)
      VALUES 
        ($1, $4, 'Human Alpha', 'HA', 10000, 10000, false, 0, 0),
        ($2, $4, 'Human Bravo', 'HB', 10000, 10000, false, 0, 0),
        ($3, $4, 'Bot Charlie', 'BC', 10000, 10000, true, 0, 0);
    `, [humanTeamId1, humanTeamId2, botTeamId, auctionId]);

    await adminClient.query(`
      INSERT INTO public.room_participants (room_id, user_id, team_id, role, is_bot)
      VALUES 
        ($1, $2, $4, 'HOST', false),
        ($1, $3, $5, 'MEMBER', false),
        ($1, NULL, $6, 'MEMBER', true);
    `, [roomId, humanUserId1, humanUserId2, humanTeamId1, humanTeamId2, botTeamId]);

    await adminClient.query(`
      INSERT INTO public.players (id, player_set_id, name, role, base_price, is_overseas)
      VALUES 
        ($1, $4, 'Player Concurrency A', 'BATSMAN', 200, false),
        ($2, $4, 'Player Concurrency B', 'BOWLER', 200, false),
        ($3, $4, 'Player Concurrency C', 'ALL_ROUNDER', 200, false);
    `, [playerId1, playerId2, playerId3, playerSetId]);

    // Lot 1: active BIDDING lot
    await adminClient.query(`
      INSERT INTO public.auction_lots (id, auction_id, lot_index, player_id, base_price, current_bid, status, timer_duration_seconds, timer_expires_at)
      VALUES ($1, $2, 1, $3, 200, 200, 'BIDDING', 15, clock_timestamp() + INTERVAL '15 seconds');
    `, [lotId1, auctionId, playerId1]);

    // Lot 2: PENDING lot (advances to GET_READY when lot 1 finalizes)
    await adminClient.query(`
      INSERT INTO public.auction_lots (id, auction_id, lot_index, player_id, base_price, current_bid, status, timer_duration_seconds)
      VALUES ($1, $2, 2, $3, 200, 200, 'PENDING', 15);
    `, [lotId2, auctionId, playerId2]);

    // Lot 3: PENDING lot (advances to GET_READY when lot 2 finalizes)
    await adminClient.query(`
      INSERT INTO public.auction_lots (id, auction_id, lot_index, player_id, base_price, current_bid, status, timer_duration_seconds)
      VALUES ($1, $2, 3, $3, 200, 200, 'PENDING', 15);
    `, [lotId3, auctionId, playerId3]);

    await adminClient.query(`
      UPDATE public.auctions SET current_lot_id = $1 WHERE id = $2;
    `, [lotId1, auctionId]);
  }, 45000);

  afterAll(async () => {
    try {
      if (adminConnected) {
        // 1. Cleanly delete test fixtures cascading from room
        await adminClient.query(`DELETE FROM public.rooms WHERE id = $1;`, [roomId]);
        await adminClient.query(`DELETE FROM public.players WHERE id IN ($1, $2, $3);`, [playerId1, playerId2, playerId3]);
        await adminClient.query(`DELETE FROM public.profiles WHERE id IN ($1, $2);`, [humanUserId1, humanUserId2]);

        // 2. Assert that table row counts and fingerprints match the initial baseline
        const postTableFingerprints = await computeTableFingerprints(adminClient);
        for (const table of Object.keys(initialTableFingerprints)) {
          expect(postTableFingerprints[table]!.count).toBe(initialTableFingerprints[table]!.count);
          expect(postTableFingerprints[table]!.hash).toBe(initialTableFingerprints[table]!.hash);
        }
      }
    } catch (cleanupErr) {
      console.error('[CONCURRENCY TEST CLEANUP ERROR]', cleanupErr);
    } finally {
      await Promise.allSettled([
        adminClient?.end(),
        bidderClient1?.end(),
        bidderClient2?.end(),
        finalizerClient?.end(),
      ]);
    }
  }, 30000);

  it('1. Proves lock hierarchy prevents deadlocks between concurrent bidding and finalization', async () => {
    // Team 1 is initial highest bidder on lot 1
    await adminClient.query(`
      UPDATE public.auction_lots
      SET highest_bidder_team_id = $1, current_bid = 200
      WHERE id = $2;
    `, [humanTeamId1, lotId1]);

    // Set roles
    await bidderClient1.query(`SET role = 'authenticated';`);
    await bidderClient1.query(`SET "request.jwt.claims" = '${JSON.stringify({ sub: humanUserId1, role: 'authenticated' })}';`);

    await finalizerClient.query(`SET role = 'service_role';`);
    await finalizerClient.query(`SET "request.jwt.claims" = '${JSON.stringify({ role: 'service_role' })}';`);

    const reqId = randomUUID();

    // Execute concurrent bid (by current highest bidder's opponent or force-finalizer)
    // Bidder 1 attempts next bid; Finalizer attempts to finalize lot 1
    const [bidResult, finResult] = await Promise.allSettled([
      bidderClient1.query(`SELECT public.v3_place_bid($1, $2, $3, $4, false) AS res;`, [auctionId, lotId1, humanTeamId2, reqId]),
      finalizerClient.query(`SELECT public.v3_finalize_and_advance_lot($1, $2, false) AS res;`, [auctionId, lotId1]),
    ]);

    // Zero deadlocks: neither query may reject with code 40P01
    expect(bidResult.status).toBe('fulfilled');
    expect(finResult.status).toBe('fulfilled');

    if (bidResult.status === 'fulfilled' && finResult.status === 'fulfilled') {
      const bRes = bidResult.value.rows[0].res;
      const fRes = finResult.value.rows[0].res;

      // Because bidder and finalizer serialize on auction_lots FOR UPDATE:
      // If bid won the lock: bid succeeded (or extended timer), finalizer got ERR_TIMER_NOT_EXPIRED.
      // If finalizer won the lock: finalizer finalized (or was rejected if timer active), bid handled accordingly.
      expect(bRes).toBeDefined();
      expect(fRes).toBeDefined();
    }

    // Verify team purse integrity
    const teamCheck = await adminClient.query(`SELECT purse FROM public.teams WHERE id = $1;`, [humanTeamId1]);
    expect(teamCheck.rows[0].purse).toBeGreaterThanOrEqual(0);
  });

  it('2. Serializes concurrent human bids on the same lot without lost updates or deadlocks', async () => {
    // Reset lot timer to ensure active BIDDING
    await adminClient.query(`
      UPDATE public.auction_lots 
      SET status = 'BIDDING', timer_expires_at = clock_timestamp() + INTERVAL '15 seconds', highest_bidder_team_id = NULL, current_bid = 200
      WHERE id = $1;
    `, [lotId1]);

    await bidderClient1.query(`SET role = 'authenticated';`);
    await bidderClient1.query(`SET "request.jwt.claims" = '${JSON.stringify({ sub: humanUserId1, role: 'authenticated' })}';`);

    await bidderClient2.query(`SET role = 'authenticated';`);
    await bidderClient2.query(`SET "request.jwt.claims" = '${JSON.stringify({ sub: humanUserId2, role: 'authenticated' })}';`);

    const reqId1 = randomUUID();
    const reqId2 = randomUUID();

    // Fire both bids simultaneously across two independent connections
    const [res1, res2] = await Promise.all([
      bidderClient1.query(`SELECT public.v3_place_bid($1, $2, $3, $4, false) AS res;`, [auctionId, lotId1, humanTeamId1, reqId1]),
      bidderClient2.query(`SELECT public.v3_place_bid($1, $2, $3, $4, false) AS res;`, [auctionId, lotId1, humanTeamId2, reqId2]),
    ]);

    const r1 = res1.rows[0].res;
    const r2 = res2.rows[0].res;

    // Both bids must complete without transaction rollback or deadlock
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // One bid was first (200 base price), the other second (200 + 25 = 225)
    const amounts = [r1.amount, r2.amount].sort((a, b) => a - b);
    expect(amounts[0]).toBe(200);
    expect(amounts[1]).toBe(225);

    // Check bids table in DB: exactly 2 bids recorded
    const bidsRes = await adminClient.query(`SELECT amount, team_id, bid_number FROM public.bids WHERE lot_id = $1 ORDER BY bid_number ASC;`, [lotId1]);
    expect(bidsRes.rows.length).toBe(2);
    expect(bidsRes.rows[0].bid_number).toBe(1);
    expect(bidsRes.rows[1].bid_number).toBe(2);

    // Lot highest bidder must match the team of the higher bid
    const lotCheck = await adminClient.query(`SELECT current_bid, highest_bidder_team_id FROM public.auction_lots WHERE id = $1;`, [lotId1]);
    expect(lotCheck.rows[0].current_bid).toBe(225);
    expect([humanTeamId1, humanTeamId2]).toContain(lotCheck.rows[0].highest_bidder_team_id);
  });

  it('3. Authorizes concurrent service-role bot bids while rejecting non-service bot claims', async () => {
    // Current bid is 225. Bot Charlie (botTeamId) bids next.
    await finalizerClient.query(`SET role = 'service_role';`);
    await finalizerClient.query(`SET "request.jwt.claims" = '${JSON.stringify({ role: 'service_role' })}';`);

    const botReqId = randomUUID();
    const botRes = await finalizerClient.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, true) AS res;
    `, [auctionId, lotId1, botTeamId, botReqId]);

    expect(botRes.rows[0].res.success).toBe(true);
    expect(botRes.rows[0].res.amount).toBe(250); // 225 + 25 = 250
    expect(botRes.rows[0].res.highest_bidder_team_id).toBe(botTeamId);

    // Human client attempting p_is_bot=true on bot team is rejected
    await bidderClient1.query(`SET role = 'authenticated';`);
    const forgedRes = await bidderClient1.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, true) AS res;
    `, [auctionId, lotId1, botTeamId, randomUUID()]);

    expect(forgedRes.rows[0].res.success).toBe(false);
    expect(forgedRes.rows[0].res.error).toBe('ERR_BOT_BID_FORBIDDEN');
  });

  it('4. Enforces distributed advisory lock: concurrent worker finalizations cannot duplicate', async () => {
    // Set timer to expired so both workers attempt finalization
    await adminClient.query(`
      UPDATE public.auction_lots 
      SET timer_expires_at = clock_timestamp() - INTERVAL '5 seconds'
      WHERE id = $1;
    `, [lotId1]);

    await finalizerClient.query(`SET role = 'service_role';`);
    await adminClient.query(`SET role = 'service_role';`);

    // Two worker threads attempt to finalize lot 1 simultaneously
    const [fin1, fin2] = await Promise.all([
      finalizerClient.query(`SELECT public.v3_finalize_and_advance_lot($1, $2, false) AS res;`, [auctionId, lotId1]),
      adminClient.query(`SELECT public.v3_finalize_and_advance_lot($1, $2, false) AS res;`, [auctionId, lotId1]),
    ]);

    const res1 = fin1.rows[0].res;
    const res2 = fin2.rows[0].res;

    // Exactly one finalization must succeed
    const successes = [res1.success, res2.success].filter(Boolean);
    expect(successes.length).toBe(1);

    // The losing transaction must receive either concurrency error or lot not bidding
    const errors = [res1.error, res2.error].filter(Boolean);
    expect(['ERR_CONCURRENT_AUCTION_FINALIZATION_IN_PROGRESS', 'ERR_LOT_NOT_BIDDING']).toContain(errors[0]);

    // Team purse must be deducted exactly once: 10000 - 250 = 9750
    const botTeam = await adminClient.query(`SELECT purse, players_bought FROM public.teams WHERE id = $1;`, [botTeamId]);
    expect(botTeam.rows[0].purse).toBe(9750);
    expect(botTeam.rows[0].players_bought).toBe(1);

    // Exactly one squad player inserted
    const squadCheck = await adminClient.query(`SELECT COUNT(*) FROM public.squad_players WHERE lot_id = $1;`, [lotId1]);
    expect(parseInt(squadCheck.rows[0].count, 10)).toBe(1);
  });

  it('5. Exercises complete end-to-end bot lifecycle: GET_READY -> START_BIDDING -> BOT_BID -> FINALIZE -> SOLD', async () => {
    // Switch auction current_lot_id to lot 2
    await adminClient.query(`
      UPDATE public.auctions SET current_lot_id = $1 WHERE id = $2;
    `, [lotId2, auctionId]);

    // 1. Worker detects eligible GET_READY lot with expired get_ready timer, starts bidding
    const startRes = await adminClient.query(`
      SELECT public.v3_start_bidding($1, $2, true) AS res;
    `, [auctionId, lotId2]);

    expect(startRes.rows[0].res.success).toBe(true);
    expect(startRes.rows[0].res.status).toBe('BIDDING');

    // 2. Bot evaluates and places first bid at base price
    const botBidReqId = randomUUID();
    const bidRes = await adminClient.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, true) AS res;
    `, [auctionId, lotId2, botTeamId, botBidReqId]);

    expect(bidRes.rows[0].res.success).toBe(true);
    expect(bidRes.rows[0].res.amount).toBe(200);
    expect(bidRes.rows[0].res.highest_bidder_team_id).toBe(botTeamId);

    // 3. Force-finalize lot 2 (simulating timer expiration)
    const finRes = await adminClient.query(`
      SELECT public.v3_finalize_and_advance_lot($1, $2, true) AS res;
    `, [auctionId, lotId2]);

    expect(finRes.rows[0].res.success).toBe(true);
    expect(finRes.rows[0].res.status).toBe('SOLD');
    expect(finRes.rows[0].res.next_lot_id).toBe(lotId3);

    // 4. Verify purse and squad balance for bot team
    const botCheck = await adminClient.query(`SELECT purse, players_bought FROM public.teams WHERE id = $1;`, [botTeamId]);
    expect(botCheck.rows[0].purse).toBe(9550); // 9750 - 200 = 9550
    expect(botCheck.rows[0].players_bought).toBe(2);

    // Next lot is now in GET_READY status
    const nextLot = await adminClient.query(`SELECT status FROM public.auction_lots WHERE id = $1;`, [lotId3]);
    expect(nextLot.rows[0].status).toBe('GET_READY');
  });
});
