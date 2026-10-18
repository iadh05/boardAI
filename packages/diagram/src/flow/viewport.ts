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
