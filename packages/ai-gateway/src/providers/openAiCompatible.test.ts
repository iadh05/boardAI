import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '../errors.ts';
import type { ChatInput, ProviderChunk } from '../types.ts';
import { createOpenAiCompatibleProvider } from './openAiCompatible.ts';

// Recorded from Ollama by scripts/record-fixture.ts (M1-15), except the "split" one: OpenAI and
// Azure send tool-call arguments in pieces, Ollama doesn't, so that one is written by hand.
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.sse`, import.meta.url), 'utf8');

/** A fetch that answers with this body, cut into 50-byte pieces like a real network. */
const replying = (body: string, init: ResponseInit = { status: 200 }) =>
  vi.fn<typeof fetch>(() => {
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 50) controller.enqueue(bytes.slice(i, i + 50));
        controller.close();
      },
    });
    return Promise.resolve(new Response(stream, init));
  });

const input: ChatInput & { signal: AbortSignal } = {
  messages: [{ role: 'user', content: 'Review my design' }],
  signal: new AbortController().signal,
};

const drain = async (stream: AsyncIterable<ProviderChunk>) => {
  const chunks: ProviderChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

const run = async (fetchFn: typeof fetch, chatInput = input) => {
  const provider = createOpenAiCompatibleProvider({
    baseUrl: 'http://localhost:11434/v1',
    model: 'designroom-qwen',
    fetch: fetchFn,
  });
  return drain(provider.stream(chatInput));
};

const textOf = (chunks: ProviderChunk[]) =>
  chunks.map((c) => (c.type === 'text' ? c.delta : '')).join('');

const failure = async (fetchFn: typeof fetch) => {
  try {
    await run(fetchFn);
  } catch (error) {
    return error;
  }
  throw new Error('expected the stream to fail');
};

describe('openAiCompatible provider — reading the stream', () => {
  it('streams text deltas, then the token counts', async () => {
    const chunks = await run(replying(fixture('openai-text-only')));

    expect(textOf(chunks)).toMatch(/cache/i);
    expect(chunks.filter((c) => c.type === 'text').length).toBeGreaterThan(5);
    expect(chunks.at(-1)).toEqual({ type: 'tokens', inputTokens: 26, outputTokens: 39 });
  });

  it('turns a tool call into a toolCall chunk with parsed arguments', async () => {
    const chunks = await run(replying(fixture('openai-tool-call')));

    expect(chunks.filter((c) => c.type === 'toolCall')).toEqual([
      {
        type: 'toolCall',
        call: {
          id: 'call_tgl52jpx',
          name: 'add_node',
          arguments: { kind: 'cache', label: 'Redis' },
        },
      },
    ]);
    expect(textOf(chunks)).toMatch(/^I propose adding a cache/);
    expect(chunks.at(-1)).toEqual({ type: 'tokens', inputTokens: 368, outputTokens: 56 });
  });

  it('never passes the model’s thinking off as the answer', async () => {
    const chunks = await run(replying(fixture('openai-tool-call-thinking')));

    expect(textOf(chunks)).not.toMatch(/The user/); // the thinking starts with "The user…"
    expect(chunks.filter((c) => c.type === 'toolCall')).toHaveLength(1);
  });

  it('assembles tool-call arguments that arrive in pieces, two calls interleaved', async () => {
    const chunks = await run(replying(fixture('openai-tool-call-split')));

    expect(chunks).toEqual([
      {
        type: 'toolCall',
        call: { id: 'call_a', name: 'add_node', arguments: { kind: 'cache', label: 'Cache' } },
      },
      {
        type: 'toolCall',
        call: { id: 'call_b', name: 'connect_nodes', arguments: { source: 'n3', target: 'n5' } },
      },
      { type: 'tokens', inputTokens: 120, outputTokens: 30 },
    ]);
  });

  it('keeps arguments that are not valid JSON as raw text, for the caller to reject', async () => {
    const body =
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"add_node","arguments":"{kind: cache"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n';
    const chunks = await run(replying(body));

    expect(chunks).toContainEqual({
      type: 'toolCall',
      call: { id: 'c', name: 'add_node', arguments: '{kind: cache' },
    });
  });

  it('gives a tool call an id when the provider sent none, so the reply can refer to it', async () => {
    const body =
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"n","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n';
    expect(await run(replying(body))).toEqual([
      { type: 'toolCall', call: { id: 'call_0', name: 'n', arguments: {} } },
    ]);
  });

  it('still delivers tool calls when the stream ends without a finish reason', async () => {
    const body =
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"n","arguments":"{}"}}]},"finish_reason":null}]}\n\ndata: [DONE]\n\n';
    expect(await run(replying(body))).toEqual([
      { type: 'toolCall', call: { id: 'c', name: 'n', arguments: {} } },
    ]);
  });
});

describe('openAiCompatible provider — the request', () => {
  it('posts a streaming chat request with thinking off, usage on, and our message shapes', async () => {
    const fetchFn = replying('data: [DONE]\n\n');
    const signal = new AbortController().signal;
    await run(fetchFn, {
      signal,
      model: 'other-model',
      tools: [{ name: 'add_node', description: 'Add a node', parameters: { type: 'object' } }],
      messages: [
        { role: 'system', content: 'You review designs.' },
        { role: 'user', content: 'Review it' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_a', name: 'add_node', arguments: { kind: 'cache' } }],
        },
        { role: 'tool', toolCallId: 'call_a', content: 'added node n5' },
      ],
    });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(signal);
    expect(JSON.parse(init?.body as string)).toEqual({
      model: 'other-model',
      stream: true,
      stream_options: { include_usage: true },
      // The only switch that turns Qwen3.5's thinking off on this endpoint (M1-15 spike).
      reasoning_effort: 'none',
      messages: [
        { role: 'system', content: 'You review designs.' },
        { role: 'user', content: 'Review it' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_a',
              type: 'function',
              function: { name: 'add_node', arguments: '{"kind":"cache"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_a', content: 'added node n5' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'add_node', description: 'Add a node', parameters: { type: 'object' } },
        },
      ],
    });
  });

  it('uses its default model, sends the API key, and can leave thinking alone', async () => {
    const fetchFn = replying('data: [DONE]\n\n');
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'https://example.test/v1/',
      model: 'gpt-x',
      apiKey: 'secret',
      disableThinking: false,
      fetch: fetchFn,
    });
    await drain(provider.stream(input));

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.model).toBe('gpt-x');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('temperature'); // the model's own default (Modelfile)
  });

  it('sends the temperature a call asks for: 0 for a classifier that must answer the same', async () => {
    const fetchFn = replying('data: [DONE]\n\n');
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      model: 'm',
      fetch: fetchFn,
    });
    await drain(provider.stream({ ...input, temperature: 0 }));

    const [, init] = fetchFn.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toMatchObject({ temperature: 0 });
  });
});

describe('openAiCompatible provider — failures', () => {
  it('says the model is unreachable when the connection fails (transient)', async () => {
    const error = await failure(
      vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed'))),
    );
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'UNAVAILABLE', transient: true });
    expect((error as LlmError).message).toMatch(/Can't reach the model/);
  });

  it.each([429, 500, 503])('treats HTTP %i as transient', async (status) => {
    expect(await failure(replying('busy', { status }))).toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('treats other 4xx as a bad request, with the provider’s message', async () => {
    const body = JSON.stringify({ error: { message: 'model "designroom-qwen" not found' } });
    const error = await failure(replying(body, { status: 404 }));
    expect(error).toMatchObject({ code: 'BAD_REQUEST', transient: false });
    expect((error as LlmError).message).toMatch(/not found/);
  });

  it('reports a chunk it cannot read', async () => {
    expect(await failure(replying('data: {not json\n\n'))).toMatchObject({ code: 'BAD_RESPONSE' });
    expect(await failure(replying('data: {"choices":"nope"}\n\n'))).toMatchObject({
      code: 'BAD_RESPONSE',
    });
  });

  it('passes on the provider’s own message when it streams an error event', async () => {
    const body =
      'data: {"choices":[{"index":0,"delta":{"content":"Start"}}]}\n\ndata: {"error":{"message":"model runner has unexpectedly stopped"}}\n\n';
    const error = await failure(replying(body));
    expect(error).toMatchObject({ code: 'UNAVAILABLE' });
    expect((error as LlmError).message).toMatch(/unexpectedly stopped/);
  });

  it('reports a successful status with no body as an unreadable response', async () => {
    const error = await failure(vi.fn<typeof fetch>(() => Promise.resolve(new Response(null))));
    expect(error).toMatchObject({ code: 'BAD_RESPONSE', transient: false });
  });

  it('reports a connection that drops mid-stream as transient', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
          controller.error(new TypeError('terminated'));
        },
      });
      return Promise.resolve(new Response(stream));
    });
    expect(await failure(fetchFn)).toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('reports a cancelled call as aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.reject(new DOMException('aborted', 'AbortError')),
    );
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'http://x/v1',
      model: 'm',
      fetch: fetchFn,
    });
    await expect(
      drain(provider.stream({ ...input, signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });
});
