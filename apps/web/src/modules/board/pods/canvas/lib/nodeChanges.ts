import type { BoardActions } from '../../../store/boardStore.ts';
import type { NodeChange } from '@xyflow/react';
import type { FlowNode } from '../../../lib/flowTypes.ts';

/**
 * New nodes from the store, keeping what only the canvas knows about each node: whether it is
 * selected and its measured size. The store owns data and positions; the canvas owns the rest.
 */
export const mergeFlowNodes = (fromStore: FlowNode[], current: FlowNode[]): FlowNode[] => {
  const byId = new Map(current.map((n) => [n.id, n]));
  return fromStore.map((next) => {
    const previous = byId.get(next.id);
    if (!previous) return next;
    const merged = { ...next, selected: previous.selected, measured: previous.measured };
    // Mid-drag the pointer wins: don't snap the node back to its old stored position.
    return previous.dragging ? { ...merged, position: previous.position, dragging: true } : merged;
  });
};

/**
 * The changes the canvas may apply to its own copy: drag, select, measure. Additions and removals
 * are dropped — only the store decides what exists (deletion goes through the store, M1-12).
 */
export const canvasChanges = (changes: NodeChange<FlowNode>[]): NodeChange<FlowNode>[] =>
  changes.filter((change) => change.type !== 'remove' && change.type !== 'add');

/**
 * Turns React Flow's change events into store actions. While a node is being dragged only the
 * canvas moves it; the store gets the final position when the drag ends (one update, not 60/s).
 */
export const commitNodeChanges = (
  changes: NodeChange[],
  actions: Pick<BoardActions, 'moveNode'>,
): void => {
  for (const change of changes) {
    if (change.type === 'position' && change.dragging === false && change.position) {
      actions.moveNode(change.id, change.position);
    }
  }
};
