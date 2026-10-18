import { describe, expect, it } from 'vitest';
import type { Board, BoardNode } from './board.ts';
import {
  addNode,
  canConnect,
  changeKind,
  connect,
  createNode,
  emptyBoard,
  moveNode,
  removeEdge,
  removeNode,
  renameNode,
} from './ops.ts';
import type { Result } from '../result.ts';

// ── helpers ────────────────────────────────────────────────────────────────────────────

/** Unwraps an ok result, failing the test with the error otherwise. */
const ok = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
};

/** Freezes the board deeply, so any mutation by an op throws in strict mode. */
const frozen = (board: Board): Board =>
  Object.freeze({
    nodes: Object.freeze(
      board.nodes.map((n) => Object.freeze({ ...n, position: Object.freeze({ ...n.position }) })),
    ),
    edges: Object.freeze(board.edges.map((e) => Object.freeze({ ...e }))),
  }) as Board;

const api = createNode('n1', 'api', { x: 0, y: 0 });
const db = createNode('n2', 'database', { x: 200, y: 0 });
const cache = createNode('n3', 'cache', { x: 200, y: 120 });
const client = createNode('n4', 'client', { x: -200, y: 0 });

/** api → db, api → cache, client → api */
const sampleBoard = (): Board =>
  frozen({
    nodes: [api, db, cache, client],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n1', target: 'n3' },
      { id: 'e3', source: 'n4', target: 'n1' },
    ],
  });

// ── tests ──────────────────────────────────────────────────────────────────────────────

describe('createNode', () => {
  it('uses the kind default label', () => {
    expect(createNode('x', 'loadBalancer', { x: 1, y: 2 })).toEqual({
      id: 'x',
      kind: 'loadBalancer',
      label: 'Load Balancer',
      position: { x: 1, y: 2 },
    });
  });
});

describe('addNode', () => {
  it('adds a node to the board', () => {
    const board = ok(addNode(frozen(emptyBoard()), api));
    expect(board.nodes).toEqual([api]);
  });

  it('rejects a duplicate id', () => {
    const result = addNode(sampleBoard(), createNode('n1', 'queue', { x: 0, y: 0 }));
    expect(result).toMatchObject({ ok: false, error: { code: 'DUPLICATE_ID' } });
  });

  it('rejects a node the schema would reject (label with a line break)', () => {
    const bad: BoardNode = { ...createNode('n9', 'api', { x: 0, y: 0 }), label: 'A\nB' };
    expect(addNode(sampleBoard(), bad)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_NODE' },
    });
  });
});

describe('removeNode', () => {
  it('removes the node and every edge touching it', () => {
    const board = ok(removeNode(sampleBoard(), 'n1')); // n1 has 3 edges
    expect(board.nodes.map((n) => n.id)).toEqual(['n2', 'n3', 'n4']);
    expect(board.edges).toEqual([]);
  });

  it('keeps edges that do not touch the node', () => {
    const board = ok(removeNode(sampleBoard(), 'n2'));
    expect(board.edges.map((e) => e.id)).toEqual(['e2', 'e3']);
  });

  it('reports an unknown node', () => {
    expect(removeNode(sampleBoard(), 'nope')).toMatchObject({
      ok: false,
      error: { code: 'NODE_NOT_FOUND' },
    });
  });
});

describe('canConnect / connect', () => {
  const board = (): Board => frozen({ nodes: [api, db], edges: [] });

  it('connects two existing nodes', () => {
    const result = ok(connect(board(), 'e1', 'n1', 'n2'));
    expect(result.edges).toEqual([{ id: 'e1', source: 'n1', target: 'n2' }]);
  });

  it('allows the opposite direction of an existing edge', () => {
    const once = ok(connect(board(), 'e1', 'n1', 'n2'));
    expect(connect(once, 'e2', 'n2', 'n1').ok).toBe(true);
  });

  it.each([
    ['a self-loop', 'n1', 'n1', 'SELF_LOOP'],
    ['an unknown source', 'n9', 'n2', 'NODE_NOT_FOUND'],
    ['an unknown target', 'n1', 'n9', 'NODE_NOT_FOUND'],
  ])('rejects %s', (_case, source, target, code) => {
    expect(canConnect(board(), source, target)).toMatchObject({ ok: false, error: { code } });
    expect(connect(board(), 'e1', source, target)).toMatchObject({ ok: false, error: { code } });
  });

  it('rejects a duplicate connection', () => {
    const once = ok(connect(board(), 'e1', 'n1', 'n2'));
    expect(connect(once, 'e2', 'n1', 'n2')).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_EDGE' },
    });
  });

  it('rejects a duplicate edge id', () => {
    const once = ok(connect(frozen({ nodes: [api, db, cache], edges: [] }), 'e1', 'n1', 'n2'));
    expect(connect(once, 'e1', 'n1', 'n3')).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_ID' },
    });
  });

  it('rejects an invalid edge id', () => {
    expect(connect(board(), 'e 1', 'n1', 'n2')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ID' },
    });
  });
});

describe('removeEdge', () => {
  it('removes only that edge', () => {
    const board = ok(removeEdge(sampleBoard(), 'e2'));
    expect(board.edges.map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(board.nodes).toHaveLength(4);
  });

  it('reports an unknown edge', () => {
    expect(removeEdge(sampleBoard(), 'nope')).toMatchObject({
      ok: false,
      error: { code: 'EDGE_NOT_FOUND' },
    });
  });
});

describe('renameNode', () => {
  it('trims and sets the label', () => {
    const board = ok(renameNode(sampleBoard(), 'n1', '  Orders API  '));
    expect(board.nodes[0]?.label).toBe('Orders API');
  });

  it('falls back to the kind default label when empty', () => {
    const board = ok(renameNode(sampleBoard(), 'n1', '   '));
    expect(board.nodes[0]?.label).toBe('API');
  });

  it('rejects a label the schema would reject', () => {
    expect(renameNode(sampleBoard(), 'n1', 'x'.repeat(101))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_LABEL' },
    });
    expect(renameNode(sampleBoard(), 'n1', 'A\nB')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_LABEL' },
    });
  });

  it('reports an unknown node', () => {
    expect(renameNode(sampleBoard(), 'nope', 'X')).toMatchObject({
      ok: false,
      error: { code: 'NODE_NOT_FOUND' },
    });
  });
});

describe('changeKind', () => {
  it('changes the kind and keeps id, label and position', () => {
    const renamed = ok(renameNode(sampleBoard(), 'n2', 'Orders DB'));
    const board = ok(changeKind(renamed, 'n2', 'cache'));
    expect(board.nodes[1]).toEqual({
      id: 'n2',
      kind: 'cache',
      label: 'Orders DB',
      position: { x: 200, y: 0 },
    });
  });

  it('reports an unknown node', () => {
    expect(changeKind(sampleBoard(), 'nope', 'cache')).toMatchObject({
      ok: false,
      error: { code: 'NODE_NOT_FOUND' },
    });
  });
});

describe('moveNode', () => {
  it('moves the node', () => {
    const board = ok(moveNode(sampleBoard(), 'n3', { x: 10, y: 20 }));
    expect(board.nodes[2]?.position).toEqual({ x: 10, y: 20 });
  });

  it('rejects a position that is not finite', () => {
    expect(moveNode(sampleBoard(), 'n3', { x: Number.NaN, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_POSITION' },
    });
  });

  it('reports an unknown node', () => {
    expect(moveNode(sampleBoard(), 'nope', { x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'NODE_NOT_FOUND' },
    });
  });
});

describe('immutability', () => {
  it('never mutates its input — every op works on a deeply frozen board', () => {
    const board = sampleBoard();
    const snapshot = JSON.stringify(board);

    ok(addNode(board, createNode('n9', 'queue', { x: 0, y: 0 })));
    ok(removeNode(board, 'n1'));
    ok(connect(board, 'e9', 'n2', 'n3'));
    ok(removeEdge(board, 'e1'));
    ok(renameNode(board, 'n1', 'Orders API'));
    ok(changeKind(board, 'n1', 'service'));
    ok(moveNode(board, 'n1', { x: 5, y: 5 }));

    expect(JSON.stringify(board)).toBe(snapshot);
  });

  it('returns a new board object on success', () => {
    const board = sampleBoard();
    expect(ok(moveNode(board, 'n1', { x: 5, y: 5 }))).not.toBe(board);
  });
});
