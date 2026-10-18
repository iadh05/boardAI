import { fail, ok, type Result } from '../result.ts';
import {
  BoardEdgeSchema,
  BoardNodeSchema,
  KIND_DEFAULT_LABEL,
  PositionSchema,
  type Board,
  type BoardEdge,
  type BoardNode,
  type NodeKind,
  type Position,
} from './board.ts';

// Board operations (architecture §4.2): pure and immutable. Each returns a new board or a typed
// error — the same rules for the canvas, the store and the AI's proposals.
// Ids are always passed in (no randomness here): the caller generates them, tests stay
// deterministic (docs/rules/backend.md — domain).

export type BoardErrorCode =
  | 'DUPLICATE_ID'
  | 'NODE_NOT_FOUND'
  | 'EDGE_NOT_FOUND'
  | 'SELF_LOOP'
  | 'DUPLICATE_EDGE'
  | 'INVALID_ID'
  | 'INVALID_NODE'
  | 'INVALID_LABEL'
  | 'INVALID_POSITION';

export type BoardResult<T = Board> = Result<T, BoardErrorCode>;

export const emptyBoard = (): Board => ({ nodes: [], edges: [] });

/** A new node with its kind's default label. */
export const createNode = (id: string, kind: NodeKind, position: Position): BoardNode => ({
  id,
  kind,
  label: KIND_DEFAULT_LABEL[kind],
  position: { ...position },
});

// Node ids and edge ids are separate namespaces — the same rule as BoardSchema.
const hasNode = (board: Board, id: string): boolean => board.nodes.some((n) => n.id === id);
const hasEdge = (board: Board, id: string): boolean => board.edges.some((e) => e.id === id);

const nodeNotFound = (id: string) => fail('NODE_NOT_FOUND', `No node with id "${id}"`);

/** Applies `update` to one node, or reports that it doesn't exist. */
const updateNode = (
  board: Board,
  id: string,
  update: (node: BoardNode) => BoardNode,
): BoardResult => {
  if (!hasNode(board, id)) return nodeNotFound(id);
  return ok({ ...board, nodes: board.nodes.map((n) => (n.id === id ? update(n) : n)) });
};

export const addNode = (board: Board, node: BoardNode): BoardResult => {
  const parsed = BoardNodeSchema.safeParse(node);
  if (!parsed.success) {
    return fail('INVALID_NODE', parsed.error.issues[0]?.message ?? 'Invalid node');
  }
  if (hasNode(board, node.id)) {
    return fail('DUPLICATE_ID', `A node with id "${node.id}" already exists`);
  }
  return ok({ ...board, nodes: [...board.nodes, parsed.data] });
};

/** Removes the node and every edge touching it — a board never keeps a dangling edge. */
export const removeNode = (board: Board, id: string): BoardResult => {
  if (!hasNode(board, id)) return nodeNotFound(id);
  return ok({
    ...board,
    nodes: board.nodes.filter((n) => n.id !== id),
    edges: board.edges.filter((e) => e.source !== id && e.target !== id),
  });
};

/**
 * The connection rule, shared by `connect` and the UI (React Flow's `isValidConnection`):
 * both ends exist, no self-loop, at most one edge per direction.
 */
export const canConnect = (board: Board, source: string, target: string): BoardResult<true> => {
  if (!hasNode(board, source)) return nodeNotFound(source);
  if (!hasNode(board, target)) return nodeNotFound(target);
  if (source === target) return fail('SELF_LOOP', 'A node cannot connect to itself');
  if (board.edges.some((e) => e.source === source && e.target === target)) {
    return fail('DUPLICATE_EDGE', `${source} → ${target} is already connected`);
  }
  return ok(true);
};

export const connect = (
  board: Board,
  edgeId: string,
  source: string,
  target: string,
): BoardResult => {
  if (!BoardEdgeSchema.shape.id.safeParse(edgeId).success) {
    return fail('INVALID_ID', `"${edgeId}" is not a valid edge id`);
  }
  // A malformed source/target can't match any node, so canConnect reports NODE_NOT_FOUND for it.
  const allowed = canConnect(board, source, target);
  if (!allowed.ok) return allowed;
  if (hasEdge(board, edgeId)) {
    return fail('DUPLICATE_ID', `An edge with id "${edgeId}" already exists`);
  }
  const edge: BoardEdge = { id: edgeId, source, target };
  return ok({ ...board, edges: [...board.edges, edge] });
};

export const removeEdge = (board: Board, id: string): BoardResult => {
  if (!hasEdge(board, id)) {
    return fail('EDGE_NOT_FOUND', `No edge with id "${id}"`);
  }
  return ok({ ...board, edges: board.edges.filter((e) => e.id !== id) });
};

/** Trims the label; an empty label falls back to the kind's default. */
export const renameNode = (board: Board, id: string, label: string): BoardResult => {
  const node = board.nodes.find((n) => n.id === id);
  if (!node) return nodeNotFound(id);
  const trimmed = label.trim();
  const next = trimmed === '' ? KIND_DEFAULT_LABEL[node.kind] : trimmed;
  const parsed = BoardNodeSchema.shape.label.safeParse(next);
  if (!parsed.success) {
    return fail('INVALID_LABEL', parsed.error.issues[0]?.message ?? 'Invalid label');
  }
  return updateNode(board, id, (n) => ({ ...n, label: parsed.data }));
};

/**
 * Changes what a node is; keeps its id and position. A label the user chose is kept; a label
 * that was still the old kind's default follows the new kind ("API" → "Cache").
 */
export const changeKind = (board: Board, id: string, kind: NodeKind): BoardResult =>
  updateNode(board, id, (n) => ({
    ...n,
    kind,
    label: n.label === KIND_DEFAULT_LABEL[n.kind] ? KIND_DEFAULT_LABEL[kind] : n.label,
  }));

export const moveNode = (board: Board, id: string, position: Position): BoardResult => {
  if (!PositionSchema.safeParse(position).success) {
    return fail('INVALID_POSITION', 'Position must be two finite numbers');
  }
  return updateNode(board, id, (n) => ({ ...n, position: { ...position } }));
};
