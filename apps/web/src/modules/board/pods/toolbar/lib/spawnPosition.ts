import type { Board, Position } from '@designroom/domain';

const GRID = 20;
/** Space kept between a new box and its neighbours. */
const GAP = 44;
/** How far around the view centre to look for a free slot (rings of slots). */
const MAX_RING = 6;

const snap = (v: number) => Math.round(v / GRID) * GRID;

/**
 * Slot offsets around the centre, nearest first; at equal distance, right before down before
 * left before up (architecture diagrams usually grow to the right).
 */
const SLOTS: readonly [number, number][] = (() => {
  const slots: [number, number][] = [];
  for (let dx = -MAX_RING; dx <= MAX_RING; dx++) {
    for (let dy = -MAX_RING; dy <= MAX_RING; dy++) slots.push([dx, dy]);
  }
  const preference = ([dx, dy]: [number, number]) =>
    dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : dy < 0 ? 3 : -1;
  return slots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || preference(a) - preference(b));
})();

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where a new box goes: centred on the view, on the grid, in the nearest slot where it overlaps
 * no other box. Slots are one box (plus a gap) apart, so new boxes form a tidy grid. With `view`
 * (what the user sees), slots outside it are skipped while there is room inside.
 */
export const spawnPosition = (
  board: Board,
  center: Position,
  size: { width: number; height: number },
  view?: Rect,
): Position => {
  const origin = { x: snap(center.x - size.width / 2), y: snap(center.y - size.height / 2) };
  const step = { x: snap(size.width + GAP), y: snap(size.height + GAP) };
  const isFree = (at: Position) =>
    board.nodes.every(
      (n) =>
        Math.abs(n.position.x - at.x) >= size.width + GAP / 2 ||
        Math.abs(n.position.y - at.y) >= size.height + GAP / 2,
    );

  const isVisible = (at: Position) =>
    !view ||
    (at.x >= view.x &&
      at.y >= view.y &&
      at.x + size.width <= view.x + view.width &&
      at.y + size.height <= view.y + view.height);

  const slots = SLOTS.map(([dx, dy]) => ({ x: origin.x + dx * step.x, y: origin.y + dy * step.y }));
  // Visible and free first; if the view is full, any free slot (the user can pan to it).
  const found = slots.find((at) => isVisible(at) && isFree(at)) ?? slots.find(isFree);
  if (found) return found;
  // A very crowded view: fall back to the centre; the user will move it.
  return origin;
};
