import {
  createNode,
  NODE_SIZE,
  type AgentOp,
  type ApplyOpsOptions,
  type Board,
  type Position,
} from '@designroom/domain';
import { spawnPosition } from './spawnPosition.ts';

// Where the AI's new nodes go (architecture §5.4). LLMs are bad at coordinates, so the model only
// says `near`; the app places the box — right of that node, else in the middle of the view — with
// the same rule as the toolbar: not on another box, in view, not under the toolbar.
// Computed once per proposal; the ghost preview and Accept both use the result, so a box lands
// exactly where its ghost was.

/** Proposed node id → its position on the board. */
export type Placements = Record<string, Position>;

type Rect = { x: number; y: number; width: number; height: number };

export type PlacementView = {
  /** Fallback point for a node without `near`: the middle of what the user sees. */
  center: Position;
  view?: Rect;
  /** What covers the canvas (the toolbar), in diagram coordinates. */
  covered?: readonly Rect[];
};

/** Space between `near` and the new box: room for an arrow and its label. */
const GAP = 96;

export const placeProposal = (
  board: Board,
  ops: readonly AgentOp[],
  { center, view, covered = [] }: PlacementView,
): Placements => {
  const placements: Placements = {};
  let current = board; // grows with each placed node, so the next one avoids it
  for (const op of ops) {
    if (op.op !== 'addNode') continue;
    const near = current.nodes.find((n) => n.id === op.near);
    const target = near
      ? {
          x: near.position.x + NODE_SIZE.width + GAP + NODE_SIZE.width / 2,
          y: near.position.y + NODE_SIZE.height / 2,
        }
      : center;
    const at = spawnPosition(current, target, NODE_SIZE, view, covered);
    placements[op.nodeId] = at;
    current = { ...current, nodes: [...current.nodes, createNode(op.nodeId, op.kind, at)] };
  }
  return placements;
};

/**
 * `applyOps` options that put new nodes at their placements — one function for the ghost preview
 * and for Accept, so both agree. Without placements, applyOps' own default (right of `near`).
 */
export const withPlacements = (placements: Placements | null): ApplyOpsOptions =>
  placements
    ? {
        placeNode: (op) =>
          // Every addNode op is placed together; the origin only guards a malformed proposal.
          placements[op.nodeId] ?? { x: 0, y: 0 },
      }
    : {};
