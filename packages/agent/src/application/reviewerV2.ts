import type { AiGateway, LlmErrorCode } from '@designroom/ai-gateway';
import { context, type Context } from '@opentelemetry/api';
import { boardToText, inventoryText } from '../domain/boardToText.ts';
import { createAliases } from '../domain/aliases.ts';
import { mergeFindings, type Finding } from '../domain/findings.ts';
import { OUT_OF_SCOPE_REPLY, type Scope } from '../domain/scope.ts';
import { MAX_TASKS, TASK_TIMEOUT_MS, type TaskCard } from '../domain/tasks.ts';
import {
  createGraph,
  END,
  type Checkpoint,
  type Node,
  type NodeContext,
} from '../runtime/graph.ts';
import { checkScope, type ScopeQuestion } from './checkScope.ts';
import { reviewProposal } from './critic.ts';
import { decideNext } from './nextStep.ts';
import { createOrchestrator, type Specialist } from './orchestrator.ts';
import { makePlan, type Plan } from './planner.ts';
import type { AgentEvent, AgentInput, createAgent } from './runAgent.ts';
import type { Timer } from './taskQueue.ts';
import { markFailed, startSpan } from './telemetry.ts';

// Agent V2's chain as a graph (ADR-011, AV2-11b). The runtime runs it; the Planner decides at the
// decision points (the plan, then "one more check, or finish?"). Each step is a small node:
//
//   scope ─► plan ─► tasks ─► next ─┬─► tasks (the Planner added a check, once)
//     │       │                     └─► architect ─► critic ─┬─► architect (revise, once)
//     ▼       ▼ (questions)                                  └─► END
//    END     END
//
// Each role's model is injected (AV2-04). Nodes emit what the user sees; the runtime streams it.

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
  /** Sees every step (the checkpoint after each node): for traces, scripts and the eval. */
  onStep?: (step: Checkpoint<ReviewState>) => void;
};

/** One request's state: only the runtime changes it, from what each node returns. */
export type ReviewState = {
  /** Answered already (out of scope, a trivial turn, the Planner's questions): nothing more runs. */
  answered: boolean;
  plan?: Plan;
  /** Specialists to run next: the plan's, then what the Planner adds. */
  todo: string[];
  ran: string[];
  findings: Finding[];
  /** The Planner may add checks once (ADR-011: re-plan once). */
  replanned: boolean;
  /** With the Critic: the Architect's answer, held until it passes. */
  held: AgentEvent[];
  /** The Critic's issues, when it sends the proposal back. */
  critique?: string[];
  /** The Critic sent it back: the Architect writes again (once). */
  sendBack: boolean;
  revised: boolean;
  /** A model failing or the user's Stop: the error the user can act on (as V1). */
  error?: { code: LlmErrorCode; message: string };
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

const findingsLines = (findings: readonly Finding[]) =>
  findings
    .map((f) => `- ${f.specialist}: ${f.problem} (${f.severity})${f.fix ? `; fix: ${f.fix}` : ''}`)
    .join('\n');

const collect = async <T>(events: AsyncIterable<T>) => {
  const all: T[] = [];
  for await (const event of events) all.push(event);
  return all;
};

const INITIAL: ReviewState = {
  answered: false,
  todo: [],
  ran: [],
  findings: [],
  replanned: false,
  held: [],
  sendBack: false,
  revised: false,
};

export const createReviewerV2 = (deps: ReviewerV2Deps) => {
  const orchestrator = createOrchestrator({
    specialists: deps.specialists,
    ...(deps.timer ? { timer: deps.timer } : {}),
  });

  /** The chain for one request: nodes close over its input (the board, the chat, Stop). */
  const graphFor = (input: AgentInput, root: Context) => {
    const { board, messages, signal } = input;
    const question = messages.findLast((m) => m.role === 'user')?.content ?? '';
    const previousAnswer = messages.findLast((m) => m.role === 'assistant')?.content;
    const withSignal = signal ? { signal } : {};
    const say = (ctx: NodeContext, event: ReviewerV2Event) => ctx.emit(event);

    /** Every node: its own span; a model failure or Stop kept as the state's error, as V1 ends. */
    const node =
      (name: string, run: Node<ReviewState>): Node<ReviewState> =>
      async (state, ctx) => {
        const step = startSpan(`node ${name}`, 'CHAIN', root);
        try {
          return await context.with(step.inside, () => run(state, ctx));
        } catch (error) {
          if (!isGatewayError(error)) throw error; // a bug: the run fails
          if (error.code !== 'ABORTED') markFailed(step.span, error.message);
          return { error: { code: error.code, message: error.message } };
        } finally {
          step.span.end();
        }
      };

    // Main: the scope guard, once; a trivial turn answered alone (D3).
    const scope = node('scope', async (_s, ctx) => {
      const inScope = await (deps.checkScope ?? ((q) => checkScope(deps.main, q)))({
        question,
        ...(previousAnswer === undefined ? {} : { previousAnswer }),
        ...withSignal,
      });
      if (inScope === 'out') {
        say(ctx, { type: 'text', delta: OUT_OF_SCOPE_REPLY });
        return { answered: true };
      }
      if (!TRIVIAL.test(question.trim())) return {};
      const answer = deps.main.chat({
        messages: [
          { role: 'system', content: MAIN_PROMPT },
          { role: 'user', content: question },
        ],
        ...withSignal,
      });
      for await (const chunk of answer) if (chunk.type === 'text') say(ctx, chunk);
      return { answered: true };
    });

    // Planner: the flow, the specialists, questions only while the chat is young (D2).
    const plan = node('plan', async (_s, ctx) => {
      const aliases = createAliases(board);
      const boardText = [inventoryText(board, aliases), boardToText(board, aliases)]
        .filter(Boolean)
        .join('\n\n');
      const made = await makePlan(deps.planner, {
        question,
        boardText,
        allowQuestions: messages.filter((m) => m.role === 'assistant').length < 2,
        ...withSignal,
      });
      if (made.questions.length > 0) {
        say(ctx, { type: 'text', delta: questionsText(made.questions) });
        return { plan: made, answered: true };
      }
      return {
        plan: made,
        todo: made.flow === 'question' ? [] : made.specialists.slice(0, MAX_TASKS),
      };
    });

    // The specialists the plan (or the Planner's re-plan) asked for, through the queue.
    const tasks = node('tasks', async (s, ctx) => {
      const cards: TaskCard[] = s.todo.map((specialist) => ({
        id: `task-${specialist}`,
        specialist,
        boxIds: [],
        question,
        budgetMs: TASK_TIMEOUT_MS,
      }));
      let found: Finding[] = [];
      for await (const event of orchestrator.run({ cards, board, ...withSignal })) {
        if (event.type === 'progress') say(ctx, { type: 'progress', text: event.text });
        else if (event.type === 'merged') found = event.results.flatMap((r) => r.findings);
      }
      return { ran: [...s.ran, ...s.todo], todo: [], findings: [...s.findings, ...found] };
    });

    // The Planner orchestrates: one more check, or finish (the model asked only when it can choose).
    const next = node('next', async (s) => {
      if (s.replanned) return {};
      const step = await decideNext(deps.planner, {
        question,
        ran: s.ran,
        findingsText: findingsLines(s.findings),
        budgetLeft: MAX_TASKS - s.ran.length,
        ...withSignal,
      });
      return step.action === 'add'
        ? { todo: step.specialists, replanned: true }
        : { replanned: true };
    });

    // Architect: AV2-01's agent explains the merged findings and proposes.
    const architect = node('architect', async (s, ctx) => {
      if (s.ran.length > 0 && !s.sendBack)
        say(ctx, { type: 'progress', text: 'Writing the answer…' });
      const answer = deps.architect.run({
        ...input,
        findings: mergeFindings(s.findings).findings,
        scoped: true,
        ...(s.critique ? { critique: s.critique } : {}),
      });
      if (!deps.critic) {
        for await (const event of answer) say(ctx, event);
        return { sendBack: false };
      }
      return { held: await collect(answer), sendBack: false }; // held for the Critic
    });

    // The Critic (AV2-08): the answer is shown once its proposal passes; sent back once.
    const critic = node('critic', async (s, ctx) => {
      const show = (events: readonly AgentEvent[]) => {
        for (const event of events) say(ctx, event);
      };
      if (signal?.aborted) {
        show(s.held); // Stopped: the answer ends as it ended
        return {};
      }
      if (!s.revised) say(ctx, { type: 'progress', text: 'Checking the proposal…' });
      const proposal = s.held.find((e) => e.type === 'proposal');
      const verdict =
        proposal?.type === 'proposal'
          ? await reviewProposal({
              board,
              ops: proposal.proposal.ops,
              question,
              ...(deps.critic?.llm ? { llm: deps.critic.llm } : {}),
              ...withSignal,
            })
          : { verdict: 'pass' as const, issues: [] };
      if (verdict.verdict === 'pass') {
        show(s.held);
        return {};
      }
      if (!s.revised) {
        say(ctx, { type: 'progress', text: 'Revising the proposal…' });
        return { critique: verdict.issues, revised: true, sendBack: true };
      }
      // Still failing after its one revision: shown, with what the Critic still sees (D9).
      const last = s.held.at(-1);
      const done = last?.type === 'done' ? last : undefined;
      show(done ? s.held.slice(0, -1) : s.held);
      say(ctx, { type: 'text', delta: `\n\n(Checked: ${verdict.issues.join(' ')})` });
      if (done) say(ctx, done);
      return {};
    });

    const over = (s: ReviewState) => s.answered || s.error !== undefined;
    return createGraph<ReviewState>()
      .addNode('scope', scope)
      .addNode('plan', plan)
      .addNode('tasks', tasks)
      .addNode('next', next)
      .addNode('architect', architect)
      .addNode('critic', critic)
      .addConditionalEdges('scope', (s) => (over(s) ? END : 'plan'))
      .addConditionalEdges('plan', (s) =>
        over(s) ? END : s.todo.length > 0 ? 'tasks' : 'architect',
      )
      .addConditionalEdges('tasks', (s) => (over(s) ? END : 'next'))
      .addConditionalEdges('next', (s) =>
        over(s) ? END : s.todo.length > 0 ? 'tasks' : 'architect',
      )
      .addConditionalEdges('architect', (s) => (over(s) || !deps.critic ? END : 'critic'))
      .addConditionalEdges('critic', (s) => (!over(s) && s.sendBack ? 'architect' : END))
      .compile({
        start: 'scope',
        ...(deps.onStep
          ? {
              checkpointer: {
                save: (_thread, step) => deps.onStep?.(step),
                latest: () => undefined,
              },
            }
          : {}),
      });
  };

  async function* review(input: AgentInput): AsyncIterable<ReviewerV2Event> {
    const root = startSpan('agent v2', 'AGENT', context.active());
    try {
      // The chat is stateless so far (no conversation id): each request is its own thread.
      for await (const event of graphFor(input, root.inside).stream('request', INITIAL)) {
        if (event.type === 'custom') yield event.data as ReviewerV2Event;
        else if (event.type === 'failed') {
          markFailed(root.span, event.error);
          throw new Error(event.error); // a bug in a node, not a model failing
        } else if (event.type === 'done') {
          const { plan, ran, answered, error, revised } = event.state;
          if (plan)
            root.span.setAttributes({
              'designroom.v2.flow': plan.flow,
              'designroom.v2.specialists': ran.join(','),
              'designroom.v2.questions': plan.questions.length,
            });
          if (revised) root.span.setAttribute('designroom.v2.critic_revised', true);
          if (error) {
            // A model failing, or the user's Stop: ended as V1 ends (review of AV2-05..09).
            yield { type: 'error', code: error.code, message: error.message };
            yield { type: 'done' };
          } else if (answered) yield { type: 'done' };
        }
      }
    } finally {
      root.span.end();
    }
  }

  return { run: (input: AgentInput): AsyncIterable<ReviewerV2Event> => review(input) };
};
