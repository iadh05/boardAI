import { createFakeProvider } from '@designroom/ai-gateway';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './core/logger.ts';
import { createApp } from './main.ts';

const config = {
  port: 3000,
  llm: { provider: 'fake', model: 'test', timeoutMs: 5_000, contextTokens: 16_384 },
  logLevel: 'info',
  errorTracking: null,
  telemetry: null,
  traceContent: false,
  debugRoutes: false,
  llmCallLog: null,
} as const;
const logger = createLogger({ level: 'error', write: () => {} });
const app = createApp({ config, logger });

describe('createApp', () => {
  it('has no debug routes unless ENABLE_DEBUG_ROUTES turns them on', async () => {
    expect((await app.request('/api/debug/boom')).status).toBe(404);
  });

  it('with debug routes on, /api/debug/boom is a real bug: a bland 500, and reported', async () => {
    const reported: unknown[] = [];
    const debugApp = createApp({
      config: { ...config, debugRoutes: true },
      logger,
      reporter: { report: (error) => reported.push(error) },
    });

    const res = await debugApp.request('/api/debug/boom');

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'INTERNAL' } }); // nothing leaks
    expect(reported).toHaveLength(1);
    expect(String(reported[0])).toMatch(/on purpose/);
  });

  it('answers the health check', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('answers an unknown route with the shared error shape', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('echoes the request id (from Nginx, or a new one) so logs and traces can be joined', async () => {
    // Nginx's $request_id: 32 hex characters.
    const id = '3f2a9c1e7b4d4e8f9a0b1c2d3e4f5a6b';
    const given = await app.request('/api/health', { headers: { 'X-Request-Id': id } });
    expect(given.headers.get('X-Request-Id')).toBe(id);
    const fresh = await app.request('/api/health');
    expect(fresh.headers.get('X-Request-Id')).toMatch(/^[\w-]{8,}$/);
  });

  it('replaces a request id that is not a plain token (it ends up in the logs)', async () => {
    const res = await app.request('/api/health', {
      headers: { 'X-Request-Id': 'x" injected="yes' },
    });
    expect(res.headers.get('X-Request-Id')).not.toContain('injected');
  });

  it('wires the chat: gateway → agent → module, streaming the model’s answer', async () => {
    const lines: string[] = [];
    const chatApp = createApp({
      config,
      logger: createLogger({ level: 'info', write: (l) => lines.push(l) }),
      // First the scope guard's call ("is this about the design?"), then the review itself.
      llmProvider: createFakeProvider([
        [{ type: 'text', delta: 'DESIGN' }],
        [{ type: 'text', delta: 'Add a cache.' }],
      ]),
    });

    const res = await chatApp.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        board: { nodes: [], edges: [] },
        messages: [{ role: 'user', content: 'Review it' }],
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('data: {"type":"text","delta":"Add a cache."}');
    expect(text.trim().endsWith('data: {"type":"done"}')).toBe(true);

    // The chat's own log lines carry the request id, so they join the access log and Nginx's.
    const requestId = res.headers.get('X-Request-Id');
    const round = lines
      .map((l) => JSON.parse(l) as { msg: string; requestId?: string })
      .find((l) => l.msg === 'agent round');
    expect(round?.requestId).toBe(requestId);
  });

  it('with LLM_CALL_LOG, records each model call of a review under its request id (M1-28)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'designroom-')), 'calls.jsonl');
    const loggingApp = createApp({
      config: { ...config, llmCallLog: file },
      logger,
      llmProvider: createFakeProvider([
        [{ type: 'text', delta: 'DESIGN' }],
        [
          { type: 'text', delta: 'Looks fine.' },
          // Every answer ends with a tool call (M1-31): here, nothing to change.
          {
            type: 'toolCall',
            call: { id: 'c1', name: 'no_change', arguments: { reason: 'The design fits.' } },
          },
        ],
      ]),
    });

    const res = await loggingApp.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        board: { nodes: [], edges: [] },
        messages: [{ role: 'user', content: 'Review it' }],
      }),
    });
    await res.text();

    // Written after each call ends, without blocking the answer: wait for both lines.
    const read = () =>
      existsSync(file)
        ? readFileSync(file, 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l) as { requestId: string; output: { text: string } })
        : [];
    await vi.waitFor(() => expect(read()).toHaveLength(2));
    const [scope, review] = read();
    expect(scope?.output.text).toBe('DESIGN'); // the scope guard's call is recorded too
    expect(review?.output.text).toBe('Looks fine.');
    expect(new Set(read().map((r) => r.requestId))).toEqual(
      new Set([res.headers.get('X-Request-Id')]),
    );
  });
});
