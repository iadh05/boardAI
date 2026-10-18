import { describe, expect, it } from 'vitest';
import { createZoneDrag, type DragItem } from './zoneDrag.ts';

const zone: DragItem = { id: 'vpc', zone: true, x: 0, y: 0, width: 600, height: 300 };
const api: DragItem = { id: 'api', zone: false, x: 40, y: 60, width: 176, height: 60 };
const client: DragItem = { id: 'client', zone: false, x: -300, y: 60, width: 176, height: 60 };
const items = [zone, api, client];

describe('createZoneDrag', () => {
  it('moves what was inside the zone along with it, live', () => {
    const drag = createZoneDrag();
    const step = drag.step([{ id: 'vpc', position: { x: 50, y: 20 }, dragging: true }], items);
    expect(step.carried).toEqual([{ id: 'api', position: { x: 90, y: 80 } }]);
    expect(step.ended).toEqual([]);
  });

  it('keeps carrying what was inside at the start, even once the zone has moved away', () => {
    const drag = createZoneDrag();
    drag.step([{ id: 'vpc', position: { x: 50, y: 0 }, dragging: true }], items);
    const moved = items.map((it) => (it.id === 'vpc' ? { ...it, x: 50 } : it));
    const step = drag.step([{ id: 'vpc', position: { x: 500, y: 0 }, dragging: true }], moved);
    expect(step.carried).toEqual([{ id: 'api', position: { x: 540, y: 60 } }]);
  });

  it('reports where the zone ended, once, when the drag ends', () => {
    const drag = createZoneDrag();
    drag.step([{ id: 'vpc', position: { x: 10, y: 0 }, dragging: true }], items);
    const end = drag.step([{ id: 'vpc', position: { x: 20, y: 0 }, dragging: false }], items);
    expect(end.ended).toEqual([{ id: 'vpc', position: { x: 20, y: 0 } }]);
    // A new drag starts fresh: it looks at what is inside now.
    const next = drag.step([{ id: 'vpc', position: { x: 30, y: 0 }, dragging: true }], items);
    expect(next.carried).toEqual([{ id: 'api', position: { x: 70, y: 60 } }]);
  });

  it('ignores moves of boxes and moves without a position', () => {
    const drag = createZoneDrag();
    const step = drag.step(
      [
        { id: 'api', position: { x: 1, y: 1 }, dragging: true },
        { id: 'vpc', dragging: true },
      ],
      items,
    );
    expect(step).toEqual({ carried: [], ended: [] });
  });
});
