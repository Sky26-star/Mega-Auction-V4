import './setup/e2e-target-guard';
import { test, expect, Page } from '@playwright/test';
import crypto from 'crypto';
import { clerkClient } from '@clerk/nextjs/server';
import { clerk as clerkTesting, clerkSetup } from '@clerk/testing/playwright';
import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import {
  createDisposableTestUser,
  setupDisposableAuction,
  cleanupDisposableAuction,
} from './setup/auction-fixture';

loadEnvConfig(process.cwd());
if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_TEST_URL!,
  process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!
);

async function createClerkDisposableTestUser() {
  if (
    !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_') ||
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')
  ) {
    throw new Error('Browser lifecycle tests require Clerk development test keys.');
  }

  const runId = crypto.randomUUID();
  const email = `e2e_${runId.replace(/-/g, '').slice(0, 12)}+clerk_test@example.com`;
  const username = `e2e_${runId.replace(/-/g, '').slice(0, 12)}`;
  const clerk = await clerkClient();
  const clerkUser = await clerk.users.createUser({
    emailAddress: [email],
    emailAddressIdentificationStatus: ['verified'],
    password: `Pass_${runId}!`,
    username,
    firstName: 'E2E',
    lastName: 'Test',
  });

  return {
    runId,
    email,
    clerkUserId: clerkUser.id,
    user: null as any,
    supabase: null as any,
    profileId: null as string | null,
  };
}

async function loginClerkTestUser(page: Page, testUser: any) {
  await clerkSetup();
  await page.goto('/');
  await clerkTesting.signIn({ page, emailAddress: testUser.email });
  const signInBrowserState = await page.evaluate(() => {
    const clerk = (window as any).Clerk;
    return { loaded: clerk?.loaded ?? false, userId: clerk?.user?.id ?? null, sessionId: clerk?.session?.id ?? null };
  });
  if (!signInBrowserState.loaded || !signInBrowserState.userId || !signInBrowserState.sessionId || signInBrowserState.userId !== testUser.clerkUserId) {
    throw new Error('Clerk helper did not create a session for the expected disposable test user.');
  }

  const profileResponse = await page.request.get('/api/auth/me', { timeout: 30000 });
  const payload = await profileResponse.json().catch(() => null);
  const profileId = payload?.profile?.id;
  if (!profileResponse.ok() || !profileId) {
    throw new Error(`Clerk test identity provisioning failed with HTTP ${profileResponse.status()}, body ${JSON.stringify(payload)}.`);
  }
  const { data: mapping, error: mappingError } = await supabaseAdmin
    .from('clerk_user_mappings')
    .select('clerk_user_id')
    .eq('profile_id', profileId)
    .single();
  if (mappingError || !mapping?.clerk_user_id) {
    throw new Error(`Clerk identity mapping was not provisioned: ${mappingError?.message || 'missing mapping'}.`);
  }

  const password = `Pass_${testUser.runId}!`;
  const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(profileId, {
    password,
    email_confirm: true,
  });
  if (passwordError) throw new Error(`Failed to prepare the local shadow identity: ${passwordError.message}.`);

  const userClient = createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: authData, error: authError } = await userClient.auth.signInWithPassword({
    email: testUser.email,
    password,
  });
  if (authError || !authData.user || !authData.session) {
    throw new Error(`Failed to authenticate the local shadow identity: ${authError?.message || 'missing session'}.`);
  }

  testUser.profileId = profileId;
  testUser.clerkUserId = mapping.clerk_user_id;
  testUser.user = authData.user;
  testUser.supabase = userClient;
  return testUser;
}

async function cleanupClerkDisposableTestUser(testUser: any) {
  let remoteFailure: unknown;
  try {
    const clerk = await clerkClient();
    const result = await clerk.users.getUserList({ emailAddress: [testUser.email], limit: 10 });
    const matches = result.data.filter((user) =>
      user.emailAddresses.some((email) => email.emailAddress.toLowerCase() === testUser.email.toLowerCase())
    );
    for (const user of matches) await clerk.users.deleteUser(user.id);
  } catch (error) {
    remoteFailure = error;
  }

  let localFailure: unknown;
  try {
    let profileId = testUser.profileId as string | null;
    if (!profileId) {
      const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      profileId = data.users.find((user) => user.email?.toLowerCase() === testUser.email.toLowerCase())?.id || null;
    }
    if (profileId) {
      const { error: mappingError } = await supabaseAdmin
        .from('clerk_user_mappings')
        .delete()
        .eq('profile_id', profileId);
      if (mappingError) throw mappingError;
      const { error: userError } = await supabaseAdmin.auth.admin.deleteUser(profileId);
      if (userError && !userError.message.toLowerCase().includes('not found')) throw userError;
    }
  } catch (error) {
    localFailure = error;
  }

  if (remoteFailure || localFailure) {
    const details = [remoteFailure, localFailure]
      .filter(Boolean)
      .map((error) => error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to fully clean up a disposable Clerk test identity: ${details.join('; ')}`);
  }
}

// Helper: authenticate test user in Playwright page
async function loginAndNavigate(page: Page, testUser: any, targetPath: string) {
  await page.goto('/login');
  await page.fill('input[id="login-email"]', testUser.user.email);
  await page.fill('input[id="login-password"]', `Pass_${testUser.runId}!`);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard*', { timeout: 15000 });
  await page.goto(targetPath);
  await page.waitForLoadState('domcontentloaded');
}

// Helper: Seed F1 (Completed Main Auction, no Mini session)
async function setupF1CompletedAuction(hostUser: any, runId: string) {
  const auctionSetup = await setupDisposableAuction(hostUser.supabase, runId, {
    roomSettings: {
      default_purse: 10000,
      max_squad_size: 15,
      max_overseas: 8,
    },
  });

  const { roomId, auctionId, hostTeamId, roomCode } = auctionSetup;
  const { data: players, error: playersError } = await supabaseAdmin
    .from('players')
    .select('id, name, role, category, country, base_price, is_overseas')
    .limit(2);

  if (playersError || !players || players.length < 2) {
    throw new Error(`Database must have at least 2 players in players table for fixtures: ${playersError?.message || 'not enough players'}`);
  }

  const p1 = players[0]!;
  const p2 = players[1]!;
  const { data: lot1, error: lot1LookupError } = await supabaseAdmin
    .from('auction_lots')
    .select('id')
    .eq('auction_id', auctionId)
    .eq('player_id', p1.id)
    .eq('is_mini_round', false)
    .single();
  if (lot1LookupError || !lot1) throw new Error(`Could not find seeded lot for the sold test player: ${lot1LookupError?.message || 'missing lot'}`);

  const { data: lot2, error: lot2LookupError } = await supabaseAdmin
    .from('auction_lots')
    .select('id')
    .eq('auction_id', auctionId)
    .eq('player_id', p2.id)
    .eq('is_mini_round', false)
    .single();
  if (lot2LookupError || !lot2) throw new Error(`Could not find seeded lot for the unsold test player: ${lot2LookupError?.message || 'missing lot'}`);

  const soldPrice = p1.base_price + 50;
  const { error: soldLotError } = await supabaseAdmin
    .from('auction_lots')
    .update({
      status: 'SOLD',
      current_bid: soldPrice,
      winning_bid: soldPrice,
      winning_team_id: hostTeamId,
      highest_bidder_team_id: hostTeamId,
      timer_expires_at: null,
      get_ready_expires_at: null,
    })
    .eq('id', lot1.id);
  expect(soldLotError).toBeNull();

  const { error: squadPlayerError } = await supabaseAdmin.from('squad_players').insert({
    id: crypto.randomUUID(),
    auction_id: auctionId,
    team_id: hostTeamId,
    player_id: p1.id,
    lot_id: lot1.id,
    purchase_price: soldPrice,
  });
  expect(squadPlayerError).toBeNull();

  const { error: unsoldLotError } = await supabaseAdmin
    .from('auction_lots')
    .update({
      status: 'UNSOLD',
      current_bid: p2.base_price,
      winning_bid: null,
      winning_team_id: null,
      highest_bidder_team_id: null,
      timer_expires_at: null,
      get_ready_expires_at: null,
    })
    .eq('id', lot2.id);
  expect(unsoldLotError).toBeNull();

  const { error: teamError } = await supabaseAdmin
    .from('teams')
    .update({
      purse: 10000 - soldPrice,
      players_bought: 1,
      overseas_count: p1.is_overseas ? 1 : 0,
    })
    .eq('id', hostTeamId);
  expect(teamError).toBeNull();

  const { error: auctionError } = await supabaseAdmin
    .from('auctions')
    .update({
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
      mega_completed_at: new Date().toISOString(),
    })
    .eq('id', auctionId);
  expect(auctionError).toBeNull();

  return {
    roomId,
    auctionId,
    hostTeamId,
    roomCode,
    p1,
    p2,
  };
}
// Helper: Seed F2 (Mini Auction Initialized in SETUP)
async function setupF2MiniInitialized(hostUser: any, runId: string) {
  const f1 = await setupF1CompletedAuction(hostUser, runId);
  const { data: initData, error: initErr } = await hostUser.supabase.rpc('v3_initiate_mini_auction', {
    p_auction_id: f1.auctionId,
  });
  expect(initErr).toBeNull();
  expect(initData.success).toBe(true);

  const { data: miniSession } = await supabaseAdmin
    .from('mini_auction_sessions')
    .select('*')
    .eq('auction_id', f1.auctionId)
    .single();

  return {
    ...f1,
    miniSession: miniSession!,
    miniAuctionSessionId: miniSession!.id,
  };
}

// Helper: Seed F3 (Mini Auction in SELECTION_CLOSED)
async function setupF3SelectionClosed(hostUser: any, runId: string) {
  const f2 = await setupF2MiniInitialized(hostUser, runId);

  // 1. Open selection window
  const { data: openData, error: openErr } = await hostUser.supabase.rpc('v3_start_mini_selection', {
    p_auction_id: f2.auctionId,
  });
  expect(openErr).toBeNull();
  expect(openData.success).toBe(true);

  // 2. Nominate p2 (which was unsold)
  const { error: toggleErr } = await hostUser.supabase.rpc('v3_toggle_mini_selection', {
    p_auction_id: f2.auctionId,
    p_player_id: f2.p2.id,
    p_desired_state: true,
  });
  expect(toggleErr).toBeNull();

  // 3. Confirm selection
  const { error: confirmErr } = await hostUser.supabase.rpc('v3_confirm_mini_selections', {
    p_auction_id: f2.auctionId,
  });
  expect(confirmErr).toBeNull();

  // 4. Force close selection
  const { data: closeData, error: closeErr } = await supabaseAdmin.rpc('v3_close_mini_selection', {
    p_auction_id: f2.auctionId,
    p_force: true,
  });
  expect(closeErr).toBeNull();
  expect(closeData.success).toBe(true);
  expect(closeData.status).toBe('SELECTION_CLOSED');

  const { data: session } = await supabaseAdmin
    .from('mini_auction_sessions')
    .select('*')
    .eq('auction_id', f2.auctionId)
    .single();

  return {
    ...f2,
    miniSession: session!,
  };
}

// Helper: Seed F4 (Mini Auction in BIDDING)
async function setupF4MiniBidding(hostUser: any, runId: string) {
  const f3 = await setupF3SelectionClosed(hostUser, runId);

  // Start mini auction bidding
  const { data: startData, error: startErr } = await hostUser.supabase.rpc('v3_start_mini_auction', {
    p_auction_id: f3.auctionId,
  });
  expect(startErr).toBeNull();
  expect(startData.success).toBe(true);
  expect(startData.status).toBe('BIDDING');

  const { data: session } = await supabaseAdmin
    .from('mini_auction_sessions')
    .select('*')
    .eq('auction_id', f3.auctionId)
    .single();

  return {
    ...f3,
    miniSession: session!,
    firstLotId: startData.first_lot_id,
  };
}

// Helper: Seed F5 (Mini Auction COMPLETED)
async function setupF5MiniCompleted(hostUser: any, runId: string) {
  const f4 = await setupF4MiniBidding(hostUser, runId);

  // Finalize the mini lot
  await supabaseAdmin
    .from('auction_lots')
    .update({
      status: 'SOLD',
      current_bid: 100,
      winning_bid: 100,
      winning_team_id: f4.hostTeamId,
    })
    .eq('id', f4.firstLotId);

  // Finalize auction -> triggers trg_auction_completed_mini_bridge
  await supabaseAdmin
    .from('auctions')
    .update({
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
    })
    .eq('id', f4.auctionId);

  const { data: session } = await supabaseAdmin
    .from('mini_auction_sessions')
    .select('*')
    .eq('auction_id', f4.auctionId)
    .single();

  return {
    ...f4,
    miniSession: session!,
  };
}

test.describe.serial('MA-MINI Lifecycle & Failure-Handling Tests', () => {
  test.setTimeout(90000);

  // ==========================================================================
  // MA-MINI-001 — Main Auction Completion Reaches Summary
  // ==========================================================================
  test('MA-MINI-001 — Main Auction Completion Reaches Summary', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f1 = await setupF1CompletedAuction(hostUser, runId);
      roomId = f1.roomId;

      // Authoritative State Source
      const { data: auction } = await supabaseAdmin
        .from('auctions')
        .select('status')
        .eq('id', f1.auctionId)
        .single();
      expect(auction!.status).toBe('COMPLETED');

      // Navigate to summary
      await loginAndNavigate(page, hostUser, `/rooms/${f1.roomId}/summary`);

      // Required Assertions
      await expect(page).toHaveURL(new RegExp(`/rooms/${f1.roomId}/summary`));
      await expect(page.getByText(/summary/i).first()).toBeVisible();
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-002 — Summary Exposes Mini Auction Entry
  // ==========================================================================
  test('MA-MINI-002 — Summary Exposes Mini Auction Entry', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f1 = await setupF1CompletedAuction(hostUser, runId);
      roomId = f1.roomId;

      await loginAndNavigate(page, hostUser, `/rooms/${f1.roomId}/summary`);

      // Required Assertions for Authorized Host
      const startBtn = page.getByTestId('mini-auction-start');
      await expect(startBtn).toBeVisible();
      await expect(startBtn).toBeEnabled();
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-003 — Start Mini Auction Creates Exactly One Session
  // ==========================================================================
  test('MA-MINI-003 — Start Mini Auction Creates Exactly One Session', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f1 = await setupF1CompletedAuction(hostUser, runId);
      roomId = f1.roomId;

      await loginAndNavigate(page, hostUser, `/rooms/${f1.roomId}/summary`);

      const startBtn = page.getByTestId('mini-auction-start');
      await startBtn.click();

      // Wait for navigation / session creation
      await page.waitForURL(new RegExp(`/rooms/${f1.roomId}/mini-auction`), { timeout: 15000 });

      // Authoritative Database Query
      const { data: miniSessions } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f1.auctionId);

      expect(miniSessions).not.toBeNull();
      expect(miniSessions!.length).toBe(1);

      const miniAuctionSession = miniSessions![0];
      expect(miniAuctionSession.auction_id).toBe(f1.auctionId);
      expect(miniAuctionSession.status).toBe('SETUP');
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-004 — Summary → Mini Auction Navigation
  // ==========================================================================
  test('MA-MINI-004 — Summary → Mini Auction Navigation', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f1 = await setupF1CompletedAuction(hostUser, runId);
      roomId = f1.roomId;

      await loginAndNavigate(page, hostUser, `/rooms/${f1.roomId}/summary`);

      const startBtn = page.getByTestId('mini-auction-start');
      await startBtn.click();

      await expect(page).toHaveURL(new RegExp(`/rooms/${f1.roomId}/mini-auction`));
      const miniPage = page.getByTestId('mini-auction-page');
      await expect(miniPage).toBeVisible();

      const renderedAuctionId = await miniPage.getAttribute('data-auction-id');
      const renderedMiniAuctionSessionId = await miniPage.getAttribute('data-session-id');

      const { data: dbSession } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f1.auctionId)
        .single();

      expect(renderedAuctionId).toBe(f1.auctionId);
      expect(renderedMiniAuctionSessionId).toBe(dbSession!.id);
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-005 — Mini Auction Setup / Selection Phase
  // ==========================================================================
  test('MA-MINI-005 — Mini Auction Setup / Selection Phase', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f2 = await setupF2MiniInitialized(hostUser, runId);
      roomId = f2.roomId;

      await loginAndNavigate(page, hostUser, `/rooms/${f2.roomId}/mini-auction`);

      // Assertions
      const phaseBadge = page.getByTestId('mini-auction-phase');
      await expect(phaseBadge).toHaveText(/SETUP/i);
      await expect(phaseBadge).toHaveAttribute('data-status', 'SETUP');

      const { data: authoritativeMiniAuction } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('status')
        .eq('auction_id', f2.auctionId)
        .single();

      expect(authoritativeMiniAuction!.status).toBe('SETUP');
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-006 — Selection → Pool Review Transition
  // ==========================================================================
  test('MA-MINI-006 — Selection → Pool Review Transition', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f3 = await setupF3SelectionClosed(hostUser, runId);
      roomId = f3.roomId;

      await loginAndNavigate(page, hostUser, `/rooms/${f3.roomId}/mini-auction`);

      // Authoritative Backend State
      const { data: authoritativeMiniAuction } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('status, total_lots')
        .eq('auction_id', f3.auctionId)
        .single();

      expect(authoritativeMiniAuction!.status).toBe('SELECTION_CLOSED');
      expect(authoritativeMiniAuction!.total_lots).toBeGreaterThan(0);

      // UI assertion
      await expect(page.getByTestId('mini-auction-pool-review')).toBeVisible();
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-007 — Pool Review → Mini Auction Bidding
  // ==========================================================================
  test('MA-MINI-007 — Pool Review → Mini Auction Bidding', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f4 = await setupF4MiniBidding(hostUser, runId);
      roomId = f4.roomId;

      await loginAndNavigate(page, hostUser, `/rooms/${f4.roomId}/mini-auction`);

      // Authoritative Backend State
      const { data: authoritativeMiniAuction } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('status')
        .eq('auction_id', f4.auctionId)
        .single();

      expect(authoritativeMiniAuction!.status).toBe('BIDDING');

      // UI assertion
      await expect(page.getByTestId('mini-auction-bidding')).toBeVisible();
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-008 — Mini Auction Completion
  // ==========================================================================
  test('MA-MINI-008 — Mini Auction Completion', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f5 = await setupF5MiniCompleted(hostUser, runId);
      roomId = f5.roomId;

      await loginAndNavigate(page, hostUser, `/rooms/${f5.roomId}/mini-auction`);

      // Authoritative Backend State
      const { data: authoritativeMiniAuction } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('status')
        .eq('auction_id', f5.auctionId)
        .single();

      expect(authoritativeMiniAuction!.status).toBe('COMPLETED');

      // UI assertion
      await expect(page.getByTestId('mini-auction-complete')).toBeVisible();

      // Verify exactly 1 active mini auction session
      const { data: activeMiniAuctionSessions } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f5.auctionId);

      expect(activeMiniAuctionSessions!.length).toBe(1);
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-009 — Main Auction Completion Failure
  // ==========================================================================
  test('MA-MINI-009 — Main Auction Completion Failure', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const auctionSetup = await setupDisposableAuction(hostUser.supabase, runId);
      roomId = auctionSetup.roomId;
      const auctionId = auctionSetup.auctionId;

      // Auction is in progress / not completed
      await supabaseAdmin.from('auctions').update({ status: 'IN_PROGRESS' }).eq('id', auctionId);

      // Attempt to initiate mini auction via API
      const res = await hostUser.supabase.rpc('v3_initiate_mini_auction', {
        p_auction_id: auctionId,
      });

      // Stored procedure rejects because auction is not completed
      expect(res.data.success).toBe(false);
      expect(res.data.error).toBe('ERR_AUCTION_NOT_COMPLETED');

      // Verify no mini session was created
      const { data: miniAuctionSession } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', auctionId)
        .maybeSingle();

      expect(miniAuctionSession).toBeNull();
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-010 — Mini Auction Initialization Failure
  // ==========================================================================
  test('MA-MINI-010 — Mini Auction Initialization Failure & Recovery', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f1 = await setupF1CompletedAuction(hostUser, runId);
      roomId = f1.roomId;

      await loginAndNavigate(page, hostUser, `/rooms/${f1.roomId}/summary`);

      // Intercept initiate-mini API to inject failure
      await page.route('**/api/auction/initiate-mini', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'Simulated Database Failure' }),
        })
      );

      const startBtn = page.getByTestId('mini-auction-start');
      await startBtn.click();

      // UI Error is surfaced
      const errorMessage = page.getByTestId('mini-auction-error');
      await expect(errorMessage).toBeVisible();
      await expect(page).not.toHaveURL(/mini-auction/);

      // Verify no session was created in DB
      let { data: sessions } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f1.auctionId);
      expect(sessions!.length).toBe(0);

      // Remove failure route and retry
      await page.unroute('**/api/auction/initiate-mini');
      const retryBtn = errorMessage.getByRole('button', { name: /retry/i });
      await retryBtn.click();

      // Navigates and succeeds on retry
      await page.waitForURL(new RegExp(`/rooms/${f1.roomId}/mini-auction`), { timeout: 15000 });
      await expect(page.getByTestId('mini-auction-page')).toBeVisible();

      // Verify exactly one session exists after retry
      const { data: sessionsAfter } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f1.auctionId);
      expect(sessionsAfter!.length).toBe(1);
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-011 — Duplicate Start Protection
  // ==========================================================================
  test('MA-MINI-011 — Duplicate Start Protection', async () => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f1 = await setupF1CompletedAuction(hostUser, runId);
      roomId = f1.roomId;

      // Trigger two concurrent start requests
      const p1 = hostUser.supabase.rpc('v3_initiate_mini_auction', { p_auction_id: f1.auctionId });
      const p2 = hostUser.supabase.rpc('v3_initiate_mini_auction', { p_auction_id: f1.auctionId });

      const [res1, res2] = await Promise.all([p1, p2]);

      expect(res1.data.success).toBe(true);
      expect(res2.data.success).toBe(true);

      // Authoritative database check: exactly 1 session
      const { data: activeMiniAuctionSessions } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f1.auctionId);

      expect(activeMiniAuctionSessions!.length).toBe(1);
      expect(activeMiniAuctionSessions![0].auction_id).toBe(f1.auctionId);
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-012 — Unauthorized Host Action
  // ==========================================================================
  test('MA-MINI-012 — Unauthorized Host Action', async () => {
    const hostUser = await createDisposableTestUser();
    const nonHostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f1 = await setupF1CompletedAuction(hostUser, runId);
      roomId = f1.roomId;

      // Non-host attempts to call initiate RPC directly
      const rpcRes = await nonHostUser.supabase.rpc('v3_initiate_mini_auction', {
        p_auction_id: f1.auctionId,
      });

      expect(rpcRes.data.success).toBe(false);
      expect(rpcRes.data.error).toBe('ERR_UNAUTHORIZED');

      // Verify no session was created
      const { data: dbSession } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f1.auctionId)
        .maybeSingle();

      expect(dbSession).toBeNull();
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-013 — Refresh During Mini Auction
  // ==========================================================================
  test('MA-MINI-013 — Refresh During Mini Auction', async ({ page }) => {
    const hostUser = await createClerkDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      await loginClerkTestUser(page, hostUser);
      const f2 = await setupF2MiniInitialized(hostUser, runId);
      roomId = f2.roomId;

      await page.goto(`/rooms/${f2.roomId}/mini-auction`);
      await page.waitForLoadState('domcontentloaded');

      // 1. Capture authoritative state before refresh
      const beforeRefresh = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f2.auctionId)
        .single();

      // 2. Perform browser refresh
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // 3. Fetch state again
      const afterRefresh = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f2.auctionId)
        .single();

      expect(afterRefresh.data!.status).toBe(beforeRefresh.data!.status);
      expect(afterRefresh.data!.id).toBe(beforeRefresh.data!.id);

      // 4. Verify UI state
      const renderedPhase = await page.getByTestId('mini-auction-phase').getAttribute('data-status');
      const renderedAuctionId = await page.getByTestId('mini-auction-page').getAttribute('data-auction-id');
      const renderedSessionId = await page.getByTestId('mini-auction-page').getAttribute('data-session-id');

      expect(renderedPhase).toBe(afterRefresh.data!.status);
      expect(renderedAuctionId).toBe(f2.auctionId);
      expect(renderedSessionId).toBe(f2.miniAuctionSessionId);
    } finally {
      try {
        if (roomId && hostUser.supabase) await cleanupDisposableAuction(hostUser.supabase, roomId);
      } finally {
        await cleanupClerkDisposableTestUser(hostUser);
      }
    }
  });

  // ==========================================================================
  // MA-MINI-014 — Reconnect / Second Context Recovery
  // ==========================================================================
  test('MA-MINI-014 — Reconnect / Second Context Recovery', async ({ browser }) => {
    const hostUser = await createClerkDisposableTestUser();
    const secondUser = await createClerkDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    const hostContext = await browser.newContext();
    const secondContext = await browser.newContext();

    try {
      const hostPage = await hostContext.newPage();
      const secondPage = await secondContext.newPage();
      await loginClerkTestUser(hostPage, hostUser);
      await loginClerkTestUser(secondPage, secondUser);

      const f3 = await setupF3SelectionClosed(hostUser, runId);
      roomId = f3.roomId;

      // Add secondUser as room participant
      const { error: participantError } = await supabaseAdmin.from('room_participants').insert({
        id: crypto.randomUUID(),
        room_id: f3.roomId,
        user_id: secondUser.user.id,
        role: 'SPECTATOR',
      });
      expect(participantError).toBeNull();

      // Context 1: Host opens mini-auction
      await hostPage.goto(`/rooms/${f3.roomId}/mini-auction`);
      await expect(hostPage.getByTestId('mini-auction-page')).toBeVisible({ timeout: 15000 });

      // Context 2: Second user opens mini-auction
      await secondPage.goto(`/rooms/${f3.roomId}/mini-auction`);
      await expect(secondPage.getByTestId('mini-auction-page')).toBeVisible({ timeout: 15000 });

      // Authoritative state
      const { data: authoritative } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f3.auctionId)
        .single();

      const context2Phase = await secondPage.getByTestId('mini-auction-phase').getAttribute('data-status');
      const context2SessionId = await secondPage.getByTestId('mini-auction-page').getAttribute('data-session-id');

      expect(context2Phase).toBe(authoritative!.status);
      expect(context2SessionId).toBe(authoritative!.id);
      // The host advances the session; the spectator must receive the authoritative realtime state.
      await hostPage.getByRole('button', { name: /START MINI AUCTION/i }).click();
      try {
        await expect(hostPage.getByTestId('mini-auction-phase')).toHaveAttribute('data-status', 'BIDDING', { timeout: 15000 });
      } catch {
        const startErrors = await hostPage.locator('p.text-red-400').allTextContents();
        const { data: failedStartState } = await supabaseAdmin
          .from('mini_auction_sessions')
          .select('status')
          .eq('auction_id', f3.auctionId)
          .single();
        throw new Error(`Mini-auction start did not advance. Database=${failedStartState?.status}; UI error=${startErrors.join(' | ') || 'none'}.`);
      }
      await expect(secondPage.getByTestId('mini-auction-phase')).toHaveAttribute('data-status', 'BIDDING', { timeout: 15000 });
      const { data: afterStart } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f3.auctionId)
        .single();
      expect(afterStart!.status).toBe('BIDDING');
      expect(afterStart!.id).toBe(authoritative!.id);
      // Refresh the second context and verify it recovers the same authoritative session.
      await secondPage.reload();
      await expect(secondPage.getByTestId('mini-auction-page')).toBeVisible({ timeout: 15000 });
      expect(await secondPage.getByTestId('mini-auction-phase').getAttribute('data-status')).toBe(afterStart!.status);
      expect(await secondPage.getByTestId('mini-auction-page').getAttribute('data-session-id')).toBe(authoritative!.id);

      // A late second tab in the same context must also join the existing session.
      const secondTab = await secondContext.newPage();
      await secondTab.goto(`/rooms/${f3.roomId}/mini-auction`);
      await expect(secondTab.getByTestId('mini-auction-page')).toBeVisible({ timeout: 15000 });
      expect(await secondTab.getByTestId('mini-auction-phase').getAttribute('data-status')).toBe(afterStart!.status);
      expect(await secondTab.getByTestId('mini-auction-page').getAttribute('data-session-id')).toBe(authoritative!.id);

      // Verify no duplicate session was created
      const { data: sessions } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f3.auctionId);

      expect(sessions!.length).toBe(1);
    } finally {
      await hostContext.close();
      await secondContext.close();
      try {
        if (roomId && hostUser.supabase) await cleanupDisposableAuction(hostUser.supabase, roomId);
      } finally {
        await cleanupClerkDisposableTestUser(secondUser);
        await cleanupClerkDisposableTestUser(hostUser);
      }
    }
  });

  // ==========================================================================
  // MA-MINI-015 — Stale Summary Recovery
  // ==========================================================================
  test('MA-MINI-015 — Stale Summary Recovery', async ({ page }) => {
    const hostUser = await createDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      const f5 = await setupF5MiniCompleted(hostUser, runId);
      roomId = f5.roomId;

      // User opens old Summary URL
      await loginAndNavigate(page, hostUser, `/rooms/${f5.roomId}/summary`);

      const startBtn = page.getByTestId('mini-auction-start');
      await expect(startBtn).toBeVisible();
      // Button displays 'CONTINUE MINI AUCTION'
      await expect(startBtn).toHaveText(/CONTINUE MINI AUCTION/i);

      // Click to continue existing session
      await startBtn.click();
      await page.waitForURL(new RegExp(`/rooms/${f5.roomId}/mini-auction`), { timeout: 15000 });

      // Authoritative check: still exactly 1 session, matching existing session ID
      const { data: activeSessions } = await supabaseAdmin
        .from('mini_auction_sessions')
        .select('*')
        .eq('auction_id', f5.auctionId);

      expect(activeSessions!.length).toBe(1);
      expect(activeSessions![0].id).toBe(f5.miniAuctionSessionId);
    } finally {
      if (roomId) await cleanupDisposableAuction(hostUser.supabase, roomId);
    }
  });

  // ==========================================================================
  // MA-MINI-016 — Full Main → Summary → Mini Lifecycle (Serial Full Lifecycle)
  // ==========================================================================
  test('MA-MINI-016 — Full Main → Summary → Mini Lifecycle', async ({ page }) => {
    const hostUser = await createClerkDisposableTestUser();
    const runId = hostUser.runId;
    let roomId = '';

    try {
      await loginClerkTestUser(page, hostUser);

      // 1. Seed the completed main auction with one sold and one unsold existing lot.
      const auctionSetup = await setupF1CompletedAuction(hostUser, runId);
      roomId = auctionSetup.roomId;
      const auctionId = auctionSetup.auctionId;
      const hostTeamId = auctionSetup.hostTeamId;
      const players = [auctionSetup.p1, auctionSetup.p2];

      const clerkToken = await page.evaluate(async () => (window as any).Clerk?.session?.getToken({ template: 'supabase' }));
      expect(clerkToken).toBeTruthy();
      const roomRead = await page.request.get(
        `${process.env.SUPABASE_TEST_URL}/rest/v1/rooms?id=eq.${roomId}&select=id,host_id`,
        { headers: { apikey: process.env.SUPABASE_TEST_ANON_KEY!, authorization: `Bearer ${clerkToken}` } }
      );
      expect(roomRead.ok()).toBe(true);
      expect(await roomRead.json()).toEqual([
        expect.objectContaining({ id: roomId, host_id: hostUser.profileId }),
      ]);

      // 2. Open Summary
      await page.goto(`/rooms/${roomId}/summary`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('mini-auction-start')).toBeVisible();

      // 3. Start Mini Auction -> SETUP
      await page.getByTestId('mini-auction-start').click();
      await page.waitForURL(new RegExp(`/rooms/${roomId}/mini-auction`), { timeout: 15000 });

      let phaseBadge = page.getByTestId('mini-auction-phase');
      await expect(phaseBadge).toHaveAttribute('data-status', 'SETUP');

      // 4. Host starts selection window -> SELECTION_OPEN
      await page.getByRole('button', { name: /START MINI SELECTION/i }).click();
      await expect(phaseBadge).toHaveAttribute('data-status', 'SELECTION_OPEN', { timeout: 10000 });

      // 5. Force close selection with a nominated player -> SELECTION_CLOSED
      const p2 = players![1];
      await hostUser.supabase.rpc('v3_toggle_mini_selection', {
        p_auction_id: auctionId,
        p_player_id: p2.id,
        p_desired_state: true,
      });
      await hostUser.supabase.rpc('v3_confirm_mini_selections', {
        p_auction_id: auctionId,
      });
      await supabaseAdmin.rpc('v3_close_mini_selection', {
        p_auction_id: auctionId,
        p_force: true,
      });

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      phaseBadge = page.getByTestId('mini-auction-phase');
      await expect(phaseBadge).toHaveAttribute('data-status', 'SELECTION_CLOSED');
      await expect(page.getByTestId('mini-auction-pool-review')).toBeVisible();

      // 6. Host starts mini auction bidding -> BIDDING
      await page.getByRole('button', { name: /START MINI AUCTION/i }).click();
      await expect(phaseBadge).toHaveAttribute('data-status', 'BIDDING', { timeout: 15000 });
      await expect(page.getByTestId('mini-auction-bidding')).toBeVisible();

      // 7. Mini lot finalizes -> COMPLETED
      const { data: miniLot } = await supabaseAdmin
        .from('auction_lots')
        .select('*')
        .eq('auction_id', auctionId)
        .eq('is_mini_round', true)
        .single();

      await supabaseAdmin.from('auction_lots').update({
        status: 'SOLD',
        current_bid: miniLot.base_price,
        winning_bid: miniLot.base_price,
        winning_team_id: hostTeamId,
      }).eq('id', miniLot.id);

      await supabaseAdmin.from('auctions').update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      }).eq('id', auctionId);

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      phaseBadge = page.getByTestId('mini-auction-phase');
      await expect(phaseBadge).toHaveAttribute('data-status', 'COMPLETED');
      await expect(page.getByTestId('mini-auction-complete')).toBeVisible();
    } finally {
      try {
        if (roomId && hostUser.supabase) await cleanupDisposableAuction(hostUser.supabase, roomId);
      } finally {
        await cleanupClerkDisposableTestUser(hostUser);
      }
    }
  });
});
