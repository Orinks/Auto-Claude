/**
 * Playwright configuration for Accessibility E2E tests
 * This config is specifically for running axe-core accessibility scans
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/accessibility.e2e.ts',
  timeout: 120000, // Extended timeout for accessibility scans
  expect: {
    timeout: 15000
  },
  fullyParallel: false, // Run tests serially for Electron
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker for Electron
  reporter: [
    ['html', { outputFolder: 'a11y-reports/playwright-report' }],
    ['list']
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'accessibility',
      testMatch: '**/accessibility.e2e.ts'
    }
  ]
});
