import type { DiagramPosition } from '../types.ts';

type Rect = { id: string; x: number; y: number; width: number; height: number };

/** Ids of the items (boxes, smaller zones) lying wholly inside the zone. */
export const insideOf = (zone: Rect, items: readonly Rect[]): string[] =>
  items
    .filter(
      (it) =>
        it.id !== zone.id &&
        it.x >= zone.x &&
        it.y >= zone.y &&
        it.x + it.width <= zone.x + zone.width &&
        it.y + it.height <= zone.y + zone.height,
    )
    .map((it) => it.id);

/**
 * Where the carried items are now: their positions when the drag started, moved by how far the
 * zone has moved. Used to move a zone's contents live while it is dragged.
 */
export const carryAlong = (
  startPositions: ReadonlyMap<string, DiagramPosition>,
  ids: readonly string[],
  zoneStart: DiagramPosition,
  zoneNow: DiagramPosition,
): { id: string; position: DiagramPosition }[] => {
  const dx = zoneNow.x - zoneStart.x;
  const dy = zoneNow.y - zoneStart.y;
  return ids.flatMap((id) => {
    const start = startPositions.get(id);
    return start ? [{ id, position: { x: start.x + dx, y: start.y + dy } }] : [];
  });
};
