import type { Board } from '@designroom/domain';
import { context, type Context, type Span } from '@opentelemetry/api';
import { mergeFindings, type Conflict, type MergedFinding } from '../domain/findings.ts';
import { progressText, type Progress, type TaskCard } from '../domain/tasks.ts';
import { runTaskQueue, type TaskResult, type Timer } from './taskQueue.ts';
import { markFailed, startSpan } from './telemetry.ts';

// Our own small orchestrator (AV2-05, S1 — no LangGraph): the plan's task cards go through the
// queue one at a time, each to its specialist; the findings are merged in code (D8); the user sees
// progress (D6); every step is a span, so Phoenix shows request → each task → merge. The
// specialists are injected: LLM agents, rule checks, or fakes in tests.

/** One specialist answering its card: findings, checked against the contract by the queue. */
export type Specialist = (input: {
  card: TaskCard;
  board: Board;
  signal: AbortSignal;
}) => Promise<unknown>;

export type OrchestratorEvent =
  | ({ type: 'progress'; text: string } & Progress)
  | { type: 'task'; result: TaskResult }
  | { type: 'merged'; findings: MergedFinding[]; conflicts: Conflict[]; results: TaskResult[] };

export type OrchestratorDeps = {
  specialists: Record<string, Specialist>;
  timer?: Timer;
  maxTasks?: number;
};

export type OrchestratorInput = {
  cards: readonly TaskCard[];
  board: Board;
  /** Stop: cancels the running task and the waiting ones. */
  signal?: AbortSignal;
};

/** A task's span, closed once the queue has judged its output (status, findings). */
const endTaskSpan = (span: Span, result: TaskResult) => {
  span.setAttributes({
    'designroom.task.status': result.status,
    'designroom.task.findings': result.findings.length,
  });
  if (result.status === 'failed' || result.status === 'timeout')
    markFailed(span, result.error ?? result.status);
  span.end();
};

export const createOrchestrator = (deps: OrchestratorDeps) => {
  async function* orchestrate(
    { cards, board, signal }: OrchestratorInput,
    parent: Context,
  ): AsyncIterable<OrchestratorEvent> {
    const root = startSpan('orchestrator', 'CHAIN', parent, {
      'designroom.orchestrator.tasks': cards.length,
    });
    const results: TaskResult[] = [];
    // Each task's span stays open until the queue has judged its output (status, findings).
    const taskSpans = new Map<string, Span>();
    try {
      const events = runTaskQueue(cards, {
        run: (card, taskSignal) => {
          const specialist = deps.specialists[card.specialist];
          const task = startSpan(`task ${card.specialist}`, 'AGENT', root.inside, {
            'designroom.task.specialist': card.specialist,
          });
          taskSpans.set(card.id, task.span);
          if (!specialist) return Promise.reject(new Error(`No specialist "${card.specialist}".`));
          // Run inside the task's span: the specialist's LLM spans nest under it.
          return context.with(task.inside, () => specialist({ card, board, signal: taskSignal }));
        },
        ...(deps.timer ? { timer: deps.timer } : {}),
        ...(deps.maxTasks ? { maxTasks: deps.maxTasks } : {}),
        ...(signal ? { signal } : {}),
      });
      for await (const event of events) {
        if (event.type === 'progress') {
          const { type: _, ...progress } = event;
          yield { type: 'progress', text: progressText(progress), ...progress };
        } else {
          const { result } = event;
          const span = taskSpans.get(result.card.id);
          if (span) endTaskSpan(span, result);
          taskSpans.delete(result.card.id);
          results.push(result);
          yield { type: 'task', result };
        }
      }
      const { findings, conflicts } = mergeFindings(results.flatMap((r) => r.findings));
      root.span.setAttributes({
        'designroom.orchestrator.findings': findings.length,
        'designroom.orchestrator.conflicts': conflicts.length,
      });
      yield { type: 'merged', findings, conflicts, results };
    } catch (error) {
      markFailed(root.span, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      root.span.end();
    }
  }

  return {
    // Read the active context at the call, as the agent does: the orchestrator span sits under the
    // caller's (the request), wherever the stream is read from.
    run: (input: OrchestratorInput): AsyncIterable<OrchestratorEvent> =>
      orchestrate(input, context.active()),
  };
};
