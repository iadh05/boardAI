import type { AiGateway, ChatInput, LlmChunk } from '@designroom/ai-gateway';
import type { Board } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { OUT_OF_SCOPE_REPLY } from '../domain/scope.ts';
import type { Specialist } from './orchestrator.ts';
import { createAgent } from './runAgent.ts';
import { createReviewerV2, type ReviewerV2Event } from './reviewerV2.ts';

// Agent V2's chain (AV2-07): Main (scope, trivial turns) → Planner (flow, specialists, questions)
// → Architect: the specialists through the queue, then AV2-01's agent explains and proposes.

const board: Board = {
  nodes: [
    { id: 'uuid-api', kind: 'api', label: 'API', position: { x: 0, y: 0 } },
    { id: 'uuid-db', kind: 'database', label: 'Postgres', position: { x: 300, y: 0 } },
  ],
  edges: [{ id: 'e1', source: 'uuid-api', target: 'uuid-db' }],
};

/** A gateway answering each call with the next scripted answer. */
const scripted = (answers: LlmChunk[][]) => {
  const calls: ChatInput[] = [];
  const llm: AiGateway = {
    async *chat(input) {
      calls.push(input);
      const answer = answers[calls.length - 1];
      if (!answer) throw new Error(`no scripted answer ${calls.length}`);
      await Promise.resolve();
      yield* answer;
    },
  };
  return { llm, calls };
};

const text = (delta: string): LlmChunk => ({ type: 'text', delta });
const tool = (name: string, args: unknown): LlmChunk => ({
  type: 'toolCall',
  call: { id: `c-${name}`, name, arguments: args },
});
const plan = (args: unknown) => [tool('make_plan', args)];

const setup = (options: {
  scope?: 'in' | 'out';
  main?: LlmChunk[][];
  planner?: LlmChunk[][];
  architect?: LlmChunk[][];
  specialists?: Record<string, Specialist>;
}) => {
  const main = scripted(options.main ?? []);
  const planner = scripted(options.planner ?? []);
  const architectLlm = scripted(options.architect ?? []);
  let n = 0;
  const reviewer = createReviewerV2({
    main: main.llm,
    planner: planner.llm,
    architect: createAgent({ llm: architectLlm.llm, newId: () => `id-${++n}` }),
    specialists: options.specialists ?? {
      data: () =>
        Promise.resolve([
          {
            specialist: 'data',
            kind: 'single-database',
            boxIds: ['uuid-db'],
            severity: 'critical',
            problem: 'one copy of the data',
            fix: 'a replica',
            confidence: 1,
          },
        ]),
    },
    checkScope: () => Promise.resolve(options.scope ?? 'in'),
  });
  return { reviewer, main, planner, architect: architectLlm };
};

const run = async (reviewer: ReturnType<typeof setup>['reviewer'], message: string) => {
  const events: ReviewerV2Event[] = [];
  for await (const event of reviewer.run({ board, messages: [{ role: 'user', content: message }] }))
    events.push(event);
  return events;
};

const textOf = (events: ReviewerV2Event[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');

describe('createReviewerV2', () => {
  it('a message about something else: the fixed reply, no planner, no specialist', async () => {
    const { reviewer, planner } = setup({ scope: 'out' });
    const events = await run(reviewer, 'tell me a joke');

    expect(textOf(events)).toBe(OUT_OF_SCOPE_REPLY);
    expect(planner.calls).toHaveLength(0);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('a trivial turn ("thanks") is answered by the Main agent alone (D3)', async () => {
    const { reviewer, planner, main } = setup({ main: [[text('You’re welcome!')]] });
    const events = await run(reviewer, 'thanks!');

    expect(textOf(events)).toBe('You’re welcome!');
    expect(planner.calls).toHaveLength(0);
    expect(main.calls[0]?.tools).toBeUndefined();
  });

  it('a review: progress while the specialists work, then the Architect explains their findings and proposes', async () => {
    const { reviewer, architect } = setup({
      planner: [plan({ flow: 'review', specialists: ['data'] })],
      architect: [
        [
          text('Postgres is a single point of failure.'),
          tool('add_node', { kind: 'database', label: 'Replica' }),
          tool('connect_nodes', { source: 'n2', target: 'n3' }),
          tool('finish', { summary: 'Added a replica.' }),
        ],
      ],
    });

    const events = await run(reviewer, 'Review my design');

    expect(
      events.filter((e) => e.type === 'progress').map((e) => e.type === 'progress' && e.text),
    ).toEqual(['Data running', 'Data ✓']);
    expect(architect.calls[0]?.messages.at(-1)?.content).toMatch(
      /<findings>\n- \[critical\] n2 "Postgres" \(data\)/,
    );
    expect(events.find((e) => e.type === 'proposal')).toMatchObject({
      proposal: { ops: [{ op: 'addNode' }, { op: 'connect' }] },
    });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('the Architect does not run its own scope check again', async () => {
    const { reviewer, architect } = setup({
      planner: [plan({ flow: 'review', specialists: ['data'] })],
      architect: [[tool('finish', { summary: 'Fine.' })]],
    });
    await run(reviewer, 'Review my design');
    expect(architect.calls).toHaveLength(1); // only its answer: no scope call on its model
  });

  it('a question: no specialists, the Architect answers', async () => {
    let asked = 0;
    const { reviewer } = setup({
      planner: [plan({ flow: 'question', specialists: [] })],
      architect: [
        [text('A CDN serves files from near the user.'), tool('finish', { summary: 'ok' })],
      ],
      specialists: {
        data: () => {
          asked++;
          return Promise.resolve([]);
        },
      },
    });

    const events = await run(reviewer, 'What is a CDN?');

    expect(asked).toBe(0);
    expect(events.some((e) => e.type === 'progress')).toBe(false);
    expect(textOf(events)).toBe('A CDN serves files from near the user.');
  });

  it('the planner needs answers first: its questions, then the answer ends (D2)', async () => {
    const { reviewer, architect } = setup({
      planner: [
        plan({ flow: 'review', specialists: ['data'], questions: ['How many users at peak?'] }),
      ],
    });

    const events = await run(reviewer, 'Design review please');

    expect(textOf(events)).toMatch(/How many users at peak\?/);
    expect(architect.calls).toHaveLength(0);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
