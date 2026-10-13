import { test, expect } from '@playwright/test';

test.describe('Phase 1 E2E Smoke Test', () => {
  test('should load the root landing page successfully', async ({ page }) => {
    // 1. Navigate to the root route
    await page.goto('/');

    // 2. Verify page loads and contains stable heading content
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Mega Auction V1');

    // 3. Verify landing page badge
    const badge = page.locator('span');
    await expect(badge).toContainText('Phase 1 Complete — Foundation Active');
  });
});
