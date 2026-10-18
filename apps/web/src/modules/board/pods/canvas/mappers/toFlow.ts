import { applyOps, type Board, type Proposal } from '@designroom/domain';
import { MarkerType, type Edge } from '@xyflow/react';
import type { FlowGraph, FlowNode } from '../../../lib/flowTypes.ts';

// The only place that knows both our board model and React Flow's (architecture §5.1).
// In M2 the board comes from Yjs; this mapper and everything after it stay the same.

const ARROW = { type: MarkerType.ArrowClosed } as const;

/**
 * Board (+ pending AI proposal) → React Flow nodes and edges.
 * The proposal is previewed with the same `applyOps` that Accept uses, so ghosts appear exactly
 * where accepting would put them. A proposal that no longer fits shows no ghosts.
 */
export const toFlow = (board: Board, proposal: Proposal | null): FlowGraph => {
  const nodes: FlowNode[] = board.nodes.map((n) => ({
    id: n.id,
    type: 'system',
    position: n.position,
    data: { kind: n.kind, label: n.label },
  }));
  const edges: Edge[] = board.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    markerEnd: ARROW,
    // Not interactive until M1-12 wires edge selection and deletion through the store.
    selectable: false,
    focusable: false,
  }));

  const preview = proposal ? applyOps(board, proposal.ops) : null;
  if (!preview?.ok) return { nodes, edges };

  const existingNodes = new Set(board.nodes.map((n) => n.id));
  const existingEdges = new Set(board.edges.map((e) => e.id));

  for (const n of preview.value.nodes) {
    if (existingNodes.has(n.id)) continue;
    nodes.push({
      id: n.id,
      type: 'ghost',
      position: n.position,
      data: { kind: n.kind, label: n.label },
      draggable: false,
      selectable: false,
      connectable: false,
    });
  }
  for (const e of preview.value.edges) {
    if (existingEdges.has(e.id)) continue;
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      markerEnd: { ...ARROW, color: 'var(--color-accent)' },
      className: 'is-proposed',
      selectable: false,
      focusable: false,
    });
  }

  return { nodes, edges };
};
