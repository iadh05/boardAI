import type { AiGateway, ChatInput, LlmChunk, LlmErrorCode } from '@designroom/ai-gateway';
import { applyOps, type Board } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { OUT_OF_SCOPE_REPLY } from '../domain/scope.ts';
import { createAgent, type AgentEvent } from './runAgent.ts';

/** One step of a scripted round: a chunk, a gateway failure, or silence until cancelled. */
type Step = LlmChunk | { type: 'fail'; code: LlmErrorCode; message: string } | { type: 'hang' };

/** What the gateway throws, built the way the agent recognises it (it may not import the class). */
const llmError = (code: LlmErrorCode, message: string) =>
  Object.assign(new Error(message), { name: 'LlmError', code });

/** The AiGateway interface played from a script: each inner array is one round's answer. */
const scriptedLlm = (rounds: Step[][]) => {
  const calls: ChatInput[] = [];
  const llm: AiGateway = {
    async *chat(input) {
      calls.push(input);
      const round = rounds[calls.length - 1];
      if (!round) throw new Error(`no scripted round ${calls.length}`);
      for (const step of round) {
        await Promise.resolve();
        if (step.type === 'fail') throw llmError(step.code, step.message);
        if (step.type === 'hang')
          await new Promise((_, reject) => {
            const abort = () => reject(llmError('ABORTED', 'cancelled'));
            if (input.signal?.aborted) abort();
            else input.signal?.addEventListener('abort', abort);
          });
        else yield step;
      }
    },
  };
  return { llm, calls };
};

const board: Board = {
  nodes: [
    { id: 'uuid-api', kind: 'api', label: 'API', position: { x: 0, y: 0 } },
    { id: 'uuid-db', kind: 'database', label: 'Postgres', position: { x: 300, y: 0 } },
  ],
  edges: [{ id: 'e1', source: 'uuid-api', target: 'uuid-db' }],
};

const text = (delta: string): Step => ({ type: 'text', delta });
const tool = (id: string, name: string, args: unknown): Step => ({
  type: 'toolCall',
  call: { id, name, arguments: args },
});

/** An agent on a scripted model: each inner array is one round's answer. */
const setup = (answers: Step[][], maxRounds = 5, scope: 'in' | 'out' = 'in') => {
  const { llm, calls } = scriptedLlm(answers);
  const fake = { calls };
  let n = 0;
  const scopeAsked: { question: string; previousAnswer?: string }[] = [];
  const agent = createAgent({
    llm,
    newId: () => `id-${++n}`,
    maxRounds,
    // The scope guard is its own model call (tested in checkScope.test.ts); here, scripted.
    checkScope: (q) => {
      scopeAsked.push(q);
      return Promise.resolve(scope);
    },
  });
  return { agent, fake, scopeAsked };
};

const run = async (agent: ReturnType<typeof setup>['agent'], signal?: AbortSignal) => {
  const events: AgentEvent[] = [];
  for await (const event of agent.run({
    board,
    messages: [{ role: 'user', content: 'Review my design' }],
    signal,
  }))
    events.push(event);
  return events;
};

const of = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) =>
  events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

const textOf = (events: AgentEvent[]) =>
  of(events, 'text')
    .map((e) => e.delta)
    .join('');

describe('runAgent', () => {
  it('without tool calls: streams the text and ends with done, no proposal', async () => {
    const { agent } = setup([[text('Looks good. '), text('Add a cache later.')]]);

    const events = await run(agent);

    expect(textOf(events)).toBe('Looks good. Add a cache later.');
    expect(of(events, 'proposal')).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('add_node then connect_nodes over two rounds → one proposal with both ops', async () => {
    const { agent, fake } = setup([
      [
        text('You need a cache.'),
        tool('c1', 'add_node', { kind: 'cache', label: 'Redis', near: 'n1' }),
      ],
      [tool('c2', 'connect_nodes', { source: 'n1', target: 'n3' })],
      [text('Added a Redis cache in front of Postgres.')],
    ]);

    const events = await run(agent);

    const [proposal] = of(events, 'proposal');
    expect(proposal?.proposal.ops).toEqual([
      { op: 'addNode', nodeId: 'id-1', kind: 'cache', label: 'Redis', near: 'uuid-api' },
      { op: 'connect', edgeId: 'id-2', source: 'uuid-api', target: 'id-1' },
    ]);
    expect(proposal?.proposal.summary).toBe('Add cache "Redis"; connect "API" → "Redis"');
    expect(applyOps(board, proposal?.proposal.ops ?? []).ok).toBe(true);
    expect(events.slice(-2).map((e) => e.type)).toEqual(['proposal', 'done']);

    // The model saw each tool result before its next round.
    const round2 = fake.calls[1]?.messages ?? [];
    expect(round2.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'c1',
      content: 'added n3 [cache] "Redis"',
    });
  });

  it('separates the text of two rounds with a blank line', async () => {
    const { agent } = setup([
      [text('Adding a cache.'), tool('c1', 'add_node', { kind: 'cache', label: 'Redis' })],
      [text('Done.')],
    ]);
    expect(textOf(await run(agent))).toBe('Adding a cache.\n\nDone.');
  });

  it('returns an invalid call’s error to the model; the proposal keeps only valid ops', async () => {
    const { agent, fake } = setup([
      [tool('c1', 'connect_nodes', { source: 'n1', target: 'n9' })],
      [tool('c2', 'add_node', { kind: 'cache', label: 'Redis' })],
      [text('Fixed.')],
    ]);

    const events = await run(agent);

    expect(fake.calls[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'c1',
      content: expect.stringMatching(/No node "n9"/) as unknown,
    });
    expect(of(events, 'proposal')[0]?.proposal.ops.map((o) => o.op)).toEqual(['addNode']);
  });

  it('stops at max rounds and proposes what is valid so far', async () => {
    const endless = Array.from({ length: 10 }, (_, i) => [
      tool(`c${i}`, 'add_node', { kind: 'service', label: `S${i}` }),
    ]);
    const { agent, fake } = setup(endless, 3);

    const events = await run(agent);

    expect(fake.calls).toHaveLength(3);
    expect(of(events, 'proposal')[0]?.proposal.ops).toHaveLength(3);
    expect(events.at(-1)).toEqual({ type: 'done' });
    // The user is told the review was cut short, not left with a sentence that goes nowhere.
    expect(textOf(events)).toMatch(/stopped here/i);
  });

  it('a gateway error → the valid changes so far, an error event, then done', async () => {
    const { agent } = setup([
      [tool('c1', 'add_node', { kind: 'cache', label: 'Redis' })],
      [{ type: 'fail', code: 'UNAVAILABLE', message: 'down' }],
    ]);

    const events = await run(agent);

    // The text may already say "I've added a cache": the proposal keeps the board in step with it.
    expect(events.slice(-3).map((e) => e.type)).toEqual(['proposal', 'error', 'done']);
    expect(events.at(-2)).toEqual({ type: 'error', code: 'UNAVAILABLE', message: 'down' });
    expect(of(events, 'proposal')[0]?.proposal.ops.map((o) => o.op)).toEqual(['addNode']);
    // The failed round is reported too: failures are what metering most needs to see.
    expect(of(events, 'round').map((r) => r.round)).toEqual([1, 2]);
  });

  it('reports how each round went (for metering)', async () => {
    const { agent } = setup([
      [
        tool('c1', 'add_node', { kind: 'cache', label: 'Redis' }),
        tool('c2', 'add_node', { kind: 'nope', label: 'x' }),
      ],
      [
        text('ok'),
        {
          type: 'usage',
          usage: {
            inputTokens: 200,
            outputTokens: 10,
            latencyMs: 5,
            timeToFirstTokenMs: 1,
            attempts: 1,
          },
        },
      ],
    ]);

    const rounds = of(await run(agent), 'round');

    expect(
      rounds.map((r) => ({ round: r.round, toolCalls: r.toolCalls, toolErrors: r.toolErrors })),
    ).toEqual([
      { round: 1, toolCalls: 2, toolErrors: 1 },
      { round: 2, toolCalls: 0, toolErrors: 0 },
    ]);
    expect(rounds[1]?.usage).toMatchObject({ inputTokens: 200, outputTokens: 10 });
  });

  it('stops quietly when the caller cancels', async () => {
    const controller = new AbortController();
    const { agent } = setup([[text('Start'), { type: 'hang' }]]);

    const events: AgentEvent[] = [];
    for await (const event of agent.run({
      board,
      messages: [{ role: 'user', content: 'Hi' }],
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === 'text') controller.abort();
    }

    expect(events.map((e) => e.type)).toEqual(['text', 'round', 'error', 'done']);
    expect(events[2]).toMatchObject({ code: 'ABORTED' });
  });
});

describe('scope guard', () => {
  it('a message about something else gets the fixed reply: no review, no tools, no proposal', async () => {
    const { agent, fake } = setup([[text('The weather is sunny.')]], 5, 'out');

    const events = await run(agent);

    expect(events).toEqual([{ type: 'text', delta: OUT_OF_SCOPE_REPLY }, { type: 'done' }]);
    expect(fake.calls).toHaveLength(0); // the reviewer was never asked
  });

  it('is asked about the latest message, with the last answer for context', async () => {
    const { agent, scopeAsked } = setup([[text('ok')]]);

    for await (const event of agent.run({
      board,
      messages: [
        { role: 'user', content: 'Review it' },
        { role: 'assistant', content: 'Shall I add a cache?' },
        { role: 'user', content: 'yes, do it' },
      ],
    }))
      void event;

    expect(scopeAsked).toEqual([
      { question: 'yes, do it', previousAnswer: 'Shall I add a cache?' },
    ]);
  });
});

describe('what the model is sent', () => {
  it('the system prompt, the history, then the board as delimited data with the last question', async () => {
    const { agent, fake } = setup([[text('ok')]]);

    const events = agent.run({
      board,
      messages: [
        { role: 'user', content: 'Review it' },
        { role: 'assistant', content: 'Add a cache as n5.' },
        { role: 'user', content: 'Done, what next?' },
      ],
    });
    for await (const event of events) void event;

    const sent = fake.calls[0]?.messages ?? [];
    expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(sent[0]?.content).not.toContain('Postgres'); // the board is never in the system prompt
    const last = sent.at(-1)?.content ?? '';
    expect(last).toContain('<board>\nn1 [api] "API" -> n2\nn2 [database] "Postgres"\n</board>');
    expect(last).toMatch(/ids .*replace any/i); // aliases may have changed since earlier messages
    expect(last.endsWith('Done, what next?')).toBe(true);
  });
});
