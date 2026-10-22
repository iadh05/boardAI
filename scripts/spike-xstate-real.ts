// SPIKE (ADR-011): real reviews on each harness — same local models, same request, alternating.
//   node scripts/spike-xstate-real.ts [--rounds 3] [--xstate-first]
import { createAgent, createReviewerV2, RULE_SPECIALISTS } from '../packages/agent/src/index.ts';
import { createReviewerXState } from '../packages/agent/src/application/reviewerXState.ts';
import { assertOnGpu, boardOf, gatewayOf, oneLine } from './lib/realModel.ts';

const args = process.argv.slice(2);
const ROUNDS = Number(args[args.indexOf('--rounds') + 1] ?? 3) || 3;
const XSTATE_FIRST = args.includes('--xstate-first');
const MODEL = 'designroom-qwen';
const out = (line = '') => process.stdout.write(`${line}\n`);
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
const deps = () => {
  const local = gatewayOf(MODEL);
  return {
    main: local,
    planner: gatewayOf(MODEL, 'ollama', true),
    architect: createAgent({ llm: local, newId: () => crypto.randomUUID() }),
    specialists: RULE_SPECIALISTS,
  };
};

await assertOnGpu(MODEL);
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const order = ONLY ? [ONLY] : XSTATE_FIRST ? ['xstate', 'our runtime'] : ['our runtime', 'xstate'];
for (let round = 1; round <= ROUNDS; round++)
  for (const name of order) {
    const reviewer = name === 'xstate' ? createReviewerXState(deps()) : createReviewerV2(deps());
    const start = performance.now();
    let progress = 0;
    let proposal = '';
    let text = '';
    for await (const e of reviewer.run({
      board,
      messages: [{ role: 'user', content: 'Review my design.' }],
    })) {
      if (e.type === 'progress') progress++;
      if (e.type === 'proposal') proposal = e.proposal.summary;
      if (e.type === 'text') text += e.delta;
    }
    const secs = ((performance.now() - start) / 1000).toFixed(1);
    const outcome = proposal
      ? `proposal (${proposal.split(';').length} ops)`
      : text.startsWith('Before I review')
        ? 'Planner asked questions'
        : `other: ${oneLine(text, 60)}`;
    out(
      `round ${round} · ${name.padEnd(11)} ${secs.padStart(5)} s · ${progress} progress · ${outcome}`,
    );
  }
