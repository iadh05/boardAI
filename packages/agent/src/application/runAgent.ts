import { context, type Context } from '@opentelemetry/api';
import type { AiGateway, LlmErrorCode, Usage } from '@designroom/ai-gateway';
import type { Board, ChatMessage, Proposal } from '@designroom/domain';
import { boardToText, inventoryText, quote } from '../domain/boardToText.ts';
import type { MergedFinding } from '../domain/findings.ts';
import { createIdRewriter } from '../domain/idRewriter.ts';
import { createLeakWatch } from '../domain/leakWatch.ts';
import { buildMessages, REFUSAL_WORDING, SYSTEM_PROMPT } from '../domain/prompt.ts';
import { OUT_OF_SCOPE_REPLY, type Scope } from '../domain/scope.ts';
import {
  AGENT_TOOLS,
  ASK_USER,
  createDraft,
  runToolCall,
  type Draft,
  type ToolOutcome,
} from '../domain/tools.ts';
import {
  FORMAT_ERROR,
  LEAK_STOPPED_REPLY,
  labelOf,
  proposalEvents,
  streamAnswer,
  type RoundContext,
  type Streamed,
  type Turn,
} from './agentRound.ts';
import { checkScope, type ScopeQuestion } from './checkScope.ts';
import { createAgentMetrics, markFailed, startSpan, toolLabel } from './telemetry.ts';

// The agent loop (architecture §7): the model answers; its tool calls run on a draft of the board;
// the results go back to the model; repeat until it stops calling tools or the round limit.
// The board is never changed here: the outcome is at most one proposal the user accepts or not.
// Streaming the model's answer is in agentRound.ts.

export { FORMAT_ERROR, LEAK_STOPPED_REPLY } from './agentRound.ts';

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

export const createAgent = (deps: AgentDeps) => {
  const metered = createAgentMetrics();

  async function* review(
    { board, messages, signal, findings, scoped, critique }: AgentInput,
    parent: Context,
  ): AsyncIterable<AgentEvent> {
    const agent = startSpan('agent', 'AGENT', parent);
    const draft = createDraft(board);
    // What exists by kind, then the listing — both inside the <board> block (M1-29).
    const boardText = [inventoryText(board, draft.aliases), boardToText(board, draft.aliases)]
      .filter(Boolean)
      .join('\n\n');
    const turn: Turn = {
      draft,
      conversation: buildMessages(
        boardText,
        messages,
        deps.canary,
        findings?.length ? findingsText(findings, draft) : undefined,
        critique?.length ? critique.map((issue) => `- ${issue}`).join('\n') : undefined,
      ),
      spoke: false,
      finished: false,
      formatWarned: false,
      holding: false,
    };
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
      const ctx: RoundContext = {
        deps,
        metered,
        board,
        agent,
        signal,
        // Output guard: the answer is cut where it starts reciting the prompt (OWASP LLM07).
        watch: createLeakWatch({
          prompt: SYSTEM_PROMPT,
          // Refusals repeat the prompt's wording on purpose: that is the guard working.
          allowed: `${OUT_OF_SCOPE_REPLY}\n${REFUSAL_WORDING}`,
          ...(deps.canary ? { canary: deps.canary } : {}),
        }),
      };
      let ended: ToolOutcome['end']; // the model called finish or ask_user

      for (let round = 1; round <= maxRounds && !turn.finished; round++) {
        rounds = round;
        const step = startSpan('agent round', 'CHAIN', agent.inside, {
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
            if (error.code !== 'ABORTED') {
              markFailed(step.span, error.message);
              markFailed(agent.span, error.message);
            }
            yield { type: 'round', round, usage: null, toolCalls: 0, toolErrors: 0 };
            yield* proposalEvents(ctx, turn);
            yield { type: 'error', code: error.code, message: error.message };
            yield { type: 'done' };
            return;
          }
          if (streamed.stopped) return;
          const { said, calls, usage, held } = streamed;
          // The round after the format error: its text goes out only with the calls it explains;
          // without them it answers a message the user never saw ("Sure, …"), so it is dropped.
          const kept = !hold || calls.length > 0;
          if (hold && kept && held.trim()) yield { type: 'text', delta: held };
          turn.spoke ||= kept && said.trim() !== '';

          let toolErrors = 0;
          if (calls.length > 0) {
            turn.conversation.push({ role: 'assistant', content: said, toolCalls: calls });
            for (const call of calls) {
              const name = toolLabel(call.name, TOOL_NAMES);
              const used = startSpan(`tool ${name}`, 'TOOL', step.inside, { 'tool.name': name });
              const outcome = runToolCall(turn.draft, call, deps);
              turn.draft = outcome.draft;
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
              turn.conversation.push({ role: 'tool', toolCallId: call.id, content: outcome.reply });
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
            turn.finished = true;
            // "Said nothing" is this round: a preamble two rounds ago doesn't explain the changes.
            const shown = ended.tool === ASK_USER || said.trim() === '' ? ended.text : '';
            if (shown) {
              if (ctx.watch.feed(shown)) {
                agent.span.setAttribute('designroom.agent.leak_stopped', true);
                yield { type: 'text', delta: `${turn.spoke ? '\n\n' : ''}${LEAK_STOPPED_REPLY}` };
                yield { type: 'done' };
                return;
              }
              const named = createIdRewriter(labelOf(turn));
              yield {
                type: 'text',
                delta: `${turn.spoke ? '\n\n' : ''}${named.feed(shown)}${named.flush()}`,
              };
              turn.spoke = true;
            }
          } else if (calls.length === 0) {
            // No tool call: one format-error observation, then the answer stands as it is (M1-32).
            // Only with a round left: otherwise the user would read "I stopped here" for nothing.
            turn.finished = turn.formatWarned || round === maxRounds;
            if (!turn.finished) {
              turn.formatWarned = true;
              turn.holding = true;
              agent.span.setAttribute('designroom.agent.format_error', true);
              turn.conversation.push({ role: 'assistant', content: said });
              turn.conversation.push({ role: 'user', content: FORMAT_ERROR });
            }
          }
        } finally {
          step.span.end();
        }
      }

      // Cut off mid-work: say so, rather than end on "Now let me connect…".
      if (!turn.finished)
        yield {
          type: 'text',
          delta: `${turn.spoke ? '\n\n' : ''}(I stopped here: that was the most steps I take in one answer. Ask me to continue.)`,
        };
      yield* proposalEvents(ctx, turn, turn.finished);
      yield { type: 'done' };
    } catch (error) {
      markFailed(agent.span, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      agent.span.setAttributes({
        'designroom.agent.rounds': rounds,
        'designroom.agent.ops': turn.draft.ops.length,
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
