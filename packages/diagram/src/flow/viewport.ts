import type { DiagramPosition } from '../types.ts';

/** The viewport transform: pan x, pan y, zoom. */
export type Transform = readonly [x: number, y: number, zoom: number];

/** The diagram coordinates under the middle of the pane, whatever the pan and zoom. */
export const viewportCenter = (
  pane: { width: number; height: number },
  [tx, ty, zoom]: Transform,
): DiagramPosition => ({
  x: (pane.width / 2 - tx) / zoom,
  y: (pane.height / 2 - ty) / zoom,
});

/** A rectangle in diagram coordinates. */
export type DiagramRect = { x: number; y: number; width: number; height: number };

/** What the user sees, in diagram coordinates. */
export const viewportBounds = (
  pane: { width: number; height: number },
  [tx, ty, zoom]: Transform,
): DiagramRect => ({
  x: (0 - tx) / zoom, // not -tx: that gives -0 when the view is not moved
  y: (0 - ty) / zoom,
  width: pane.width / zoom,
  height: pane.height / zoom,
});
