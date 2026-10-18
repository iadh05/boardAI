import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testSetup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/testSetup.ts', 'src/index.ts'],
      // A library others build on: keep it well tested.
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
