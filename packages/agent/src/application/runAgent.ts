import { context, type Context } from '@opentelemetry/api';
import type { AiGateway, LlmErrorCode, Usage } from '@designroom/ai-gateway';
import type { Board, ChatMessage, Proposal } from '@designroom/domain';
import { boardToText, inventoryText, quote } from '../domain/boardToText.ts';
import type { MergedFinding } from '../domain/findings.ts';
import { createLeakWatch } from '../domain/leakWatch.ts';
import { buildMessages, REFUSAL_WORDING, SYSTEM_PROMPT } from '../domain/prompt.ts';
import { OUT_OF_SCOPE_REPLY, type Scope } from '../domain/scope.ts';
import { createDraft, type Draft } from '../domain/tools.ts';
import { playRound, proposalEvents, type RoundContext, type Turn } from './agentRound.ts';
import { checkScope, type ScopeQuestion } from './checkScope.ts';
import { createAgentMetrics, markFailed, startSpan } from './telemetry.ts';

// The agent loop (architecture §7): the model answers; its tool calls run on a draft of the board;
// the results go back to the model; repeat until it stops calling tools or the round limit.
// The board is never changed here: the outcome is at most one proposal the user accepts or not.
// One round's steps are in agentRound.ts.

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

/** The board, the chat, the findings and the critique as the model reads them. */
const conversationFor = (input: AgentInput, draft: Draft, canary: string | undefined) => {
  // What exists by kind, then the listing — both inside the <board> block (M1-29).
  const boardText = [
    inventoryText(input.board, draft.aliases),
    boardToText(input.board, draft.aliases),
  ]
    .filter(Boolean)
    .join('\n\n');
  const { findings, critique } = input;
  return buildMessages(
    boardText,
    input.messages,
    canary,
    findings?.length ? findingsText(findings, draft) : undefined,
    critique?.length ? critique.map((issue) => `- ${issue}`).join('\n') : undefined,
  );
};

/**
 * Scope guard first: a message about something else gets a fixed reply, and the reviewer (with its
 * tools) never runs. Enforced here, in code — not left to the prompt.
 */
const guardScope = async (
  deps: AgentDeps,
  metered: ReturnType<typeof createAgentMetrics>,
  input: AgentInput,
  agent: ReturnType<typeof startSpan>,
): Promise<Scope> => {
  if (input.scoped) return 'in'; // the caller (agent V2's Main) already checked it
  const { messages, signal } = input;
  const question = messages.findLast((m) => m.role === 'user')?.content ?? '';
  const previousAnswer = messages.findLast((m) => m.role === 'assistant')?.content;
  const guard = startSpan('scope check', 'GUARDRAIL', agent.inside);
  try {
    const scope = await context.with(guard.inside, () =>
      (deps.checkScope ?? ((q) => checkScope(deps.llm, q)))({
        question,
        ...(previousAnswer === undefined ? {} : { previousAnswer }),
        ...(signal ? { signal } : {}),
      }),
    );
    guard.span.setAttribute('designroom.agent.scope', scope);
    metered.scope(scope);
    return scope;
  } finally {
    guard.span.end();
  }
};

export const createAgent = (deps: AgentDeps) => {
  const metered = createAgentMetrics();

  async function* review(input: AgentInput, parent: Context): AsyncIterable<AgentEvent> {
    const agent = startSpan('agent', 'AGENT', parent);
    const draft = createDraft(input.board);
    const turn: Turn = {
      draft,
      conversation: conversationFor(input, draft, deps.canary),
      spoke: false,
      finished: false,
      formatWarned: false,
      holding: false,
    };
    let rounds = 0;
    try {
      if ((await guardScope(deps, metered, input, agent)) === 'out') {
        yield { type: 'text', delta: OUT_OF_SCOPE_REPLY };
        yield { type: 'done' };
        return;
      }
      const ctx: RoundContext = {
        deps,
        metered,
        board: input.board,
        agent,
        signal: input.signal,
        // Output guard: the answer is cut where it starts reciting the prompt (OWASP LLM07).
        watch: createLeakWatch({
          prompt: SYSTEM_PROMPT,
          // Refusals repeat the prompt's wording on purpose: that is the guard working.
          allowed: `${OUT_OF_SCOPE_REPLY}\n${REFUSAL_WORDING}`,
          ...(deps.canary ? { canary: deps.canary } : {}),
        }),
      };
      const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
      for (let round = 1; round <= maxRounds && !turn.finished; round++) {
        rounds = round;
        if (yield* playRound(ctx, turn, round, round === maxRounds)) return;
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
