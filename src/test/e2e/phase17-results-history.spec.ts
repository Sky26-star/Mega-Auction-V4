// src/test/e2e/phase17-results-history.spec.ts
// E2E Verification Suite for Phase 17F (Results & History UI/UX) and Phase 17G (Data Integrity)
// Uses existing disposable user and auction fixtures.

import { test, expect } from '@playwright/test';
import {
  createDisposableTestUser,
  setupDisposableAuction,
  cleanupDisposableAuction,
} from './setup/auction-fixture';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

test.describe.serial('Phase 17F + 17G — Post-Auction Results, History & Modal E2E', () => {
  test.setTimeout(120000); // 2 minutes

  let hostUser: any;
  let roomId: string;
  let auctionId: string;
  let hostTeamId: string;
  let roomCode: string;
  let runId: string;
  let supabaseAdmin: any;

  let testPlayer1Id: string;
  let testPlayer2Id: string;

  test.beforeAll(async () => {
    // 1. Create Disposable Test User (Host)
    hostUser = await createDisposableTestUser();
    runId = hostUser.runId;

    supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    // 2. Provision standard disposable auction
    const auctionSetup = await setupDisposableAuction(hostUser.supabase, runId, {
      roomSettings: {
        default_purse: 100,
        max_squad_size: 15,
        max_overseas: 8,
      },
    });

    roomId = auctionSetup.roomId;
    auctionId = auctionSetup.auctionId;
    hostTeamId = auctionSetup.hostTeamId;
    roomCode = auctionSetup.roomCode;

    // 3. Query existing players from public player sets to attach to lots
    const { data: players } = await supabaseAdmin
      .from('players')
      .select('id, name, role, category, country, base_price, is_overseas')
      .limit(3);

    if (!players || players.length < 2) {
      throw new Error('Database must have at least 2 players in players table for Phase 17 E2E tests');
    }

    testPlayer1Id = players[0].id;
    testPlayer2Id = players[1].id;

    // 4. Seed 1 SOLD Lot (Mega), 1 UNSOLD Lot (Mega), and 1 Squad Player to simulate completed auction state
    const lot1Id = crypto.randomUUID();
    const lot2Id = crypto.randomUUID();

    // Insert Lot 1: SOLD in Mega round
    await supabaseAdmin.from('auction_lots').insert({
      id: lot1Id,
      auction_id: auctionId,
      player_id: testPlayer1Id,
      lot_index: 0,
      status: 'SOLD',
      base_price: 200,
      current_bid: 1500,
      winning_bid: 1500,
      winning_team_id: hostTeamId,
      is_mini_round: false,
    });

    // Insert Squad Player for Lot 1
    await supabaseAdmin.from('squad_players').insert({
      id: crypto.randomUUID(),
      auction_id: auctionId,
      team_id: hostTeamId,
      player_id: testPlayer1Id,
      lot_id: lot1Id,
      purchase_price: 1500,
      is_active: true,
    });

    // Insert Lot 2: UNSOLD
    await supabaseAdmin.from('auction_lots').insert({
      id: lot2Id,
      auction_id: auctionId,
      player_id: testPlayer2Id,
      lot_index: 1,
      status: 'UNSOLD',
      base_price: 100,
      current_bid: null,
      winning_bid: null,
      winning_team_id: null,
      is_mini_round: false,
    });

    // Deduct spend from host team purse: 10000 - 1500 = 8500
    await supabaseAdmin
      .from('teams')
      .update({
        purse: 8500,
        players_bought: 1,
      })
      .eq('id', hostTeamId);

    // Mark Auction COMPLETED
    await supabaseAdmin
      .from('auctions')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        mega_completed_at: new Date().toISOString(),
      })
      .eq('id', auctionId);
  });

  test.afterAll(async () => {
    if (roomId && hostUser?.supabase) {
      try {
        await cleanupDisposableAuction(hostUser.supabase, roomId);
      } catch (e) {
        // Ignored
      }
    }
  });

  test('E2E: Completed Arena CTA -> Results -> Team Matrix -> Leaderboards -> Player Lifecycle Modal', async ({ page }) => {
    // 1. Authenticate Host via Login Form
    await page.goto('/login');
    await page.fill('input[id="login-email"]', hostUser.user.email);
    await page.fill('input[id="login-password"]', 'Pass_' + runId + '!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard*', { timeout: 15000 });

    // 2. Navigate to Completed Auction Arena (/rooms/[id]/auction)
    await page.goto(`/rooms/${roomId}/auction`);
    await page.waitForLoadState('networkidle');

    // Verify RED #2: Completion Screen & CTA Presence
    const completedHeading = page.locator('text=AUCTION COMPLETED');
    await expect(completedHeading).toBeVisible({ timeout: 15000 });

    const viewSummaryBtn = page.getByRole('button', { name: /VIEW SUMMARY & RESULTS/i });
    await expect(viewSummaryBtn).toBeVisible();

    // 3. Click CTA and verify navigation to /rooms/[id]/summary
    await viewSummaryBtn.click();
    await page.waitForURL(`**/rooms/${roomId}/summary*`, { timeout: 15000 });

    // Verify Results Page Loaded
    await expect(page.locator('text=AUTHORITATIVE POST-AUCTION AUDIT REPORT')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=ROOM ' + roomCode)).toBeVisible();

    // 4. Verify Overview Cards (Gross Acquisitions & Net Capital Spend)
    await expect(page.locator('text=GROSS ACQUISITIONS').first()).toBeVisible();
    await expect(page.locator('text=NET CAPITAL SPEND').first()).toBeVisible();

    // 5. Verify Team Purse Utilization Matrix (YELLOW #2 Breakdown: Mega, Refunds, Mini)
    await expect(page.locator('text=TEAM PURSE UTILIZATION MATRIX')).toBeVisible();
    await expect(page.locator('text=Mega:').first()).toBeVisible();
    await expect(page.locator('text=Refunds:').first()).toBeVisible();
    await expect(page.locator('text=Mini:').first()).toBeVisible();

    // 6. Verify Spending Analytics (PRD Item 6 & Yellow #6)
    await expect(page.locator('text=ROLE DISTRIBUTION')).toBeVisible();
    await expect(page.locator('text=CATEGORY ALLOCATION')).toBeVisible();
    await expect(page.locator('text=DOMESTIC VS OVERSEAS')).toBeVisible();

    // 7. Verify Unsold Player Catalog & Yellow #3 (Click Unsold Lot to Open Player History Modal)
    await expect(page.locator('text=UNSOLD PLAYER CATALOG')).toBeVisible();
    const unsoldEntry = page.locator('text=UNSOLD').first();
    await expect(unsoldEntry).toBeVisible();

    // Click unsold lot card
    await unsoldEntry.click();

    // 8. Verify Player History Modal Opens (Phase 17D)
    const modalHeading = page.locator('text=LIFECYCLE AUDIT TRAIL');
    await expect(modalHeading).toBeVisible({ timeout: 10000 });

    // 9. Verify Yellow #4: Modal Dismissal via Escape Key
    await page.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible({ timeout: 5000 });

    // 10. Reopen Modal from Squad or Top Buys and Dismiss via Close Button
    const topBuyEntry = page.locator('text=MARQUEE BUYS').locator('..').locator('..');
    const playerCard = topBuyEntry.locator('div[title*="Click to view full player lifecycle history"]').first();
    if (await playerCard.isVisible()) {
      await playerCard.click();
      await expect(page.locator('text=LIFECYCLE AUDIT TRAIL')).toBeVisible({ timeout: 10000 });

      // Click close button (X)
      const closeBtn = page.locator('button:has(svg.lucide-x)').first();
      await closeBtn.click();
      await expect(page.locator('text=LIFECYCLE AUDIT TRAIL')).not.toBeVisible({ timeout: 5000 });
    }
  });
});
