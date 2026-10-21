import { describe, expect, it, vi } from 'vitest';
import { sendFeedback } from './sendFeedback.ts';

const traced = {
  id: 'p1',
  summary: 'Add cache "Redis"',
  ops: [{ op: 'addNode' as const, nodeId: 'c', kind: 'cache' as const, label: 'Redis' }],
  traceId: '2adb8e295d202a612dc768b48ac1d3f4',
  spanId: '67f6740bbe1ddc3f',
};

describe('sendFeedback (M1-26c)', () => {
  it('posts the verdict with the proposal’s trace and span ids', () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));

    sendFeedback(fetchFn, traced, 'accepted');

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/chat/feedback');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      traceId: traced.traceId,
      spanId: traced.spanId,
      verdict: 'accepted',
    });
  });

  it('sends nothing for a proposal made without tracing (no ids)', () => {
    const fetchFn = vi.fn<typeof fetch>();
    const { traceId: _t, spanId: _s, ...untraced } = traced;

    sendFeedback(fetchFn, untraced, 'rejected');

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never bothers the user: a failed send is ignored', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('offline')));

    expect(() => sendFeedback(fetchFn, traced, 'rejected')).not.toThrow();
    await Promise.resolve(); // the rejection is handled, not left unhandled
  });
});
