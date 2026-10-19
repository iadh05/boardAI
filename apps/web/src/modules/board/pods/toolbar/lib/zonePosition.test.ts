import { describe, expect, it } from 'vitest';
import { zonePosition } from './zonePosition.ts';

const SIZE = { width: 520, height: 300 };

describe('zonePosition', () => {
  it('centres the zone on the view, on the grid', () => {
    expect(zonePosition({ x: 500, y: 400 }, SIZE)).toEqual({ x: 240, y: 260 });
  });

  it('moves it below the toolbar when its title would open under it', () => {
    const toolbar = { x: 0, y: 0, width: 380, height: 300 };
    const at = zonePosition({ x: 300, y: 300 }, SIZE, [toolbar]);
    expect(at.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
    expect(at.y % 20).toBe(0);
  });

  it('stays centred when nothing covers it', () => {
    const toolbar = { x: 0, y: 0, width: 100, height: 50 };
    expect(zonePosition({ x: 500, y: 400 }, SIZE, [toolbar])).toEqual({ x: 240, y: 260 });
  });
});
