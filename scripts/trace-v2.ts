// AV2-11b: watch agent V2 run on the graph, step by step — which node ran, what the state became,
// what the Planner decided, and what the user saw. Real model (local Qwen by default); never part
// of `pnpm test`.
//
//   node scripts/trace-v2.ts [--model designroom-qwen] [--planner ollama:designroom-qwen+think]

import type { ReviewState } from '../packages/agent/src/index.ts';
import type { ChatMessage } from '../packages/domain/src/index.ts';
import { assertOnGpu, boardOf, connectV2, oneLine } from './lib/realModel.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const MODEL = flag('--model', 'designroom-qwen');
const PLANNER = flag('--planner', `ollama:${MODEL}+think`);
const out = (line = '') => process.stdout.write(`${line}\n`);

const shop = boardOf(
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
const exposed = boardOf(
  [
    ['client', 'Browser'],
    ['api', 'Payments API'],
    ['database', 'Cards DB'],
  ],
  [
    ['Browser', 'Payments API'],
    ['Browser', 'Cards DB', 'direct reads'],
    ['Payments API', 'Cards DB'],
  ],
);

const RUNS = [
  { name: 'review', board: shop.board, ask: 'Review my design.' },
  { name: 'deep dive', board: exposed.board, ask: 'Is my database safe?' },
  { name: 'question', board: shop.board, ask: 'What is a CDN, in one sentence?' },
];

/** The state after a step, in one line: what changed what happens next. */
const stateLine = (s: ReviewState) =>
  [
    s.plan ? `plan: ${s.plan.flow} [${s.plan.specialists.join(', ')}]` : null,
    s.todo.length ? `todo: [${s.todo.join(', ')}]` : null,
    s.ran.length ? `ran: [${s.ran.join(', ')}]` : null,
    s.findings.length
      ? `findings: ${s.findings.map((f) => `${f.specialist}/${f.kind}`).join(', ')}`
      : null,
    s.replanned ? 'Planner decided' : null,
    s.answered ? 'answered' : null,
    s.error ? `error: ${s.error.code}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

await assertOnGpu(MODEL);
out(`Model ${MODEL} · Planner ${PLANNER}\n`);

for (const run of RUNS) {
  out(`══ ${run.name}: "${run.ask}"`);
  const started = performance.now();
  const at = () => `${((performance.now() - started) / 1000).toFixed(1).padStart(5)} s`;
  const { agent } = connectV2(MODEL, 'ollama', {
    planner: PLANNER,
    onStep: (step) =>
      out(`${at()}  ▸ ${step.after.padEnd(9)} → ${step.next.padEnd(9)} ${stateLine(step.state)}`),
  });
  const messages: ChatMessage[] = [{ role: 'user', content: run.ask }];
  let text = '';
  for await (const event of agent.run({ board: run.board, messages })) {
    if (event.type === 'progress') out(`${at()}    progress: ${event.text}`);
    else if (event.type === 'text') text += event.delta;
    else if (event.type === 'proposal') out(`${at()}    proposal: ${event.proposal.summary}`);
    else if (event.type === 'error') out(`${at()}    error: ${event.message}`);
  }
  out(`${at()}    answer: ${oneLine(text)}`);
  out();
}
