import { describe, expect, it } from 'vitest';
import { LlmError } from '../errors.ts';
import type { ChatInput, ProviderChunk } from '../types.ts';
import { createFakeProvider } from './fake.ts';

const input = (content: string): ChatInput & { signal: AbortSignal } => ({
  messages: [{ role: 'user', content }],
  signal: new AbortController().signal,
});

const drain = async (stream: AsyncIterable<ProviderChunk>) => {
  const chunks: ProviderChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

describe('fake provider', () => {
  it('replays a script: text, tool call, text, usage', async () => {
    const answer: ProviderChunk[] = [
      { type: 'text', delta: 'You need a cache.' },
      { type: 'toolCall', call: { id: 'c1', name: 'add_node', arguments: { kind: 'cache' } } },
      { type: 'text', delta: ' Added it.' },
      { type: 'tokens', inputTokens: 10, outputTokens: 5 },
    ];
    const fake = createFakeProvider([answer]);

    expect(await drain(fake.stream(input('review')))).toEqual(answer);
  });

  it('gives the next scripted answer on each call, and records what it was asked', async () => {
    const fake = createFakeProvider([
      [{ type: 'text', delta: 'first' }],
      [{ type: 'text', delta: 'second' }],
    ]);

    await drain(fake.stream(input('one')));
    const second = await drain(fake.stream(input('two')));

    expect(second).toEqual([{ type: 'text', delta: 'second' }]);
    expect(fake.calls.map((c) => c.messages[0]?.content)).toEqual(['one', 'two']);
  });

  it('fails where the script says so', async () => {
    const error = new LlmError('UNAVAILABLE', 'down');
    const fake = createFakeProvider([
      [
        { type: 'text', delta: 'partial' },
        { type: 'error', error },
      ],
    ]);

    const chunks: ProviderChunk[] = [];
    await expect(async () => {
      for await (const chunk of fake.stream(input('x'))) chunks.push(chunk);
    }).rejects.toBe(error);
    expect(chunks).toEqual([{ type: 'text', delta: 'partial' }]);
  });

  it('can hang until the call is cancelled', async () => {
    const fake = createFakeProvider([[{ type: 'hang' }]]);
    const controller = new AbortController();

    const result = drain(fake.stream({ ...input('x'), signal: controller.signal }));
    controller.abort();

    await expect(result).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('says clearly when a test scripted too few answers', async () => {
    const fake = createFakeProvider([]);
    await expect(drain(fake.stream(input('x')))).rejects.toThrow(/no scripted answer left/);
  });
});
