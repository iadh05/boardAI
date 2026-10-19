import { describe, expect, it } from 'vitest';
import type { ChatInput, LlmMessage, ProviderChunk } from '../types.ts';
import { createScenarioProvider, ScenarioFileSchema, type ScenarioFile } from './scenario.ts';

const file: ScenarioFile = ScenarioFileSchema.parse({
  scenarios: [
    {
      name: 'missing-cache',
      when: 'review',
      rounds: [
        [
          { type: 'text', delta: 'Every read hits Postgres. ' },
          {
            type: 'toolCall',
            name: 'add_node',
            arguments: { kind: 'cache', label: 'Cache', near: 'n3' },
          },
        ],
        [{ type: 'toolCall', name: 'connect_nodes', arguments: { source: 'n3', target: 'n5' } }],
        [{ type: 'text', delta: 'I propose a cache in front of Postgres.' }],
      ],
    },
    {
      name: 'model-down',
      when: 'fail',
      rounds: [[{ type: 'error', code: 'UNAVAILABLE', message: 'down' }]],
    },
  ],
});

const provider = createScenarioProvider(file);

const ask = async (messages: LlmMessage[]) => {
  const input: ChatInput & { signal: AbortSignal } = {
    messages,
    signal: new AbortController().signal,
  };
  const chunks: ProviderChunk[] = [];
  for await (const chunk of provider.stream(input)) chunks.push(chunk);
  return chunks;
};

const user = (content: string): LlmMessage => ({ role: 'user', content });
const toolRound = (id: string): LlmMessage[] => [
  { role: 'assistant', content: '', toolCalls: [{ id, name: 'x', arguments: {} }] },
  { role: 'tool', toolCallId: id, content: 'ok' },
];

describe('scenario provider', () => {
  it('picks the scenario whose trigger is in the latest user message, and plays its first round', async () => {
    const chunks = await ask([
      { role: 'system', content: 'You review.' },
      user('<board>…</board>\n\nPlease REVIEW my design'),
    ]);

    expect(chunks).toEqual([
      { type: 'text', delta: 'Every read hits Postgres. ' },
      {
        type: 'toolCall',
        call: {
          id: 'call_1_1',
          name: 'add_node',
          arguments: { kind: 'cache', label: 'Cache', near: 'n3' },
        },
      },
    ]);
  });

  it('matches the user’s question, not the board listing that comes with it', async () => {
    // The agent sends the board in the same message; a label must not pick the scenario.
    const chunks = ask([user('<board>\nn1 [custom] "Review queue"\n</board>\n\nPlease fail')]);
    await expect(chunks).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('knows the round from the conversation itself: no state, so parallel tests cannot interfere', async () => {
    const second = await ask([user('review'), ...toolRound('call_1_1')]);
    const third = await ask([user('review'), ...toolRound('call_1_1'), ...toolRound('call_2_1')]);

    expect(second).toEqual([
      {
        type: 'toolCall',
        call: { id: 'call_2_1', name: 'connect_nodes', arguments: { source: 'n3', target: 'n5' } },
      },
    ]);
    expect(third).toEqual([{ type: 'text', delta: 'I propose a cache in front of Postgres.' }]);
  });

  it('counts rounds from the latest user message, so a new question starts the scenario again', async () => {
    const chunks = await ask([
      user('review'),
      ...toolRound('a'),
      { role: 'assistant', content: 'Done.' },
      user('review again'),
    ]);
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Every read hits Postgres. ' });
  });

  it('answers nothing more once the scenario is over (the model stops)', async () => {
    const rounds = [user('review'), ...toolRound('a'), ...toolRound('b'), ...toolRound('c')];
    expect(await ask(rounds)).toEqual([]);
  });

  it('can fail like a real provider', async () => {
    await expect(ask([user('please fail')])).rejects.toMatchObject({
      name: 'LlmError',
      code: 'UNAVAILABLE',
    });
  });

  it('says plainly when no scenario matches, instead of failing', async () => {
    const chunks = await ask([user('hello there')]);
    expect(chunks).toEqual([
      { type: 'text', delta: expect.stringMatching(/no scenario matches/i) as unknown },
    ]);
  });
});

describe('ScenarioFileSchema', () => {
  it('allows a catch-all (empty trigger) only as the last scenario: it would hide the others', () => {
    const rounds = [[{ type: 'text', delta: 'x' }]];
    expect(
      ScenarioFileSchema.safeParse({
        scenarios: [
          { name: 'any', when: '', rounds },
          { name: 'review', when: 'review', rounds },
        ],
      }).success,
    ).toBe(false);
    expect(
      ScenarioFileSchema.safeParse({
        scenarios: [
          { name: 'review', when: 'review', rounds },
          { name: 'any', when: '', rounds },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects a file with a mistake, so the server refuses to start with it', () => {
    const bad = ScenarioFileSchema.safeParse({
      scenarios: [{ name: 'x', when: 'y', rounds: [[{ type: 'toolCall', name: 'add_node' }]] }],
    });
    expect(bad.success).toBe(false);
  });
});
