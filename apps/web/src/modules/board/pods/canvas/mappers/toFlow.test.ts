import { createNode, type Board, type Proposal } from '@designroom/domain';
import { MarkerType } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { toFlow } from './toFlow.ts';

const board: Board = {
  nodes: [createNode('api', 'api', { x: 0, y: 0 }), createNode('db', 'database', { x: 240, y: 0 })],
  edges: [{ id: 'e1', source: 'api', target: 'db' }],
};

const proposal: Proposal = {
  id: 'p1',
  summary: 'Add a cache',
  ops: [
    { op: 'addNode', nodeId: 'cache', kind: 'cache', label: 'Redis', near: 'api' },
    { op: 'connect', edgeId: 'e-cache', source: 'api', target: 'cache' },
  ],
};

describe('toFlow', () => {
  it('maps board nodes to "system" React Flow nodes carrying kind and label', () => {
    const { nodes } = toFlow(board, null);

    expect(nodes).toEqual([
      {
        id: 'api',
        type: 'system',
        position: { x: 0, y: 0 },
        data: { kind: 'api', label: 'API' },
        ariaLabel: 'API',
      },
      {
        id: 'db',
        type: 'system',
        position: { x: 240, y: 0 },
        data: { kind: 'database', label: 'Database' },
        ariaLabel: 'Database',
      },
    ]);
  });

  it('names nodes after their label for screen readers; ghosts say they are proposed', () => {
    const { nodes } = toFlow(board, proposal);
    expect(nodes.map((n) => n.ariaLabel)).toEqual(['API', 'Database', 'Proposed: Redis']);
  });

  it('gives board edges an arrow head pointing at the target', () => {
    const { edges } = toFlow(board, null);

    expect(edges).toEqual([
      {
        id: 'e1',
        source: 'api',
        target: 'db',
        markerEnd: { type: MarkerType.ArrowClosed },
        // Not interactive until M1-12 wires edge selection and deletion through the store.
        selectable: false,
        focusable: false,
      },
    ]);
  });

  it('shows proposed nodes as "ghost" nodes where accepting would put them', () => {
    const { nodes } = toFlow(board, proposal);
    const ghost = nodes.find((n) => n.id === 'cache');

    expect(ghost).toMatchObject({ type: 'ghost', data: { kind: 'cache', label: 'Redis' } });
    expect(ghost?.position.x).toBeGreaterThan(0); // beside the API, not on top of it
    // Ghosts can't be dragged, selected or connected: they're a preview.
    expect(ghost).toMatchObject({ draggable: false, selectable: false, connectable: false });
  });

  it('shows proposed edges dashed and marks them as proposed', () => {
    const { edges } = toFlow(board, proposal);
    const proposed = edges.find((e) => e.id === 'e-cache');

    expect(proposed).toMatchObject({
      source: 'api',
      target: 'cache',
      className: 'is-proposed',
      // The arrow head is recoloured with the dashed line.
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-accent)' },
    });
  });

  it('keeps the real board untouched and unmarked', () => {
    const { nodes, edges } = toFlow(board, proposal);

    expect(nodes.filter((n) => n.type === 'system').map((n) => n.id)).toEqual(['api', 'db']);
    expect(edges.find((e) => e.id === 'e1')?.className).toBeUndefined();
  });

  it('shows no ghosts for a proposal that no longer fits the board', () => {
    const stale: Proposal = {
      ...proposal,
      ops: [{ op: 'updateNode', nodeId: 'gone', label: 'X' }],
    };

    const { nodes, edges } = toFlow(board, stale);

    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });
});
