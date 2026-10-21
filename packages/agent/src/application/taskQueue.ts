import { z } from 'zod';
import { FindingSchema, type Finding } from '../domain/findings.ts';
import { MAX_TASKS, type Progress, type TaskCard } from '../domain/tasks.ts';

// The task queue (AV2-05, D5): one task at a time — Ollama answers one call at a time on one GPU
// anyway, the queue makes it explicit and lets the user watch. At most MAX_TASKS per request,
// each within its budget; Stop cancels the running task and the waiting ones. A specialist's
// output is checked against the finding contract: a broken one fails, it is never merged.

export type TaskStatus = 'done' | 'timeout' | 'failed' | 'cancelled' | 'skipped';
export type TaskResult = {
  card: TaskCard;
  status: TaskStatus;
  findings: Finding[];
  error?: string;
};

export type QueueEvent = ({ type: 'progress' } & Progress) | { type: 'result'; result: TaskResult };

/** Calls `fire` after `ms`; returns a cancel. Injected: tests fire it by hand. */
export type Timer = (ms: number, fire: () => void) => () => void;

export type QueueOptions = {
  /** Runs one task: a specialist answering its card. Returns findings, checked here. */
  run: (card: TaskCard, signal: AbortSignal) => Promise<unknown>;
  timer?: Timer;
  /** Stop: cancels the running task and the waiting ones. */
  signal?: AbortSignal;
  maxTasks?: number;
};

const realTimer: Timer = (ms, fire) => {
  const handle = setTimeout(fire, ms);
  return () => clearTimeout(handle);
};

const FindingsSchema = z.array(FindingSchema);

export async function* runTaskQueue(
  cards: readonly TaskCard[],
  options: QueueOptions,
): AsyncIterable<QueueEvent> {
  const timer = options.timer ?? realTimer;
  const max = options.maxTasks ?? MAX_TASKS;
  const queued = cards.slice(0, max);
  const done: string[] = [];

  for (const [i, card] of queued.entries()) {
    if (options.signal?.aborted) {
      yield { type: 'result', result: { card, status: 'cancelled', findings: [] } };
      continue;
    }
    yield {
      type: 'progress',
      done: [...done],
      running: card.specialist,
      waiting: queued.length - i - 1,
    };

    const task = new AbortController();
    let timedOut = false;
    const cancelTimer = timer(card.budgetMs, () => {
      timedOut = true;
      task.abort();
    });
    const stop = () => task.abort();
    options.signal?.addEventListener('abort', stop, { once: true });
    let result: TaskResult;
    try {
      // Raced against its own abort: a task that ignores its signal can't hold the queue (review
      // of AV2-05); its late answer is dropped.
      const stopped = new Promise<never>((_, reject) => {
        const quit = () => reject(new Error('stopped'));
        if (task.signal.aborted) quit();
        else task.signal.addEventListener('abort', quit, { once: true });
      });
      stopped.catch(() => undefined); // only read when it wins the race
      const output = await Promise.race([options.run(card, task.signal), stopped]);
      const findings = FindingsSchema.safeParse(output);
      result = findings.success
        ? { card, status: 'done', findings: findings.data }
        : { card, status: 'failed', findings: [], error: 'broke the finding contract' };
    } catch (error) {
      const status: TaskStatus = timedOut
        ? 'timeout'
        : options.signal?.aborted
          ? 'cancelled'
          : 'failed';
      result = {
        card,
        status,
        findings: [],
        ...(status === 'failed'
          ? { error: error instanceof Error ? error.message : String(error) }
          : {}),
      };
    } finally {
      cancelTimer();
      options.signal?.removeEventListener('abort', stop);
    }
    if (result.status === 'done') done.push(card.specialist);
    yield { type: 'result', result };
  }
  for (const card of cards.slice(max))
    yield { type: 'result', result: { card, status: 'skipped', findings: [] } };
  if (!options.signal?.aborted)
    yield { type: 'progress', done: [...done], running: null, waiting: 0 };
}
