import { z } from 'zod';
import { fail, ok, type Result } from '../result.ts';
import {
  BoardNodeSchema,
  EdgeLabelSchema,
  EdgeModeSchema,
  KIND_DEFAULT_LABEL,
  NodeKindSchema,
  type Board,
  type Position,
} from './board.ts';
import {
  addNode,
  changeKind,
  connect,
  createNode,
  renameNode,
  type BoardErrorCode,
  type BoardResult,
} from './ops.ts';

// What the AI may do to a board (architecture §4.3). It never edits the board directly: it
// proposes operations, which are validated by applyOps on the server (dry run) and applied by
// the same applyOps in the browser when the user clicks Accept.
// There is deliberately NO delete operation — adding one needs an ADR (docs/rules/backend.md).

const Id = BoardNodeSchema.shape.id;
const Label = BoardNodeSchema.shape.label;

export const AddNodeOpSchema = z.object({
  op: z.literal('addNode'),
  nodeId: Id,
  kind: NodeKindSchema,
  label: Label,
  /** Id of the node the new one relates to; used to place it nearby. */
  near: Id.optional(),
});

export const UpdateNodeOpSchema = z
  .object({
    op: z.literal('updateNode'),
    nodeId: Id,
    label: Label.optional(),
    kind: NodeKindSchema.optional(),
  })
  .refine((op) => op.label !== undefined || op.kind !== undefined, {
    message: 'updateNode must change the label or the kind',
  });

export const ConnectOpSchema = z.object({
  op: z.literal('connect'),
  edgeId: Id,
  source: Id,
  target: Id,
  /** E.g. "events": the agent can say what the link is. */
  label: EdgeLabelSchema.optional(),
  /** E.g. async through a queue — something a reviewer often suggests. */
  mode: EdgeModeSchema.optional(),
});

export const AgentOpSchema = z.discriminatedUnion('op', [
  AddNodeOpSchema,
  UpdateNodeOpSchema,
  ConnectOpSchema,
]);
export type AgentOp = z.infer<typeof AgentOpSchema>;
export type AddNodeOp = z.infer<typeof AddNodeOpSchema>;

/** Most changes a single proposal may carry — keeps proposals reviewable by a human. */
export const MAX_OPS_PER_PROPOSAL = 20;

export const ProposalSchema = z.object({
  id: Id,
  summary: z.string().min(1).max(500),
  ops: z.array(AgentOpSchema).min(1).max(MAX_OPS_PER_PROPOSAL),
  /** Links Accept/Reject feedback to the agent's trace (M1-26). */
  traceId: z.string().min(1).max(128).optional(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export type ApplyOpsErrorCode = BoardErrorCode | 'INVALID_OP';

export type ApplyOpsOptions = {
  /** Where a new node goes. LLMs are bad at coordinates, so the caller decides (canvas: M1-23). */
  placeNode?: (op: AddNodeOp, board: Board) => Position;
};

const COLUMN_GAP = 240;
const ROW_GAP = 120;

/**
 * Default placement: one column to the right of the `near` node (else the origin), moving down
 * one row at a time until the spot is free — so several new nodes near the same node don't stack.
 */
const besideNear = (op: AddNodeOp, board: Board): Position => {
  const near = board.nodes.find((n) => n.id === op.near);
  const x = near ? near.position.x + COLUMN_GAP : 0;
  let y = near ? near.position.y : 0;
  const taken = (py: number) =>
    board.nodes.some(
      (n) =>
        Math.abs(n.position.x - x) < COLUMN_GAP / 2 && Math.abs(n.position.y - py) < ROW_GAP / 2,
    );
  while (taken(y)) y += ROW_GAP;
  return { x, y };
};

/** The AI's label follows the same rule as a user rename: trimmed, empty → the kind's default. */
const labelFor = (op: AddNodeOp): string => op.label.trim() || KIND_DEFAULT_LABEL[op.kind];

const applyOne = (
  board: Board,
  op: AgentOp,
  placeNode: ApplyOpsOptions['placeNode'],
): BoardResult => {
  switch (op.op) {
    case 'addNode': {
      if (op.near !== undefined && !board.nodes.some((n) => n.id === op.near)) {
        return fail('NODE_NOT_FOUND', `No node with id "${op.near}" to place the new node near`);
      }
      const position = (placeNode ?? besideNear)(op, board);
      return addNode(board, { ...createNode(op.nodeId, op.kind, position), label: labelFor(op) });
    }
    case 'updateNode': {
      let next: BoardResult = ok(board);
      if (op.kind !== undefined) next = changeKind(board, op.nodeId, op.kind);
      if (next.ok && op.label !== undefined) next = renameNode(next.value, op.nodeId, op.label);
      return next;
    }
    case 'connect':
      return connect(board, op.edgeId, op.source, op.target, { label: op.label, mode: op.mode });
  }
};

/**
 * Applies a proposal's operations in order, all or nothing: if any operation fails, the result is
 * that error (naming the operation) and the caller keeps its original board.
 */
export const applyOps = (
  board: Board,
  ops: readonly AgentOp[],
  options: ApplyOpsOptions = {},
): Result<Board, ApplyOpsErrorCode> => {
  // Operations come from an LLM: validate them at runtime, whatever the static types say.
  const parsed = z.array(AgentOpSchema).min(1).max(MAX_OPS_PER_PROPOSAL).safeParse(ops);
  if (!parsed.success) {
    // Say which operation and field were wrong, so the model can fix that one (path: [index, field]).
    const issue = parsed.error.issues[0];
    const [index, ...field] = issue?.path ?? [];
    const where =
      typeof index === 'number'
        ? `Operation ${index + 1}${field.length ? ` (${field.join('.')})` : ''}: `
        : '';
    return fail('INVALID_OP', `${where}${issue?.message ?? 'Invalid operations'}`);
  }

  let current = board;
  for (const [index, op] of parsed.data.entries()) {
    const result = applyOne(current, op, options.placeNode);
    if (!result.ok) {
      return fail(result.error.code, `Operation ${index + 1} (${op.op}): ${result.error.message}`);
    }
    current = result.value;
  }
  return ok(current);
};
