/// <reference types="node" />
// ↑ Config files are type-checked outside the app's tsconfig, so Node's types (process.env) are declared here.
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const isCI = Boolean(process.env.CI);
const PORT = 4173; // `vite preview` — the production build, closer to what users get than the dev server
// Its own port: never reuse the dev server on :3000, which talks to the real model.
const API_PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI, // a stray test.only must not silently skip the rest in CI
  // docs/rules/e2e.md — the CI retry only exists to record a trace; a test that needed it is
  // flaky, and flaky fails the build.
  retries: isCI ? 1 : 0,
  failOnFlakyTests: isCI,
  reporter: isCI ? [['html', { open: 'never' }], ['github']] : [['list']],
  use: {
    // BASE_URL lets the same tests run through Nginx later (http://localhost:8080).
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'on-first-retry', // full step-by-step trace when a test fails once
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          // The server with the fake model: scripted, deterministic, no GPU (docs/rules/e2e.md).
          command: 'pnpm --filter @designroom/server start',
          url: `http://localhost:${API_PORT}/api/health`,
          env: {
            PORT: String(API_PORT),
            LLM_PROVIDER: 'fake',
            LLM_SCENARIO_FILE: path.resolve('e2e/fixtures/llm/scenarios.json'),
            LOG_LEVEL: 'warn',
          },
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
        {
          command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
          url: `http://localhost:${PORT}`,
          env: { API_URL: `http://localhost:${API_PORT}` },
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
      ],
});
