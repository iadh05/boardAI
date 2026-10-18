import type { Board, Position } from '@designroom/domain';

/** How far a new node moves (right and down) when its spot is taken. */
export const NUDGE = 24;

/** React Flow's viewport transform: pan x, pan y, zoom. */
export type Transform = readonly [x: number, y: number, zoom: number];

/** The flow coordinates under the middle of the pane, whatever the pan and zoom. */
export const viewportCenter = (
  pane: { width: number; height: number },
  [tx, ty, zoom]: Transform,
): Position => ({
  x: (pane.width / 2 - tx) / zoom,
  y: (pane.height / 2 - ty) / zoom,
});

const isTaken = (board: Board, at: Position) =>
  board.nodes.some(
    (n) => Math.abs(n.position.x - at.x) < NUDGE / 2 && Math.abs(n.position.y - at.y) < NUDGE / 2,
  );

/** Where a new node goes: the target, nudged diagonally until no node sits there. */
export const spawnPosition = (board: Board, target: Position): Position => {
  let at = target;
  // Ends: each step moves past one node at most, and the board has finitely many.
  while (isTaken(board, at)) at = { x: at.x + NUDGE, y: at.y + NUDGE };
  return at;
};
