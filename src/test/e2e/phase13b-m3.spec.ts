import './setup/e2e-target-guard';
import { test, expect } from '@playwright/test';
import {
  createDisposableTestUser,
  createPhase13BTestPlayerSet,
  setupDisposableAuction,
  cleanupBoundedTestPlayerSet,
  cleanupDisposableAuction,
} from './setup/auction-fixture';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

test.describe('Phase 13B — M3 REAL PLAYWRIGHT MULTI-CONTEXT INTEGRATION', () => {
  test.setTimeout(180000); // 3 minutes

  let hostUser: any;
  let spectatorUser: any;
  let roomId: string;
  let auctionId: string;
  let playerSetId: string;
  let supabaseAdmin: any;

  test.beforeAll(async () => {
    // 1. Create Host User
    hostUser = await createDisposableTestUser();
    
    // 2. Create Spectator User
    spectatorUser = await createDisposableTestUser();

    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const runId = crypto.randomUUID().substring(0, 8);
    
    // 3. Setup Auction as Host
    const { playerSetId: psId } = await createPhase13BTestPlayerSet(hostUser.supabase, runId);
    playerSetId = psId;

    const auction = await setupDisposableAuction(hostUser.supabase, runId, {
      playerSetId,
      roomSettings: { default_purse: 17, max_squad_size: 15, max_overseas: 8 },
    });
    roomId = auction.roomId;
    auctionId = auction.auctionId;
    
    // 4. Add spectator to room participants so they can access the room
    const { error: partErr } = await supabaseAdmin.from('room_participants').insert({
      room_id: roomId,
      user_id: spectatorUser.user.id,
      role: 'SPECTATOR'
    });
    if (partErr) throw new Error(`Failed to add spectator: ${partErr.message}`);

    // 5. Make the player set public so the spectator can see player names
    await supabaseAdmin.from('player_sets').update({ is_public: true }).eq('id', playerSetId);
  });

  test.afterAll(async () => {
    if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    if (playerSetId) await cleanupBoundedTestPlayerSet(supabaseAdmin, playerSetId);
  });

  test('M3: Both contexts observe realtime state changes and auto-navigate', async ({ browser }) => {
    // 1. Create two independent browser contexts
    const hostContext = await browser.newContext();
    const spectatorContext = await browser.newContext();
    
    const hostPage = await hostContext.newPage();
    const spectatorPage = await spectatorContext.newPage();

    // 2. Authenticate Host via UI
    await hostPage.goto('/login');
    await hostPage.fill('input[id="login-email"]', hostUser.user.email);
    await hostPage.fill('input[id="login-password"]', 'Pass_' + hostUser.runId + '!');
    await hostPage.click('button[type="submit"]');
    await hostPage.waitForURL('**/dashboard*', { timeout: 15000 });

    // 3. Authenticate Spectator via UI
    await spectatorPage.goto('/login');
    await spectatorPage.fill('input[id="login-email"]', spectatorUser.user.email);
    await spectatorPage.fill('input[id="login-password"]', 'Pass_' + spectatorUser.runId + '!');
    await spectatorPage.click('button[type="submit"]');
    await spectatorPage.waitForURL('**/dashboard*', { timeout: 15000 });

    // 4. Navigate both to the Auction Room Lobby
    const lobbyUrl = `/rooms/${roomId}`;
    await hostPage.goto(lobbyUrl);
    await spectatorPage.goto(lobbyUrl);

    // Verify both loaded the lobby page successfully
    await expect(hostPage.locator('text=AUCTION LOBBY').first()).toBeVisible({ timeout: 15000 });
    await expect(spectatorPage.locator('text=AUCTION LOBBY').first()).toBeVisible({ timeout: 15000 });

    // 5. Trigger a Genuine State Change via API
    // We will start the auction. This changes the state from LOBBY to IN_PROGRESS.
    const { error: startErr } = await hostUser.supabase.rpc('v3_start_auction', { p_room_id: roomId });
    expect(startErr).toBeNull();

    // 6. Observe the State Change in Both Contexts
    // The realtime subscription should detect the IN_PROGRESS state and auto-navigate both to /auction
    await hostPage.waitForURL(`**/rooms/${roomId}/auction`, { timeout: 25000 });
    await spectatorPage.waitForURL(`**/rooms/${roomId}/auction`, { timeout: 25000 });

    // The player's name should appear in the auction view.
    await expect(hostPage.locator('text=P13B Alpha').first()).toBeVisible({ timeout: 15000 });
    await expect(spectatorPage.locator('text=P13B Alpha').first()).toBeVisible({ timeout: 15000 });

    // Verify consistency: Check that both pages reflect the same base price (200)
    await expect(hostPage.locator('text=200').first()).toBeVisible();
    await expect(spectatorPage.locator('text=200').first()).toBeVisible();

    // Clean up contexts
    await hostContext.close();
    await spectatorContext.close();
  });
});
