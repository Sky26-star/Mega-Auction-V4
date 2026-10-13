import { test, expect } from '@playwright/test';
import { createDisposableTestUser, cleanupDisposableAuction, cleanupBoundedTestPlayerSet } from './setup/auction-fixture';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const serviceSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function pollUntil(queryFn: any, conditionFn: any, timeoutMs = 15000, pollIntervalMs = 1000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(async () => {
      try {
        const result = await queryFn();
        if (conditionFn(result)) {
          clearInterval(interval);
          resolve(result);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          reject(new Error('pollUntil timeout'));
        }
      } catch (e) { }
    }, pollIntervalMs);
  });
}

// Remove fixed Bot IDs since they cause unique key constraint violations across multiple auctions
// const BOT_ID_A = 'd0000000-0000-0000-0000-00000000000a';
// const BOT_ID_B = 'd0000000-0000-0000-0000-00000000000b';

async function runScenario(
  supabase: any,
  userId: string,
  scenarioName: string,
  botConfig: { id: string, name: string, purse: number, rosterSize: number, rosterRole: string, overseasCount: number }[],
  currentLot: { role: string, category: string, basePrice: number, isOverseas: boolean },
  futurePool: { role: string, category: string, basePrice: number, isOverseas: boolean, count: number }[]
) {
  console.log(`[SCENARIO START] ${scenarioName}`);
  const roomCode = crypto.randomBytes(3).toString('hex').toUpperCase();
  
  // 1. Create player set
  const playerSetId = crypto.randomUUID();
  const { error: pSetErr } = await serviceSupabase.from('player_sets').insert({
    id: playerSetId, name: `Test Set ${scenarioName}`, created_by: userId, is_public: false
  });
  if (pSetErr) throw new Error("PSET: " + pSetErr.message);
  
  // 2. Create players
  let players: any[] = [];
  const lotPlayerId = crypto.randomUUID();
  players.push({
    id: lotPlayerId, player_set_id: playerSetId, name: 'Current Lot Player',
    role: currentLot.role, category: currentLot.category, base_price: currentLot.basePrice,
    is_overseas: currentLot.isOverseas, country: currentLot.isOverseas ? 'England' : 'India'
  });
  
  for (const group of futurePool) {
    for (let i = 0; i < group.count; i++) {
      players.push({
        id: crypto.randomUUID(), player_set_id: playerSetId, name: `Future ${group.role} ${i}`,
        role: group.role, category: group.category, base_price: group.basePrice,
        is_overseas: group.isOverseas, country: group.isOverseas ? 'England' : 'India'
      });
    }
  }
  
  const { error: pErr } = await serviceSupabase.from('players').insert(players);
  if (pErr) throw new Error("PLAYER: " + pErr.message);
  
  // 3. Create room and auction
  const { data: createData, error: createError } = await supabase.rpc('create_room_with_team', {
    p_room_code: roomCode, p_room_name: scenarioName,
    p_room_settings: { max_squad_size: 25, max_overseas: 8 },
    p_player_set_id: playerSetId, p_team_name: 'Host', p_team_short_name: 'HST',
    p_team_color: '#000000', p_default_purse: 10000
  });
  if (createError) throw new Error(createError.message);
  
  const { room_id, auction_id } = createData;
  
  // Delete default bots if any (create_room_with_team might not create bots, but just in case)
  await serviceSupabase.from('teams').delete().eq('auction_id', auction_id).eq('is_bot', true);
  
  // 4. Inject specific bots
  for (const b of botConfig) {
    await serviceSupabase.from('teams').insert({
      id: b.id, auction_id, name: b.name, short_name: b.name.substring(0,3).toUpperCase(),
      purse: b.purse, initial_purse: 10000, is_bot: true
    });
    console.log(`[BOT_MAP] ${scenarioName} -> ${b.name} -> ${b.id}`);
    
    // Inject roster (already SOLD lots)
    for (let i = 0; i < b.rosterSize; i++) {
      const pid = crypto.randomUUID();
      const isOS = i < b.overseasCount;
      await serviceSupabase.from('players').insert({
        id: pid, player_set_id: playerSetId, name: `Roster ${b.name} ${i}`,
        role: b.rosterRole, category: 'C', base_price: 100, is_overseas: isOS, country: isOS ? 'England' : 'India'
      });
      await serviceSupabase.from('auction_lots').insert({
        id: crypto.randomUUID(), auction_id, player_id: pid,
        status: 'SOLD', winning_team_id: b.id, winning_bid: 100, base_price: 100, lot_index: -100 - i
      });
    }
  }
  
  // Ensure current player is lot index 0 so it comes first
  const { error: updErr } = await serviceSupabase.from('auction_lots')
    .update({ lot_index: 0 })
    .eq('auction_id', auction_id).eq('player_id', lotPlayerId);
    
  if (updErr) throw new Error(updErr.message);

  // 5. Start Auction
  await supabase.rpc('v3_start_auction', { p_room_id: room_id });
  
  // Wait for lot to enter BIDDING phase
  await pollUntil(
    () => serviceSupabase.from('auction_lots').select('status').eq('auction_id', auction_id).eq('player_id', lotPlayerId).single(),
    (r: any) => r.data && r.data.status === 'BIDDING',
    15000
  );
  
  // Wait a few seconds for bot evaluation logs
  await new Promise(r => setTimeout(r, 6000));
  console.log(`[SCENARIO END] ${scenarioName}`);
  
  return { roomId: room_id, playerSetId };
}

test.describe('Behaviors 2-7 Batch Target', () => {
  let supabase: any;
  let userId: string;
  let cleanups: {roomId: string, playerSetId: string}[] = [];

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    if (!setup.user) {
      throw new Error('Disposable test user was not created');
    }
    userId = setup.user.id;
  });

  test.afterAll(async () => {
    for (const c of cleanups) {
      await cleanupDisposableAuction(supabase, c.roomId).catch(() => {});
      await cleanupBoundedTestPlayerSet(supabase, c.playerSetId).catch(() => {});
    }
  });

  test('Execute all 6 behavioral scenarios', async () => {
    test.setTimeout(300000); // 5 minutes
    
    // B2: Scarcity (Abundant vs Scarce)
    const b2a = await runScenario(supabase, userId, 'B2_SCARCITY_ABUNDANT',
      [{ id: crypto.randomUUID(), name: 'B2_Abundant', purse: 8000, rosterSize: 0, rosterRole: 'BATSMAN', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false },
      [{ role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false, count: 10 }]
    );
    cleanups.push(b2a);
    
    const b2b = await runScenario(supabase, userId, 'B2_SCARCITY_SCARCE',
      [{ id: crypto.randomUUID(), name: 'B2_Scarce', purse: 8000, rosterSize: 0, rosterRole: 'BATSMAN', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false },
      [{ role: 'BOWLER', category: 'A', basePrice: 100, isOverseas: false, count: 10 }]
    );
    cleanups.push(b2b);

    // B3: Purse-Pacing (Early vs Late)
    const b3a = await runScenario(supabase, userId, 'B3_PACING_EARLY',
      [{ id: crypto.randomUUID(), name: 'B3_Early', purse: 4000, rosterSize: 0, rosterRole: 'BATSMAN', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false },
      [{ role: 'BATSMAN', category: 'C', basePrice: 100, isOverseas: false, count: 100 }]
    );
    cleanups.push(b3a);
    
    const b3b = await runScenario(supabase, userId, 'B3_PACING_LATE',
      [{ id: crypto.randomUUID(), name: 'B3_Late', purse: 4000, rosterSize: 0, rosterRole: 'BATSMAN', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false },
      [{ role: 'BATSMAN', category: 'C', basePrice: 100, isOverseas: false, count: 2 }]
    );
    cleanups.push(b3b);

    // B4: Late Emergency
    const b4a = await runScenario(supabase, userId, 'B4_EMERGENCY_NORMAL',
      [{ id: crypto.randomUUID(), name: 'B4_Normal', purse: 5000, rosterSize: 24, rosterRole: 'BOWLER', overseasCount: 0 }], // Missing 1 slot, presumably wants Batsman
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false },
      [{ role: 'BATSMAN', category: 'B', basePrice: 100, isOverseas: false, count: 10 }]
    );
    cleanups.push(b4a);
    
    const b4b = await runScenario(supabase, userId, 'B4_EMERGENCY_CRITICAL',
      [{ id: crypto.randomUUID(), name: 'B4_Emergency', purse: 5000, rosterSize: 24, rosterRole: 'BOWLER', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false },
      [{ role: 'BOWLER', category: 'B', basePrice: 100, isOverseas: false, count: 10 }] // No future batsmen!
    );
    cleanups.push(b4b);

    // B5: Endgame Surplus (Both in same auction)
    const b5 = await runScenario(supabase, userId, 'B5_ENDGAME_SURPLUS',
      [
        { id: crypto.randomUUID(), name: 'B5_Constrained', purse: 2000, rosterSize: 20, rosterRole: 'BATSMAN', overseasCount: 0 },
        { id: crypto.randomUUID(), name: 'B5_Surplus', purse: 9000, rosterSize: 20, rosterRole: 'BATSMAN', overseasCount: 0 }
      ],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false },
      [{ role: 'BATSMAN', category: 'C', basePrice: 100, isOverseas: false, count: 5 }]
    );
    cleanups.push(b5);

    // B6: Opportunity Cost
    const b6a = await runScenario(supabase, userId, 'B6_OPPORTUNITY_ATTRACTIVE',
      [{ id: crypto.randomUUID(), name: 'B6_Attractive', purse: 8000, rosterSize: 0, rosterRole: 'BATSMAN', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false },
      [{ role: 'BATSMAN', category: 'A', basePrice: 20, isOverseas: false, count: 5 }] // Elite but base price 20
    );
    cleanups.push(b6a);
    
    const b6b = await runScenario(supabase, userId, 'B6_OPPORTUNITY_POOR',
      [{ id: crypto.randomUUID(), name: 'B6_Poor', purse: 8000, rosterSize: 0, rosterRole: 'BATSMAN', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false },
      [{ role: 'BATSMAN', category: 'C', basePrice: 200, isOverseas: false, count: 5 }] // Weak and expensive
    );
    cleanups.push(b6b);

    // B7: Overseas Hard Clamp
    const b7 = await runScenario(supabase, userId, 'B7_OVERSEAS_CLAMP',
      [{ id: crypto.randomUUID(), name: 'B7_Overseas', purse: 8000, rosterSize: 8, rosterRole: 'BATSMAN', overseasCount: 8 }], // MAX overseas
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: true },
      [{ role: 'BATSMAN', category: 'C', basePrice: 100, isOverseas: false, count: 5 }]
    );
    cleanups.push(b7);
  });
});
