import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { LlmError } from '../errors.ts';
import type { ChatInput, ProviderChunk } from '../types.ts';
import { createAnthropicProvider, type AnthropicOptions } from './anthropic.ts';

// Claude through the official SDK (AV2-03). The SDK's own HTTP calls are replayed from a stream
// recorded from claude-haiku-5-5 (2026-10-21), so what is tested is the real SDK parsing it.

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.sse`, import.meta.url), 'utf8');

const replying = (body: string, init: ResponseInit = { status: 200 }) =>
  vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(body, {
        ...init,
        headers: { 'content-type': 'text/event-stream', ...(init.headers ?? {}) },
      }),
    ),
  );

const input: ChatInput & { signal: AbortSignal } = {
  messages: [
    { role: 'system', content: 'You review designs.' },
    { role: 'user', content: 'Review my design' },
  ],
  tools: [
    {
      name: 'add_node',
      description: 'Propose a component.',
      parameters: { type: 'object', properties: { kind: { type: 'string' } } },
    },
  ],
  signal: new AbortController().signal,
};

const provider = (fetchFn: typeof fetch, options: Partial<AnthropicOptions> = {}) =>
  createAnthropicProvider({
    apiKey: 'test-key',
    model: 'claude-haiku-5-5',
    fetch: fetchFn,
    ...options,
  });

const run = async (
  fetchFn: typeof fetch,
  chatInput = input,
  options?: Partial<AnthropicOptions>,
) => {
  const chunks: ProviderChunk[] = [];
  for await (const chunk of provider(fetchFn, options).stream(chatInput)) chunks.push(chunk);
  return chunks;
};

const failure = async (fetchFn: typeof fetch) => {
  try {
    await run(fetchFn);
  } catch (error) {
    return error;
  }
  throw new Error('expected the stream to fail');
};

/** The JSON body the SDK posted. */
const posted = (fetchFn: ReturnType<typeof replying>) =>
  JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;

describe('anthropic provider — reading the stream', () => {
  it('streams the text, then the tool call with its parsed input, then the token counts', async () => {
    const chunks = await run(replying(fixture('claude-tool-call')));

    const text = chunks.map((c) => (c.type === 'text' ? c.delta : '')).join('');
    expect(text).toBe(
      "Every request hitting Postgres directly is a read bottleneck, so I'll add a cache in front of it.",
    );
    expect(chunks.filter((c) => c.type === 'toolCall')).toEqual([
      {
        type: 'toolCall',
        call: {
          id: 'toolu_01MtSpWAGXCzBEXFdcPMx5KJ',
          name: 'add_node',
          arguments: { kind: 'cache', label: expect.any(String) as unknown },
        },
      },
    ]);
    expect(chunks.at(-1)).toEqual({ type: 'tokens', inputTokens: 456, outputTokens: 116 });
  });

  it('drops a tool call cut off by the token limit: its input may be incomplete', async () => {
    const cut = fixture('claude-tool-call').replace(
      '"stop_reason":"tool_use"',
      '"stop_reason":"max_tokens"',
    );
    const chunks = await run(replying(cut));
    expect(chunks.filter((c) => c.type === 'toolCall')).toEqual([]);
  });

  it('a refusal is an error the user can read, not an empty answer', async () => {
    const refused = fixture('claude-tool-call').replace(
      '"stop_reason":"tool_use"',
      '"stop_reason":"refusal"',
    );
    const error = await failure(replying(refused));
    expect(error).toMatchObject({ code: 'BAD_RESPONSE' });
    expect((error as LlmError).message).toMatch(/declined/);
  });
});

describe('anthropic provider — the request', () => {
  it('sends the system prompt apart, our tools as input_schema, and tool results as one user turn', async () => {
    const fetchFn = replying(fixture('claude-tool-call'));

    await run(fetchFn, {
      ...input,
      messages: [
        { role: 'system', content: 'You review designs.' },
        { role: 'user', content: 'Add a cache' },
        {
          role: 'assistant',
          content: 'Adding one.',
          toolCalls: [
            { id: 'toolu_a', name: 'add_node', arguments: { kind: 'cache' } },
            { id: 'toolu_b', name: 'connect_nodes', arguments: { source: 'n1' } },
          ],
        },
        { role: 'tool', toolCallId: 'toolu_a', content: 'added n3' },
        { role: 'tool', toolCallId: 'toolu_b', content: 'connected' },
        { role: 'user', content: '[format error] …' },
      ],
    });

    const body = posted(fetchFn);
    expect(body).toMatchObject({
      model: 'claude-haiku-5-5',
      system: 'You review designs.',
      tools: [
        { name: 'add_node', description: 'Propose a component.', input_schema: { type: 'object' } },
      ],
      messages: [
        { role: 'user', content: 'Add a cache' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Adding one.' },
            { type: 'tool_use', id: 'toolu_a', name: 'add_node', input: { kind: 'cache' } },
            { type: 'tool_use', id: 'toolu_b', name: 'connect_nodes', input: { source: 'n1' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_a', content: 'added n3' },
            { type: 'tool_result', tool_use_id: 'toolu_b', content: 'connected' },
            { type: 'text', text: '[format error] …' },
          ],
        },
      ],
    });
  });

  it('turns thinking off the way each model takes it: Haiku "disabled", Sonnet "between_tools"', async () => {
    const haiku = replying(fixture('claude-tool-call'));
    await run(haiku);
    expect(posted(haiku)).toMatchObject({
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
    });

    const sonnet = replying(fixture('claude-tool-call'));
    await run(sonnet, input, { model: 'claude-sonnet-5-5' });
    expect(posted(sonnet)).toMatchObject({
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low' },
    });
  });

  it('thinking on: adaptive, with the effort asked for', async () => {
    const fetchFn = replying(fixture('claude-tool-call'));
    await run(fetchFn, input, { thinking: { effort: 'medium' } });
    expect(posted(fetchFn)).toMatchObject({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    });
  });

  it('only Haiku and Sonnet (the owner’s rule, $100 budget)', () => {
    expect(() => provider(replying(''), { model: 'claude-opus-5-5' })).toThrow(
      /claude-haiku-5-5, claude-sonnet-5-5/,
    );
  });
});

describe('anthropic provider — failures', () => {
  const answering = (status: number, headers: Record<string, string> = {}) =>
    replying(JSON.stringify({ type: 'error', error: { type: 'x', message: `status ${status}` } }), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('429 is transient and carries the wait it asks for', async () => {
    expect(await failure(answering(429, { 'retry-after': '12' }))).toMatchObject({
      code: 'UNAVAILABLE',
      retryAfterMs: 12_000,
    });
  });

  it('529 (overloaded) and 5xx are transient', async () => {
    expect(await failure(answering(529))).toMatchObject({ code: 'UNAVAILABLE' });
    expect(await failure(answering(500))).toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('400 and 401 are bad requests: retrying won’t help', async () => {
    expect(await failure(answering(400))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await failure(answering(401))).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a network failure is transient', async () => {
    const down = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));
    expect(await failure(down)).toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('a cancelled call is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const chunks = run(replying(fixture('claude-tool-call')), {
      ...input,
      signal: controller.signal,
    });
    await expect(chunks).rejects.toMatchObject({ code: 'ABORTED' });
  });
});

describe('anthropic provider — spend guard', () => {
  it('refuses a call once the day’s budget is spent, before sending it', async () => {
    const fetchFn = replying(fixture('claude-tool-call'));
    // Haiku: 456 in × $0.10/M + 116 out × $0.50/M ≈ $0.000104 per call.
    const options = { dailyBudgetUsd: 0.0001, now: () => 0 };
    const guarded = provider(fetchFn, options);

    for await (const _ of guarded.stream(input)) void _;
    const second = async () => {
      for await (const _ of guarded.stream(input)) void _;
    };

    await expect(second()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(second()).rejects.toThrow(/budget/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a new day starts a new budget', async () => {
    let t = 0;
    const fetchFn = replying(fixture('claude-tool-call'));
    const guarded = provider(fetchFn, { dailyBudgetUsd: 0.0001, now: () => t });

    for await (const _ of guarded.stream(input)) void _;
    t = 24 * 60 * 60 * 1000;
    fetchFn.mockImplementation(() =>
      Promise.resolve(
        new Response(fixture('claude-tool-call'), {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    );
    for await (const _ of guarded.stream(input)) void _;

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
