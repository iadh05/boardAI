import type { AiGateway, LlmErrorCode } from '@designroom/ai-gateway';
import { context } from '@opentelemetry/api';
import { boardToText, inventoryText } from '../domain/boardToText.ts';
import { createAliases } from '../domain/aliases.ts';
import { OUT_OF_SCOPE_REPLY, type Scope } from '../domain/scope.ts';
import { MAX_TASKS, TASK_TIMEOUT_MS, type TaskCard } from '../domain/tasks.ts';
import { checkScope, type ScopeQuestion } from './checkScope.ts';
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

export const createReviewerV2 = (deps: ReviewerV2Deps) => {
  const orchestrator = createOrchestrator({
    specialists: deps.specialists,
    ...(deps.timer ? { timer: deps.timer } : {}),
  });

  async function* review(input: AgentInput): AsyncIterable<ReviewerV2Event> {
    const { board, messages, signal } = input;
    const root = startSpan('agent v2', 'AGENT', context.active());
    try {
      const question = messages.findLast((m) => m.role === 'user')?.content ?? '';
      const previousAnswer = messages.findLast((m) => m.role === 'assistant')?.content;

      // Main: the scope guard, once for the whole chain.
      const scope = await context.with(root.inside, () =>
        (deps.checkScope ?? ((q) => checkScope(deps.main, q)))({
          question,
          ...(previousAnswer === undefined ? {} : { previousAnswer }),
          ...(signal ? { signal } : {}),
        }),
      );
      if (scope === 'out') {
        yield { type: 'text', delta: OUT_OF_SCOPE_REPLY };
        yield { type: 'done' };
        return;
      }

      // Main: a trivial turn needs no plan (D3).
      if (TRIVIAL.test(question.trim())) {
        root.span.setAttribute('designroom.v2.flow', 'trivial');
        const answer = context.with(root.inside, () =>
          deps.main.chat({
            messages: [
              { role: 'system', content: MAIN_PROMPT },
              { role: 'user', content: question },
            ],
            ...(signal ? { signal } : {}),
          }),
        );
        for await (const chunk of answer) if (chunk.type === 'text') yield chunk;
        yield { type: 'done' };
        return;
      }

      // Planner: the board as it reads it (labels quoted), questions only while the chat is young.
      const aliases = createAliases(board);
      const boardText = [inventoryText(board, aliases), boardToText(board, aliases)]
        .filter(Boolean)
        .join('\n\n');
      const assistantTurns = messages.filter((m) => m.role === 'assistant').length;
      const plan = await context.with(root.inside, () =>
        makePlan(deps.planner, {
          question,
          boardText,
          allowQuestions: assistantTurns < 2, // D2: at most 2 rounds of questions
          ...(signal ? { signal } : {}),
        }),
      );
      root.span.setAttributes({
        'designroom.v2.flow': plan.flow,
        'designroom.v2.specialists': plan.specialists.join(','),
        'designroom.v2.questions': plan.questions.length,
      });
      if (plan.questions.length > 0) {
        yield { type: 'text', delta: questionsText(plan.questions) };
        yield { type: 'done' };
        return;
      }

      // Architect: the specialists through the queue, then the agent explains and proposes.
      let findings: AgentInput['findings'] = [];
      if (plan.flow !== 'question' && plan.specialists.length > 0) {
        const cards: TaskCard[] = plan.specialists.slice(0, MAX_TASKS).map((specialist) => ({
          id: `task-${specialist}`,
          specialist,
          boxIds: [],
          question,
          budgetMs: TASK_TIMEOUT_MS,
        }));
        const events = context.with(root.inside, () =>
          orchestrator.run({ cards, board, ...(signal ? { signal } : {}) }),
        );
        for await (const event of events) {
          if (event.type === 'progress') yield { type: 'progress', text: event.text };
          else if (event.type === 'merged') findings = event.findings;
        }
      }
      const answer = context.with(root.inside, () =>
        deps.architect.run({ ...input, findings, scoped: true }),
      );
      yield* answer;
    } catch (error) {
      // A model failing, or the user's Stop, ends the answer the way V1's does: an error event the
      // user can act on, then done (review of AV2-05..09). Anything else is a bug: thrown.
      if (!isGatewayError(error)) {
        markFailed(root.span, error instanceof Error ? error.message : String(error));
        throw error;
      }
      if (error.code !== 'ABORTED') markFailed(root.span, error.message);
      yield { type: 'error', code: error.code, message: error.message };
      yield { type: 'done' };
    } finally {
      root.span.end();
    }
  }

  return { run: (input: AgentInput): AsyncIterable<ReviewerV2Event> => review(input) };
};
