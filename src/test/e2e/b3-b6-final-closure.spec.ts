import { test, expect } from '@playwright/test';
import { createDisposableTestUser } from './setup/auction-fixture';
import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env.local') });

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

async function runScenario(
  supabase: any,
  userId: string,
  scenarioName: string,
  botConfig: { id: string, name: string, purse: number, rosterSize: number, rosterRole: string, overseasCount: number }[],
  currentLot: { role: string, category: string, basePrice: number, isOverseas: boolean, startBid: number },
  futurePool: { role: string, category: string, basePrice: number, isOverseas: boolean, count: number }[]
) {
  console.log(`[SCENARIO START] ${scenarioName}`);
  const roomCode = crypto.randomBytes(3).toString('hex').toUpperCase();
  
  const playerSetId = crypto.randomUUID();
  await serviceSupabase.from('player_sets').insert({
    id: playerSetId, name: `Test Set ${scenarioName}`, created_by: userId, is_public: false
  });
  
  let players: any[] = [];
  const lotPlayerId = crypto.randomUUID();
  players.push({
    id: lotPlayerId, player_set_id: playerSetId, name: 'Current Lot Player',
    role: currentLot.role, category: currentLot.category, base_price: Math.max(currentLot.basePrice, currentLot.startBid || 100),
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
  
  await serviceSupabase.from('players').insert(players);
  
  const { data: createData, error: createError } = await supabase.rpc('create_room_with_team', {
    p_room_code: roomCode, p_room_name: scenarioName,
    p_room_settings: { max_squad_size: 25, max_overseas: 8 },
    p_player_set_id: playerSetId, p_team_name: 'Host', p_team_short_name: 'HST',
    p_team_color: '#000000', p_default_purse: 10000
  });
  if (createError) throw new Error(createError.message);
  
  const { room_id, auction_id } = createData;
  await serviceSupabase.from('teams').delete().eq('auction_id', auction_id).eq('is_bot', true);

  for (const b of botConfig) {
    await serviceSupabase.from('teams').insert({
      id: b.id, auction_id, name: b.name, short_name: b.name.substring(0,3).toUpperCase(),
      purse: b.purse, initial_purse: b.purse, is_bot: true
    });
    console.log(`[BOT_MAP] ${scenarioName} -> ${b.name} -> ${b.id}`);
    
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
  
  await serviceSupabase.from('auction_lots')
    .update({ lot_index: 0 })
    .eq('auction_id', auction_id).eq('player_id', lotPlayerId);

  await supabase.rpc('v3_start_auction', { p_room_id: room_id });
  
  await pollUntil(
    () => serviceSupabase.from('auction_lots').select('status, current_bid').eq('auction_id', auction_id).eq('player_id', lotPlayerId).single(),
    (r: any) => r.data && r.data.status === 'BIDDING',
    15000
  );

  await new Promise(r => setTimeout(r, 6000));
  console.log(`[SCENARIO END] ${scenarioName}`);
  return async () => {};
}

test.describe('B3 & B6 Final Runtime Proofs', () => {
  let supabase: any;
  let userId: string;
  const cleanups: any[] = [];

  test.beforeAll(async () => {
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    if (!setup.user) {
      throw new Error('Disposable test user was not created');
    }
    userId = setup.user.id;
  });

  test.afterAll(async () => {
    for (const c of cleanups) await c();
  });

  test('Execute Controlled B3 and B6 Scenarios', async () => {
    test.setTimeout(120000);

    const b3Early = await runScenario(supabase, userId, 'B3_EARLY_BUILD',
      [{ id: 'b4feef58-0ace-40fa-997d-87b121cc06b4', name: 'B3_Early', purse: 10000, rosterSize: 0, rosterRole: 'BOWLER', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false, startBid: 1300 },
      [] 
    );
    cleanups.push(b3Early);

    const b3Late = await runScenario(supabase, userId, 'B3_LATE_PACING',
      [{ id: '3e64d92a-b7e1-46d2-9171-a7ad081a28ec', name: 'B3_Late', purse: 2500, rosterSize: 15, rosterRole: 'BOWLER', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false, startBid: 1300 },
      []
    );
    cleanups.push(b3Late);

    const b6Attractive = await runScenario(supabase, userId, 'B6_ATTRACTIVE',
      [{ id: '60c1840e-54cd-4b53-bc2d-d55ad57396a8', name: 'B6_Attractive', purse: 8000, rosterSize: 24, rosterRole: 'BOWLER', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false, startBid: 100 },
      [{ role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false, count: 5 }]
    );
    cleanups.push(b6Attractive);

    const b6Poor = await runScenario(supabase, userId, 'B6_POOR',
      [{ id: '11e4f4fb-e145-4dfc-ac3e-108a7863f649', name: 'B6_Poor', purse: 8000, rosterSize: 24, rosterRole: 'BOWLER', overseasCount: 0 }],
      { role: 'BATSMAN', category: 'A', basePrice: 100, isOverseas: false, startBid: 100 },
      [] 
    );
    cleanups.push(b6Poor);

    await new Promise(r => setTimeout(r, 5000));
  });
});
