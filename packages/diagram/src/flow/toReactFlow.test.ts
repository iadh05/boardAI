import { describe, expect, it } from 'vitest';
import type { DiagramEdge, DiagramNode } from '../types.ts';
import { facingSides, toReactFlow } from './toReactFlow.ts';

const api: DiagramNode = { id: 'api', label: 'Orders API', position: { x: 0, y: 0 } };
const db: DiagramNode = {
  id: 'db',
  label: 'Postgres',
  position: { x: 300, y: 0 },
  shape: 'cylinder',
};
const link: DiagramEdge = { id: 'e1', source: 'api', target: 'db', label: 'SQL' };

describe('toReactFlow — nodes', () => {
  it('turns each node into a "box" node named after its label', () => {
    const { nodes } = toReactFlow([api, db], []);

    expect(nodes[1]).toMatchObject({
      id: 'db',
      type: 'box',
      position: { x: 300, y: 0 },
      ariaLabel: 'Postgres',
      data: { label: 'Postgres', shape: 'cylinder' },
    });
  });

  it('draws a plain rectangle when no shape is given', () => {
    expect(toReactFlow([api], []).nodes[0]?.data).toMatchObject({ shape: 'rectangle' });
  });

  it('makes ghosts read-only and says they are proposed', () => {
    const ghost = toReactFlow([{ ...api, ghost: true }], []).nodes[0];

    expect(ghost).toMatchObject({
      ariaLabel: 'Proposed: Orders API',
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      data: { ghost: true },
    });
  });
});

describe('toReactFlow — edges', () => {
  it('keeps the label, points an arrow at the target and names the edge', () => {
    const edge = toReactFlow([api, db], [link]).edges[0];

    expect(edge).toMatchObject({
      id: 'e1',
      source: 'api',
      target: 'db',
      label: 'SQL',
      ariaLabel: 'From Orders API to Postgres',
      markerEnd: { type: 'arrowclosed' },
    });
  });

  it('leaves and enters on the sides that face each other', () => {
    expect(toReactFlow([api, db], [link]).edges[0]).toMatchObject({
      sourceHandle: 'right',
      targetHandle: 'left',
    });
  });

  it('draws dashed edges with a dash pattern', () => {
    const edge = toReactFlow([api, db], [{ ...link, dashed: true }]).edges[0];
    expect(edge?.style?.strokeDasharray).toBeDefined();
  });

  it('makes ghost edges read-only and marks them for styling', () => {
    const edge = toReactFlow([api, db], [{ ...link, ghost: true }]).edges[0];

    expect(edge).toMatchObject({
      className: 'dr-edge-ghost',
      selectable: false,
      focusable: false,
      deletable: false,
    });
  });
});

describe('facingSides', () => {
  const at = (x: number, y: number) => ({ x, y });

  it.each([
    ['right of', at(300, 0), ['right', 'left']],
    ['left of', at(-300, 0), ['left', 'right']],
    ['below', at(0, 300), ['bottom', 'top']],
    ['above', at(0, -300), ['top', 'bottom']],
  ] as const)('target %s the source', (_, target, sides) => {
    expect(facingSides(at(0, 0), target)).toEqual(sides);
  });
});

describe('toReactFlow — zones', () => {
  const vpc = {
    id: 'vpc',
    label: 'VPC',
    position: { x: 0, y: 0 },
    size: { width: 600, height: 300 },
  };

  it('turns zones into "zone" nodes of their size, named for screen readers, listed first', () => {
    const { nodes } = toReactFlow([api], [], [vpc]);
    expect(nodes.map((n) => n.id)).toEqual(['vpc', 'api']);
    expect(nodes[0]).toMatchObject({
      type: 'zone',
      width: 600,
      height: 300,
      ariaLabel: 'Zone: VPC',
      data: { label: 'VPC' },
    });
  });

  it('keeps zones under boxes even when selected', () => {
    expect(toReactFlow([], [], [vpc]).nodes[0]?.zIndex).toBeLessThanOrEqual(-1000);
  });
});
