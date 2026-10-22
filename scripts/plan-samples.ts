// AV2-07: the Planner on the real model — does it pick the right flow and specialists? Ten
// requests on the demo board, a few runs each. Never part of `pnpm test`: it needs Ollama.
//
//   node scripts/plan-samples.ts [--runs 2] [--model designroom-qwen]

import { makePlan, type Flow } from '../packages/agent/src/index.ts';
import { createAliases } from '../packages/agent/src/domain/aliases.ts';
import { boardToText } from '../packages/agent/src/domain/boardToText.ts';
import { assertOnGpu, boardOf, gatewayOf, type ProviderName } from './lib/realModel.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const RUNS = Number(flag('--runs', '2'));
const MODEL = flag('--model', 'designroom-qwen');
// The Planner on a hosted model too, thinking on or off: --provider groq --think.
const PROVIDER = flag('--provider', 'ollama') as ProviderName;
const THINK = args.includes('--think');
const out = (line = '') => process.stdout.write(`${line}\n`);

const { board } = boardOf(
  [
    ['client', 'Web client'],
    ['loadBalancer', 'Load Balancer'],
    ['api', 'Orders API'],
    ['database', 'Postgres'],
  ],
  [
    ['Web client', 'Load Balancer'],
    ['Load Balancer', 'Orders API'],
    ['Orders API', 'Postgres'],
  ],
);
const boardText = boardToText(board, createAliases(board));

/** A request, the flow it needs, and the specialists that must be in the plan. */
const CASES: [request: string, flow: Flow, needs: ('data' | 'security')[]][] = [
  ['Review my design.', 'review', ['data', 'security']],
  ['Can you check my design before we launch?', 'review', ['data', 'security']],
  ['Improve this architecture.', 'review', ['data']],
  ['Is this secure?', 'deep-dive', ['security']],
  ['Could someone read the database straight from the app?', 'deep-dive', ['security']],
  ['Will Postgres survive a crash?', 'deep-dive', ['data']],
  ['Is my data safe if a disk dies?', 'deep-dive', ['data']],
  ['What is a CDN?', 'question', []],
  ['Kafka or RabbitMQ: which is better here?', 'question', []],
  ['Why would we need a cache?', 'question', []],
];

const llm = gatewayOf(MODEL, PROVIDER, THINK);
if (PROVIDER === 'ollama') await assertOnGpu(MODEL);
out(`Planner, model ${MODEL}, ${RUNS} run(s) per request\n`);
out('| Request | Expected | Got | Passed | Asked |');
out('|---|---|---|---|---|');
let passed = 0;
let asked = 0;
for (const [request, flow, needs] of CASES) {
  const got: string[] = [];
  let ok = 0;
  let questions = 0;
  for (let r = 0; r < RUNS; r++) {
    const plan = await makePlan(llm, { question: request, boardText, allowQuestions: true });
    // A deep dive done as a full review still gets the right specialist: counted as right.
    const flowOk = plan.flow === flow || (flow === 'deep-dive' && plan.flow === 'review');
    const right = flowOk && needs.every((n) => plan.specialists.includes(n));
    if (right) ok++;
    if (plan.questions.length) questions++;
    got.push(`${plan.flow}[${plan.specialists.join('+')}]`);
  }
  passed += ok;
  asked += questions;
  out(
    `| ${request} | ${flow}[${needs.join('+')}] | ${got.join(' · ')} | ${ok}/${RUNS} | ${questions} |`,
  );
}
out(`\nRight plans: ${passed}/${CASES.length * RUNS} (asked questions in ${asked})`);
