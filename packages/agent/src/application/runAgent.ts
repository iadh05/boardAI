import { context, type Context } from '@opentelemetry/api';
import type {
  AiGateway,
  LlmErrorCode,
  LlmMessage,
  LlmToolCall,
  Usage,
} from '@designroom/ai-gateway';
import type { Board, ChatMessage, Proposal } from '@designroom/domain';
import { boardToText } from '../domain/boardToText.ts';
import { createLeakWatch } from '../domain/leakWatch.ts';
import { PROPOSE_NUDGE, recommendsChange } from '../domain/nudge.ts';
import { buildMessages, REFUSAL_WORDING, SYSTEM_PROMPT } from '../domain/prompt.ts';
import { OUT_OF_SCOPE_REPLY, type Scope } from '../domain/scope.ts';
import { summarize } from '../domain/summary.ts';
import { AGENT_TOOLS, createDraft, runToolCall } from '../domain/tools.ts';
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

export type AgentInput = {
  board: Board;
  messages: readonly ChatMessage[];
  signal?: AbortSignal;
};

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
    { board, messages, signal }: AgentInput,
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
      const guard = startSpan('scope check', 'GUARDRAIL', agent.inside);
      let scope: Scope;
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
      if (scope === 'out') {
        yield { type: 'text', delta: OUT_OF_SCOPE_REPLY };
        yield { type: 'done' };
        return;
      }

      const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
      const conversation: LlmMessage[] = buildMessages(
        boardToText(board, draft.aliases),
        messages,
        deps.canary,
      );
      // Output guard: the answer is cut where it starts reciting the prompt (OWASP LLM07).
      const watch = createLeakWatch({
        prompt: SYSTEM_PROMPT,
        // Refusals repeat the prompt's wording on purpose: that is the guard working.
        allowed: `${OUT_OF_SCOPE_REPLY}\n${REFUSAL_WORDING}`,
        ...(deps.canary ? { canary: deps.canary } : {}),
      });
      let spoke = false; // an earlier round wrote something
      let finished = false; // the model stopped calling tools by itself
      let nudged = false; // asked once to propose what it recommended in words (M1-24e)

      // Valid ops so far, as one proposal: also sent when a later round fails, because the text the
      // user already read may say "I've added a cache".
      const proposal = (): AgentEvent[] =>
        draft.ops.length === 0
          ? []
          : [
              {
                type: 'proposal',
                proposal: {
                  id: deps.newId(),
                  summary: summarize(draft.ops, board, draft.board),
                  ops: draft.ops,
                },
              },
            ];

      for (let round = 1; round <= maxRounds && !finished; round++) {
        rounds = round;
        const step = startSpan('agent round', 'CHAIN', agent.inside, {
          'designroom.agent.round': round,
        });
        try {
          const calls: LlmToolCall[] = [];
          let said = '';
          let usage: Usage | null = null;
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
                if (said === '' && spoke) yield { type: 'text', delta: '\n\n' };
                said += chunk.delta;
                yield { type: 'text', delta: chunk.delta };
              } else if (chunk.type === 'toolCall') calls.push(chunk.call);
              else usage = chunk.usage;
            }
          } catch (error) {
            if (!isGatewayError(error)) throw error; // a bug, not a model failure
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
          spoke ||= said.trim() !== '';

          let toolErrors = 0;
          if (calls.length > 0) {
            conversation.push({ role: 'assistant', content: said, toolCalls: calls });
            for (const call of calls) {
              const name = toolLabel(call.name, TOOL_NAMES);
              const used = startSpan(`tool ${name}`, 'TOOL', step.inside, { 'tool.name': name });
              const outcome = runToolCall(draft, call, deps);
              draft = outcome.draft;
              if (!outcome.ok) {
                toolErrors++;
                markFailed(used.span, outcome.reply); // what the model was told
              }
              used.span.end();
              metered.toolCall(name, outcome.ok);
              conversation.push({ role: 'tool', toolCallId: call.id, content: outcome.reply });
            }
          }
          step.span.setAttributes({
            'designroom.agent.tool_calls': calls.length,
            'designroom.agent.tool_errors': toolErrors,
          });
          yield { type: 'round', round, usage, toolCalls: calls.length, toolErrors };
          finished = calls.length === 0;
          // Advice in words only, nothing proposed yet: ask once for the proposal (M1-24e).
          // Only with a round left: otherwise the user would read "I stopped here" for nothing.
          if (
            finished &&
            !nudged &&
            round < maxRounds &&
            draft.ops.length === 0 &&
            recommendsChange(said)
          ) {
            nudged = true;
            finished = false;
            agent.span.setAttribute('designroom.agent.nudged', true);
            conversation.push({ role: 'assistant', content: said });
            conversation.push({ role: 'user', content: PROPOSE_NUDGE });
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
      yield* proposal();
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
