import { describe, expect, it } from 'vitest';
import { labelPoint, roundedPath } from './geometry.ts';

describe('roundedPath', () => {
  it('draws a straight route as one line', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBe('M 0 0 L 100 0');
  });

  it('rounds each corner with a small curve', () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        10,
      ),
    ).toBe('M 0 0 L 90 0 Q 100 0 100 10 L 100 100');
  });

  it('never rounds more than half a short segment', () => {
    const path = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 100 },
      ],
      10,
    );
    expect(path).toBe('M 0 0 L 4 0 Q 8 0 8 4 L 8 100');
  });

  it('is empty without points', () => {
    expect(roundedPath([])).toBe('');
  });
});

describe('labelPoint', () => {
  it('is the middle of the longest segment (where a label has the most room)', () => {
    expect(
      labelPoint([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 200 },
        { x: 60, y: 200 },
      ]),
    ).toEqual({ x: 20, y: 100 });
  });

  it('is the point itself for a one-point route', () => {
    expect(labelPoint([{ x: 5, y: 7 }])).toEqual({ x: 5, y: 7 });
  });
});
