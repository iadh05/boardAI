import type { AgentEvent, AgentInput } from '@designroom/agent';
import { ChatEventSchema, type ChatEvent, type ChatRequest } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../core/logger.ts';
import { createReviewBoard, type ReviewAgent } from './reviewBoard.ts';

const request: ChatRequest = {
  board: {
    nodes: [{ id: 'api', kind: 'api', label: 'API', position: { x: 0, y: 0 } }],
    edges: [],
  },
  messages: [{ role: 'user', content: 'Review my design' }],
};

const proposal = {
  id: 'p1',
  summary: 'Add cache "Redis"',
  ops: [{ op: 'addNode' as const, nodeId: 'n', kind: 'cache' as const, label: 'Redis' }],
};

/** An agent that replays events (or fails), and remembers what it was asked. */
const fakeAgent = (script: (AgentEvent | Error)[]) => {
  const inputs: AgentInput[] = [];
  const agent: ReviewAgent = {
    async *run(input) {
      inputs.push(input);
      for (const step of script) {
        await Promise.resolve();
        if (step instanceof Error) throw step;
        yield step;
      }
    },
  };
  return { agent, inputs };
};

const setup = (script: (AgentEvent | Error)[]) => {
  const lines: string[] = [];
  const logger = createLogger({ level: 'debug', write: (l) => lines.push(l), now: () => 0 });
  const { agent, inputs } = fakeAgent(script);
  const reported: unknown[] = [];
  const review = createReviewBoard({ agent, reporter: { report: (e) => reported.push(e) } });
  return {
    review: (req: ChatRequest, signal?: AbortSignal) => review(req, { logger, signal }),
    inputs,
    lines,
    reported,
  };
};

const collect = async (review: ReturnType<typeof setup>['review'], req = request) => {
  const started = review(req);
  if (!started.ok) throw new Error(started.error.message);
  const events: ChatEvent[] = [];
  for await (const event of started.value) events.push(event);
  return events;
};

describe('reviewBoard', () => {
  it('passes text and the proposal on, and ends with done', async () => {
    const { review } = setup([
      { type: 'text', delta: 'Add a cache.' },
      { type: 'proposal', proposal },
      { type: 'done' },
    ]);

    const events = await collect(review);

    expect(events).toEqual([
      { type: 'text', delta: 'Add a cache.' },
      { type: 'proposal', proposal },
      { type: 'done' },
    ]);
    for (const event of events) expect(ChatEventSchema.safeParse(event).success).toBe(true);
  });

  it('logs each round instead of sending it to the browser', async () => {
    const usage = {
      inputTokens: 300,
      outputTokens: 20,
      latencyMs: 900,
      timeToFirstTokenMs: 200,
      attempts: 1,
    };
    const { review, lines } = setup([
      { type: 'round', round: 1, usage, toolCalls: 2, toolErrors: 1 },
      { type: 'done' },
    ]);

    expect(await collect(review)).toEqual([{ type: 'done' }]);
    expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>)).toContainEqual(
      expect.objectContaining({
        msg: 'agent round',
        round: 1,
        toolCalls: 2,
        toolErrors: 1,
        inputTokens: 300,
      }),
    );
  });

  it('logs a cancel as such, not as a model failure', async () => {
    const { review, lines } = setup([
      { type: 'error', code: 'ABORTED', message: 'The request was cancelled.' },
      { type: 'done' },
    ]);

    await collect(review);

    const logged = lines.map((l) => JSON.parse(l) as { level: string; msg: string });
    expect(logged).toContainEqual(
      expect.objectContaining({ level: 'info', msg: 'chat cancelled' }),
    );
    expect(logged.some((l) => l.level === 'warn')).toBe(false);
  });

  it.each([
    ['UNAVAILABLE', /is Ollama running/],
    ['TIMEOUT', /took too long/],
    ['BAD_REQUEST', /LLM_MODEL/],
    ['BAD_RESPONSE', /could not read/],
  ] as const)(
    'turns a %s from the model into a message the user can act on',
    async (code, message) => {
      const { review } = setup([
        { type: 'error', code, message: 'raw provider message' },
        { type: 'done' },
      ]);

      const events = await collect(review);

      expect(events).toEqual([
        { type: 'error', message: expect.stringMatching(message) as unknown },
        { type: 'done' },
      ]);
    },
  );

  it('turns a bug into an error event and done, and logs it: the stream never just stops', async () => {
    const bug = new TypeError('boom');
    const { review, lines, reported } = setup([{ type: 'text', delta: 'Hmm' }, bug]);

    const events = await collect(review);

    expect(events).toEqual([
      { type: 'text', delta: 'Hmm' },
      { type: 'error', message: expect.stringMatching(/went wrong/) as unknown },
      { type: 'done' },
    ]);
    expect(lines.join('\n')).toMatch(/"level":"error".*boom/);
    expect(reported).toEqual([bug]); // to Sentry: it happened inside the stream, past Hono's handler
  });

  it('ends with exactly one done even if the agent forgets it', async () => {
    const { review } = setup([{ type: 'text', delta: 'Hi' }]);
    expect((await collect(review)).filter((e) => e.type === 'done')).toHaveLength(1);
  });

  it('sends the agent only the recent history that fits the model, and the cancel signal', async () => {
    const long = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `${i}`.padEnd(4_000, '.'),
    }));
    const { review, inputs } = setup([{ type: 'done' }]);
    const controller = new AbortController();

    const started = review(
      { ...request, messages: [...long, { role: 'user', content: 'latest' }] },
      controller.signal,
    );
    if (!started.ok) throw new Error('expected to start');
    for await (const _event of started.value) void _event;

    expect(inputs[0]?.messages.length).toBeLessThan(31);
    expect(inputs[0]?.messages.at(-1)?.content).toBe('latest');
    expect(inputs[0]?.signal).toBe(controller.signal);
  });

  it('refuses before streaming when the board leaves no room for the chat', () => {
    // The contract's limits (150 nodes…) keep real boards under the budget; this guard is for
    // when those limits or the model's context change. 400 long-label nodes don't fit.
    const huge: ChatRequest = {
      ...request,
      board: {
        nodes: Array.from({ length: 400 }, (_, i) => ({
          id: `node-${i}`,
          kind: 'custom' as const,
          label: 'L'.repeat(100),
          position: { x: i, y: 0 },
        })),
        edges: [],
      },
      messages: [{ role: 'user', content: 'x'.repeat(4_000) }],
    };
    const { review } = setup([]);

    expect(review(huge)).toMatchObject({ ok: false, error: { code: 'BOARD_TOO_LARGE' } });
  });
});
