import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true, // Nginx forwards to this exact port (infra/nginx/nginx.conf).
    // No /api proxy here: in dev the app is opened through Nginx (http://localhost:8080), which
    // routes /api to the server, the same single origin as in production (architecture §14).
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
