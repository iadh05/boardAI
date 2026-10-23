import type { AiGateway, LlmErrorCode } from '@designroom/ai-gateway';
import { context } from '@opentelemetry/api';
import { boardToText, inventoryText } from '../domain/boardToText.ts';
import { createAliases } from '../domain/aliases.ts';
import { OUT_OF_SCOPE_REPLY, type Scope } from '../domain/scope.ts';
import { MAX_TASKS, TASK_TIMEOUT_MS, type TaskCard } from '../domain/tasks.ts';
import { checkScope, type ScopeQuestion } from './checkScope.ts';
import { reviewProposal } from './critic.ts';
import { createOrchestrator, type Specialist } from './orchestrator.ts';
import { makePlan } from './planner.ts';
import type { AgentEvent, AgentInput, createAgent } from './runAgent.ts';
import type { Timer } from './taskQueue.ts';
import { markFailed, startSpan } from './telemetry.ts';

// Agent V2's chain (AV2-07, architecture-v2 § The chain), as one request:
//   Main (level 1)  — the scope guard once; a trivial turn ("thanks") answered alone (D3).
//   Planner (level 2) — the flow, the specialists, questions only when they change the answer (D2).
//   Architect — the specialists' tasks through the queue (progress for the user, D6), findings
//               merged in code (D8), then AV2-01's agent explains them and proposes the fixes, with
//               the same tools, caps and applyOps checks as before.
// Each role's model is injected (AV2-04: hosted with the local model behind it, or local).

export type ReviewerV2Event = AgentEvent | { type: 'progress'; text: string };

export type ReviewerV2Deps = {
  main: AiGateway;
  planner: AiGateway;
  /** AV2-01's agent on the specialists' model: explains the findings and proposes. */
  architect: ReturnType<typeof createAgent>;
  specialists: Record<string, Specialist>;
  /** The scope guard; by default one short call to `main`. Injected in tests. */
  checkScope?: (question: ScopeQuestion) => Promise<Scope>;
  timer?: Timer;
  /**
   * The Critic (AV2-08), off when absent (AGENT_CRITIC=on). Code checks always; the LLM Critic too
   * when `llm` is given (D14: another model family). On, the answer is held until it passes.
   */
  critic?: { llm?: AiGateway };
};

const collect = async <T>(events: AsyncIterable<T>) => {
  const all: T[] = [];
  for await (const event of events) all.push(event);
  return all;
};

/** The Critic's verdict on what the Architect said: nothing proposed, nothing to check. */
const critique = async (
  events: readonly AgentEvent[],
  question: string,
  board: AgentInput['board'],
  critic: NonNullable<ReviewerV2Deps['critic']>,
  signal?: AbortSignal,
) => {
  const proposal = events.find((e) => e.type === 'proposal');
  if (proposal?.type !== 'proposal') return { verdict: 'pass' as const, issues: [] };
  return reviewProposal({
    board,
    ops: proposal.proposal.ops,
    question,
    ...(critic.llm ? { llm: critic.llm } : {}),
    ...(signal ? { signal } : {}),
  });
};

type GatewayError = Error & { code: LlmErrorCode };

/** The gateway throws LlmError; the agent may only import its types, so it checks the shape. */
const isGatewayError = (error: unknown): error is GatewayError =>
  error instanceof Error &&
  error.name === 'LlmError' &&
  typeof (error as GatewayError).code === 'string';

/** "thanks", "ok", "great!" — nothing for the Planner (D3). */
const TRIVIAL = /^(thanks?( you)?|thx|ok(ay)?|cool|great|nice|perfect|got it|merci|👍)[\s.!]*$/i;

const MAIN_PROMPT =
  'You are the assistant of a system-design board. Reply to the user in one short, friendly sentence.';

const questionsText = (questions: readonly string[]) =>
  questions.length === 1
    ? `Before I review, one question: ${questions[0] ?? ''}`
    : `Before I review, a few questions:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;

/** What every step of one request shares. */
type Step = {
  deps: ReviewerV2Deps;
  input: AgentInput;
  question: string;
  root: ReturnType<typeof startSpan>;
};

const inRoot = <T>(step: Step, run: () => T) => context.with(step.root.inside, run);
const withSignal = (signal: AbortSignal | undefined) => (signal ? { signal } : {});

/** Main (level 1): the scope guard, once for the chain, then a trivial turn (D3). True: answered. */
async function* answeredByMain(step: Step): AsyncGenerator<ReviewerV2Event, boolean> {
  const { deps, input, question, root } = step;
  const previousAnswer = input.messages.findLast((m) => m.role === 'assistant')?.content;
  const scope = await inRoot(step, () =>
    (deps.checkScope ?? ((q) => checkScope(deps.main, q)))({
      question,
      ...(previousAnswer === undefined ? {} : { previousAnswer }),
      ...withSignal(input.signal),
    }),
  );
  if (scope === 'out') {
    yield { type: 'text', delta: OUT_OF_SCOPE_REPLY };
    return true;
  }
  if (!TRIVIAL.test(question.trim())) return false;
  root.span.setAttribute('designroom.v2.flow', 'trivial');
  const answer = inRoot(step, () =>
    deps.main.chat({
      messages: [
        { role: 'system', content: MAIN_PROMPT },
        { role: 'user', content: question },
      ],
      ...withSignal(input.signal),
    }),
  );
  for await (const chunk of answer) if (chunk.type === 'text') yield chunk;
  return true;
}

type Plan = Awaited<ReturnType<typeof makePlan>>;

/**
 * Planner (level 2): the board as it reads it (labels quoted), questions only while the chat is
 * young. Undefined once it asked the user its questions.
 */
async function* planned(step: Step): AsyncGenerator<ReviewerV2Event, Plan | undefined> {
  const { deps, input, question, root } = step;
  const aliases = createAliases(input.board);
  const boardText = [inventoryText(input.board, aliases), boardToText(input.board, aliases)]
    .filter(Boolean)
    .join('\n\n');
  const assistantTurns = input.messages.filter((m) => m.role === 'assistant').length;
  const plan = await inRoot(step, () =>
    makePlan(deps.planner, {
      question,
      boardText,
      allowQuestions: assistantTurns < 2, // D2: at most 2 rounds of questions
      ...withSignal(input.signal),
    }),
  );
  root.span.setAttributes({
    'designroom.v2.flow': plan.flow,
    'designroom.v2.specialists': plan.specialists.join(','),
    'designroom.v2.questions': plan.questions.length,
  });
  if (plan.questions.length === 0) return plan;
  yield { type: 'text', delta: questionsText(plan.questions) };
  return undefined;
}

/**
 * The specialists' tasks through the queue (progress for the user, D6), findings merged in code
 * (D8). Undefined when the plan runs no specialist.
 */
async function* specialistFindings(
  step: Step,
  plan: Plan,
  orchestrator: ReturnType<typeof createOrchestrator>,
): AsyncGenerator<ReviewerV2Event, AgentInput['findings']> {
  if (plan.flow === 'question' || plan.specialists.length === 0) return undefined;
  const { input, question } = step;
  const cards: TaskCard[] = plan.specialists.slice(0, MAX_TASKS).map((specialist) => ({
    id: `task-${specialist}`,
    specialist,
    boxIds: [],
    question,
    budgetMs: TASK_TIMEOUT_MS,
  }));
  const events = inRoot(step, () =>
    orchestrator.run({ cards, board: input.board, ...withSignal(input.signal) }),
  );
  let findings: AgentInput['findings'] = [];
  for await (const event of events) {
    if (event.type === 'progress') yield { type: 'progress', text: event.text };
    else if (event.type === 'merged') findings = event.findings;
  }
  return findings;
}

type Architect = (critique?: string[]) => AsyncIterable<AgentEvent>;

/** The Critic (AV2-08): the answer is held until its proposal passes; sent back once. */
async function* criticChecked(
  step: Step,
  critic: NonNullable<ReviewerV2Deps['critic']>,
  architect: Architect,
): AsyncIterable<ReviewerV2Event> {
  const { input, question, root } = step;
  const { board, signal } = input;
  const first = await collect(architect());
  // Stopped: nothing more to check or ask — the first answer ends as it ended.
  if (signal?.aborted) return yield* first;
  yield { type: 'progress', text: 'Checking the proposal…' };
  const firstVerdict = await critique(first, question, board, critic, signal);
  if (firstVerdict.verdict === 'pass') return yield* first;
  root.span.setAttribute('designroom.v2.critic_revised', true);
  yield { type: 'progress', text: 'Revising the proposal…' };
  const second = await collect(architect(firstVerdict.issues));
  if (signal?.aborted) return yield* second;
  const secondVerdict = await critique(second, question, board, critic, signal);
  if (secondVerdict.verdict === 'pass') return yield* second;
  // Still failing after its one revision: shown, with what the Critic still sees (D9).
  const done = second.at(-1)?.type === 'done' ? second.pop() : undefined;
  yield* second;
  yield { type: 'text', delta: `\n\n(Checked: ${secondVerdict.issues.join(' ')})` };
  if (done) yield done;
}

/**
 * A model failing, or the user's Stop, ends the answer the way V1's does: an error event the user
 * can act on, then done (review of AV2-05..09). Anything else is a bug: thrown.
 */
function* failed(root: Step['root'], error: unknown): Iterable<ReviewerV2Event> {
  if (!isGatewayError(error)) {
    markFailed(root.span, error instanceof Error ? error.message : String(error));
    throw error;
  }
  if (error.code !== 'ABORTED') markFailed(root.span, error.message);
  yield { type: 'error', code: error.code, message: error.message };
  yield { type: 'done' };
}

export const createReviewerV2 = (deps: ReviewerV2Deps) => {
  const orchestrator = createOrchestrator({
    specialists: deps.specialists,
    ...(deps.timer ? { timer: deps.timer } : {}),
  });

  async function* review(input: AgentInput): AsyncIterable<ReviewerV2Event> {
    const root = startSpan('agent v2', 'AGENT', context.active());
    const question = input.messages.findLast((m) => m.role === 'user')?.content ?? '';
    const step: Step = { deps, input, question, root };
    try {
      const plan = (yield* answeredByMain(step)) ? undefined : yield* planned(step);
      if (!plan) {
        yield { type: 'done' };
        return;
      }
      // Architect: the specialists through the queue, then AV2-01's agent explains and proposes.
      const findings = yield* specialistFindings(step, plan, orchestrator);
      const architect: Architect = (critique) =>
        inRoot(step, () =>
          deps.architect.run({
            ...input,
            findings: findings ?? [],
            scoped: true,
            ...(critique ? { critique } : {}),
          }),
        );
      // What happens next, until the answer's first word: "Data ✓" said nothing about the Architect
      // or the Critic at work (review of AV2-05..09).
      if (findings) yield { type: 'progress', text: 'Writing the answer…' };
      yield* deps.critic ? criticChecked(step, deps.critic, architect) : architect();
    } catch (error) {
      yield* failed(root, error);
    } finally {
      root.span.end();
    }
  }

  return { run: (input: AgentInput): AsyncIterable<ReviewerV2Event> => review(input) };
};
