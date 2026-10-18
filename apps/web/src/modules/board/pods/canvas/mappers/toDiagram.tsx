import type { DiagramEdge, DiagramNode } from '@designroom/diagram';
import {
  applyOps,
  KIND_DEFAULT_LABEL,
  type Board,
  type BoardEdge,
  type BoardNode,
  type Proposal,
} from '@designroom/domain';
import { Icon } from '../../../../../core/ui/index.ts';
import { KIND_COLOR, KIND_ICON, KIND_SHAPE } from '../../../lib/kindAppearance.ts';

// The only place that knows both our board model and the diagram's (architecture §5.1).
// In M2 the board comes from Yjs; this mapper and everything after it stay the same.

const toNode = (n: BoardNode, ghost: boolean): DiagramNode => ({
  id: n.id,
  label: n.label,
  position: n.position,
  shape: KIND_SHAPE[n.kind],
  color: KIND_COLOR[n.kind],
  // Named, so screen readers hear the kind even when the label says something else.
  icon: <Icon icon={KIND_ICON[n.kind]} label={KIND_DEFAULT_LABEL[n.kind]} />,
  ghost,
});

/** An arrow: its label, and dashed when the call is async (queue, events). */
const toEdge = (e: BoardEdge, ghost: boolean): DiagramEdge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  ghost,
  ...(e.label !== undefined ? { label: e.label } : {}),
  ...(e.mode === 'async' ? { dashed: true } : {}),
});

/**
 * Board (+ pending AI proposal) → what the diagram draws. The proposal is previewed with the same
 * `applyOps` that Accept uses, so ghosts appear exactly where accepting would put them. A
 * proposal that no longer fits shows no ghosts.
 */
export const toDiagram = (
  board: Board,
  proposal: Proposal | null,
): { nodes: DiagramNode[]; edges: DiagramEdge[] } => {
  const nodes = board.nodes.map((n) => toNode(n, false));
  const edges = board.edges.map((e) => toEdge(e, false));

  const preview = proposal ? applyOps(board, proposal.ops) : null;
  if (!preview?.ok) return { nodes, edges };

  const existingNodes = new Set(board.nodes.map((n) => n.id));
  const existingEdges = new Set(board.edges.map((e) => e.id));
  for (const n of preview.value.nodes) {
    if (!existingNodes.has(n.id)) nodes.push(toNode(n, true));
  }
  for (const e of preview.value.edges) {
    if (!existingEdges.has(e.id)) {
      edges.push(toEdge(e, true));
    }
  }
  return { nodes, edges };
};
