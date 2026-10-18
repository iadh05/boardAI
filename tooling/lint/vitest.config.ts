import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only our tests — never the fixtures (some are Playwright *.spec.ts files on purpose).
    include: ['src/**/*.test.ts'],
    // Type-aware ESLint over the fixtures takes a few seconds on a cold start.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
