import { createNode, type Board } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { NUDGE, spawnPosition } from './spawnPosition.ts';

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
