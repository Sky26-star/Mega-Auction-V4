import { defineConfig, devices } from '@playwright/test';
import './src/test/e2e/setup/e2e-target-guard';
export default defineConfig({
  testDir: './src/test/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node scripts/check-port.js && npm run build && node scripts/start-prod.js',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
