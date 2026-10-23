// V1 vs V2 on a ladder: level 1 is an easy question on a 3-box board, each level after it a harder
// question on a bigger board (scripts/lib/ladderLevels.ts). Real models; never in `pnpm test`.
//
//   node --env-file=<server .env> scripts/ladder-eval.ts [--runs 3] [--levels 1,2,3] [--scale 1]
//        [--hosted-planner groq:<model>+think | none] [--out eval-runs]
//
// Every run is saved for diagnosis, in a git-ignored folder (it holds boards and chats): its input
// (level, board, conversation, setup), its output (answer, proposal, verdict) and every model call
// it made, with the role that made it (the exact messages sent and what came back, tokens, time).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordLlmCalls, type LlmCallRecord } from '../apps/server/src/core/llmCallLog.ts';
import type { AgentOp, Board } from '../packages/domain/src/index.ts';
import { boardFor, LEVELS, type Level } from './lib/ladderLevels.ts';
import {
  assertOnGpu,
  connectRealModel,
  connectV2,
  runReview,
  type GatewayWrap,
  type Run,
} from './lib/realModel.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const MODEL = 'designroom-qwen';
const RUNS = Number(flag('--runs', '3'));
const SCALE = Number(flag('--scale', '1'));
const ONLY = flag('--levels', '').split(',').filter(Boolean).map(Number);
/** A third setup with the Planner hosted, as LLM_ROLE_PLANNER writes it; none without the flag. */
const HOSTED = flag('--hosted-planner', 'none');
const DIR = join(
  flag('--out', 'eval-runs'),
  `ladder-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`,
);
const out = (line = '') => process.stdout.write(`${line}\n`);

type Call = LlmCallRecord & { role: string };
type Setup = { name: string; connect: (wrap: GatewayWrap) => ReturnType<typeof connectV2> };

const SETUPS: Setup[] = [
  { name: 'V1', connect: (wrap) => connectRealModel(MODEL, 'ollama', wrap) },
  {
    name: 'V2 local',
    connect: (wrap) => connectV2(MODEL, 'ollama', { planner: `ollama:${MODEL}+think`, wrap }),
  },
  ...(HOSTED === 'none'
    ? []
    : [
        {
          name: 'V2 hosted Planner',
          connect: (wrap: GatewayWrap) => connectV2(MODEL, 'ollama', { planner: HOSTED, wrap }),
        },
      ]),
];

/** Every call a role's gateway makes, kept in `calls`. */
const recorder =
  (calls: Call[]): GatewayWrap =>
  (role, llm) =>
    recordLlmCalls(llm, {
      write: (record) => calls.push({ role, ...record }),
      now: () => Date.now(),
      requestId: () => null,
    });

/** Ops that touch the healthy subsystems: changes nobody needed (false alarms). */
const offTarget = (ops: AgentOp[], board: Board, level: Level) => {
  const core = new Set(level.core.boxes.map(([, label]) => label));
  const padding = new Set(board.nodes.filter((n) => !core.has(n.label)).map((n) => n.id));
  return ops.filter((op) => {
    if (op.op === 'addNode') return op.near !== undefined && padding.has(op.near);
    if (op.op === 'updateNode') return padding.has(op.nodeId);
    return padding.has(op.source) || padding.has(op.target);
  }).length;
};

type Result = {
  level: number;
  setup: string;
  run: number;
  pass: boolean;
  asked: boolean;
  ms: number;
  ops: number;
  offTarget: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
};

const tokens = (calls: Call[], key: 'inputTokens' | 'outputTokens') =>
  calls.reduce((sum, c) => sum + (c.usage?.[key] ?? 0), 0);

/** One review, saved with its input, output and model calls; returns its row. */
const runOnce = async (level: Level, setup: Setup, board: Board, i: number): Promise<Result> => {
  const calls: Call[] = [];
  const { agent } = setup.connect(recorder(calls));
  const run: Run = await runReview(agent, board, level.messages);
  const result: Result = {
    level: level.level,
    setup: setup.name,
    run: i,
    pass: !run.error && level.pass(run),
    asked: run.text.startsWith('Before I review'),
    ms: Math.round(run.ms),
    ops: run.ops.length,
    offTarget: offTarget(run.ops, board, level),
    calls: calls.length,
    inputTokens: tokens(calls, 'inputTokens'),
    outputTokens: tokens(calls, 'outputTokens'),
    ...(run.error ? { error: run.error } : {}),
  };
  const file = `L${level.level}-${setup.name.replace(/\s+/g, '-')}-${i}.json`;
  const input = { level: level.level, name: level.name, problem: level.problem, scale: SCALE };
  writeFileSync(
    join(DIR, file),
    `${JSON.stringify({ input: { ...input, setup: setup.name, board, messages: level.messages }, output: { ...run, verdict: result }, calls }, null, 2)}\n`,
  );
  return result;
};

const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] ?? 0;
const sum = (rs: Result[], f: (r: Result) => number | boolean) =>
  rs.reduce((n, r) => n + Number(f(r)), 0);

/** One line per setup on a level: passes, questions, false alarms, time, tokens. */
const lineOf = (rs: Result[], name: string) =>
  `   ${name.padEnd(18)} passed ${sum(rs, (r) => r.pass)}/${rs.length} · asked ${sum(rs, (r) => r.asked)} · off-target ops ${sum(rs, (r) => r.offTarget)} · errors ${sum(rs, (r) => r.error !== undefined)} · ${(p50(rs.map((r) => r.ms)) / 1000).toFixed(1)} s p50 · ${Math.round(p50(rs.map((r) => r.inputTokens)) / 1000)}k tokens in`;

const results: Result[] = [];
await assertOnGpu(MODEL);
mkdirSync(DIR, { recursive: true });
out(`Ladder: ${RUNS} run(s) per setup, scale ${SCALE}; saved in ${DIR}`);
for (const level of LEVELS.filter((l) => ONLY.length === 0 || ONLY.includes(l.level))) {
  const board = boardFor(level, SCALE);
  out(`\n## L${level.level} ${level.name} (${board.nodes.length} boxes): ${level.problem}`);
  for (const setup of SETUPS) {
    const rows: Result[] = [];
    for (let i = 1; i <= RUNS; i++) rows.push(await runOnce(level, setup, board, i));
    results.push(...rows);
    out(lineOf(rows, setup.name));
  }
}

const table = [
  `| Level | Boxes | ${SETUPS.map((s) => s.name).join(' | ')} |`,
  `|---|---|${SETUPS.map(() => '---').join('|')}|`,
  ...LEVELS.filter((l) => results.some((r) => r.level === l.level)).map((l) => {
    const cell = (s: Setup) => {
      const rs = results.filter((r) => r.level === l.level && r.setup === s.name);
      return `${sum(rs, (r) => r.pass)}/${rs.length}`;
    };
    return `| L${l.level} ${l.name} | ${boardFor(l, SCALE).nodes.length} | ${SETUPS.map(cell).join(' | ')} |`;
  }),
];
out(`\n${table.join('\n')}`);
writeFileSync(
  join(DIR, 'summary.json'),
  `${JSON.stringify({ model: MODEL, hostedPlanner: HOSTED, runs: RUNS, scale: SCALE, results }, null, 2)}\n`,
);
writeFileSync(join(DIR, 'summary.md'), `${table.join('\n')}\n`);
