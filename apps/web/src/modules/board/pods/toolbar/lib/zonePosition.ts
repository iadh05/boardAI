import type { Position } from '@designroom/domain';

type Rect = { x: number; y: number; width: number; height: number };

const GRID = 20;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const snapUp = (v: number) => Math.ceil(v / GRID) * GRID;

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * Where a new zone goes: centred on the view, on the grid — but never with its top (where its
 * title opens for naming) under what covers the canvas (the toolbar): then just below it.
 * Unlike boxes, a zone may cover boxes: it is drawn behind them.
 */
export const zonePosition = (
  center: Position,
  size: { width: number; height: number },
  covered: readonly Rect[] = [],
): Position => {
  const at = { x: snap(center.x - size.width / 2), y: snap(center.y - size.height / 2) };
  const titleBar = { ...at, width: size.width, height: GRID * 2 };
  const below = covered
    .filter((area) => intersects(titleBar, area))
    .reduce((y, area) => Math.max(y, area.y + area.height), -Infinity);
  return below === -Infinity ? at : { x: at.x, y: snapUp(below) };
};
