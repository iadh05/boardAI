import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../../core/logger.ts';
import { createPhoenixFeedback } from './phoenixFeedback.ts';

const feedback = {
  traceId: '2adb8e295d202a612dc768b48ac1d3f4',
  spanId: '67f6740bbe1ddc3f',
  verdict: 'rejected' as const,
};

describe('createPhoenixFeedback (M1-26c)', () => {
  it('annotates the agent span in Phoenix, as human feedback', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    const sink = createPhoenixFeedback({
      endpoint: 'http://localhost:6006/',
      logger: createLogger({ level: 'error', write: () => {} }),
      fetch: fetchFn,
    });

    await sink.record(feedback);

    const [url, init] = (fetchFn.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:6006/v1/span_annotations?sync=false');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      data: [
        {
          span_id: '67f6740bbe1ddc3f',
          name: 'user verdict',
          annotator_kind: 'HUMAN',
          result: { label: 'rejected', score: 0 },
        },
      ],
    });
  });

  it('never fails the user: Phoenix down is a warning in the logs', async () => {
    const lines: string[] = [];
    const sink = createPhoenixFeedback({
      endpoint: 'http://localhost:6006',
      logger: createLogger({ level: 'warn', write: (l) => lines.push(l) }),
      fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });

    await expect(sink.record(feedback)).resolves.toBeUndefined();
    expect(lines.join('')).toMatch(/could not record feedback/);
  });
});
