import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Type-aware ESLint over the fixtures takes a few seconds on a cold start.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
