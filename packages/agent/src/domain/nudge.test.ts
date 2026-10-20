import { describe, expect, it } from 'vitest';
import { connectNudge, unconnectedNewBoxes } from './nudge.ts';

describe('unconnectedNewBoxes (M1-24e)', () => {
  it('new boxes no arrow touches, in the order they were added', () => {
    expect(
      unconnectedNewBoxes([
        { op: 'addNode', nodeId: 'lb', kind: 'loadBalancer', label: 'LB' },
        { op: 'addNode', nodeId: 'cache', kind: 'cache', label: 'Redis' },
        { op: 'connect', edgeId: 'e1', source: 'api', target: 'cache' },
        { op: 'addNode', nodeId: 'q', kind: 'queue', label: 'Queue' },
      ]),
    ).toEqual(['lb', 'q']);
  });

  it('an arrow either way counts', () => {
    expect(
      unconnectedNewBoxes([
        { op: 'addNode', nodeId: 'lb', kind: 'loadBalancer', label: 'LB' },
        { op: 'connect', edgeId: 'e1', source: 'lb', target: 'api' },
      ]),
    ).toEqual([]);
  });

  it('the request names the boxes, so the model knows which', () => {
    expect(connectNudge(['n5 "Orders LB"'])).toMatch(/connect_nodes[\s\S]*n5 "Orders LB"/);
  });
});
