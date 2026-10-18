import { useStoreApi } from '@xyflow/react';
import { viewportBounds, viewportCenter, type DiagramRect } from '../flow/viewport.ts';
import type { DiagramPosition } from '../types.ts';

export type DiagramViewport = {
  /** The diagram coordinates under the middle of what the user sees. */
  center: () => DiagramPosition;
  /** What the user sees, in diagram coordinates. */
  bounds: () => DiagramRect;
};

/** For children of <Diagram>. Reads the view on demand, so it never re-renders on pan or zoom. */
export function useDiagramViewport(): DiagramViewport {
  const store = useStoreApi();
  return {
    center: () => {
      const { width, height, transform } = store.getState();
      return viewportCenter({ width, height }, transform);
    },
    bounds: () => {
      const { width, height, transform } = store.getState();
      return viewportBounds({ width, height }, transform);
    },
  };
}
