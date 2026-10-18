/// <reference types="node" />
// ↑ Config files are type-checked outside the app's tsconfig, so Node's types (process.env) are declared here.
import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const PORT = 4173; // `vite preview` — the production build, closer to what users get than the dev server

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI, // a stray test.only must not silently skip the rest in CI
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['html', { open: 'never' }], ['github']] : [['list']],
  use: {
    // BASE_URL lets the same tests run through Nginx later (http://localhost:8080).
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'on-first-retry', // full step-by-step trace when a test fails once
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
});
