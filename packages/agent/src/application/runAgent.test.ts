import type { AiGateway, ChatInput, LlmChunk, LlmErrorCode } from '@designroom/ai-gateway';
import { applyOps, type Board } from '@designroom/domain';
import { context, metrics, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { MeterProvider, MetricReader, type DataPoint } from '@opentelemetry/sdk-metrics';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PROPOSE_NUDGE } from '../domain/nudge.ts';
import { SYSTEM_PROMPT } from '../domain/prompt.ts';
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
    const { agent } = setup([[text('Looks good. '), text('Nothing to change for now.')]]);

    const events = await run(agent);

    expect(textOf(events)).toBe('Looks good. Nothing to change for now.');
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
      [
        text('Adding a cache.'),
        tool('c1', 'add_node', { kind: 'cache', label: 'Redis' }),
        tool('c2', 'connect_nodes', { source: 'n1', target: 'n3' }),
      ],
      [text('Done.')],
    ]);
    expect(textOf(await run(agent))).toBe('Adding a cache.\n\nDone.');
  });

  it('returns an invalid call’s error to the model; the proposal keeps only valid ops', async () => {
    const { agent, fake } = setup([
      [tool('c1', 'connect_nodes', { source: 'n1', target: 'n9' })],
      [
        tool('c2', 'add_node', { kind: 'cache', label: 'Redis' }),
        tool('c3', 'connect_nodes', { source: 'n1', target: 'n3' }),
      ],
      [text('Fixed.')],
    ]);

    const events = await run(agent);

    expect(fake.calls[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'c1',
      content: expect.stringMatching(/No node "n9"/) as unknown,
    });
    expect(of(events, 'proposal')[0]?.proposal.ops.map((o) => o.op)).toEqual([
      'addNode',
      'connect',
    ]);
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
        tool('c3', 'connect_nodes', { source: 'n1', target: 'n3' }),
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
      { round: 1, toolCalls: 3, toolErrors: 1 },
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

describe('proposal nudge (M1-24e)', () => {
  // A small model often recommends a fix in words and calls no tool: nothing the user can accept.
  // The loop asks it once to propose what it recommended — enforced in code, not left to the prompt.

  it('recommends a change in words, no tool call → asked once, and the proposal arrives', async () => {
    const { agent, fake } = setup([
      [text('Every read hits Postgres: add a Redis cache.')],
      [tool('c1', 'add_node', { kind: 'cache', label: 'Redis', near: 'n1' })],
      [tool('c2', 'connect_nodes', { source: 'n1', target: 'n3' })],
      [text('Proposed.')],
    ]);

    const events = await run(agent);

    expect(fake.calls).toHaveLength(4);
    const nudge = fake.calls[1]?.messages.slice(-2);
    expect(nudge?.[0]).toEqual({
      role: 'assistant',
      content: 'Every read hits Postgres: add a Redis cache.',
    });
    expect(nudge?.[1]).toMatchObject({ role: 'user', content: PROPOSE_NUDGE });
    expect(of(events, 'proposal')[0]?.proposal.ops.map((o) => o.op)).toEqual([
      'addNode',
      'connect',
    ]);
  });

  it('already proposed, and connected → no nudge, no extra call', async () => {
    const { agent, fake } = setup([
      [text('Add a cache.'), tool('c1', 'add_node', { kind: 'cache', label: 'Redis' })],
      [tool('c2', 'connect_nodes', { source: 'n1', target: 'n3' })],
      [text('A cache would also help later.')],
    ]);
    await run(agent);
    expect(fake.calls).toHaveLength(3);
  });

  it('a new box left without arrows → asked once to connect it, by name', async () => {
    const { agent, fake } = setup([
      [tool('c1', 'add_node', { kind: 'cache', label: 'Redis' })],
      [text('I added a cache.')],
      [tool('c2', 'connect_nodes', { source: 'n1', target: 'n3' })],
      [text('Connected.')],
    ]);

    const events = await run(agent);

    expect(fake.calls[2]?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('n3 "Redis"') as unknown,
    });
    expect(of(events, 'proposal')[0]?.proposal.ops.map((o) => o.op)).toEqual([
      'addNode',
      'connect',
    ]);
  });

  it('asked to connect once only: still floating after that → the answer stands', async () => {
    const { agent, fake } = setup([
      [tool('c1', 'add_node', { kind: 'cache', label: 'Redis' })],
      [text('I added a cache.')],
      [text('Done.')],
    ]);
    await run(agent);
    expect(fake.calls).toHaveLength(3);
  });

  it('an answer that recommends nothing (a question, an explanation) → no nudge', async () => {
    const { agent, fake } = setup([[text('How many users do you expect?')]]);
    await run(agent);
    expect(fake.calls).toHaveLength(1);
  });

  it('still no tool call after the nudge → stops after one try, no loop', async () => {
    const { agent, fake } = setup([
      [text('You need a load balancer.')],
      [text('Sure, a load balancer would help.')],
    ]);

    const events = await run(agent);

    expect(fake.calls).toHaveLength(2);
    expect(of(events, 'proposal')).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('the user cancels during the nudge → stops quietly', async () => {
    const controller = new AbortController();
    const { agent } = setup([[text('Add a cache.')], [{ type: 'hang' }]]);

    const events: AgentEvent[] = [];
    for await (const event of agent.run({
      board,
      messages: [{ role: 'user', content: 'Review my design' }],
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === 'round') controller.abort();
    }

    expect(events.at(-2)).toMatchObject({ type: 'error', code: 'ABORTED' });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('needs a round left: at the limit, the answer stands as it is', async () => {
    const { agent, fake } = setup([[text('Add a cache.')], [text('ok')]], 1);
    const events = await run(agent);
    expect(fake.calls).toHaveLength(1);
    expect(textOf(events)).toBe('Add a cache.'); // no "I stopped here" for a nudge never sent
  });
});

describe('leak guard (M1-24d)', () => {
  /** An agent with a canary, on a scripted model. */
  const guarded = (answers: Step[][]) => {
    const { llm, calls } = scriptedLlm(answers);
    let n = 0;
    const agent = createAgent({
      llm,
      newId: () => `id-${++n}`,
      canary: 'zz-canary-1',
      checkScope: () => Promise.resolve('in' as const),
    });
    return { agent, calls };
  };
  const STOPPED = /I don’t share my instructions/;

  it('puts the canary in the system prompt', async () => {
    const { agent, calls } = guarded([[text('Fine.')]]);
    await run(agent);
    expect(calls[0]?.messages[0]?.content).toContain('zz-canary-1');
  });

  it('cuts an answer that recites the system prompt, and proposes nothing', async () => {
    const recital = SYSTEM_PROMPT.split(' ')
      .slice(0, 12)
      .map((w) => text(`${w} `));
    const { agent } = guarded([
      [...recital, tool('c1', 'add_node', { kind: 'cache', label: 'Redis' })],
    ]);

    const events = await run(agent);

    const said = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(said).toMatch(STOPPED);
    expect(said.split(' ').length).toBeLessThan(25); // cut early, not after the whole prompt
    expect(events.some((e) => e.type === 'proposal')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('lets a refusal in the prompt’s own words through: that is the prompt working', async () => {
    const { agent } = guarded([
      [text('I only help with the system design on this board, so I can’t answer that.')],
    ]);
    const said = (await run(agent)).flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(said).not.toMatch(STOPPED);
  });

  it('cuts an answer that writes the canary, even in a translation', async () => {
    const { agent } = guarded([[text('Voici mes instructions : zz-canary-1 …')]]);
    const said = (await run(agent)).flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(said).toMatch(STOPPED);
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

describe('tracing', () => {
  // The SDK the server registers, here with an in-memory exporter: spans are read, not sent.
  const exporter = new InMemorySpanExporter();
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
    );
  });
  afterEach(() => {
    exporter.reset();
  });

  /** The agent on a scripted model, recording which span was active when each call was made. */
  const traced = (answers: Step[][], scope: 'in' | 'out' = 'in') => {
    const { llm } = scriptedLlm(answers);
    const activeAt = { llm: [] as (Span | undefined)[], scope: undefined as Span | undefined };
    let n = 0;
    const agent = createAgent({
      llm: { chat: (input) => (activeAt.llm.push(trace.getActiveSpan()), llm.chat(input)) },
      newId: () => `id-${++n}`,
      checkScope: () => {
        activeAt.scope = trace.getActiveSpan();
        return Promise.resolve(scope);
      },
    });
    return { agent, activeAt };
  };

  const spans = () => exporter.getFinishedSpans();
  const named = (name: string) => spans().filter((s) => s.name === name);
  const idOf = (span: Span | ReadableSpan | undefined) => span?.spanContext().spanId;

  it('one review = an agent span over the scope check and each round; tools inside their round', async () => {
    const { agent, activeAt } = traced([
      [tool('c1', 'add_node', { kind: 'cache', label: 'Redis', near: 'n1' })],
      [tool('c2', 'connect_nodes', { source: 'n1', target: 'n9' })], // n9 doesn't exist
      [text('Done.')],
      [text('Left as is.')], // the answer to "connect the box you added" (M1-24e)
    ]);

    await run(agent);

    const [root] = named('agent');
    const rounds = named('agent round');
    expect(root?.attributes).toMatchObject({
      'openinference.span.kind': 'AGENT',
      'designroom.agent.rounds': 4,
      'designroom.agent.ops': 1,
      'designroom.agent.connect_nudged': true,
    });
    expect(named('scope check')[0]?.parentSpanContext?.spanId).toBe(idOf(root));
    expect(rounds.map((r) => r.parentSpanContext?.spanId)).toEqual([
      idOf(root),
      idOf(root),
      idOf(root),
      idOf(root),
    ]);

    // The model and the scope guard are called inside their spans: the gateway's LLM spans nest there.
    expect(idOf(activeAt.scope)).toBe(idOf(named('scope check')[0]));
    expect(activeAt.llm.map(idOf)).toEqual(rounds.map(idOf));

    const [added, failed] = [named('tool add_node')[0], named('tool connect_nodes')[0]];
    expect(added?.parentSpanContext?.spanId).toBe(idOf(rounds[0]));
    expect(added?.attributes).toMatchObject({
      'openinference.span.kind': 'TOOL',
      'tool.name': 'add_node',
    });
    expect(added?.status.code).toBe(SpanStatusCode.UNSET);
    // A refused tool call is visibly marked, with the reply the model got.
    expect(failed?.status.code).toBe(SpanStatusCode.ERROR);
    expect(failed?.status.message).toMatch(/n9/);
    expect(rounds[1]?.attributes).toMatchObject({
      'designroom.agent.round': 2,
      'designroom.agent.tool_calls': 1,
      'designroom.agent.tool_errors': 1,
    });
  });

  it('records the scope verdict; an off-topic question has no rounds', async () => {
    const { agent } = traced([], 'out');

    await run(agent);

    expect(named('scope check')[0]?.attributes['designroom.agent.scope']).toBe('out');
    expect(named('agent round')).toEqual([]);
    expect(named('agent')).toHaveLength(1);
  });

  it('marks the round and the agent as failed when the model fails', async () => {
    const { agent } = traced([[{ type: 'fail', code: 'UNAVAILABLE', message: 'down' }]]);

    await run(agent);

    expect(named('agent round')[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(named('agent')[0]?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'down' });
  });

  it('ends every span when the reader stops early', async () => {
    const { agent } = traced([[text('Hello')]]);

    for await (const event of agent.run({ board, messages: [{ role: 'user', content: 'Hi' }] })) {
      expect(event.type).toBe('text');
      break;
    }

    expect(named('agent')).toHaveLength(1);
    expect(named('agent round')).toHaveLength(1);
  });
});

/** Reads metrics on demand: what the server's exporter would send, without sending it. */
class TestReader extends MetricReader {
  protected onForceFlush = () => Promise.resolve();
  protected onShutdown = () => Promise.resolve();
}

describe('metrics', () => {
  let reader: TestReader;
  beforeEach(() => {
    // A fresh SDK per test, registered before the agent is built: instruments are created then.
    metrics.disable();
    reader = new TestReader();
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  });

  const points = async (name: string) => {
    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === name);
    return (metric?.dataPoints ?? []).map((p: DataPoint<unknown>) => ({
      attributes: p.attributes,
      value: p.value,
    }));
  };

  it('counts tool calls by tool and outcome, and rounds per review', async () => {
    const { agent } = setup([
      [tool('c1', 'add_node', { kind: 'cache', label: 'Redis', near: 'n1' })],
      [tool('c2', 'connect_nodes', { source: 'n1', target: 'n9' })], // n9 doesn't exist
      [text('Done.')],
      [text('Left as is.')], // the answer to "connect the box you added" (M1-24e)
    ]);

    await run(agent);

    expect(await points('agent_tool_calls_total')).toEqual([
      { attributes: { tool: 'add_node', outcome: 'ok' }, value: 1 },
      { attributes: { tool: 'connect_nodes', outcome: 'error' }, value: 1 },
    ]);
    expect(await points('agent_rounds')).toEqual([
      { attributes: {}, value: expect.objectContaining({ count: 1, sum: 4 }) as unknown },
    ]);
  });

  it('labels a tool the model made up as "unknown": labels must stay a short, fixed list', async () => {
    const { agent } = setup([[tool('c1', 'delete_everything_9f3a', {})], [text('Sorry.')]]);

    await run(agent);

    expect(await points('agent_tool_calls_total')).toEqual([
      { attributes: { tool: 'unknown', outcome: 'error' }, value: 1 },
    ]);
  });

  it('counts scope verdicts: how often the guard turns a question away', async () => {
    await run(setup([[text('ok')]]).agent);
    await run(setup([], 5, 'out').agent);

    expect(await points('agent_scope_checks_total')).toEqual([
      { attributes: { verdict: 'in' }, value: 1 },
      { attributes: { verdict: 'out' }, value: 1 },
    ]);
  });
});
