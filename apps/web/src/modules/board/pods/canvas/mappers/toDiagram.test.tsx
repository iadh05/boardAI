import { NODE_SIZE as DIAGRAM_NODE_SIZE } from '@designroom/diagram';
import {
  createNode,
  NODE_SIZE as DOMAIN_NODE_SIZE,
  type Board,
  type Proposal,
} from '@designroom/domain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toDiagram } from './toDiagram.tsx';

const board: Board = {
  nodes: [
    { ...createNode('api', 'api', { x: 0, y: 0 }), label: 'Orders API' },
    createNode('db', 'database', { x: 240, y: 0 }),
  ],
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

describe('toDiagram', () => {
  it('draws each node with its label and the look of its kind', () => {
    const { nodes } = toDiagram(board, null);

    expect(nodes[1]).toMatchObject({
      id: 'db',
      label: 'Database',
      position: { x: 240, y: 0 },
      shape: 'cylinder',
      color: 'var(--color-kind-data)',
      ghost: false,
    });
  });

  it('gives each node an icon that says its kind, even when the label says something else', () => {
    render(<>{toDiagram(board, null).nodes[0]?.icon}</>);
    expect(screen.getByRole('img', { name: 'API' })).toBeInTheDocument();
  });

  it('draws board edges as plain arrows', () => {
    expect(toDiagram(board, null).edges).toEqual([
      { id: 'e1', source: 'api', target: 'db', ghost: false },
    ]);
  });

  it('shows the label of an arrow, and async arrows dashed', () => {
    const named: Board = {
      ...board,
      edges: [{ id: 'e1', source: 'api', target: 'db', label: 'events', mode: 'async' }],
    };
    expect(toDiagram(named, null).edges[0]).toMatchObject({ label: 'events', dashed: true });
  });

  it('passes zones through', () => {
    const zone = {
      id: 'vpc',
      label: 'VPC',
      position: { x: 0, y: 0 },
      size: { width: 600, height: 300 },
    };
    expect(toDiagram({ ...board, zones: [zone] }, null).zones).toEqual([zone]);
    expect(toDiagram(board, null).zones).toEqual([]);
  });

  it('shows a proposal as ghosts, exactly where accepting would put them', () => {
    const { nodes, edges } = toDiagram(board, proposal);
    const ghost = nodes.find((n) => n.id === 'cache');

    expect(ghost).toMatchObject({ label: 'Redis', shape: 'rounded', ghost: true });
    expect(ghost?.position.x).toBeGreaterThan(0); // beside the API, not on top of it
    expect(edges.find((e) => e.id === 'e-cache')).toMatchObject({ ghost: true });
  });

  it('keeps the real board unmarked', () => {
    const { nodes, edges } = toDiagram(board, proposal);
    expect(nodes.filter((n) => !n.ghost).map((n) => n.id)).toEqual(['api', 'db']);
    expect(edges.find((e) => e.id === 'e1')?.ghost).toBe(false);
  });

  it('shows no ghosts for a proposal that no longer fits the board', () => {
    const stale: Proposal = {
      ...proposal,
      ops: [{ op: 'updateNode', nodeId: 'gone', label: 'X' }],
    };
    const { nodes, edges } = toDiagram(board, stale);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });
});

it('the board and the diagram agree on the size of a box (zone membership depends on it)', () => {
  expect({ ...DOMAIN_NODE_SIZE }).toEqual({ ...DIAGRAM_NODE_SIZE });
});
