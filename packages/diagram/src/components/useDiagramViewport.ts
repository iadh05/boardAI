import { useStoreApi } from '@xyflow/react';
import {
  screenRectToDiagram,
  viewportBounds,
  viewportCenter,
  type DiagramRect,
} from '../flow/viewport.ts';
import type { DiagramPosition } from '../types.ts';

export type DiagramViewport = {
  /** The diagram coordinates under the middle of what the user sees. */
  center: () => DiagramPosition;
  /** What the user sees, in diagram coordinates. */
  bounds: () => DiagramRect;
  /** The part of the diagram an element drawn over it hides (a toolbar, a hint), in diagram coordinates. */
  coveredBy: (element: Element) => DiagramRect;
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
    coveredBy: (element) => {
      const { domNode, transform } = store.getState();
      const box = element.getBoundingClientRect();
      const pane = domNode?.getBoundingClientRect() ?? { left: 0, top: 0 };
      return screenRectToDiagram(
        { x: box.left - pane.left, y: box.top - pane.top, width: box.width, height: box.height },
        transform,
      );
    },
  };
}
