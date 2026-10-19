import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Quality gate: stream parsing, retries and timeouts are easy to get subtly wrong.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
