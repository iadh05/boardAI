import { describe, expect, it } from 'vitest';
import { FindingSchema, mergeFindings, type Finding } from './findings.ts';

// The contract between specialists and the Architect (AV2-05, D7) and the merge in code (D8): the
// hardest reasoning stays deterministic — the 9B model explains, it doesn't arbitrate.

const finding = (over: Partial<Finding>): Finding => ({
  specialist: 'data',
  kind: 'single-database',
  boxIds: ['db'],
  severity: 'warn',
  problem: 'one copy of the data',
  confidence: 0.8,
  ...over,
});

describe('FindingSchema', () => {
  it('accepts a finding as a specialist returns it', () => {
    expect(FindingSchema.safeParse(finding({ fix: 'add a replica' })).success).toBe(true);
  });

  it.each([
    ['no boxes', { boxIds: [] }],
    ['an unknown severity', { severity: 'urgent' }],
    ['a confidence above 1', { confidence: 1.5 }],
    ['an empty problem', { problem: '' }],
  ])('refuses %s: a broken contract is not merged', (_, bad) => {
    expect(FindingSchema.safeParse({ ...finding({}), ...bad }).success).toBe(false);
  });
});

describe('mergeFindings', () => {
  it('two specialists, same problem on the same boxes: one finding, both named, the stronger kept', () => {
    const { findings } = mergeFindings([
      finding({ specialist: 'data', severity: 'warn', boxIds: ['db', 'api'] }),
      finding({ specialist: 'chaos', severity: 'critical', boxIds: ['api', 'db'] }),
    ]);

    expect(findings).toEqual([
      expect.objectContaining({ severity: 'critical', from: ['data', 'chaos'] }),
    ]);
  });

  it('sorts by severity, then confidence', () => {
    const { findings } = mergeFindings([
      finding({ kind: 'a', severity: 'info' }),
      finding({ kind: 'b', severity: 'critical', confidence: 0.5 }),
      finding({ kind: 'c', severity: 'critical', confidence: 0.9 }),
      finding({ kind: 'd', severity: 'warn' }),
    ]);
    expect(findings.map((f) => f.kind)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('keeps both sides of a known conflict on the same boxes, with the trade-off for the user', () => {
    const { findings, conflicts } = mergeFindings([
      finding({ specialist: 'cost', kind: 'drop-replica', boxIds: ['replica'] }),
      finding({ specialist: 'chaos', kind: 'keep-replica', boxIds: ['replica'] }),
    ]);

    expect(findings).toHaveLength(2);
    expect(conflicts).toEqual([
      {
        kinds: ['drop-replica', 'keep-replica'],
        boxIds: ['replica'],
        tradeoff: expect.stringMatching(/cost/i) as unknown,
      },
    ]);
  });

  it('a conflict needs a shared box: the same kinds on different boxes are not one', () => {
    const { conflicts } = mergeFindings([
      finding({ kind: 'drop-replica', boxIds: ['r1'] }),
      finding({ kind: 'keep-replica', boxIds: ['r2'] }),
    ]);
    expect(conflicts).toEqual([]);
  });
});
