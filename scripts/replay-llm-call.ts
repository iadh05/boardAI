// Divide and conquer for the agent (M1-28): sends ONE recorded model call — exactly the same
// messages, and the tools by name — to the model again, N times, with no agent loop around it.
// The tool definitions are today's: a call recorded before a tool changed is not replayed exactly.
//   - The model answers badly here too → the problem is in the input (prompt, board text) or the
//     model, not in our loop.
//   - It answers well here, badly in the app → look at the loop (nudges, rounds, history).
// --system swaps the system prompt for a file's content: try a prompt fix without touching the app.
//
//   node scripts/replay-llm-call.ts <file> [--request <id>] [--call 2] [--runs 5] [--system prompt.txt]

import { readFileSync } from 'node:fs';
import { AGENT_TOOLS } from '../packages/agent/src/index.ts';
import { callsOf, flag } from './lib/llmCalls.ts';
import { assertOnGpu, connectRealModel, oneLine } from './lib/realModel.ts';

const args = process.argv.slice(2);
const file = args[0];
if (!file)
  throw new Error(
    'usage: node scripts/replay-llm-call.ts <file> [--request <id>] [--call n] [--runs n] [--system file]',
  );
const runs = Number(flag(args, '--runs') ?? '5');
const model = flag(args, '--model') ?? 'designroom-qwen';
const systemFile = flag(args, '--system');
const out = (s = '') => process.stdout.write(`${s}\n`);

const { id, calls } = callsOf(file, flag(args, '--request'));
const index = Number(flag(args, '--call') ?? String(calls.length)) - 1; // default: the last call
const call = calls[index];
if (!call) throw new Error(`Review ${id} has ${calls.length} call(s); no call ${index + 1}`);

const messages = systemFile
  ? call.messages.map((m) =>
      m.role === 'system' ? { ...m, content: readFileSync(systemFile, 'utf8') } : m,
    )
  : call.messages;
// The log keeps tool names only: their definitions are today's. Say so when they differ.
const tools = AGENT_TOOLS.filter((t) => call.tools.includes(t.name));
const missing = call.tools.filter((name) => !tools.some((t) => t.name === name));
if (missing.length > 0)
  out(`Note: tools no longer in the code, left out of the replay: ${missing.join(', ')}`);

await assertOnGpu(model);
const { llm } = connectRealModel(model);

out(
  `Replaying call ${index + 1} of review ${id}, ${runs} time(s)${systemFile ? `, system prompt from ${systemFile}` : ''}`,
);
out(`Recorded answer: ${oneLine(call.output.text)}`);
for (const t of call.output.toolCalls) out(`  → ${t.name}(${JSON.stringify(t.arguments)})`);
out();

for (let run = 1; run <= runs; run++) {
  let text = '';
  const toolCalls: string[] = [];
  const started = performance.now();
  for await (const chunk of llm.chat({
    messages,
    tools,
    ...(call.temperature === undefined ? {} : { temperature: call.temperature }),
  })) {
    if (chunk.type === 'text') text += chunk.delta;
    else if (chunk.type === 'toolCall')
      toolCalls.push(`${chunk.call.name}(${JSON.stringify(chunk.call.arguments)})`);
  }
  out(`── run ${run} · ${Math.round(performance.now() - started)} ms ──`);
  out(oneLine(text, 600) || '(no text)');
  for (const t of toolCalls) out(`  → ${t}`);
}
process.exit(0);
