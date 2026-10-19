import type {
  AiGateway,
  LlmErrorCode,
  LlmMessage,
  LlmToolCall,
  Usage,
} from '@designroom/ai-gateway';
import type { Board, ChatMessage, Proposal } from '@designroom/domain';
import { boardToText } from '../domain/boardToText.ts';
import { buildMessages } from '../domain/prompt.ts';
import { OUT_OF_SCOPE_REPLY, type Scope } from '../domain/scope.ts';
import { summarize } from '../domain/summary.ts';
import { AGENT_TOOLS, createDraft, runToolCall } from '../domain/tools.ts';
import { checkScope, type ScopeQuestion } from './checkScope.ts';

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
};

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

export const createAgent = (deps: AgentDeps) => ({
  async *run({ board, messages, signal }: AgentInput): AsyncIterable<AgentEvent> {
    // Scope guard first: a message about something else gets a fixed reply, and the reviewer
    // (with its tools) never runs. Enforced here, in code — not left to the prompt.
    const question = messages.findLast((m) => m.role === 'user')?.content ?? '';
    const previousAnswer = messages.findLast((m) => m.role === 'assistant')?.content;
    const scope = await (deps.checkScope ?? ((q) => checkScope(deps.llm, q)))({
      question,
      ...(previousAnswer === undefined ? {} : { previousAnswer }),
      ...(signal ? { signal } : {}),
    });
    if (scope === 'out') {
      yield { type: 'text', delta: OUT_OF_SCOPE_REPLY };
      yield { type: 'done' };
      return;
    }

    const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
    let draft = createDraft(board);
    const conversation: LlmMessage[] = buildMessages(boardToText(board, draft.aliases), messages);
    let spoke = false; // an earlier round wrote something
    let finished = false; // the model stopped calling tools by itself

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
      const calls: LlmToolCall[] = [];
      let said = '';
      let usage: Usage | null = null;
      try {
        // A copy: the conversation grows after this call, the request must not change with it.
        const request = { messages: [...conversation], tools: AGENT_TOOLS, signal };
        for await (const chunk of deps.llm.chat(request)) {
          if (chunk.type === 'text') {
            // A new round's text starts a new paragraph, not glued to the last sentence.
            if (said === '' && spoke) yield { type: 'text', delta: '\n\n' };
            said += chunk.delta;
            yield { type: 'text', delta: chunk.delta };
          } else if (chunk.type === 'toolCall') calls.push(chunk.call);
          else usage = chunk.usage;
        }
      } catch (error) {
        if (!isGatewayError(error)) throw error; // a bug, not a model failure
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
          const outcome = runToolCall(draft, call, deps);
          draft = outcome.draft;
          if (!outcome.ok) toolErrors++;
          conversation.push({ role: 'tool', toolCallId: call.id, content: outcome.reply });
        }
      }
      yield { type: 'round', round, usage, toolCalls: calls.length, toolErrors };
      finished = calls.length === 0;
    }

    // Cut off mid-work: say so, rather than end on "Now let me connect…".
    if (!finished)
      yield {
        type: 'text',
        delta: `${spoke ? '\n\n' : ''}(I stopped here: that was the most steps I take in one answer. Ask me to continue.)`,
      };
    yield* proposal();
    yield { type: 'done' };
  },
});
