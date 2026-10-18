import type { DiagramPosition } from '../types.ts';
import { carryAlong, insideOf } from './carryAlong.ts';

/** What the drag logic needs to know about each node on the canvas. */
export type DragItem = {
  id: string;
  zone: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};
/** A position change from React Flow, reduced to what matters here. */
export type MoveChange = { id: string; position?: DiagramPosition; dragging?: boolean };

/**
 * Tracks zone drags: what a zone held when its drag started moves along with it, live, and the
 * zone's final position is reported once when the drag ends.
 */
export const createZoneDrag = () => {
  const active = new Map<
    string,
    { start: DiagramPosition; ids: string[]; starts: Map<string, DiagramPosition> }
  >();

  return {
    step(changes: readonly MoveChange[], items: readonly DragItem[]) {
      const carried: { id: string; position: DiagramPosition }[] = [];
      const ended: { id: string; position: DiagramPosition }[] = [];
      for (const change of changes) {
        const zone = items.find((it) => it.id === change.id && it.zone);
        if (!zone || !change.position) continue;
        let drag = active.get(zone.id);
        if (!drag) {
          drag = {
            start: { x: zone.x, y: zone.y },
            ids: insideOf(zone, items),
            starts: new Map(items.map((it) => [it.id, { x: it.x, y: it.y }])),
          };
          active.set(zone.id, drag);
        }
        carried.push(...carryAlong(drag.starts, drag.ids, drag.start, change.position));
        if (change.dragging === false) {
          active.delete(zone.id);
          ended.push({ id: zone.id, position: change.position });
        }
      }
      return { carried, ended };
    },
  };
};
