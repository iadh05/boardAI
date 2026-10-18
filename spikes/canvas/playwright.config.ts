import { defineConfig } from '@playwright/test';

// Run from apps/web (which has Playwright): pnpm exec playwright test -c ../../spikes/canvas/playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  use: { baseURL: 'http://localhost:5180', viewport: { width: 1440, height: 760 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm dev', cwd: '.', url: 'http://localhost:5180', reuseExistingServer: true },
});
