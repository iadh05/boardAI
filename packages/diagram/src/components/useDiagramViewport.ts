import { useStoreApi } from '@xyflow/react';
import { viewportCenter } from '../flow/viewport.ts';
import type { DiagramPosition } from '../types.ts';

export type DiagramViewport = {
  /** The diagram coordinates under the middle of what the user sees. */
  center: () => DiagramPosition;
};

/** For children of <Diagram>. Reads the view on demand, so it never re-renders on pan or zoom. */
export function useDiagramViewport(): DiagramViewport {
  const store = useStoreApi();
  return {
    center: () => {
      const { width, height, transform } = store.getState();
      return viewportCenter({ width, height }, transform);
    },
  };
}
