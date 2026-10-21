import type { AiGateway, ChatInput, LlmChunk } from '@designroom/ai-gateway';
import { describe, expect, it } from 'vitest';
import { recordLlmCalls, type LlmCallRecord } from './llmCallLog.ts';

const usage = {
  inputTokens: 100,
  outputTokens: 20,
  latencyMs: 5,
  timeToFirstTokenMs: 1,
  attempts: 1,
};

/** A model that answers with these chunks, or fails after them. */
const model = (chunks: LlmChunk[], fail?: Error): AiGateway => ({
  async *chat() {
    for (const chunk of chunks) {
      await Promise.resolve(); // a real model's chunks arrive asynchronously
      yield chunk;
    }
    if (fail) throw fail;
  },
});

const input: ChatInput = {
  messages: [
    { role: 'system', content: 'You are a reviewer.' },
    { role: 'user', content: 'Review my design.' },
  ],
  tools: [{ name: 'add_node', description: 'adds', parameters: {} }],
  temperature: 0,
};

const record = async (llm: AiGateway) => {
  const records: LlmCallRecord[] = [];
  let clock = 1000;
  const recorded = recordLlmCalls(llm, {
    write: (r) => records.push(r),
    now: () => (clock += 250),
    requestId: () => 'req-1',
  });
  const seen: LlmChunk[] = [];
  let error: unknown;
  try {
    for await (const chunk of recorded.chat(input)) seen.push(chunk);
  } catch (e) {
    error = e;
  }
  return { records, seen, error };
};

describe('recording model calls (M1-28)', () => {
  it('records exactly what was sent and what came back, and passes the answer through', async () => {
    const chunks: LlmChunk[] = [
      { type: 'text', delta: 'Add a ' },
      { type: 'text', delta: 'cache.' },
      { type: 'toolCall', call: { id: 'c1', name: 'add_node', arguments: { kind: 'cache' } } },
      { type: 'usage', usage },
    ];
    const { records, seen } = await record(model(chunks));

    expect(seen).toEqual(chunks); // the caller sees the same stream
    expect(records).toEqual([
      {
        time: new Date(1250).toISOString(),
        requestId: 'req-1',
        temperature: 0,
        tools: ['add_node'],
        messages: input.messages,
        output: {
          text: 'Add a cache.',
          toolCalls: [{ id: 'c1', name: 'add_node', arguments: { kind: 'cache' } }],
        },
        usage,
        ms: 250,
      },
    ]);
  });

  it('records a failed call with its error, and still throws it', async () => {
    const { records, error } = await record(
      model([{ type: 'text', delta: 'Partial' }], new Error('model down')),
    );
    expect(error).toEqual(new Error('model down'));
    expect(records[0]).toMatchObject({ output: { text: 'Partial' }, error: 'model down' });
  });

  it('records a call the caller stopped reading (the user pressed Stop)', async () => {
    const recorded: LlmCallRecord[] = [];
    const llm = recordLlmCalls(
      model([
        { type: 'text', delta: 'One' },
        { type: 'text', delta: 'Two' },
      ]),
      { write: (r) => recorded.push(r), now: () => 0, requestId: () => null },
    );
    for await (const chunk of llm.chat(input)) {
      expect(chunk).toEqual({ type: 'text', delta: 'One' });
      break;
    }
    expect(recorded[0]).toMatchObject({ requestId: null, output: { text: 'One' }, stopped: true });
  });
});
