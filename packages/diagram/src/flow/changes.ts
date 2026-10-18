import type { Edge, NodeChange } from '@xyflow/react';
import type { DiagramPosition } from '../types.ts';
import type { BoxNode } from './toReactFlow.ts';

// The diagram is controlled: the app owns what exists and where. The canvas keeps a local copy
// only for what it alone knows — selection, measured size, a node mid-drag — and merges the
// app's version in whenever the props change.

export const mergeNodes = (fromProps: BoxNode[], current: BoxNode[]): BoxNode[] => {
  const byId = new Map(current.map((n) => [n.id, n]));
  return fromProps.map((next) => {
    const previous = byId.get(next.id);
    if (!previous) return next;
    const merged = { ...next, selected: previous.selected, measured: previous.measured };
    // Mid-drag the pointer wins: don't snap the node back to its old position.
    return previous.dragging ? { ...merged, position: previous.position, dragging: true } : merged;
  });
};

export const mergeEdges = (fromProps: Edge[], current: Edge[]): Edge[] => {
  const selected = new Set(current.filter((e) => e.selected).map((e) => e.id));
  return fromProps.map((edge) => (selected.has(edge.id) ? { ...edge, selected: true } : edge));
};

/**
 * Node or edge changes the canvas may apply to its own copy: drag, select, measure. Additions
 * and removals are dropped — deletions go to the app through `onDelete`.
 */
export const canvasChanges = <Change extends { type: string }>(changes: Change[]): Change[] =>
  changes.filter((change) => change.type !== 'remove' && change.type !== 'add');

/** Reports a node's position once, when its drag ends. */
export const commitMoves = (
  changes: NodeChange[],
  onNodeMove: (id: string, position: DiagramPosition) => void,
): void => {
  for (const change of changes) {
    if (change.type === 'position' && change.dragging === false && change.position) {
      onNodeMove(change.id, change.position);
    }
  }
};
