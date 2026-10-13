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

test.describe('Phase 13B — M4 HOST + SPECTATOR MULTI-CONTEXT VALIDATION', () => {
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
    
    // 4. Add spectator to room participants
    const { error: partErr } = await supabaseAdmin.from('room_participants').insert({
      room_id: roomId,
      user_id: spectatorUser.user.id,
      role: 'SPECTATOR'
    });
    if (partErr) throw new Error(`Failed to add spectator: ${partErr.message}`);

    // 5. Make the player set public so the spectator can see players
    await supabaseAdmin.from('player_sets').update({ is_public: true }).eq('id', playerSetId);
  });

  test.afterAll(async () => {
    if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    if (playerSetId) await cleanupBoundedTestPlayerSet(supabaseAdmin, playerSetId);
  });

  test('M4: Enforces Host vs Spectator boundary via UI and backend authorization', async ({ browser }) => {
    // 1. Create independent browser contexts
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

    // 5. Trigger Auction Start (using Host API for brevity/reliability, as proven in M3)
    const { error: startErr } = await hostUser.supabase.rpc('v3_start_auction', { p_room_id: roomId });
    expect(startErr).toBeNull();

    // Both should transition to the live auction room automatically
    await hostPage.waitForURL(`**/rooms/${roomId}/auction`, { timeout: 25000 });
    await spectatorPage.waitForURL(`**/rooms/${roomId}/auction`, { timeout: 25000 });

    // Wait for the UI to fully load the live auction state (e.g. player name visible)
    await expect(hostPage.locator('text=P13B Alpha').first()).toBeVisible({ timeout: 15000 });
    await expect(spectatorPage.locator('text=P13B Alpha').first()).toBeVisible({ timeout: 15000 });

    // 6. UI Boundary Verification: PAUSE AUCTION button
    // Host should see the Pause button
    const hostPauseBtn = hostPage.locator('button:has-text("PAUSE AUCTION")');
    await expect(hostPauseBtn).toBeVisible();

    // Spectator should NOT see the Pause button
    const spectatorPauseBtn = spectatorPage.locator('button:has-text("PAUSE AUCTION")');
    await expect(spectatorPauseBtn).toBeHidden();

    // 7. Security Boundary Verification: Spectator unauthorized direct API call
    // The spectator attempts to call the backend pause API using their authenticated session context
    const unauthorizedResponse = await spectatorPage.evaluate(async (auctionId) => {
      const res = await fetch('/api/auction/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId })
      });
      const data = await res.json();
      return { status: res.status, data };
    }, auctionId);

    // Assert that the backend safely rejected the unauthorized request
    expect(unauthorizedResponse.status).not.toBe(200);
    expect(unauthorizedResponse.data.success).toBe(false);
    expect(unauthorizedResponse.data.error).toContain('UNAUTHORIZED_HOST_ONLY');

    // Ensure the auction was NOT paused by the spectator
    await expect(spectatorPage.locator('text=Auction Paused').first()).toBeHidden();
    
    // 8. Legitimate Host Action Verification
    // Host clicks the PAUSE AUCTION button
    await hostPauseBtn.click();

    // 9. Realtime Synchronization Verification
    // Both screens should show the paused state without page refresh
    await expect(hostPage.locator('h2:has-text("Auction Paused")').first()).toBeVisible({ timeout: 15000 });
    await expect(spectatorPage.locator('h2:has-text("Auction Paused")').first()).toBeVisible({ timeout: 15000 });

    // Ensure the original player context is preserved/rendered correctly underneath or alongside the pause state
    // (Usually in an overlay, but let's just ensure they both agree on being Paused).

    // Clean up contexts
    await hostContext.close();
    await spectatorContext.close();
  });
});
