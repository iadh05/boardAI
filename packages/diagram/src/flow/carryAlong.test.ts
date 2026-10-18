import { describe, expect, it } from 'vitest';
import { carryAlong, insideOf } from './carryAlong.ts';

const zone = { id: 'vpc', x: 0, y: 0, width: 600, height: 300 };
const box = (id: string, x: number, y: number) => ({ id, x, y, width: 176, height: 60 });

describe('insideOf', () => {
  it('lists what lies wholly inside the zone: boxes and smaller zones', () => {
    const items = [
      box('api', 40, 60),
      box('client', -300, 60),
      box('half', 520, 60), // sticks out on the right
      { id: 'subnet', x: 20, y: 40, width: 240, height: 120 },
    ];
    expect(insideOf(zone, items).sort()).toEqual(['api', 'subnet']);
  });

  it('never lists the zone itself', () => {
    expect(insideOf(zone, [zone])).toEqual([]);
  });
});

describe('carryAlong', () => {
  it('moves the carried items by how far the zone moved', () => {
    const positions = new Map([
      ['api', { x: 40, y: 60 }],
      ['db', { x: 300, y: 60 }],
    ]);
    expect(carryAlong(positions, ['api', 'db'], { x: 0, y: 0 }, { x: 100, y: 50 })).toEqual([
      { id: 'api', position: { x: 140, y: 110 } },
      { id: 'db', position: { x: 400, y: 110 } },
    ]);
  });

  it('skips items that are gone', () => {
    expect(carryAlong(new Map(), ['api'], { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual([]);
  });
});
