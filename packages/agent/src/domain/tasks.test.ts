import { describe, expect, it } from 'vitest';
import { progressText, TaskCardSchema } from './tasks.ts';

describe('progressText (D6)', () => {
  it('reads like the user expects: done, running, how many left', () => {
    expect(progressText({ done: ['data'], running: 'security', waiting: 1 })).toBe(
      'Data ✓ · Security running · 1 left',
    );
  });

  it('at the end: only what is done', () => {
    expect(progressText({ done: ['data', 'security'], running: null, waiting: 0 })).toBe(
      'Data ✓ · Security ✓',
    );
  });
});

describe('TaskCardSchema (D4)', () => {
  it('refuses a budget over 60 s: no task may hold the GPU longer', () => {
    const card = { id: 't1', specialist: 'data', boxIds: [], question: 'q', budgetMs: 61_000 };
    expect(TaskCardSchema.safeParse(card).success).toBe(false);
  });
});
