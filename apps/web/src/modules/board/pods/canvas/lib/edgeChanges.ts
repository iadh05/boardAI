import type { Edge } from '@xyflow/react';

/** New edges from the store, keeping the one thing only the canvas knows: which are selected. */
export const mergeFlowEdges = (fromStore: Edge[], current: Edge[]): Edge[] => {
  const selected = new Set(current.filter((e) => e.selected).map((e) => e.id));
  return fromStore.map((edge) => (selected.has(edge.id) ? { ...edge, selected: true } : edge));
};
