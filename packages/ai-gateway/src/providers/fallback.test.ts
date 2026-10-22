import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '../errors.ts';
import type { ChatInput, LlmProvider, ProviderChunk } from '../types.ts';
import { createFallbackProvider } from './fallback.ts';

// A hosted model with the local one behind it (AV2-04, D13): offline, rate-limited past the wait,
// budget spent or key wrong — the local model answers instead of the request failing.

const input: ChatInput & { signal: AbortSignal } = {
  messages: [{ role: 'user', content: 'Review my design' }],
  signal: new AbortController().signal,
};

const answering = (...chunks: ProviderChunk[]): LlmProvider => ({
  async *stream() {
    await Promise.resolve();
    yield* chunks;
  },
});

const failing = (error: LlmError, ...before: ProviderChunk[]): LlmProvider => ({
  async *stream() {
    await Promise.resolve();
    yield* before;
    throw error;
  },
});

const drain = async (provider: LlmProvider) => {
  const chunks: ProviderChunk[] = [];
  for await (const chunk of provider.stream(input)) chunks.push(chunk);
  return chunks;
};

const local = answering({ type: 'text', delta: 'local' });

describe('createFallbackProvider', () => {
  it('the primary answers when it can: the fallback is never called', async () => {
    const fallback = {
      stream: vi.fn((input: Parameters<LlmProvider['stream']>[0]) => local.stream(input)),
    };
    const chunks = await drain(
      createFallbackProvider(answering({ type: 'text', delta: 'hosted' }), fallback),
    );
    expect(chunks).toEqual([{ type: 'text', delta: 'hosted' }]);
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it.each([
    ['unavailable (offline, 429 past the wait)', new LlmError('UNAVAILABLE', 'down')],
    ['a bad request (budget spent, wrong key)', new LlmError('BAD_REQUEST', 'budget spent')],
    ['an unreadable answer', new LlmError('BAD_RESPONSE', 'garbled')],
  ])('the primary fails before answering — %s: the fallback answers', async (_, error) => {
    const onFallback = vi.fn();
    const chunks = await drain(createFallbackProvider(failing(error), local, { onFallback }));

    expect(chunks).toEqual([{ type: 'text', delta: 'local' }]);
    expect(onFallback).toHaveBeenCalledWith(error);
  });

  it('once the primary has answered part, its failure stands: the user would read two answers', async () => {
    const error = new LlmError('UNAVAILABLE', 'dropped');
    const provider = createFallbackProvider(failing(error, { type: 'text', delta: 'Half' }), local);

    await expect(drain(provider)).rejects.toBe(error);
  });

  it('a cancelled call is not retried elsewhere: nobody wants the answer', async () => {
    const fallback = {
      stream: vi.fn((input: Parameters<LlmProvider['stream']>[0]) => local.stream(input)),
    };
    const provider = createFallbackProvider(
      failing(new LlmError('ABORTED', 'cancelled')),
      fallback,
    );

    await expect(drain(provider)).rejects.toMatchObject({ code: 'ABORTED' });
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it('a timeout falls back too: a hosted model that went silent', async () => {
    const chunks = await drain(
      createFallbackProvider(failing(new LlmError('TIMEOUT', 'silent')), local),
    );
    expect(chunks).toEqual([{ type: 'text', delta: 'local' }]);
  });

  // Review of AV2-04: the gateway's idle timeout aborts the call, which looked like a cancel, so a
  // hosted model that never answered never fell back. The fallback keeps its own first-chunk clock.
  it('a hosted model silent past the first-chunk deadline is cut off, and the local one answers', async () => {
    let fire = () => undefined as void;
    const silent: LlmProvider = {
      async *stream({ signal }) {
        await new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new LlmError('ABORTED', 'cancelled')));
          fire(); // the deadline passes while it says nothing
        });
        yield { type: 'text', delta: 'never' };
      },
    };
    const onFallback = vi.fn();

    const chunks = await drain(
      createFallbackProvider(silent, local, {
        firstChunkMs: 15_000,
        timer: (_ms, f) => {
          fire = f;
          return () => undefined;
        },
        onFallback,
      }),
    );

    expect(chunks).toEqual([{ type: 'text', delta: 'local' }]);
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ code: 'TIMEOUT' }));
  });

  it('the caller cancelling is still a cancel, deadline or not', async () => {
    const stop = new AbortController();
    const fallback = {
      stream: vi.fn((input: Parameters<LlmProvider['stream']>[0]) => local.stream(input)),
    };
    const waiting: LlmProvider = {
      async *stream({ signal }) {
        await new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new LlmError('ABORTED', 'cancelled')));
          stop.abort();
        });
        yield { type: 'text', delta: 'never' };
      },
    };
    const provider = createFallbackProvider(waiting, fallback, {
      firstChunkMs: 15_000,
      timer: () => () => undefined,
    });

    const chunks: ProviderChunk[] = [];
    await expect(async () => {
      for await (const c of provider.stream({ ...input, signal: stop.signal })) chunks.push(c);
    }).rejects.toMatchObject({ code: 'ABORTED' });
    expect(fallback.stream).not.toHaveBeenCalled();
  });
});
