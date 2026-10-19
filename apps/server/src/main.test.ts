import { createFakeProvider } from '@designroom/ai-gateway';
import { describe, expect, it } from 'vitest';
import { createLogger } from './core/logger.ts';
import { createApp } from './main.ts';

const config = {
  port: 3000,
  llm: { provider: 'fake', model: 'test', timeoutMs: 5_000 },
  logLevel: 'info',
} as const;
const logger = createLogger({ level: 'error', write: () => {} });
const app = createApp({ config, logger });

describe('createApp', () => {
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
    const chatApp = createApp({
      config,
      logger,
      llmProvider: createFakeProvider([[{ type: 'text', delta: 'Add a cache.' }]]),
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
  });
});
