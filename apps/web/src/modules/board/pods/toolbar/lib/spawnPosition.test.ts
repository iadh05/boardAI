import { createNode, type Board, type Position } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { spawnPosition } from './spawnPosition.ts';

const SIZE = { width: 176, height: 60 };
const GRID = 20;
const empty: Board = { nodes: [], edges: [] };
const center = { x: 500, y: 300 };

const overlaps = (a: Position, b: Position) =>
  Math.abs(a.x - b.x) < SIZE.width && Math.abs(a.y - b.y) < SIZE.height;

/** Adds nodes one by one, the way repeated toolbar clicks do. */
const addMany = (count: number, board: Board = empty): Position[] => {
  const spots: Position[] = [];
  let current = board;
  for (let i = 0; i < count; i++) {
    const at = spawnPosition(current, center, SIZE);
    spots.push(at);
    current = { ...current, nodes: [...current.nodes, createNode(`n${i}`, 'api', at)] };
  }
  return spots;
};

describe('spawnPosition', () => {
  it('centres the first box on the view, on the grid', () => {
    const at = spawnPosition(empty, center, SIZE);

    expect(at.x % GRID).toBe(0);
    expect(at.y % GRID).toBe(0);
    expect(Math.abs(at.x + SIZE.width / 2 - center.x)).toBeLessThanOrEqual(GRID);
    expect(Math.abs(at.y + SIZE.height / 2 - center.y)).toBeLessThanOrEqual(GRID);
  });

  it('puts the next box beside the first one, to the right, with room between them', () => {
    const [first, second] = addMany(2);

    expect(second?.y).toBe(first?.y);
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBeGreaterThan(SIZE.width);
  });

  it('never puts a box on top of another, however many are added', () => {
    const spots = addMany(12);
    for (const [i, a] of spots.entries()) {
      for (const b of spots.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
  });

  it('avoids boxes the user placed by hand too', () => {
    const handPlaced = spawnPosition(empty, center, SIZE);
    const board: Board = {
      nodes: [createNode('mine', 'database', { x: handPlaced.x + 30, y: handPlaced.y + 10 })],
      edges: [],
    };
    expect(overlaps(spawnPosition(board, center, SIZE), board.nodes[0]?.position ?? center)).toBe(
      false,
    );
  });

  it('keeps new boxes where the user can see them: on a narrow view, the next one goes below', () => {
    const view = { x: 350, y: 100, width: 300, height: 500 }; // a phone-width view around the centre
    let board: Board = empty;
    const spots: Position[] = [];
    for (let i = 0; i < 3; i++) {
      const at = spawnPosition(board, center, SIZE, view);
      spots.push(at);
      board = { ...board, nodes: [...board.nodes, createNode(`n${i}`, 'api', at)] };
    }
    for (const at of spots) {
      expect(at.x).toBeGreaterThanOrEqual(view.x);
      expect(at.x + SIZE.width).toBeLessThanOrEqual(view.x + view.width);
      expect(at.y).toBeGreaterThanOrEqual(view.y);
      expect(at.y + SIZE.height).toBeLessThanOrEqual(view.y + view.height);
    }
  });
});
