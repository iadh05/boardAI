import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '../errors.ts';
import type { ChatInput, ProviderChunk } from '../types.ts';
import { createOpenAiCompatibleProvider } from './openAiCompatible.ts';

// The OpenAI format as Gemini and Groq speak it (AV2-02). Each vendor differs a little; the
// gateway hides it, so the agent sees one format whichever model answers.

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.sse`, import.meta.url), 'utf8');

const replying = (body: string, init: ResponseInit = { status: 200 }) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, init)));

const input: ChatInput & { signal: AbortSignal } = {
  messages: [{ role: 'user', content: 'Review my design' }],
  signal: new AbortController().signal,
};

const run = async (fetchFn: typeof fetch, chatInput = input) => {
  const provider = createOpenAiCompatibleProvider({
    baseUrl: 'https://example.test/v1',
    model: 'some-model',
    fetch: fetchFn,
  });
  const chunks: ProviderChunk[] = [];
  for await (const chunk of provider.stream(chatInput)) chunks.push(chunk);
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

/** The JSON body the provider posted (always a string: it calls JSON.stringify). */
const posted = (fetchFn: ReturnType<typeof replying>): unknown =>
  JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string);

const sentBody = (fetchFn: ReturnType<typeof replying>) =>
  posted(fetchFn) as { messages: { tool_calls?: { extra_content?: unknown }[] }[] };

describe('Gemini (recorded 2026-10-21, gemini-3.5-flash-lite)', () => {
  it('reads a tool call sent whole, without an index', async () => {
    const chunks = await run(replying(fixture('gemini-tool-call')));

    expect(chunks.filter((c) => c.type === 'toolCall')).toEqual([
      {
        type: 'toolCall',
        call: {
          id: 'call_135950',
          name: 'add_node',
          arguments: { label: 'Redis', kind: 'cache' },
          providerData: {
            extra_content: { google: { thought_signature: expect.any(String) as unknown } },
          },
        },
      },
    ]);
  });

  // Review of AV2-02: Gemini repeats the running usage on every chunk; added up, it counted twice.
  it('reports the token counts once, though Gemini repeats them on every chunk', async () => {
    const chunks = await run(replying(fixture('gemini-tool-call')));
    expect(chunks.filter((c) => c.type === 'tokens')).toEqual([
      { type: 'tokens', inputTokens: 91, outputTokens: 22 },
    ]);
  });

  it('sends the thought signature back with the call it came with', async () => {
    const fetchFn = replying(fixture('gemini-tool-call'));
    const providerData = { extra_content: { google: { thought_signature: 'sig-1' } } };

    await run(fetchFn, {
      ...input,
      messages: [
        { role: 'user', content: 'Add a cache' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'add_node', arguments: { kind: 'cache' }, providerData }],
        },
        { role: 'tool', toolCallId: 'c1', content: 'added n3' },
      ],
    });

    expect(sentBody(fetchFn).messages[1]?.tool_calls?.[0]).toMatchObject(providerData);
  });

  it('two whole calls in one chunk stay two calls', async () => {
    const body = `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { id: 'a', function: { name: 'add_node', arguments: '{"kind":"cache"}' } },
              { id: 'b', function: { name: 'connect_nodes', arguments: '{"source":"n1"}' } },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    })}\n\ndata: [DONE]\n\n`;

    const calls = (await run(replying(body))).filter((c) => c.type === 'toolCall');
    expect(calls.map((c) => c.type === 'toolCall' && c.call.id)).toEqual(['a', 'b']);
  });
});

// Groq checks tool arguments on its own server and ends the stream with an error instead of the
// call (measured 2026-10-21: 4 of 6 runs). Not reproduced on demand in 11 tries, so this event
// is written from Groq's documented error shape (code tool_use_failed, failed_generation).
const groqToolUseFailed = (failedGeneration: string) =>
  `data: ${JSON.stringify({
    error: {
      message:
        "tool call validation failed: parameters for tool add_node did not match schema: errors: [`/kind`: value must be one of 'client', 'cache']",
      type: 'invalid_request_error',
      code: 'tool_use_failed',
      failed_generation: failedGeneration,
    },
  })}\n\n`;

describe('Groq', () => {
  it('a call its server refused comes back as the call the model made, for our check to answer', async () => {
    const generated = JSON.stringify([
      { name: 'add_node', arguments: { kind: 'loadBalancr', label: 'LB' } },
    ]);

    const calls = (await run(replying(groqToolUseFailed(generated)))).filter(
      (c) => c.type === 'toolCall',
    );

    expect(calls).toEqual([
      {
        type: 'toolCall',
        call: {
          id: 'refused_0',
          name: 'add_node',
          arguments: { kind: 'loadBalancr', label: 'LB' },
        },
      },
    ]);
  });

  it('an unreadable failed generation still reaches our check, as raw text with the tool name', async () => {
    const calls = (
      await run(replying(groqToolUseFailed('<tool_call>add_node{kind: lb</tool_call>')))
    ).filter((c) => c.type === 'toolCall');

    expect(calls).toEqual([
      {
        type: 'toolCall',
        call: {
          id: 'refused_0',
          name: 'add_node',
          arguments: '<tool_call>add_node{kind: lb</tool_call>',
        },
      },
    ]);
  });

  // Measured: the history then held a call whose arguments were text, sent as a JSON string, and
  // Groq refused the next request ("cannot unmarshal string into map").
  it('sends a call whose arguments were not an object back as an object, so the history stays valid', async () => {
    const fetchFn = replying('data: [DONE]\n\n');

    await run(fetchFn, {
      ...input,
      messages: [
        { role: 'user', content: 'Add a cache' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'refused_0', name: 'add_node', arguments: '<tool_call>add_node{' }],
        },
        {
          role: 'tool',
          toolCallId: 'refused_0',
          content: 'add_node: arguments must be a JSON object',
        },
      ],
    });

    const call = sentBody(fetchFn).messages[1]?.tool_calls?.[0] as {
      function: { arguments: string };
    };
    expect(JSON.parse(call.function.arguments)).toEqual({ _raw: '<tool_call>add_node{' });
  });

  it('other error events stay errors', async () => {
    const error = await failure(replying('data: {"error":{"message":"over capacity"}}\n\n'));
    expect(error).toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('429: rate limited', () => {
  // Measured on Groq's free tier: Qwen3.8 allows 7,000 input tokens a minute, so a review's third
  // round is often refused with "Please try again in 4.38s".
  const limited = (headers: Record<string, string>, message: string) =>
    replying(JSON.stringify({ error: { message } }), { status: 429, headers });

  it('carries the wait the provider asked for, from the retry-after header', async () => {
    const error = await failure(limited({ 'retry-after': '7' }, 'Rate limit reached'));
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'UNAVAILABLE', retryAfterMs: 7000 });
  });

  it('or from the message when there is no header ("try again in 4.38s", "454.28ms")', async () => {
    expect(
      await failure(limited({}, 'Rate limit reached. Please try again in 4.38s. Need more?')),
    ).toMatchObject({ retryAfterMs: 4380 });
    // Groq's daily limits say minutes (review of AV2-02): read, so the gateway fails fast on them.
    expect(await failure(limited({}, 'Please try again in 1m2.5s.'))).toMatchObject({
      retryAfterMs: 62_500,
    });
    expect(
      await failure(limited({}, 'Please try again in 454.285714ms. Need more tokens?')),
    ).toMatchObject({ retryAfterMs: 455 });
  });

  it("reads Gemini's 429 (recorded): an array, its message, and RetryInfo's delay", async () => {
    const body = readFileSync(new URL('./fixtures/gemini-429.json', import.meta.url), 'utf8');
    const error = await failure(replying(body, { status: 429 }));

    expect(error).toMatchObject({ code: 'UNAVAILABLE', retryAfterMs: 31_000 });
    expect((error as LlmError).message).toMatch(/limit: 15, model: gemini-3\.5-flash-lite/);
  });

  it('no hint, no wait: the gateway uses its own backoff', async () => {
    const error = await failure(limited({}, 'Too many requests'));
    expect((error as LlmError).retryAfterMs).toBeUndefined();
  });
});

describe('thinking setting per model', () => {
  const withEffort = async (reasoningEffort: string | null | undefined) => {
    const fetchFn = replying('data: [DONE]\n\n');
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      fetch: fetchFn,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    });
    const chunks: ProviderChunk[] = [];
    for await (const chunk of provider.stream(input)) chunks.push(chunk);
    return posted(fetchFn) as Record<string, unknown>;
  };

  it('sends the effort the model takes ("low" for gpt-oss, which cannot turn thinking off)', async () => {
    expect(await withEffort('low')).toMatchObject({ reasoning_effort: 'low' });
  });

  it('null leaves it out (some Gemini models refuse "none")', async () => {
    expect(await withEffort(null)).not.toHaveProperty('reasoning_effort');
  });

  it('by default thinking stays off, as before', async () => {
    expect(await withEffort(undefined)).toMatchObject({ reasoning_effort: 'none' });
  });
});
