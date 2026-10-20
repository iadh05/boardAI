import { describe, expect, it } from 'vitest';
import { connectNudge, recommendsChange, shouldNudge, unconnectedNewBoxes } from './nudge.ts';

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

describe('shouldNudge — only when the answer asks permission (M1-29)', () => {
  // Measured by replay on the Uber board: the old rule ("add" + a component word) fired on a
  // comparison answer ("Kafka or RabbitMQ?") and on "nothing to change", pushing the model to
  // invent changes. The failure the nudge exists for is asking instead of proposing.
  it.each([
    'Every read hits Postgres. Would you like me to add a Redis cache?',
    'Do you want me to proceed with adding these components (an idempotency Redis, a queue)?',
    'I recommend a read replica for Postgres. Shall I add it?',
    'A load balancer is missing. Want me to add one in front of the two APIs?',
  ])('asks permission for a change: nudge — %s', (answer) => {
    expect(shouldNudge(answer)).toBe(true);
  });

  it.each([
    // The recorded answer to "what better in this case kafka or rabbit mq": it mentions adding
    // RabbitMQ as an option, and asks a question — but not for permission to change anything.
    'Keep Kafka. Optionally add a small RabbitMQ instance only for request-reply workflows. Do you see any part of the design where you would prefer request-reply?',
    'No changes are needed: Kafka is already the right choice. Would you like me to add a cache anyway?',
    'Nothing needs to change here. Shall I add a queue later if traffic grows?',
    'Every read hits Postgres: add a Redis cache.', // recommends, but doesn't ask
    'How many users do you expect?',
  ])('no nudge — %s', (answer) => {
    expect(shouldNudge(answer)).toBe(false);
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
