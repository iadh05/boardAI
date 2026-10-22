// V1 vs V2 on hard questions: what the design rules don't already catch — security, cost,
// hidden single points of failure, consistency, global latency. Real models; never in `pnpm test`.
//
//   node --env-file=<server .env> scripts/hard-eval.ts [--runs 5] [--hosted-planner groq:<model>+think] [--save out.json]
//
// A case passes when the answer names the real problem (the text) and, where a fix is a box,
// proposes it (the ops). The Planner asking questions instead of answering is counted apart.

import type { AgentOp, Board, ChatMessage } from '../packages/domain/src/index.ts';
import { writeFileSync } from 'node:fs';
import {
  assertOnGpu,
  boardOf,
  connectRealModel,
  connectV2,
  oneLine,
  runReview,
  type Run,
} from './lib/realModel.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const RUNS = Number(flag('--runs', '5'));
const SAVE = flag('--save', '');
const HOSTED_PLANNER = flag('--hosted-planner', '');
const MODEL = 'designroom-qwen';
const out = (line = '') => process.stdout.write(`${line}\n`);

type Case = {
  name: string;
  problem: string;
  board: Board;
  ask: string;
  pass: (run: Run) => boolean;
};

const added = (ops: AgentOp[]) => ops.filter((op) => op.op === 'addNode').length;
const says = (run: Run, ...patterns: RegExp[]) => patterns.every((p) => p.test(run.text));

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
).board;
const DIRECT_DB =
  /(browser|client|front.?end)[^.]{0,120}(database|\bdb\b|cards db)|direct(ly)? (access|read|connect|reach)|bypass/i;

const CASES: Case[] = [
  {
    name: 'exposed-db',
    problem: 'the browser reads the card database directly',
    board: exposed,
    ask: 'Review my design.',
    pass: (r) => says(r, DIRECT_DB),
  },
  {
    name: 'deep-dive',
    problem: 'asked "is my database safe?": direct access + no replica',
    board: exposed,
    ask: 'Is my database safe?',
    pass: (r) => says(r, DIRECT_DB),
  },
  {
    name: 'over-engineered',
    problem: '100 users, $50/month, on a Kafka + 3 databases + CDN board',
    board: boardOf(
      [
        ['client', 'Web app'],
        ['cdn', 'CDN'],
        ['loadBalancer', 'Load balancer'],
        ['api', 'Notes API'],
        ['cache', 'Redis'],
        ['queue', 'Kafka'],
        ['service', 'Indexer'],
        ['database', 'Postgres primary'],
        ['database', 'Postgres replica 1'],
        ['database', 'Postgres replica 2'],
      ],
      [
        ['Web app', 'CDN'],
        ['CDN', 'Load balancer'],
        ['Load balancer', 'Notes API'],
        ['Notes API', 'Redis'],
        ['Notes API', 'Kafka', 'events', 'async'],
        ['Kafka', 'Indexer', 'events', 'async'],
        ['Notes API', 'Postgres primary'],
        ['Postgres primary', 'Postgres replica 1', 'replication', 'async'],
        ['Postgres primary', 'Postgres replica 2', 'replication', 'async'],
      ],
    ).board,
    ask: 'We have about 100 users and a budget of $50 a month. Review my design.',
    pass: (r) =>
      added(r.ops) === 0 &&
      says(
        r,
        /over.?engineer|too (complex|much|many)|simplif|remove|not need|unnecessary|overkill/i,
      ),
  },
  {
    name: 'hidden-spof',
    problem: 'two APIs behind a load balancer, but one worker and one database',
    board: boardOf(
      [
        ['client', 'Mobile app'],
        ['loadBalancer', 'Load balancer'],
        ['api', 'API 1'],
        ['api', 'API 2'],
        ['cache', 'Redis'],
        ['queue', 'Jobs queue'],
        ['service', 'Worker'],
        ['database', 'Postgres'],
      ],
      [
        ['Mobile app', 'Load balancer'],
        ['Load balancer', 'API 1'],
        ['Load balancer', 'API 2'],
        ['API 1', 'Redis'],
        ['API 2', 'Redis'],
        ['API 1', 'Postgres'],
        ['API 2', 'Postgres'],
        ['API 1', 'Jobs queue', 'jobs', 'async'],
        ['Jobs queue', 'Worker', 'jobs', 'async'],
        ['Worker', 'Postgres'],
      ],
    ).board,
    ask: 'What is the single point of failure in this design?',
    pass: (r) =>
      says(
        r,
        /worker|postgres|database/i,
        /single point|spof|only one|one (instance|copy)|no (replica|backup|second)/i,
      ),
  },
  {
    name: 'dual-write',
    problem: 'saved to Postgres, then published to Kafka: events can be lost',
    board: boardOf(
      [
        ['client', 'Shop'],
        ['api', 'Orders API'],
        ['database', 'Postgres'],
        ['queue', 'Kafka'],
        ['service', 'Payments'],
      ],
      [
        ['Shop', 'Orders API'],
        ['Orders API', 'Postgres', 'save order'],
        ['Orders API', 'Kafka', 'order created', 'async'],
        ['Kafka', 'Payments', 'order created', 'async'],
      ],
    ).board,
    ask: 'Orders are saved to Postgres and then published to Kafka. Can we lose an order event?',
    pass: (r) =>
      says(
        r,
        /outbox|transactional|dual.?write|atomic|two.?phase|change data capture|\bcdc\b|debezium/i,
      ),
  },
  {
    name: 'global-latency',
    problem: 'everything in eu-west; half the users in the US need < 100 ms',
    board: boardOf(
      [
        ['client', 'Users'],
        ['api', 'API (eu-west)'],
        ['database', 'Postgres (eu-west)'],
      ],
      [
        ['Users', 'API (eu-west)'],
        ['API (eu-west)', 'Postgres (eu-west)'],
      ],
    ).board,
    ask: 'Half of our users are in the US and need answers in under 100 ms. Review the design.',
    pass: (r) =>
      r.ops.length > 0 && says(r, /cdn|multi.?region|us.?(east|west|region)|replica|edge|geo/i),
  },
];

const SETUPS = [
  { name: 'V1', agent: () => connectRealModel(MODEL).agent },
  {
    name: 'V2 local',
    agent: () => connectV2(MODEL, 'ollama', { planner: `ollama:${MODEL}+think` }).agent,
  },
  // A hosted Planner, as LLM_ROLE_PLANNER writes it (e.g. groq:<model>+think): from the command line.
  ...(HOSTED_PLANNER
    ? [
        {
          name: 'V2 + hosted Planner',
          agent: () => connectV2(MODEL, 'ollama', { planner: HOSTED_PLANNER }).agent,
        },
      ]
    : []),
];

const asked = (run: Run) => run.text.startsWith('Before I review');
const pct = (n: number, d: number) => `${n}/${d}`;
const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] ?? 0;

await assertOnGpu(MODEL);
const saved: {
  setup: string;
  case: string;
  run: number;
  pass: boolean;
  asked: boolean;
  ms: number;
  ops: number;
  text: string;
  summary: string;
  error?: string;
}[] = [];
for (const c of CASES) {
  out(`\n## ${c.name}: ${c.problem}\n   asks: "${c.ask}"`);
  for (const s of SETUPS) {
    const runs: Run[] = [];
    for (let i = 1; i <= RUNS; i++) {
      const messages: ChatMessage[] = [{ role: 'user', content: c.ask }];
      const run = await runReview(s.agent(), c.board, messages);
      runs.push(run);
      saved.push({
        setup: s.name,
        case: c.name,
        run: i,
        pass: !run.error && c.pass(run),
        asked: asked(run),
        ms: Math.round(run.ms),
        ops: run.ops.length,
        text: run.text,
        summary: run.summary,
        ...(run.error ? { error: run.error } : {}),
      });
    }
    const passes = runs.filter((r) => !r.error && c.pass(r)).length;
    const errors = runs.filter((r) => r.error).length;
    out(
      `   ${s.name.padEnd(18)} passed ${pct(passes, RUNS)} · asked ${runs.filter(asked).length} · errors ${errors} · ${(p50(runs.map((r) => r.ms)) / 1000).toFixed(1)} s p50 · e.g. ${oneLine(runs.find((r) => c.pass(r))?.text ?? runs[0]?.text ?? '', 110)}`,
    );
  }
}

out('\n| Case | ' + SETUPS.map((s) => s.name).join(' | ') + ' |');
out('|---|' + SETUPS.map(() => '---').join('|') + '|');
for (const c of CASES)
  out(
    `| ${c.name} | ${SETUPS.map((s) => {
      const rs = saved.filter((x) => x.case === c.name && x.setup === s.name);
      return `${rs.filter((x) => x.pass).length}/${rs.length}`;
    }).join(' | ')} |`,
  );
out(
  `| **total** | ${SETUPS.map((s) => {
    const rs = saved.filter((x) => x.setup === s.name);
    return `**${rs.filter((x) => x.pass).length}/${rs.length}**`;
  }).join(' | ')} |`,
);
if (SAVE)
  writeFileSync(SAVE, `${JSON.stringify({ model: MODEL, runs: RUNS, results: saved }, null, 2)}\n`);
