import type { BoardActions } from '../../../store/boardStore.ts';
import type { NodeChange } from '@xyflow/react';
import type { FlowNode } from '../mappers/toFlow.ts';

/**
 * New nodes from the store, keeping what only the canvas knows about each node: whether it is
 * selected and its measured size. The store owns data and positions; the canvas owns the rest.
 */
export const mergeFlowNodes = (fromStore: FlowNode[], current: FlowNode[]): FlowNode[] => {
  const byId = new Map(current.map((n) => [n.id, n]));
  return fromStore.map((next) => {
    const previous = byId.get(next.id);
    if (!previous) return next;
    return { ...next, selected: previous.selected, measured: previous.measured };
  });
};

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
