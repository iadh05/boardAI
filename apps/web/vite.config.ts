import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true, // Nginx forwards to this exact port (infra/nginx/nginx.conf).
    // IPv4 loopback: "localhost" can resolve to ::1 only, which Nginx in Docker can't reach
    // (host.docker.internal is IPv4) — the app then answers 502 through http://localhost:8080.
    host: '127.0.0.1',
    // No /api proxy here: in dev the app is opened through Nginx (http://localhost:8080), which
    // routes /api to the server, the same single origin as in production (architecture §14).
  },
  preview: {
    // The e2e runs serve the production build without Nginx: forward /api to the fake-model
    // server they start on :3100 (playwright.config.ts). That is also the default, so a preview
    // started by hand and reused by Playwright can never reach the real model on :3000.
    // /ws: the rooms' WebSocket (M2), same server. Vite keeps the Host header, so the server's
    // same-origin check sees the page's own host.
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:3100',
      '/ws': { target: process.env.API_URL ?? 'http://localhost:3100', ws: true },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // The diagram engine in its own file: it changes only when we upgrade it, so browsers
            // keep it cached while our own code changes (hashed names + immutable caching, M1-14b).
            {
              name: 'diagram-engine',
              // Module ids use forward slashes on every OS.
              test: /\/node_modules\/.*\/(@xyflow|libavoid-js|d3-[a-z]+|classcat)\//,
            },
            {
              // Sentry in its own file too: it changes only on upgrades, and its size shows here.
              name: 'error-tracking',
              test: /\/node_modules\/.*\/@sentry(-internal)?\//,
            },
          ],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'], // e2e/*.spec.ts belong to Playwright
    environment: 'jsdom',
    setupFiles: ['./src/testSetup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/testSetup.ts', 'src/main.tsx'],
      // Quality gate: stores, mappers and hooks must be test-driven (docs/rules/frontend.md).
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
