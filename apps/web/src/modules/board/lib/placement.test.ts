import { createNode, NODE_SIZE, type AgentOp, type Board, type Position } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { placeProposal } from './placement.ts';

const api = createNode('api', 'api', { x: 0, y: 0 });
const board: Board = { nodes: [api], edges: [] };
const view = { x: -400, y: -300, width: 1600, height: 900 };
const add = (nodeId: string, near?: string): AgentOp => ({
  op: 'addNode',
  nodeId,
  kind: 'cache',
  label: 'Cache',
  ...(near ? { near } : {}),
});

const overlaps = (a: Position, b: Position) =>
  Math.abs(a.x - b.x) < NODE_SIZE.width && Math.abs(a.y - b.y) < NODE_SIZE.height;

describe('placeProposal', () => {
  it('puts a proposed node with `near` to the right of that node', () => {
    const at = placeProposal(board, [add('cache', 'api')], { center: { x: 600, y: 300 }, view });
    expect(at.cache?.x).toBeGreaterThan(api.position.x + NODE_SIZE.width);
    expect(at.cache?.y).toBe(api.position.y);
  });

  it('without `near`, puts it at the fallback point (the middle of the view)', () => {
    const at = placeProposal(board, [add('cache')], { center: { x: 700, y: 300 }, view });
    const middle = { x: 700 - NODE_SIZE.width / 2, y: 300 - NODE_SIZE.height / 2 };
    expect(Math.abs((at.cache?.x ?? 0) - middle.x)).toBeLessThanOrEqual(20);
    expect(Math.abs((at.cache?.y ?? 0) - middle.y)).toBeLessThanOrEqual(20);
  });

  it('never puts two proposed nodes on top of each other, or on an existing box', () => {
    const at = placeProposal(board, [add('a', 'api'), add('b', 'api'), add('c')], {
      center: { x: 0, y: 0 },
      view,
    });
    const spots = [at.a, at.b, at.c].filter((p): p is Position => p !== undefined);
    expect(spots).toHaveLength(3);
    for (const [i, p] of spots.entries()) {
      expect(overlaps(p, api.position)).toBe(false);
      for (const q of spots.slice(i + 1)) expect(overlaps(p, q)).toBe(false);
    }
  });

  it('can place next to a node added earlier in the same proposal', () => {
    const at = placeProposal(board, [add('queue'), add('worker', 'queue')], {
      center: { x: 600, y: 300 },
      view,
    });
    expect(at.worker?.x).toBeGreaterThan((at.queue?.x ?? 0) + NODE_SIZE.width);
  });

  it('keeps ghosts out from under the toolbar', () => {
    const toolbar = { x: 200, y: -300, width: 400, height: 400 }; // right of the API box
    const at = placeProposal(board, [add('cache', 'api')], {
      center: { x: 600, y: 300 },
      view,
      covered: [toolbar],
    });
    const p = at.cache ?? { x: 0, y: 0 };
    const hidden =
      p.x < toolbar.x + toolbar.width &&
      p.x + NODE_SIZE.width > toolbar.x &&
      p.y < toolbar.y + toolbar.height &&
      p.y + NODE_SIZE.height > toolbar.y;
    expect(hidden).toBe(false);
  });

  it('ignores operations that add nothing', () => {
    const ops: AgentOp[] = [{ op: 'updateNode', nodeId: 'api', label: 'Orders API' }];
    expect(placeProposal(board, ops, { center: { x: 0, y: 0 }, view })).toEqual({});
  });
});
