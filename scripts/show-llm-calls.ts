// Prints one review's model calls from the call log (LLM_CALL_LOG, M1-28), readable: what was
// sent (system prompt, board, chat, the agent's nudges) and what came back, call by call.
//
//   node scripts/show-llm-calls.ts <file>                 # the last review
//   node scripts/show-llm-calls.ts <file> --list          # every review in the file
//   node scripts/show-llm-calls.ts <file> --request <id>  # one review
//   node scripts/show-llm-calls.ts <file> --full          # also the whole system prompt

import { callsOf, flag, readCalls } from './lib/llmCalls.ts';

const args = process.argv.slice(2);
const file = args[0];
if (!file)
  throw new Error(
    'usage: node scripts/show-llm-calls.ts <file> [--list] [--request <id>] [--full]',
  );
const out = (s = '') => process.stdout.write(`${s}\n`);

if (args.includes('--list')) {
  for (const [id, calls] of readCalls(file)) {
    // The question as the review saw it: the first review round's last user message, after the board.
    const review = calls.find((c) => c.tools.length > 0) ?? calls[0];
    const question = review?.messages.findLast((m) => m.role === 'user')?.content ?? '';
    const asked = question.split('</board>').at(-1)?.trim() ?? '';
    out(`${calls[0]?.time}  ${id}  ${calls.length} call(s)  "${asked.slice(0, 80)}"`);
  }
  process.exit(0);
}

const { id, calls } = callsOf(file, flag(args, '--request'));
out(`Review ${id}: ${calls.length} model call(s)\n`);

type Call = (typeof calls)[number];
type Message = Call['messages'][number];

/** One call's header: what it was, how long, how many tokens, how it ended. */
const header = (call: Call, i: number) => {
  // The scope guard is a short call with no tools; the review rounds offer the agent's tools.
  const kind = call.tools.length === 0 ? 'scope check' : 'review round';
  const tokens = call.usage
    ? ` · ${call.usage.inputTokens} in / ${call.usage.outputTokens} out`
    : '';
  const error = call.error ? ` · ERROR ${call.error}` : '';
  return `═══════ call ${i + 1} — ${kind} · ${call.ms} ms${tokens}${error}${call.stopped ? ' · stopped' : ''}`;
};

/** What a message carries besides its text: the tool calls it makes, or the call it answers. */
const extraOf = (m: Message) => {
  if (m.role === 'assistant' && m.toolCalls?.length)
    return `\n  tool calls: ${m.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.arguments)})`).join(', ')}`;
  return m.role === 'tool' ? ` (result of ${m.toolCallId})` : '';
};

const printMessage = (m: Message, previous: Call | undefined) => {
  if (m.role === 'system' && !args.includes('--full')) {
    out(`── system (${m.content.length} chars; --full to show) ──`);
    return;
  }
  // Earlier rounds' messages repeat in each later call: show only what's new in this one.
  if (previous?.messages.some((p) => JSON.stringify(p) === JSON.stringify(m))) return;
  out(`── ${m.role}${extraOf(m)} ──`);
  out(m.content);
};

calls.forEach((call, i) => {
  out(header(call, i));
  for (const m of call.messages) printMessage(m, i > 0 ? calls[i - 1] : undefined);
  out('── ANSWER ──');
  out(call.output.text || '(no text)');
  for (const t of call.output.toolCalls) out(`  → ${t.name}(${JSON.stringify(t.arguments)})`);
  out();
});
