import { applyOps, type AgentOp, type Board } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { summarize } from './summary.ts';

const before: Board = {
  nodes: [
    { id: 'api', kind: 'api', label: 'API', position: { x: 0, y: 0 } },
    { id: 'db', kind: 'database', label: 'Postgres', position: { x: 300, y: 0 } },
  ],
  edges: [],
};

const summaryOf = (ops: AgentOp[]) => {
  const after = applyOps(before, ops);
  if (!after.ok) throw new Error(after.error.message);
  return summarize(ops, before, after.value);
};

describe('summarize', () => {
  it('names boxes by label, never by id', () => {
    expect(
      summaryOf([
        { op: 'addNode', nodeId: 'q', kind: 'queue', label: 'Jobs' },
        { op: 'connect', edgeId: 'e', source: 'api', target: 'q', mode: 'async', label: 'jobs' },
        { op: 'connect', edgeId: 'e2', source: 'api', target: 'db', mode: 'async' },
      ]),
    ).toBe(
      'Add queue "Jobs"; connect "API" → "Jobs" (async, "jobs"); connect "API" → "Postgres" (async)',
    );
  });

  it('never shows an id, even for a box added and then changed in the same proposal', () => {
    // Seen with the real model (M1-24): "Change "fc4b06ea-…": rename to …".
    expect(
      summaryOf([
        { op: 'addNode', nodeId: 'q-uuid', kind: 'queue', label: 'Queue' },
        { op: 'updateNode', nodeId: 'q-uuid', label: 'Jobs' },
      ]),
    ).toBe('Add queue "Jobs"; change "Queue": rename to "Jobs"');
  });

  it('names a box added in the proposal as the board stores it (trimmed, or the default)', () => {
    expect(
      summaryOf([
        { op: 'addNode', nodeId: 'q', kind: 'queue', label: '  ' },
        { op: 'updateNode', nodeId: 'q', label: 'Jobs' },
      ]),
    ).toBe('Add queue "Jobs"; change "Queue": rename to "Jobs"');
  });

  it('describes a change by the name the user knows now', () => {
    expect(
      summaryOf([{ op: 'updateNode', nodeId: 'api', label: 'Orders API', kind: 'service' }]),
    ).toBe('Change "API": rename to "Orders API", make it a service');
    expect(summaryOf([{ op: 'updateNode', nodeId: 'db', kind: 'cache' }])).toBe(
      'Change "Postgres": make it a cache',
    );
  });

  it('stays within the proposal’s 500 characters', () => {
    const ops: AgentOp[] = Array.from({ length: 20 }, (_, i) => ({
      op: 'addNode',
      nodeId: `n${i}`,
      kind: 'service',
      label: `A rather long service name number ${i}`,
    }));
    const summary = summaryOf(ops);
    expect(summary).toHaveLength(500);
    expect(summary.endsWith('…')).toBe(true);
  });
});
