import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true, // Nginx (M1-14b) forwards to this exact port.
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
