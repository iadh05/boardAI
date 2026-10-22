// SPIKE (ADR-011): our runtime vs XState, same six nodes, fake models — what the harness costs.
//   node scripts/spike-xstate-bench.ts [--runs 300]
import type { AiGateway, LlmChunk } from '../packages/ai-gateway/src/index.ts';
import { createAgent, createReviewerV2, RULE_SPECIALISTS } from '../packages/agent/src/index.ts';
import { createReviewerXState } from '../packages/agent/src/application/reviewerXState.ts';
import { boardOf } from './lib/realModel.ts';

const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf('--runs') + 1] ?? 300) || 300;
const out = (line = '') => process.stdout.write(`${line}\n`);

/** A model that always gives the same answer, at once. */
const answering = (chunks: LlmChunk[]): AiGateway => ({
  async *chat() {
    await Promise.resolve();
    yield* chunks;
  },
});
const tool = (name: string, args: unknown): LlmChunk => ({
  type: 'toolCall',
  call: { id: name, name, arguments: args },
});

const { board } = boardOf(
  [
    ['client', 'Mobile app'],
    ['api', 'Orders API'],
    ['database', 'Orders DB'],
  ],
  [
    ['Mobile app', 'Orders API'],
    ['Orders API', 'Orders DB'],
  ],
);
const deps = () => ({
  main: answering([{ type: 'text', delta: 'ok' }]),
  planner: answering([tool('make_plan', { flow: 'review', specialists: ['data', 'security'] })]),
  architect: createAgent({
    llm: answering([{ type: 'text', delta: 'Add a replica.' }, tool('finish', { summary: 'ok' })]),
    newId: () => crypto.randomUUID(),
  }),
  specialists: RULE_SPECIALISTS,
  checkScope: () => Promise.resolve('in' as const),
});

const harnesses = {
  'our runtime': createReviewerV2(deps()),
  xstate: createReviewerXState(deps()),
};

const once = async (reviewer: { run: typeof harnesses.xstate.run }) => {
  let events = 0;
  for await (const event of reviewer.run({
    board,
    messages: [{ role: 'user', content: 'Review' }],
  }))
    events += event.type ? 1 : 0;
  return events;
};

for (const reviewer of Object.values(harnesses)) await once(reviewer); // warm up
for (const [name, reviewer] of Object.entries(harnesses)) {
  const times: number[] = [];
  let events = 0;
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    events = await once(reviewer);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const p = (q: number) => (times[Math.floor(q * (times.length - 1))] ?? 0).toFixed(2);
  out(
    `${name.padEnd(12)} ${RUNS} runs · ${events} events each · p50 ${p(0.5)} ms · p95 ${p(0.95)} ms`,
  );
}
