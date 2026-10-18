import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { ZoneNode } from '../components/ZoneView.tsx';
import type {
  DiagramEdge,
  DiagramNode,
  DiagramPosition,
  DiagramShape,
  DiagramZone,
} from '../types.ts';

// The only place that knows both our public model and React Flow's. If the engine changes
// (ADR-004), this mapper and the components change; the public API doesn't.

export type BoxData = {
  label: string;
  shape: DiagramShape;
  color?: string;
  icon?: DiagramNode['icon'];
  ghost: boolean;
};
export type BoxNode = Node<BoxData, 'box'>;
export type FlowNode = BoxNode | ZoneNode;

/** Zones sit under boxes even when selected (React Flow lifts selected nodes by 1000). */
const ZONE_Z = -1000;

export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type Side = (typeof SIDES)[number];

/** The sides of two boxes that face each other: where an arrow leaves and where it arrives. */
export const facingSides = (from: DiagramPosition, to: DiagramPosition): [Side, Side] => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
};

const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: 'var(--dr-diagram-edge)',
} as const;
const GHOST_ARROW = { ...ARROW, color: 'var(--dr-diagram-accent)' };
const DASH = '6 4';

export const toReactFlow = (
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
  zones: readonly DiagramZone[] = [],
): { nodes: FlowNode[]; edges: Edge[] } => {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const flowNodes = nodes.map((n): BoxNode => {
    const ghost = n.ghost === true;
    return {
      id: n.id,
      type: 'box',
      position: n.position,
      data: { label: n.label, shape: n.shape ?? 'rectangle', color: n.color, icon: n.icon, ghost },
      // The accessible name of React Flow's node wrapper (role "group").
      ariaLabel: ghost ? `Proposed: ${n.label}` : n.label,
      ...(ghost
        ? { draggable: false, selectable: false, connectable: false, deletable: false }
        : {}),
    };
  });

  const flowEdges = edges.map((e): Edge => {
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    const [sourceHandle, targetHandle] =
      source && target ? facingSides(source.position, target.position) : ['right', 'left'];
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      // Drawn by RoutedEdge: along its route around boxes, or a simple path until there is one.
      type: 'routed',
      label: e.label,
      markerEnd: e.ghost ? GHOST_ARROW : ARROW,
      ariaLabel: `From ${source?.label ?? e.source} to ${target?.label ?? e.target}`,
      data: { dashed: e.dashed === true, ghost: e.ghost === true },
      ...(e.dashed ? { style: { strokeDasharray: DASH } } : {}),
      ...(e.ghost
        ? { className: 'dr-edge-ghost', selectable: false, focusable: false, deletable: false }
        : {}),
    };
  });

  const zoneNodes = zones.map((z): ZoneNode => ({
    id: z.id,
    type: 'zone',
    position: z.position,
    data: { label: z.label },
    width: z.size.width,
    height: z.size.height,
    zIndex: ZONE_Z,
    ariaLabel: `Zone: ${z.label}`,
  }));

  // Zones first: drawn behind the boxes.
  return { nodes: [...zoneNodes, ...flowNodes], edges: flowEdges };
};
