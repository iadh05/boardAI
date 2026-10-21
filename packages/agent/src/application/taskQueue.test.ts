import { describe, expect, it } from 'vitest';
import type { Finding } from '../domain/findings.ts';
import type { TaskCard } from '../domain/tasks.ts';
import { runTaskQueue, type QueueEvent, type Timer } from './taskQueue.ts';

// The task queue (AV2-05, D5): one task at a time — one GPU answers one call at a time anyway —
// at most 6 per request, 60 s each, and Stop cancels the running task and the waiting ones.

const card = (id: string, specialist = id): TaskCard => ({
  id,
  specialist,
  boxIds: ['db'],
  question: `Check ${specialist}`,
  budgetMs: 60_000,
});

const finding = (specialist: string): Finding => ({
  specialist,
  kind: 'single-database',
  boxIds: ['db'],
  severity: 'warn',
  problem: 'one copy',
  confidence: 1,
});

/** Timers fired by hand: no test reads the clock (docs/rules/general.md). */
const manualTimer = () => {
  const pending = new Set<() => void>();
  const timer: Timer = (_ms, fire) => {
    pending.add(fire);
    return () => pending.delete(fire);
  };
  return { timer, fireAll: () => [...pending].forEach((fire) => fire()) };
};

const collect = async (events: AsyncIterable<QueueEvent>) => {
  const all: QueueEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
};

const resultsOf = (events: QueueEvent[]) =>
  events.flatMap((e) => (e.type === 'result' ? [e.result] : []));

describe('runTaskQueue', () => {
  it('runs the tasks one at a time, in order, and returns each one’s findings', async () => {
    const order: string[] = [];
    let running = 0;
    const events = await collect(
      runTaskQueue([card('data'), card('security')], {
        run: async (task) => {
          running++;
          expect(running).toBe(1); // never two at once
          order.push(task.id);
          await Promise.resolve();
          running--;
          return [finding(task.specialist)];
        },
        timer: manualTimer().timer,
      }),
    );

    expect(order).toEqual(['data', 'security']);
    expect(resultsOf(events).map((r) => [r.card.id, r.status, r.findings.length])).toEqual([
      ['data', 'done', 1],
      ['security', 'done', 1],
    ]);
  });

  it('reports progress before each task and at the end', async () => {
    const events = await collect(
      runTaskQueue([card('data'), card('security')], {
        run: () => Promise.resolve([]),
        timer: manualTimer().timer,
      }),
    );

    expect(events.filter((e) => e.type === 'progress')).toEqual([
      { type: 'progress', done: [], running: 'data', waiting: 1 },
      { type: 'progress', done: ['data'], running: 'security', waiting: 0 },
      { type: 'progress', done: ['data', 'security'], running: null, waiting: 0 },
    ]);
  });

  it('a task over its time is stopped and marked timeout; the next one still runs', async () => {
    const { timer, fireAll } = manualTimer();
    const events = await collect(
      runTaskQueue([card('slow'), card('fast')], {
        run: (task, signal) =>
          task.id === 'slow'
            ? new Promise((_, reject) => {
                signal.addEventListener('abort', () => reject(new Error('aborted')));
                fireAll(); // its 60 s are up
              })
            : Promise.resolve([finding('fast')]),
        timer,
      }),
    );

    expect(resultsOf(events).map((r) => [r.card.id, r.status])).toEqual([
      ['slow', 'timeout'],
      ['fast', 'done'],
    ]);
  });

  it('Stop cancels the running task and the waiting ones', async () => {
    const stop = new AbortController();
    const events = await collect(
      runTaskQueue([card('data'), card('security'), card('cost')], {
        run: (_task, signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
            stop.abort(); // the user pressed Stop while the first task ran
          }),
        timer: manualTimer().timer,
        signal: stop.signal,
      }),
    );

    expect(resultsOf(events).map((r) => [r.card.id, r.status])).toEqual([
      ['data', 'cancelled'],
      ['security', 'cancelled'],
      ['cost', 'cancelled'],
    ]);
  });

  it('runs at most 6 tasks: the rest are skipped, not silently dropped', async () => {
    const cards = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => card(id));
    const events = await collect(
      runTaskQueue(cards, { run: () => Promise.resolve([]), timer: manualTimer().timer }),
    );

    expect(resultsOf(events).map((r) => r.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
      'skipped',
    ]);
  });

  it('a specialist that breaks the finding contract fails: its output is not trusted', async () => {
    const events = await collect(
      runTaskQueue([card('data')], {
        run: () => Promise.resolve([{ specialist: 'data', severity: 'panic' }]),
        timer: manualTimer().timer,
      }),
    );

    expect(resultsOf(events)).toEqual([
      expect.objectContaining({ status: 'failed', findings: [] }),
    ]);
  });

  it('a specialist that throws fails alone; the queue goes on', async () => {
    const events = await collect(
      runTaskQueue([card('data'), card('security')], {
        run: (task) =>
          task.id === 'data' ? Promise.reject(new Error('model down')) : Promise.resolve([]),
        timer: manualTimer().timer,
      }),
    );

    expect(resultsOf(events).map((r) => [r.card.id, r.status, r.error])).toEqual([
      ['data', 'failed', 'model down'],
      ['security', 'done', undefined],
    ]);
  });
});
