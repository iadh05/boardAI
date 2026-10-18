import { createNode, type Board } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { NUDGE, spawnPosition, viewportCenter } from './spawnPosition.ts';

describe('viewportCenter', () => {
  it('is the middle of the pane when the view is not moved', () => {
    expect(viewportCenter({ width: 800, height: 600 }, [0, 0, 1])).toEqual({ x: 400, y: 300 });
  });

  it('follows panning and zoom (screen → flow coordinates)', () => {
    // Panned right by 100 and down by 50, zoomed to 2×.
    expect(viewportCenter({ width: 800, height: 600 }, [100, 50, 2])).toEqual({ x: 150, y: 125 });
  });
});

describe('spawnPosition', () => {
  const empty: Board = { nodes: [], edges: [] };

  it('uses the target spot when it is free', () => {
    expect(spawnPosition(empty, { x: 400, y: 300 })).toEqual({ x: 400, y: 300 });
  });

  it('nudges a new node off one that is already there', () => {
    const board: Board = { nodes: [createNode('a', 'api', { x: 400, y: 300 })], edges: [] };
    expect(spawnPosition(board, { x: 400, y: 300 })).toEqual({ x: 400 + NUDGE, y: 300 + NUDGE });
  });

  it('gives three clicks three different spots', () => {
    let board: Board = empty;
    const spots = [];
    for (let i = 0; i < 3; i++) {
      const at = spawnPosition(board, { x: 400, y: 300 });
      spots.push(at);
      board = { ...board, nodes: [...board.nodes, createNode(`n${i}`, 'api', at)] };
    }
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(3);
  });
});
