import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { DEBT_AT_START, READABILITY_DEBT } from './readabilityDebt.ts';

// The readability guardrails (ADR-014) let the files already over a limit only warn. The list may
// only shrink: no file joins it to dodge a limit, and a file that's been fixed must leave it.

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const READABILITY_RULES = new Set([
  'sonarjs/cognitive-complexity',
  'max-lines-per-function',
  'max-lines',
]);

describe('readability debt (ADR-014)', () => {
  it('only shrinks', () => {
    expect(READABILITY_DEBT.length).toBeLessThanOrEqual(DEBT_AT_START);
  });

  it('lists only files still over a limit: a fixed file leaves the list', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles(READABILITY_DEBT.map((f) => path.join(repoRoot, f)));
    const stillOver = results
      .filter((r) => r.messages.some((m) => m.ruleId !== null && READABILITY_RULES.has(m.ruleId)))
      .map((r) => path.relative(repoRoot, r.filePath).split(path.sep).join('/'));
    expect([...READABILITY_DEBT].sort()).toEqual(stillOver.sort());
  }, 120_000);
});
