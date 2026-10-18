import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BoardSchema, NODE_KINDS, type Board } from './board.ts';
import {
  addNode,
  changeKind,
  connect,
  createNode,
  emptyBoard,
  moveNode,
  removeEdge,
  removeNode,
  renameNode,
  type BoardResult,
} from './ops.ts';

// Property-based test: instead of hand-picked cases, fast-check generates many random
// sequences of operations — with small id pools so collisions, missing ids and self-loops
// happen often — and checks after EVERY step that the board is still a valid graph
// (BoardSchema: unique ids, no dangling edge, no self-loop, no duplicate connection).
// When it finds a failing sequence, it shrinks it to the smallest one that still fails.

const nodeId = fc.constantFrom('n1', 'n2', 'n3', 'n4');
const edgeId = fc.constantFrom('e1', 'e2', 'e3', 'e4', 'e5', 'e6');
const kind = fc.constantFrom(...NODE_KINDS);
const coordinate = fc.integer({ min: -1000, max: 1000 });

type Op = { name: string; run: (board: Board) => BoardResult };

const named = (name: string, run: Op['run']): Op => ({ name, run });

// Weighted so the interesting states actually happen: most random sequences would otherwise
// fail early (you can't connect nodes that don't exist yet). Measured below.
const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .tuple(nodeId, kind, coordinate, coordinate)
      .map(([id, k, x, y]) => named('addNode', (b) => addNode(b, createNode(id, k, { x, y })))),
  },
  {
    weight: 4,
    arbitrary: fc
      .tuple(edgeId, nodeId, nodeId)
      .map(([id, s, t]) => named('connect', (b) => connect(b, id, s, t))),
  },
  { weight: 2, arbitrary: nodeId.map((id) => named('removeNode', (b) => removeNode(b, id))) },
  { weight: 1, arbitrary: edgeId.map((id) => named('removeEdge', (b) => removeEdge(b, id))) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(nodeId, fc.string({ maxLength: 20 }))
      .map(([id, l]) => named('renameNode', (b) => renameNode(b, id, l))),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(nodeId, kind)
      .map(([id, k]) => named('changeKind', (b) => changeKind(b, id, k))),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(nodeId, coordinate, coordinate)
      .map(([id, x, y]) => named('moveNode', (b) => moveNode(b, id, { x, y }))),
  },
);

// size 'max': use the whole length range — fast-check prefers short arrays by default.
const sequences = fc.array(op, { minLength: 5, maxLength: 60, size: 'max' });
const RUNS = 500;

describe('board operations (property-based)', () => {
  it('any sequence of operations keeps the board a valid graph', () => {
    fc.assert(
      fc.property(sequences, (ops) => {
        let board = emptyBoard();
        for (const { run } of ops) {
          const result = run(board);
          if (result.ok) board = result.value;
          // A failed op must leave nothing half-done: we keep the previous board.
          const check = BoardSchema.safeParse(board);
          expect(check.success, check.error?.issues[0]?.message).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('reaches the interesting states often enough to be meaningful', () => {
    // A property test is only as good as its generator. This guards against a generator that
    // "passes" because it never builds a connected graph or never removes a connected node.
    let connects = 0;
    let removalsOfConnectedNodes = 0;
    fc.assert(
      fc.property(sequences, (ops) => {
        let board = emptyBoard();
        for (const { name, run } of ops) {
          const result = run(board);
          if (!result.ok) continue;
          if (name === 'connect') connects++;
          if (name === 'removeNode' && result.value.edges.length < board.edges.length) {
            removalsOfConnectedNodes++;
          }
          board = result.value;
        }
      }),
      { numRuns: RUNS },
    );
    expect(connects).toBeGreaterThan(RUNS);
    expect(removalsOfConnectedNodes).toBeGreaterThan(RUNS / 5);
  });
});
