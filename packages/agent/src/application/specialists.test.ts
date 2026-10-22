import type { Board, BoardNode, NodeKind } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import type { TaskCard } from '../domain/tasks.ts';
import { createOrchestrator, type OrchestratorEvent } from './orchestrator.ts';
import { RULE_SPECIALISTS } from './specialists.ts';

// The first specialists (AV2-06): Data and Security, rules first — what code can see stays code
// (architecture-v2 § Specialists). Their eval boards: one per flaw, and a clean one that must
// produce nothing. Rules are deterministic, so "≥ 4/5 runs" is 5/5 by construction.

const boardOf = (boxes: [NodeKind, string][], arrows: [string, string][]): Board => ({
  nodes: boxes.map(([kind, label]): BoardNode => ({
    id: label,
    kind,
    label,
    position: { x: 0, y: 0 },
  })),
  edges: arrows.map(([source, target], i) => ({ id: `e${i}`, source, target })),
});

const card = (specialist: string, boxIds: string[] = []): TaskCard => ({
  id: `t-${specialist}`,
  specialist,
  boxIds,
  question: 'Review this design',
  budgetMs: 60_000,
});

const ask = (specialist: 'data' | 'security', board: Board, boxIds: string[] = []) =>
  RULE_SPECIALISTS[specialist]({
    card: card(specialist, boxIds),
    board,
    signal: new AbortController().signal,
  });

const singleDatabase = boardOf(
  [
    ['client', 'Web'],
    ['loadBalancer', 'Gateway'],
    ['api', 'Orders API'],
    ['cache', 'Redis'],
    ['database', 'Postgres'],
  ],
  [
    ['Web', 'Gateway'],
    ['Gateway', 'Orders API'],
    ['Orders API', 'Redis'],
    ['Orders API', 'Postgres'],
  ],
);

const clientToDatabase = boardOf(
  [
    ['client', 'Mobile app'],
    ['database', 'Firestore'],
  ],
  [['Mobile app', 'Firestore']],
);

const clean = boardOf(
  [
    ['client', 'Web'],
    ['loadBalancer', 'Gateway'],
    ['api', 'Orders API'],
    ['cache', 'Redis'],
    ['database', 'Postgres (primary + replica)'],
  ],
  [
    ['Web', 'Gateway'],
    ['Gateway', 'Orders API'],
    ['Orders API', 'Redis'],
    ['Orders API', 'Postgres (primary + replica)'],
  ],
);

describe('Data specialist', () => {
  it('finds the single database, as a typed finding with confidence 1', async () => {
    expect(await ask('data', singleDatabase)).toEqual([
      {
        specialist: 'data',
        kind: 'single-database',
        boxIds: ['Postgres'],
        severity: 'critical',
        problem: expect.stringMatching(/single point of failure/) as unknown,
        fix: expect.any(String) as unknown,
        confidence: 1,
      },
    ]);
  });

  it('nothing on the clean board', async () => {
    expect(await ask('data', clean)).toEqual([]);
  });

  it('only looks at the boxes on its card, when the card names some', async () => {
    expect(await ask('data', singleDatabase, ['Redis'])).toEqual([]);
  });
});

describe('Security specialist', () => {
  it('finds the client reading the database directly', async () => {
    expect(await ask('security', clientToDatabase)).toEqual([
      expect.objectContaining({
        specialist: 'security',
        kind: 'client-to-data',
        boxIds: ['Mobile app', 'Firestore'],
        severity: 'critical',
      }),
    ]);
  });

  it('nothing on the clean board', async () => {
    expect(await ask('security', clean)).toEqual([]);
  });
});

describe('Data and Security through the orchestrator', () => {
  it('both review the same board: findings merged, most severe first', async () => {
    const board = boardOf(
      [
        ['client', 'App'],
        ['api', 'API'],
        ['database', 'DB'],
      ],
      [
        ['App', 'API'],
        ['App', 'DB'],
        ['API', 'DB'],
      ],
    );
    const events: OrchestratorEvent[] = [];
    for await (const event of createOrchestrator({ specialists: RULE_SPECIALISTS }).run({
      cards: [card('data'), card('security')],
      board,
    }))
      events.push(event);

    const merged = events.at(-1);
    expect(merged?.type === 'merged' && merged.findings.map((f) => [f.specialist, f.kind])).toEqual(
      [
        ['data', 'single-database'],
        ['security', 'client-to-data'],
        ['data', 'no-cache'],
        ['security', 'no-edge'],
      ],
    );
  });
});
