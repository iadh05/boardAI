import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Quality gate: domain is pure logic, so it must stay almost fully tested.
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
