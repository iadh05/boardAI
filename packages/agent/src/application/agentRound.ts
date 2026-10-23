import { context, isSpanContextValid, type Span } from '@opentelemetry/api';
import type {
  LlmChunk,
  LlmErrorCode,
  LlmMessage,
  LlmToolCall,
  Usage,
} from '@designroom/ai-gateway';
import type { Board } from '@designroom/domain';
import { createIdRewriter } from '../domain/idRewriter.ts';
import type { createLeakWatch } from '../domain/leakWatch.ts';
import { summarize } from '../domain/summary.ts';
import {
  AGENT_TOOLS,
  ASK_USER,
  runToolCall,
  unconnectedNewBoxes,
  type Draft,
  type ToolOutcome,
} from '../domain/tools.ts';
import type { AgentDeps, AgentEvent } from './runAgent.ts';
import { type createAgentMetrics, markFailed, startSpan, toolLabel } from './telemetry.ts';

// The steps of one agent round (architecture §7), split out of the loop in runAgent.ts so each is
// readable alone (ADR-014): stream the model's answer, run its tool calls, end on finish or
// ask_user, or send the one format-error observation. The loop's state lives in a `Turn`.

/** Said instead of the rest of an answer that started giving the system prompt away. */
export const LEAK_STOPPED_REPLY =
  'I don’t share my instructions. Ask me about the architecture on your board.';

/**
 * The one observation for an answer with no tool call (M1-32). Worded as the runtime's error, not
 * as the user: a chat API has no other slot for it, since there is no tool call to answer.
 */
export const FORMAT_ERROR =
  '[format error] Your answer had no tool call. End every answer with a tool call: the changes you propose followed by finish(summary), finish alone if nothing should change, or ask_user(question).';

/** What one request's loop knows between rounds. */
export type Turn = {
  draft: Draft;
  conversation: LlmMessage[];
  /** An earlier round wrote something. */
  spoke: boolean;
  /** The answer is over: finish, ask_user, or no tool call twice. */
  finished: boolean;
  /** Sent the one format-error observation (M1-32). */
  formatWarned: boolean;
  /** The next round answers the format error: its text waits. */
  holding: boolean;
};

/** What every step needs about the request, fixed for its whole life. */
export type RoundContext = {
  deps: AgentDeps;
  metered: ReturnType<typeof createAgentMetrics>;
  board: Board;
  agent: ReturnType<typeof startSpan>;
  watch: ReturnType<typeof createLeakWatch>;
  signal: AbortSignal | undefined;
};

type GatewayError = Error & { code: LlmErrorCode };

/** The gateway throws LlmError; the agent may only import its types, so it checks the shape. */
const isGatewayError = (error: unknown): error is GatewayError =>
  error instanceof Error &&
  error.name === 'LlmError' &&
  typeof (error as GatewayError).code === 'string';

const TOOL_NAMES = AGENT_TOOLS.map((t) => t.name);
const paragraph = (before: boolean) => (before ? '\n\n' : '');

/**
 * The agent span's ids, for the proposal: Accept/Reject comes back as feedback on that span
 * (M1-26c). None when tracing is off (the span is a no-op with an invalid id).
 */
const traceOf = (span: Span) => {
  const ids = span.spanContext();
  return isSpanContextValid(ids) ? { traceId: ids.traceId, spanId: ids.spanId } : {};
};

/** A box's name from its alias in the draft, for the user's text (M1-29): "n10" → its label. */
export const labelOf = (turn: Turn) => (alias: string) => {
  const id = turn.draft.aliases.nodeId(alias);
  return id ? turn.draft.board.nodes.find((n) => n.id === id)?.label : undefined;
};

/**
 * Valid ops so far, as one proposal: also sent when a later round fails, because the text the user
 * already read may say "I've added a cache". An answer that ended by itself with a new box no arrow
 * reached leaves that box out (finish refuses it; this is for an answer that stood without finish —
 * review of M1-32). Cut short (an error, the round limit), the work in progress is kept as it is.
 */
export const proposalEvents = (ctx: RoundContext, turn: Turn, complete = false): AgentEvent[] => {
  const floating = new Set(complete ? unconnectedNewBoxes(turn.draft.ops) : []);
  const ops = turn.draft.ops.filter(
    (op) => !((op.op === 'addNode' || op.op === 'updateNode') && floating.has(op.nodeId)),
  );
  if (ops.length === 0) return [];
  const summary = summarize(ops, ctx.board, turn.draft.board);
  return [
    {
      type: 'proposal',
      proposal: { id: ctx.deps.newId(), summary, ops, ...traceOf(ctx.agent.span) },
    },
  ];
};

/** The answer stops where it started reciting the prompt: no proposal, the request ends. */
function* stopLeak(ctx: RoundContext, before: boolean): Generator<AgentEvent> {
  ctx.agent.span.setAttribute('designroom.agent.leak_stopped', true);
  yield { type: 'text', delta: `${paragraph(before)}${LEAK_STOPPED_REPLY}` };
  yield { type: 'done' };
}

type Streamed =
  | { stopped: true }
  | { stopped: false; said: string; calls: LlmToolCall[]; usage: Usage | null; held: string };

type IdRewriter = ReturnType<typeof createIdRewriter>;

/** The model's answer, piece by piece: text shown (or held), tool calls and usage collected. */
async function* readAnswer(
  ctx: RoundContext,
  turn: Turn,
  answer: AsyncIterable<LlmChunk>,
  ids: IdRewriter,
  hold: boolean,
): AsyncGenerator<AgentEvent, Streamed> {
  const calls: LlmToolCall[] = [];
  let said = '';
  let held = '';
  let usage: Usage | null = null;
  for await (const chunk of answer) {
    if (chunk.type === 'toolCall') calls.push(chunk.call);
    else if (chunk.type !== 'text') usage = chunk.usage;
    // Checked before it is shown: the piece that completes a leak never reaches the user.
    else if (ctx.watch.feed(chunk.delta)) {
      yield* stopLeak(ctx, said !== '' || turn.spoke);
      return { stopped: true }; // stops reading: the gateway cancels the model call
    } else {
      // A new round's text starts a new paragraph, not glued to the last sentence.
      const shown = paragraph(said === '' && turn.spoke) + ids.feed(chunk.delta);
      said += chunk.delta;
      if (hold) held += shown;
      else if (shown) yield { type: 'text', delta: shown };
    }
  }
  return { stopped: false, said, calls, usage, held };
}

/**
 * One model call, streamed to the user as it comes: ids shown as names (M1-29), the leak guard on
 * every piece before it's shown. `hold`: the round answering the format error keeps its text back.
 */
async function* streamAnswer(
  ctx: RoundContext,
  turn: Turn,
  step: ReturnType<typeof startSpan>,
  hold: boolean,
): AsyncGenerator<AgentEvent, Streamed> {
  // The user sees names, not ids; the model's own text (`said`, sent back next round) keeps them.
  const ids = createIdRewriter(labelOf(turn));
  // A copy: the conversation grows after this call, the request must not change with it.
  const request = { messages: [...turn.conversation], tools: AGENT_TOOLS, signal: ctx.signal };
  // Called inside the round's span, so the gateway's LLM span is the round's child.
  const answer = context.with(step.inside, () => ctx.deps.llm.chat(request));
  let streamed: Streamed;
  try {
    streamed = yield* readAnswer(ctx, turn, answer, ids, hold);
  } catch (error) {
    // The model failed mid-answer: what the rewriter held back was already said — show it first.
    const rest = ids.flush();
    if (rest && !hold) yield { type: 'text', delta: rest };
    throw error;
  }
  if (streamed.stopped) return streamed;
  const rest = ids.flush();
  if (hold) return { ...streamed, held: streamed.held + rest };
  if (rest) yield { type: 'text', delta: rest };
  return streamed;
}

/** The model failed (or Stop): what was done so far as a proposal, then the error, then done. */
function* failRound(
  ctx: RoundContext,
  turn: Turn,
  step: ReturnType<typeof startSpan>,
  round: number,
  error: GatewayError,
): Generator<AgentEvent> {
  if (error.code !== 'ABORTED') {
    markFailed(step.span, error.message);
    markFailed(ctx.agent.span, error.message);
  }
  yield { type: 'round', round, usage: null, toolCalls: 0, toolErrors: 0 };
  yield* proposalEvents(ctx, turn);
  yield { type: 'error', code: error.code, message: error.message };
  yield { type: 'done' };
}

/** The model's tool calls on the draft, each a span; stops after finish or ask_user. */
const runTools = (
  ctx: RoundContext,
  turn: Turn,
  step: ReturnType<typeof startSpan>,
  calls: readonly LlmToolCall[],
): { toolErrors: number; ended: ToolOutcome['end'] } => {
  let toolErrors = 0;
  let ended: ToolOutcome['end'];
  for (const call of calls) {
    const name = toolLabel(call.name, TOOL_NAMES);
    const used = startSpan(`tool ${name}`, 'TOOL', step.inside, { 'tool.name': name });
    const outcome = runToolCall(turn.draft, call, ctx.deps);
    turn.draft = outcome.draft;
    ended = outcome.end;
    // The arguments and the reply can quote labels: in the trace only with content on (M1-26c).
    if (ctx.deps.recordContent)
      used.span.setAttributes({
        'input.value': JSON.stringify(call.arguments),
        'output.value': outcome.reply,
      });
    if (!outcome.ok) {
      toolErrors++;
      markFailed(used.span, ctx.deps.recordContent ? outcome.reply : 'refused');
    }
    used.span.end();
    ctx.metered.toolCall(name, outcome.ok);
    turn.conversation.push({ role: 'tool', toolCallId: call.id, content: outcome.reply });
    if (ended) break; // the answer is over: calls after finish or ask_user don't run
  }
  return { toolErrors, ended };
};

/**
 * finish or ask_user ended the answer (M1-32). A question is always shown — it's what the user must
 * answer; a summary only when the model said nothing in words this round. Both go through the leak
 * guard like any text (an attack could ask for the prompt in them). Returns true when it stopped.
 */
function* showEnding(
  ctx: RoundContext,
  turn: Turn,
  ended: NonNullable<ToolOutcome['end']>,
  said: string,
): Generator<AgentEvent, boolean> {
  turn.finished = true;
  const shown = ended.tool === ASK_USER || said.trim() === '' ? ended.text : '';
  if (!shown) return false;
  if (ctx.watch.feed(shown)) {
    yield* stopLeak(ctx, turn.spoke);
    return true;
  }
  const named = createIdRewriter(labelOf(turn));
  yield { type: 'text', delta: `${paragraph(turn.spoke)}${named.feed(shown)}${named.flush()}` };
  turn.spoke = true;
  return false;
}

/**
 * No tool call: one format-error observation, then the answer stands as it is (M1-32). Only with a
 * round left: otherwise the user would read "I stopped here" for nothing.
 */
const warnFormat = (ctx: RoundContext, turn: Turn, said: string, lastRound: boolean) => {
  turn.finished = turn.formatWarned || lastRound;
  if (turn.finished) return;
  turn.formatWarned = true;
  turn.holding = true;
  ctx.agent.span.setAttribute('designroom.agent.format_error', true);
  turn.conversation.push({ role: 'assistant', content: said });
  turn.conversation.push({ role: 'user', content: FORMAT_ERROR });
};

/** One round: the model's answer, its tool calls, then how the answer goes on. True: stop now. */
export async function* playRound(
  ctx: RoundContext,
  turn: Turn,
  round: number,
  lastRound: boolean,
): AsyncGenerator<AgentEvent, boolean> {
  const step = startSpan('agent round', 'CHAIN', ctx.agent.inside, {
    'designroom.agent.round': round,
  });
  try {
    const hold = turn.holding; // this round answers the format error: its text waits (M1-32)
    turn.holding = false;
    let streamed: Streamed;
    try {
      streamed = yield* streamAnswer(ctx, turn, step, hold);
    } catch (error) {
      if (!isGatewayError(error)) throw error; // a bug, not a model failure
      yield* failRound(ctx, turn, step, round, error);
      return true;
    }
    if (streamed.stopped) return true;
    const { said, calls, usage, held } = streamed;
    // The round after the format error: its text goes out only with the calls it explains; without
    // them it answers a message the user never saw ("Sure, …"), so it is dropped.
    const kept = !hold || calls.length > 0;
    if (hold && kept && held.trim()) yield { type: 'text', delta: held };
    turn.spoke ||= kept && said.trim() !== '';

    if (calls.length > 0)
      turn.conversation.push({ role: 'assistant', content: said, toolCalls: calls });
    const { toolErrors, ended } = runTools(ctx, turn, step, calls);
    step.span.setAttributes({
      'designroom.agent.tool_calls': calls.length,
      'designroom.agent.tool_errors': toolErrors,
    });
    yield { type: 'round', round, usage, toolCalls: calls.length, toolErrors };
    if (ended) return yield* showEnding(ctx, turn, ended, said);
    if (calls.length === 0) warnFormat(ctx, turn, said, lastRound);
    return false;
  } finally {
    step.span.end();
  }
}
