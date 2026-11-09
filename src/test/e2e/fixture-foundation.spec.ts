import './setup/e2e-target-guard';
import { test, expect } from '@playwright/test';
import { createDisposableTestUser, setupDisposableAuction, cleanupDisposableAuction } from './setup/auction-fixture';
import type { SupabaseClient } from '@supabase/supabase-js';

test.describe('Phase 13A - Fixture Foundation', () => {
  let supabase: SupabaseClient;
  let user: any;
  let runId: string;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let roomCode: string;

  test.beforeAll(async () => {
    // 1. Create unique disposable test user
    const setup = await createDisposableTestUser();
    supabase = setup.supabase;
    user = setup.user;
    runId = setup.runId;
    
    expect(user).toBeDefined();
    expect(user.email).toContain('test_fixture_');
  });

  test.afterAll(async () => {
    // 3. Cleanup the disposable test auction
    if (roomId && supabase) {
      await cleanupDisposableAuction(supabase, roomId);
      
      // Verify cleanup: Room should no longer exist
      const { data, error } = await supabase
        .from('rooms')
        .select('id')
        .eq('id', roomId)
        .maybeSingle();
      
      expect(error).toBeNull();
      expect(data).toBeNull(); // Should be fully deleted
    }
  });

  test('should safely CREATE, VERIFY, and CLEANUP one disposable test auction', async () => {
    // 2. CREATE
    const auctionSetup = await setupDisposableAuction(supabase, runId);
    roomId = auctionSetup.roomId;
    auctionId = auctionSetup.auctionId;
    hostTeamId = auctionSetup.hostTeamId;
    roomCode = auctionSetup.roomCode;

    expect(roomId).toBeDefined();
    expect(auctionId).toBeDefined();
    expect(hostTeamId).toBeDefined();
    expect(roomCode).toBeDefined();

    // 2a. VERIFY: Check room exists
    const { data: roomData, error: roomError } = await supabase
      .from('rooms')
      .select('code, status')
      .eq('id', roomId)
      .single();
    
    expect(roomError).toBeNull();
    expect(roomData?.code).toBe(roomCode);
    expect(roomData?.status).toBe('OPEN');

    // 2b. VERIFY: Check auction exists
    const { data: auctionData, error: auctionError } = await supabase
      .from('auctions')
      .select('status, player_set_id')
      .eq('id', auctionId)
      .single();
    
    expect(auctionError).toBeNull();
    expect(auctionData?.status).toBe('LOBBY'); // Initial status is LOBBY
    expect(auctionData?.player_set_id).toBe('00000000-0000-0000-0000-000000000202');

    // 2c. VERIFY: Check teams exist (Host + 3 Bots = 4 Teams)
    const { data: teamsData, error: teamsError } = await supabase
      .from('teams')
      .select('id, is_bot, name')
      .eq('auction_id', auctionId);
    
    expect(teamsError).toBeNull();
    expect(teamsData).toHaveLength(4);
    
    const botTeams = teamsData!.filter(t => t.is_bot);
    const hostTeam = teamsData!.find(t => !t.is_bot);
    
    expect(botTeams).toHaveLength(3);
    expect(hostTeam).toBeDefined();
    expect(hostTeam?.id).toBe(hostTeamId);

    // Note: Do NOT transition to IN_PROGRESS. We stop here.
  });
});
