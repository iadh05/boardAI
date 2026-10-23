import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { useMemo, useState } from 'react';
import { canvasChanges, commitMoves, mergeEdges, mergeNodes } from '../flow/changes.ts';
import { createZoneDrag, type DragItem } from '../flow/zoneDrag.ts';
import { toReactFlow, type BoxNode, type FlowNode } from '../flow/toReactFlow.ts';
import type { DiagramEdge, DiagramNode, DiagramPosition, DiagramZone } from '../types.ts';
import { NODE_SIZE } from './nodeSize.ts';

type Options = {
  nodes: readonly DiagramNode[];
  edges: readonly DiagramEdge[];
  zones: readonly DiagramZone[];
  onNodeMove: ((id: string, position: DiagramPosition) => void) | undefined;
  onZoneMove: ((id: string, position: DiagramPosition) => void) | undefined;
};

const toDragItem = (n: FlowNode): DragItem => ({
  id: n.id,
  zone: n.type === 'zone',
  x: n.position.x,
  y: n.position.y,
  width: n.measured?.width ?? n.width ?? NODE_SIZE.width,
  height: n.measured?.height ?? n.height ?? NODE_SIZE.height,
});

/**
 * The canvas's own copy of the boxes, zones and arrows. React Flow updates it during drags,
 * selection and measuring; the props are merged in when they change ("adjust state when a prop
 * changes" — React docs). Moves are reported to the app; a dragged zone carries what's inside it.
 */
export function useCanvasNodes({
  nodes: nodesProp,
  edges: edgesProp,
  zones,
  onNodeMove,
  onZoneMove,
}: Options) {
  // useMemo: keeps the mapped arrays stable while the props are, so the merge below runs only
  // when the app actually changed something.
  const flow = useMemo(
    () => toReactFlow(nodesProp, edgesProp, zones),
    [nodesProp, edgesProp, zones],
  );
  const [nodes, setNodes] = useState<FlowNode[]>(flow.nodes);
  const [edges, setEdges] = useState<Edge[]>(flow.edges);
  const [mergedFrom, setMergedFrom] = useState(flow);
  if (mergedFrom !== flow) {
    setMergedFrom(flow);
    setNodes((current) => mergeNodes(flow.nodes, current));
    setEdges((current) => mergeEdges(flow.edges, current));
  }

  // From the live positions, so arrows follow a node while it's dragged.
  // Zones are not obstacles: arrows may cross them.
  const boxes = useMemo(() => nodes.filter((n): n is BoxNode => n.type === 'box'), [nodes]);

  // While a zone is dragged, what was inside it when the drag started moves along, live.
  const [zoneDrag] = useState(createZoneDrag);
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const moves = changes.flatMap((c) => (c.type === 'position' ? [c] : []));
    const { carried, ended } = zoneDrag.step(moves, nodes.map(toDragItem));
    const carriedChanges = carried.map((c): NodeChange<FlowNode> => ({
      type: 'position',
      id: c.id,
      position: c.position,
    }));
    setNodes((current) =>
      applyNodeChanges([...canvasChanges(changes), ...carriedChanges], current),
    );
    for (const zone of ended) onZoneMove?.(zone.id, zone.position);
    const isZone = (id: string) => zones.some((z) => z.id === id);
    if (onNodeMove)
      commitMoves(
        moves.filter((c) => !isZone(c.id)),
        onNodeMove,
      );
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(canvasChanges(changes), current));
  };

  return { nodes, edges, boxes, onNodesChange, onEdgesChange };
}
