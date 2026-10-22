// SPIKE: what each harness sends the Planner's model, side by side (fake models, no network).
import type { AiGateway, ChatInput } from '../packages/ai-gateway/src/index.ts';
import { createAgent, createReviewerV2, RULE_SPECIALISTS } from '../packages/agent/src/index.ts';
import { createReviewerXState } from '../packages/agent/src/application/reviewerXState.ts';
import { boardOf } from './lib/realModel.ts';

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
const seen: Record<'graph' | 'xstate', ChatInput[]> = { graph: [], xstate: [] };
const recorder = (name: 'graph' | 'xstate'): AiGateway => ({
  async *chat(input) {
    seen[name].push(input);
    await Promise.resolve();
    yield {
      type: 'toolCall',
      call: { id: 'p', name: 'make_plan', arguments: { flow: 'question', specialists: [] } },
    };
  },
});
const silent: AiGateway = {
  async *chat() {
    await Promise.resolve();
    yield { type: 'text', delta: 'x' };
  },
};
for (const [name, make] of [
  ['graph', createReviewerV2],
  ['xstate', createReviewerXState],
] as const) {
  const reviewer = make({
    main: silent,
    planner: recorder(name),
    architect: createAgent({ llm: silent, newId: () => 'id' }),
    specialists: RULE_SPECIALISTS,
    checkScope: () => Promise.resolve('in' as const),
  });
  const events = reviewer.run({
    board,
    messages: [{ role: 'user', content: 'Review my design.' }],
  });
  for await (const event of events) if (event.type === 'error') throw new Error(event.message);
}
const show = (input: ChatInput | undefined) => JSON.stringify(input?.messages ?? null);
process.stdout.write(`planner calls: graph ${seen.graph.length}, xstate ${seen.xstate.length}\n`);
process.stdout.write(`same messages: ${show(seen.graph[0]) === show(seen.xstate[0])}\n`);
process.stdout.write(
  `graph:  ${show(seen.graph[0]).slice(-300)}\nxstate: ${show(seen.xstate[0]).slice(-300)}\n`,
);
