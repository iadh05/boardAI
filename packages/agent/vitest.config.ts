import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Quality gate: the agent turns model output into board changes: every path must be tested.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
