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

describe.skipIf(!disposableDatabase.configured)('Auction RPC Security & Concurrency Real PostgreSQL Integration Suite', () => {
  let client: Client;
  let initialTableFingerprints: Record<string, TableFingerprint> = {};
  let initialSchemaFingerprints: SchemaFingerprint = { functionsHash: '', privilegesHash: '' };
  let transactionActive = false;
  let isConnected = false;

  beforeAll(async () => {
    client = new Client({ connectionString: LOCAL_PG_URL, connectionTimeoutMillis: 10000 });
    try {
      await client.connect();
      isConnected = true;
    } catch {
      throw new Error(
        'Could not connect to the configured disposable PostgreSQL target at 127.0.0.1:55325.'
      );
    }

    // Capture stable baseline cryptographic fingerprints of rows and schema before transaction
    initialTableFingerprints = await computeTableFingerprints(client);
    initialSchemaFingerprints = await computeSchemaFingerprints(client);

    // Start isolated transaction
    await client.query('BEGIN;');
    transactionActive = true;
  });

  afterAll(async () => {
    try {
      if (transactionActive && isConnected) {
        await client.query('ROLLBACK;');
        transactionActive = false;
      }
    } finally {
      if (isConnected) {
        // Confirm database state is 100% restored to baseline fingerprints
        const postTableFingerprints = await computeTableFingerprints(client);
        const postSchemaFingerprints = await computeSchemaFingerprints(client);

        for (const table of Object.keys(initialTableFingerprints)) {
          const init = initialTableFingerprints[table]!;
          const post = postTableFingerprints[table]!;
          if (post.count !== init.count || post.hash !== init.hash) {
            console.error(
              `Database mutation leak detected in ${table}: expected count=${init.count}, got=${post.count}`
            );
          }
        }
        await client.end();
      }
    }
  });

  it('1. Compiles hardened migration and verifies exact privilege revokes and grants', async () => {
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261022100000_auction_rpc_security_hardening.sql');
    let sql = fs.readFileSync(migrationPath, 'utf8');
    sql = sql.replace(/^\s*BEGIN\s*;/m, '');
    sql = sql.replace(/\s*COMMIT\s*;\s*$/m, '');

    // Apply migration inside the active transaction
    await client.query(sql);

    // Verify exact function privileges inside transaction
    const privs = await client.query(`
      SELECT 
        has_function_privilege('anon', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE') AS anon_can_bid,
        has_function_privilege('anon', 'public.v3_finalize_and_advance_lot(uuid,uuid)', 'EXECUTE') AS anon_can_finalize_2,
        has_function_privilege('anon', 'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)', 'EXECUTE') AS anon_can_finalize_3,
        has_function_privilege('anon', 'public.v3_start_bidding(uuid,uuid)', 'EXECUTE') AS anon_can_start_2,
        has_function_privilege('anon', 'public.v3_start_bidding(uuid,uuid,boolean)', 'EXECUTE') AS anon_can_start_3,
        has_function_privilege('anon', 'public.v3_close_mini_selection(uuid,boolean)', 'EXECUTE') AS anon_can_close_mini,
        has_function_privilege('authenticated', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE') AS auth_can_bid,
        has_function_privilege('authenticated', 'public.v3_finalize_and_advance_lot(uuid,uuid)', 'EXECUTE') AS auth_can_finalize_2,
        has_function_privilege('authenticated', 'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)', 'EXECUTE') AS auth_can_finalize_3,
        has_function_privilege('authenticated', 'public.v3_start_bidding(uuid,uuid)', 'EXECUTE') AS auth_can_start_2,
        has_function_privilege('authenticated', 'public.v3_start_bidding(uuid,uuid,boolean)', 'EXECUTE') AS auth_can_start_3,
        has_function_privilege('authenticated', 'public.v3_close_mini_selection(uuid,boolean)', 'EXECUTE') AS auth_can_close_mini,
        has_function_privilege('service_role', 'public.v3_place_bid(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE') AS service_can_bid,
        has_function_privilege('service_role', 'public.v3_finalize_and_advance_lot(uuid,uuid)', 'EXECUTE') AS service_can_finalize_2,
        has_function_privilege('service_role', 'public.v3_finalize_and_advance_lot(uuid,uuid,boolean)', 'EXECUTE') AS service_can_finalize_3,
        has_function_privilege('service_role', 'public.v3_start_bidding(uuid,uuid)', 'EXECUTE') AS service_can_start_2,
        has_function_privilege('service_role', 'public.v3_start_bidding(uuid,uuid,boolean)', 'EXECUTE') AS service_can_start_3,
        has_function_privilege('service_role', 'public.v3_close_mini_selection(uuid,boolean)', 'EXECUTE') AS service_can_close_mini;
    `);

    const p = privs.rows[0];

    // Anonymous role must have NO execute privileges on bidding or lifecycle RPCs
    expect(p.anon_can_bid).toBe(false);
    expect(p.anon_can_finalize_2).toBe(false);
    expect(p.anon_can_finalize_3).toBe(false);
    expect(p.anon_can_start_2).toBe(false);
    expect(p.anon_can_start_3).toBe(false);
    expect(p.anon_can_close_mini).toBe(false);

    // Authenticated role may place bids, but MUST NOT execute worker lifecycle RPCs
    expect(p.auth_can_bid).toBe(true);
    expect(p.auth_can_finalize_2).toBe(false);
    expect(p.auth_can_finalize_3).toBe(false);
    expect(p.auth_can_start_2).toBe(false);
    expect(p.auth_can_start_3).toBe(false);
    expect(p.auth_can_close_mini).toBe(false);

    // Service role must retain full execute privileges on all bidding and lifecycle RPCs
    expect(p.service_can_bid).toBe(true);
    expect(p.service_can_finalize_2).toBe(true);
    expect(p.service_can_finalize_3).toBe(true);
    expect(p.service_can_start_2).toBe(true);
    expect(p.service_can_start_3).toBe(true);
    expect(p.service_can_close_mini).toBe(true);
  }, 30000);

  it('2. Executes all 10 security, concurrency, and bot reliability scenarios against real PostgreSQL 17', async () => {
    const roomId = randomUUID();
    const auctionId = randomUUID();
    const humanUserId1 = randomUUID();
    const humanUserId2 = randomUUID();
    const humanTeamId1 = randomUUID();
    const humanTeamId2 = randomUUID();
    const botTeamId = randomUUID();
    const playerId1 = randomUUID();
    const playerId2 = randomUUID();
    const lotId1 = randomUUID();
    const lotId2 = randomUUID();
    const playerSetId = '00000000-0000-0000-0000-000000000202';

    // Insert profiles
    await client.query(`
      INSERT INTO public.profiles (id, username, display_name)
      VALUES 
        ($1, 'human_user_1', 'Human User One'),
        ($2, 'human_user_2', 'Human User Two');
    `, [humanUserId1, humanUserId2]);

    // Insert room
    await client.query(`
      INSERT INTO public.rooms (id, name, code, host_id, settings, status)
      VALUES ($1, 'Test Room', 'TEST01', $2, '{"max_squad_size": 25, "max_overseas": 8, "timer_duration_seconds": 15}'::jsonb, 'OPEN');
    `, [roomId, humanUserId1]);

    // Insert auction with NULL current_lot_id first
    await client.query(`
      INSERT INTO public.auctions (id, room_id, player_set_id, status, current_lot_id, current_lot_index)
      VALUES ($1, $2, $3, 'IN_PROGRESS', NULL, 1);
    `, [auctionId, roomId, playerSetId]);

    // Insert teams
    await client.query(`
      INSERT INTO public.teams (id, auction_id, name, short_name, purse, initial_purse, is_bot, players_bought, overseas_count)
      VALUES 
        ($1, $4, 'Human Team 1', 'HT1', 10000, 10000, false, 0, 0),
        ($2, $4, 'Human Team 2', 'HT2', 10000, 10000, false, 0, 0),
        ($3, $4, 'Bot Team 1', 'BT1', 10000, 10000, true, 0, 0);
    `, [humanTeamId1, humanTeamId2, botTeamId, auctionId]);

    // Insert room_participants (membership)
    await client.query(`
      INSERT INTO public.room_participants (room_id, user_id, team_id, role, is_bot)
      VALUES 
        ($1, $2, $4, 'HOST', false),
        ($1, $3, $5, 'MEMBER', false),
        ($1, NULL, $6, 'MEMBER', true);
    `, [roomId, humanUserId1, humanUserId2, humanTeamId1, humanTeamId2, botTeamId]);

    // Insert players
    await client.query(`
      INSERT INTO public.players (id, player_set_id, name, role, base_price, is_overseas)
      VALUES 
        ($1, $3, 'Player Alpha', 'BATSMAN', 200, false),
        ($2, $3, 'Player Beta', 'BOWLER', 200, false);
    `, [playerId1, playerId2, playerSetId]);

    // Insert lots (lot 1 is BIDDING, lot 2 is PENDING)
    await client.query(`
      INSERT INTO public.auction_lots (id, auction_id, lot_index, player_id, base_price, current_bid, status, timer_duration_seconds, timer_expires_at)
      VALUES ($1, $2, 1, $3, 200, 200, 'BIDDING', 15, clock_timestamp() + INTERVAL '15 seconds');
    `, [lotId1, auctionId, playerId1]);

    await client.query(`
      INSERT INTO public.auction_lots (id, auction_id, lot_index, player_id, base_price, current_bid, status, timer_duration_seconds)
      VALUES ($1, $2, 2, $3, 200, 200, 'PENDING', 15);
    `, [lotId2, auctionId, playerId2]);

    // Link current_lot_id on auction
    await client.query(`
      UPDATE public.auctions SET current_lot_id = $1 WHERE id = $2;
    `, [lotId1, auctionId]);

    // --- Scenario 1: A valid authenticated human bid succeeds ---
    await client.query(`SET LOCAL role = 'authenticated';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: humanUserId1, role: 'authenticated' })}';`);

    const reqId1 = randomUUID();
    const bidRes1 = await client.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, false) AS res;
    `, [auctionId, lotId1, humanTeamId1, reqId1]);

    expect(bidRes1.rows[0].res.success).toBe(true);
    expect(bidRes1.rows[0].res.current_bid).toBe(200);
    expect(bidRes1.rows[0].res.highest_bidder_team_id).toBe(humanTeamId1);

    // --- Scenario 2: A user cannot bid for another team's team ID ---
    const reqId2 = randomUUID();
    const bidRes2 = await client.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, false) AS res;
    `, [auctionId, lotId1, humanTeamId2, reqId2]);

    expect(bidRes2.rows[0].res.success).toBe(false);
    expect(bidRes2.rows[0].res.error).toBe('ERR_TEAM_MEMBERSHIP_REQUIRED');

    // --- Scenario 3: A client cannot forge a bot bid ---
    const reqId3 = randomUUID();
    const bidRes3 = await client.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, true) AS res;
    `, [auctionId, lotId1, humanTeamId1, reqId3]);

    expect(bidRes3.rows[0].res.success).toBe(false);
    expect(bidRes3.rows[0].res.error).toBe('ERR_BOT_BID_FORBIDDEN');

    // --- Scenario 3b: NULL claims does NOT bypass authorization (Three-valued logic check) ---
    await client.query(`SET LOCAL "request.jwt.claims" = '';`);
    await client.query(`SET LOCAL "request.jwt.claim.role" = '';`);
    const reqIdNullClaims = randomUUID();
    const bidResNullClaims = await client.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, true) AS res;
    `, [auctionId, lotId1, humanTeamId1, reqIdNullClaims]);

    expect(bidResNullClaims.rows[0].res.success).toBe(false);
    expect(bidResNullClaims.rows[0].res.error).toBe('ERR_BOT_BID_FORBIDDEN');

    // --- Scenario 3c: Forged request.jwt.claim.role is rejected ---
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: humanUserId1, role: 'authenticated' })}';`);
    await client.query(`SET LOCAL "request.jwt.claim.role" = 'service_role';`); // Attacker attempt to forge GUC
    const reqIdForged = randomUUID();
    const bidResForged = await client.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, true) AS res;
    `, [auctionId, lotId1, humanTeamId1, reqIdForged]);

    expect(bidResForged.rows[0].res.success).toBe(false);
    expect(bidResForged.rows[0].res.error).toBe('ERR_BOT_BID_FORBIDDEN');

    // --- Scenario 3d: Forged claims JSON (attacker injects service_role claim while session role is authenticated) ---
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: humanUserId1, role: 'service_role' })}';`);
    await client.query(`SET LOCAL "request.jwt.claim.role" = 'service_role';`);
    const reqIdForgedJson = randomUUID();
    const bidResForgedJson = await client.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, true) AS res;
    `, [auctionId, lotId1, humanTeamId1, reqIdForgedJson]);

    expect(bidResForgedJson.rows[0].res.success).toBe(false);
    expect(bidResForgedJson.rows[0].res.error).toBe('ERR_BOT_BID_FORBIDDEN');

    // Reset forged claims back to standard authenticated
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: humanUserId1, role: 'authenticated' })}';`);
    await client.query(`SET LOCAL "request.jwt.claim.role" = 'authenticated';`);

    // --- Scenario 4: Anonymous bidding is rejected ---
    await client.query(`SET LOCAL role = 'anon';`);
    await client.query(`SAVEPOINT test_anon_sp;`);
    let threwAnonAclError = false;
    try {
      await client.query(`
        SELECT public.v3_place_bid($1, $2, $3, $4, false) AS res;
      `, [auctionId, lotId1, humanTeamId1, randomUUID()]);
    } catch (err: any) {
      threwAnonAclError = true;
      expect(err.message).toContain('permission denied for function v3_place_bid');
      await client.query(`ROLLBACK TO SAVEPOINT test_anon_sp;`);
    }
    expect(threwAnonAclError).toBe(true);

    // Also verify human caller cannot bid on bot team directly
    await client.query(`SET LOCAL role = 'authenticated';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: humanUserId1, role: 'authenticated' })}';`);
    const reqId4 = randomUUID();
    const bidRes4 = await client.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, false) AS res;
    `, [auctionId, lotId1, botTeamId, reqId4]);

    expect(bidRes4.rows[0].res.success).toBe(false);
    expect(bidRes4.rows[0].res.error).toBe('ERR_BOT_BID_FORBIDDEN');

    // --- Scenario 5: A legitimate service-role bot bid succeeds ---
    await client.query(`SET LOCAL role = 'service_role';`);
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ role: 'service_role' })}';`);

    const reqIdBot = randomUUID();
    const botBidRes = await client.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, true) AS res;
    `, [auctionId, lotId1, botTeamId, reqIdBot]);

    expect(botBidRes.rows[0].res.success).toBe(true);
    expect(botBidRes.rows[0].res.amount).toBe(225); // 200 + 25L step
    expect(botBidRes.rows[0].res.highest_bidder_team_id).toBe(botTeamId);

    // --- Scenario 6: Duplicate requests do not create duplicate bids (Idempotency) ---
    const dupRes = await client.query(`
      SELECT public.v3_place_bid($1, $2, $3, $4, true) AS res;
    `, [auctionId, lotId1, botTeamId, reqIdBot]); // Same request ID

    expect(dupRes.rows[0].res.success).toBe(true);
    expect(dupRes.rows[0].res.is_duplicate).toBe(true);

    const bidCountRes = await client.query(`SELECT COUNT(*) FROM public.bids WHERE auction_id = $1;`, [auctionId]);
    expect(parseInt(bidCountRes.rows[0].count, 10)).toBe(2);

    // --- Scenario 7: Unauthorized early finalization is rejected ---
    await client.query(`SET LOCAL role = 'authenticated';`);
    await client.query(`SAVEPOINT test7_sp;`);
    let threwAclError = false;
    try {
      await client.query(`SELECT public.v3_finalize_and_advance_lot($1, $2, true);`, [auctionId, lotId1]);
    } catch (err: any) {
      threwAclError = true;
      expect(err.message).toContain('permission denied for function v3_finalize_and_advance_lot');
      await client.query(`ROLLBACK TO SAVEPOINT test7_sp;`);
    }
    expect(threwAclError).toBe(true);

    // --- Scenario 8: Service role unexpired finalization without force rejected ---
    await client.query(`SET LOCAL role = 'service_role';`);
    const earlyFinRes = await client.query(`
      SELECT public.v3_finalize_and_advance_lot($1, $2, false) AS res;
    `, [auctionId, lotId1]);

    expect(earlyFinRes.rows[0].res.success).toBe(false);
    expect(earlyFinRes.rows[0].res.error).toBe('ERR_TIMER_NOT_EXPIRED');

    // --- Scenario 8b: Service role 2-argument finalization call resolves unambiguously ---
    const earlyFin2ArgRes = await client.query(`
      SELECT public.v3_finalize_and_advance_lot($1::uuid, $2::uuid) AS res;
    `, [auctionId, lotId1]);
    expect(earlyFin2ArgRes.rows[0].res.success).toBe(false);
    expect(earlyFin2ArgRes.rows[0].res.error).toBe('ERR_TIMER_NOT_EXPIRED');

    // --- Scenario 9: Authoritative lot finalization & balance update ---
    const forceFinRes = await client.query(`
      SELECT public.v3_finalize_and_advance_lot($1, $2, true) AS res;
    `, [auctionId, lotId1]);

    expect(forceFinRes.rows[0].res.success).toBe(true);
    expect(forceFinRes.rows[0].res.status).toBe('SOLD');
    expect(forceFinRes.rows[0].res.next_lot_id).toBe(lotId2);
    expect(forceFinRes.rows[0].res.auction_status).toBe('IN_PROGRESS');

    const botTeamCheck = await client.query(`SELECT purse, players_bought FROM public.teams WHERE id = $1;`, [botTeamId]);
    expect(botTeamCheck.rows[0].purse).toBe(9775); // 10000 - 225
    expect(botTeamCheck.rows[0].players_bought).toBe(1);

    // --- Scenario 10: Service role starts bidding on next lot ---
    const startRes = await client.query(`
      SELECT public.v3_start_bidding($1, $2, true) AS res;
    `, [auctionId, lotId2]);

    expect(startRes.rows[0].res.success).toBe(true);
    expect(startRes.rows[0].res.status).toBe('BIDDING');

    // --- Scenario 10b: Service role 2-argument start_bidding call resolves unambiguously ---
    // Calling 2-arg on already bidding lot returns duplicate status
    const start2ArgRes = await client.query(`
      SELECT public.v3_start_bidding($1::uuid, $2::uuid) AS res;
    `, [auctionId, lotId2]);
    expect(start2ArgRes.rows[0].res.success).toBe(true);
    expect(start2ArgRes.rows[0].res.status).toBe('BIDDING');
  }, 30000);

  it('3. Confirms that transaction rollback completely restored database to baseline', async () => {
    // Explicitly roll back the transaction
    if (transactionActive) {
      await client.query('ROLLBACK;');
      transactionActive = false;
    }

    // Verify all tables match their exact initial baseline row counts and SHA-256 row fingerprints
    const postTableFingerprints = await computeTableFingerprints(client);
    const postSchemaFingerprints = await computeSchemaFingerprints(client);

    for (const table of Object.keys(initialTableFingerprints)) {
      expect(postTableFingerprints[table]!.count).toBe(initialTableFingerprints[table]!.count);
      expect(postTableFingerprints[table]!.hash).toBe(initialTableFingerprints[table]!.hash);
    }

    // Verify all function definitions and privileges match initial baseline
    expect(postSchemaFingerprints.functionsHash).toBe(initialSchemaFingerprints.functionsHash);
    expect(postSchemaFingerprints.privilegesHash).toBe(initialSchemaFingerprints.privilegesHash);
  });
});
