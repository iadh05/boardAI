import { describe, expect, it } from 'vitest';
import { recommendsChange } from './nudge.ts';

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
