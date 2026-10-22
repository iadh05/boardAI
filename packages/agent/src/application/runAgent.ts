import { context, isSpanContextValid, type Context, type Span } from '@opentelemetry/api';
import type {
  AiGateway,
  LlmErrorCode,
  LlmMessage,
  LlmToolCall,
  Usage,
} from '@designroom/ai-gateway';
import type { Board, ChatMessage, Proposal } from '@designroom/domain';
import { boardToText, inventoryText, quote } from '../domain/boardToText.ts';
import type { MergedFinding } from '../domain/findings.ts';
import { createIdRewriter } from '../domain/idRewriter.ts';
import { createLeakWatch } from '../domain/leakWatch.ts';
import { buildMessages, REFUSAL_WORDING, SYSTEM_PROMPT } from '../domain/prompt.ts';
import { OUT_OF_SCOPE_REPLY, type Scope } from '../domain/scope.ts';
import { summarize } from '../domain/summary.ts';
import {
  AGENT_TOOLS,
  ASK_USER,
  createDraft,
  runToolCall,
  unconnectedNewBoxes,
  type Draft,
  type ToolOutcome,
} from '../domain/tools.ts';
import { checkScope, type ScopeQuestion } from './checkScope.ts';
import { createAgentMetrics, markFailed, startSpan, toolLabel } from './telemetry.ts';

// The agent loop (architecture §7): the model answers; its tool calls run on a draft of the board;
// the results go back to the model; repeat until it stops calling tools or the round limit.
// The board is never changed here: the outcome is at most one proposal the user accepts or not.

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'proposal'; proposal: Proposal }
  /** One per model call: what it cost and how its tool calls went (metering, M1-24). */
  | { type: 'round'; round: number; usage: Usage | null; toolCalls: number; toolErrors: number }
  | { type: 'error'; code: LlmErrorCode; message: string }
  | { type: 'done' };

export type AgentDeps = {
  /** Injected so the agent itself does no I/O: the server passes the real gateway, tests a fake. */
  llm: AiGateway;
  /** Ids for new nodes, edges and the proposal (crypto.randomUUID in the server). */
  newId: () => string;
  /** Most model calls per request (chatPolicy): a model that keeps calling tools is stopped. */
  maxRounds?: number;
  /**
   * Put tool arguments and replies on the tool spans, for Phoenix (M1-26c). Off by default: they
   * can quote the board — for a local Phoenix only (architecture §9).
   */
  recordContent?: boolean;
  /** The scope guard; by default one short call to `llm`. Injected in tests. */
  checkScope?: (question: ScopeQuestion) => Promise<Scope>;
  /**
   * A random word put in the system prompt (M1-24d): if an answer writes it, the prompt is
   * leaking, even translated. Random per server start (infra); none in most tests.
   */
  canary?: string;
};

/** Said instead of the rest of an answer that started giving the system prompt away. */
export const LEAK_STOPPED_REPLY =
  'I don’t share my instructions. Ask me about the architecture on your board.';

/**
 * The one observation for an answer with no tool call (M1-32). Worded as the runtime's error, not
 * as the user: a chat API has no other slot for it, since there is no tool call to answer.
 */
export const FORMAT_ERROR =
  '[format error] Your answer had no tool call. End every answer with a tool call: the changes you propose followed by finish(summary), finish alone if nothing should change, or ask_user(question).';

export type AgentInput = {
  board: Board;
  messages: readonly ChatMessage[];
  signal?: AbortSignal;
  /** The specialists' merged findings (agent V2, AV2-07): the agent explains and fixes them. */
  findings?: readonly MergedFinding[];
  /** The caller already ran the scope guard (agent V2's Main): not asked twice. */
  scoped?: boolean;
  /** The Critic's issues with a first proposal (AV2-08): the agent proposes again without them. */
  critique?: readonly string[];
};

/** Findings as the model reads them: `- [critical] n2 "Postgres" (data): problem. Fix: fix.` */
const findingsText = (findings: readonly MergedFinding[], draft: Draft) =>
  findings
    .map((f) => {
      const boxes = f.boxIds
        .map((id) => {
          const node = draft.board.nodes.find((n) => n.id === id);
          return `${draft.aliases.nodeAlias(id) ?? '?'} ${quote(node?.label ?? '')}`;
        })
        .join(', ');
      return `- [${f.severity}] ${boxes} (${f.from.join(', ')}): ${f.problem}.${f.fix ? ` Fix: ${f.fix}.` : ''}`;
    })
    .join('\n');

const DEFAULT_MAX_ROUNDS = 5;

type GatewayError = Error & { code: LlmErrorCode };

/** The gateway throws LlmError; the agent may only import its types, so it checks the shape. */
const isGatewayError = (error: unknown): error is GatewayError =>
  error instanceof Error &&
  error.name === 'LlmError' &&
  typeof (error as GatewayError).code === 'string';

const TOOL_NAMES = AGENT_TOOLS.map((t) => t.name);

/**
 * The agent span's ids, for the proposal: Accept/Reject comes back as feedback on that span
 * (M1-26c). None when tracing is off (the span is a no-op with an invalid id).
 */
const traceOf = (span: Span) => {
  const ids = span.spanContext();
  return isSpanContextValid(ids) ? { traceId: ids.traceId, spanId: ids.spanId } : {};
};

export const createAgent = (deps: AgentDeps) => {
  const metered = createAgentMetrics();

  async function* review(
    { board, messages, signal, findings, scoped, critique }: AgentInput,
    parent: Context,
  ): AsyncIterable<AgentEvent> {
    const agent = startSpan('agent', 'AGENT', parent);
    let draft = createDraft(board);
    let rounds = 0;
    try {
      // Scope guard first: a message about something else gets a fixed reply, and the reviewer
      // (with its tools) never runs. Enforced here, in code — not left to the prompt.
      const question = messages.findLast((m) => m.role === 'user')?.content ?? '';
      const previousAnswer = messages.findLast((m) => m.role === 'assistant')?.content;
      let scope: Scope = 'in'; // the caller (agent V2's Main) already checked it: `scoped`
      if (!scoped) {
        const guard = startSpan('scope check', 'GUARDRAIL', agent.inside);
        try {
          scope = await context.with(guard.inside, () =>
            (deps.checkScope ?? ((q) => checkScope(deps.llm, q)))({
              question,
              ...(previousAnswer === undefined ? {} : { previousAnswer }),
              ...(signal ? { signal } : {}),
            }),
          );
          guard.span.setAttribute('designroom.agent.scope', scope);
          metered.scope(scope);
        } finally {
          guard.span.end();
        }
      }
      if (scope === 'out') {
        yield { type: 'text', delta: OUT_OF_SCOPE_REPLY };
        yield { type: 'done' };
        return;
      }

      const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
      // What exists by kind, then the listing — both inside the <board> block (M1-29).
      const boardText = [inventoryText(board, draft.aliases), boardToText(board, draft.aliases)]
        .filter(Boolean)
        .join('\n\n');
      const conversation: LlmMessage[] = buildMessages(
        boardText,
        messages,
        deps.canary,
        findings?.length ? findingsText(findings, draft) : undefined,
        critique?.length ? critique.map((issue) => `- ${issue}`).join('\n') : undefined,
      );
      // Output guard: the answer is cut where it starts reciting the prompt (OWASP LLM07).
      const watch = createLeakWatch({
        prompt: SYSTEM_PROMPT,
        // Refusals repeat the prompt's wording on purpose: that is the guard working.
        allowed: `${OUT_OF_SCOPE_REPLY}\n${REFUSAL_WORDING}`,
        ...(deps.canary ? { canary: deps.canary } : {}),
      });
      let spoke = false; // an earlier round wrote something
      let finished = false; // the answer is over: finish, ask_user, or no tool call twice
      let formatWarned = false; // sent the one format-error observation (M1-32)
      let holding = false; // the next round answers the format error
      let ended: ToolOutcome['end']; // the model called finish or ask_user
      /** A box's name from its id in the draft, for the user's text (M1-29): "n10" → its label. */
      const labelOf = (alias: string) => {
        const id = draft.aliases.nodeId(alias);
        return id ? draft.board.nodes.find((n) => n.id === id)?.label : undefined;
      };

      // Valid ops so far, as one proposal: also sent when a later round fails, because the text the
      // user already read may say "I've added a cache".
      // An answer that ended by itself with a new box no arrow reached: that box fixes nothing and
      // is left out (finish refuses it; this is for an answer that stood without finish — review of
      // M1-32). Cut short (an error, the round limit), the work in progress is kept as it is.
      const proposal = (complete = false): AgentEvent[] => {
        const floating = new Set(complete ? unconnectedNewBoxes(draft.ops) : []);
        const ops = draft.ops.filter(
          (op) => !((op.op === 'addNode' || op.op === 'updateNode') && floating.has(op.nodeId)),
        );
        return ops.length === 0
          ? []
          : [
              {
                type: 'proposal',
                proposal: {
                  id: deps.newId(),
                  summary: summarize(ops, board, draft.board),
                  ops,
                  ...traceOf(agent.span),
                },
              },
            ];
      };

      for (let round = 1; round <= maxRounds && !finished; round++) {
        rounds = round;
        const step = startSpan('agent round', 'CHAIN', agent.inside, {
          'designroom.agent.round': round,
        });
        try {
          const calls: LlmToolCall[] = [];
          let said = '';
          const hold = holding; // this round answers the format error: its text waits (M1-32)
          holding = false;
          let held = '';
          let usage: Usage | null = null;
          // The user sees names, not ids (M1-29): "n10" → "Payment Service". The model's own text
          // (`said`, sent back to it next round) keeps its ids.
          const ids = createIdRewriter(labelOf);
          try {
            // A copy: the conversation grows after this call, the request must not change with it.
            const request = { messages: [...conversation], tools: AGENT_TOOLS, signal };
            // Called inside the round's span, so the gateway's LLM span is the round's child.
            const answer = context.with(step.inside, () => deps.llm.chat(request));
            for await (const chunk of answer) {
              if (chunk.type === 'text') {
                // Checked before it is shown: the piece that completes a leak never reaches the user.
                if (watch.feed(chunk.delta)) {
                  agent.span.setAttribute('designroom.agent.leak_stopped', true);
                  yield {
                    type: 'text',
                    delta: `${said || spoke ? '\n\n' : ''}${LEAK_STOPPED_REPLY}`,
                  };
                  yield { type: 'done' }; // no proposal: this answer is not one to act on
                  return; // stops reading: the gateway cancels the model call
                }
                // A new round's text starts a new paragraph, not glued to the last sentence.
                const start = said === '' && spoke ? '\n\n' : '';
                said += chunk.delta;
                const shown = start + ids.feed(chunk.delta);
                if (hold) held += shown;
                else if (shown) yield { type: 'text', delta: shown };
              } else if (chunk.type === 'toolCall') calls.push(chunk.call);
              else usage = chunk.usage;
            }
            const rest = ids.flush();
            if (hold) held += rest;
            else if (rest) yield { type: 'text', delta: rest };
          } catch (error) {
            if (!isGatewayError(error)) throw error; // a bug, not a model failure
            const rest = ids.flush(); // what was held back was already said
            if (rest && !hold) yield { type: 'text', delta: rest };
            if (error.code !== 'ABORTED') {
              markFailed(step.span, error.message);
              markFailed(agent.span, error.message);
            }
            yield { type: 'round', round, usage: null, toolCalls: 0, toolErrors: 0 };
            yield* proposal();
            yield { type: 'error', code: error.code, message: error.message };
            yield { type: 'done' };
            return;
          }
          // The round after the format error: its text goes out only with the calls it explains;
          // without them it answers a message the user never saw ("Sure, …"), so it is dropped.
          const kept = !hold || calls.length > 0;
          if (hold && kept && held.trim()) yield { type: 'text', delta: held };
          spoke ||= kept && said.trim() !== '';

          let toolErrors = 0;
          if (calls.length > 0) {
            conversation.push({ role: 'assistant', content: said, toolCalls: calls });
            for (const call of calls) {
              const name = toolLabel(call.name, TOOL_NAMES);
              const used = startSpan(`tool ${name}`, 'TOOL', step.inside, { 'tool.name': name });
              const outcome = runToolCall(draft, call, deps);
              draft = outcome.draft;
              ended = outcome.end;
              // The arguments and the reply can quote labels: in the trace only with content on
              // (local Phoenix, M1-26c).
              if (deps.recordContent)
                used.span.setAttributes({
                  'input.value': JSON.stringify(call.arguments),
                  'output.value': outcome.reply,
                });
              if (!outcome.ok) {
                toolErrors++;
                markFailed(used.span, deps.recordContent ? outcome.reply : 'refused');
              }
              used.span.end();
              metered.toolCall(name, outcome.ok);
              conversation.push({ role: 'tool', toolCallId: call.id, content: outcome.reply });
              if (ended) break; // the answer is over: calls after finish or ask_user don't run
            }
          }
          step.span.setAttributes({
            'designroom.agent.tool_calls': calls.length,
            'designroom.agent.tool_errors': toolErrors,
          });
          yield { type: 'round', round, usage, toolCalls: calls.length, toolErrors };
          if (ended) {
            // finish or ask_user ended the answer (M1-32). A question is always shown — it's what
            // the user must answer; a summary only when the model said nothing in words. Both go
            // through the same leak guard as any text (an attack could ask for the prompt in them).
            finished = true;
            // "Said nothing" is this round: a preamble two rounds ago doesn't explain the changes.
            const shown = ended.tool === ASK_USER || said.trim() === '' ? ended.text : '';
            if (shown) {
              if (watch.feed(shown)) {
                agent.span.setAttribute('designroom.agent.leak_stopped', true);
                yield { type: 'text', delta: `${spoke ? '\n\n' : ''}${LEAK_STOPPED_REPLY}` };
                yield { type: 'done' };
                return;
              }
              const named = createIdRewriter(labelOf);
              yield {
                type: 'text',
                delta: `${spoke ? '\n\n' : ''}${named.feed(shown)}${named.flush()}`,
              };
              spoke = true;
            }
          } else if (calls.length === 0) {
            // No tool call: one format-error observation, then the answer stands as it is (M1-32).
            // Only with a round left: otherwise the user would read "I stopped here" for nothing.
            finished = formatWarned || round === maxRounds;
            if (!finished) {
              formatWarned = true;
              holding = true;
              agent.span.setAttribute('designroom.agent.format_error', true);
              conversation.push({ role: 'assistant', content: said });
              conversation.push({ role: 'user', content: FORMAT_ERROR });
            }
          }
        } finally {
          step.span.end();
        }
      }

      // Cut off mid-work: say so, rather than end on "Now let me connect…".
      if (!finished)
        yield {
          type: 'text',
          delta: `${spoke ? '\n\n' : ''}(I stopped here: that was the most steps I take in one answer. Ask me to continue.)`,
        };
      yield* proposal(finished);
      yield { type: 'done' };
    } catch (error) {
      markFailed(agent.span, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      agent.span.setAttributes({
        'designroom.agent.rounds': rounds,
        'designroom.agent.ops': draft.ops.length,
      });
      agent.span.end();
      if (rounds > 0) metered.review(rounds); // none when the scope guard answered
    }
  }

  return {
    // Not an async generator itself: a generator's body runs on its first read, in the reader's
    // context. Reading the active context here, at the call, puts the agent span under the
    // caller's (the request), wherever the stream is read from.
    run: (input: AgentInput): AsyncIterable<AgentEvent> => review(input, context.active()),
  };
};
