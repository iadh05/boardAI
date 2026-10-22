import type { Board } from '@designroom/domain';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Finding } from '../domain/findings.ts';
import type { TaskCard } from '../domain/tasks.ts';
import { createOrchestrator, type OrchestratorEvent, type Specialist } from './orchestrator.ts';

// The orchestrator (AV2-05, S1): the plan's tasks through the queue, findings merged in code,
// progress for the user, every step a span (Phoenix: request → each task → merge).

const board: Board = {
  nodes: [
    { id: 'api', kind: 'api', label: 'Orders API', position: { x: 0, y: 0 } },
    { id: 'db', kind: 'database', label: 'Postgres', position: { x: 300, y: 0 } },
  ],
  edges: [{ id: 'e1', source: 'api', target: 'db' }],
};

const card = (specialist: string): TaskCard => ({
  id: `t-${specialist}`,
  specialist,
  boxIds: ['db'],
  question: `Review ${specialist}`,
  budgetMs: 60_000,
});

const finding = (specialist: string, over: Partial<Finding> = {}): Finding => ({
  specialist,
  kind: 'single-database',
  boxIds: ['db'],
  severity: 'warn',
  problem: 'one copy of the data',
  confidence: 1,
  ...over,
});

const collect = async (events: AsyncIterable<OrchestratorEvent>) => {
  const all: OrchestratorEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
};

const exporter = new InMemorySpanExporter();
beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});
afterEach(() => exporter.reset());

describe('createOrchestrator', () => {
  it('a review through the queue with one specialist: progress, then the merged findings', async () => {
    const seen: TaskCard[] = [];
    const data: Specialist = ({ card: task }) => {
      seen.push(task);
      return Promise.resolve([finding('data')]);
    };

    const events = await collect(
      createOrchestrator({ specialists: { data } }).run({ cards: [card('data')], board }),
    );

    expect(seen).toEqual([card('data')]); // the specialist gets its card, nothing more
    expect(
      events.filter((e) => e.type === 'progress').map((e) => e.type === 'progress' && e.text),
    ).toEqual(['Data running', 'Data ✓']);
    expect(events.at(-1)).toMatchObject({
      type: 'merged',
      findings: [expect.objectContaining({ kind: 'single-database', from: ['data'] })],
      conflicts: [],
    });
  });

  it('two specialists agreeing on one problem: one finding, both named', async () => {
    const events = await collect(
      createOrchestrator({
        specialists: {
          data: () => Promise.resolve([finding('data')]),
          chaos: () => Promise.resolve([finding('chaos', { severity: 'critical' })]),
        },
      }).run({ cards: [card('data'), card('chaos')], board }),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'merged',
      findings: [expect.objectContaining({ severity: 'critical', from: ['data', 'chaos'] })],
    });
  });

  it('a task for a specialist that does not exist fails; the others still run', async () => {
    const events = await collect(
      createOrchestrator({ specialists: { data: () => Promise.resolve([finding('data')]) } }).run({
        cards: [card('astrology'), card('data')],
        board,
      }),
    );

    const last = events.at(-1);
    expect(
      last?.type === 'merged' && last.results.map((r) => [r.card.specialist, r.status]),
    ).toEqual([
      ['astrology', 'failed'],
      ['data', 'done'],
    ]);
  });

  it('every task is a span inside the orchestrator span, with its status and findings count', async () => {
    await collect(
      createOrchestrator({ specialists: { data: () => Promise.resolve([finding('data')]) } }).run({
        cards: [card('data')],
        board,
      }),
    );

    const spans = exporter.getFinishedSpans();
    const root = spans.find((s) => s.name === 'orchestrator');
    const task = spans.find((s) => s.name === 'task data');
    expect(task?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
    expect(task?.attributes).toMatchObject({
      'designroom.task.status': 'done',
      'designroom.task.findings': 1,
    });
    expect(root?.attributes).toMatchObject({ 'designroom.orchestrator.tasks': 1 });
  });
});
