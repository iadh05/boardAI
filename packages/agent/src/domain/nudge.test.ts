import { describe, expect, it } from 'vitest';
import { connectNudge, recommendsChange, unconnectedNewBoxes } from './nudge.ts';

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

describe('recommendsChange (M1-24e)', () => {
  it.each([
    'The Orders API has no caching layer: every request hits Postgres. Add a Redis cache.',
    'I recommend introducing a queue between the API and the workers.',
    'You need a load balancer in front of the two APIs.',
    'Postgres is a single point of failure: add a read replica.',
    'Consider putting a CDN in front of the web client.',
    'Without a cache, the database will struggle at peak.',
  ])('a recommendation in words: %s', (answer) => {
    expect(recommendsChange(answer)).toBe(true);
  });

  it.each([
    'Could you tell me how many users you expect, and whether reads or writes dominate?',
    'This design looks solid for its size. Nothing to change.',
    '',
  ])('not a recommendation: %s', (answer) => {
    expect(recommendsChange(answer)).toBe(false);
  });
});
