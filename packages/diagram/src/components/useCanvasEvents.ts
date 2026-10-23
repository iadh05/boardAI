import { useReactFlow, type Edge, type ReactFlowProps } from '@xyflow/react';
import type { KeyboardEvent } from 'react';
import type { FlowNode } from '../flow/toReactFlow.ts';
import type { DiagramZone } from '../types.ts';
import type { DiagramProps } from './Diagram.tsx';

type CanvasEvents = Pick<
  ReactFlowProps<FlowNode, Edge>,
  | 'isValidConnection'
  | 'onConnect'
  | 'onDelete'
  | 'onNodeDoubleClick'
  | 'onEdgeDoubleClick'
  | 'onKeyDown'
  | 'onPointerMove'
  | 'onPointerLeave'
>;

/**
 * What the user does on the canvas, turned into the app's callbacks: connect, delete, open a label
 * (double-click, or Enter on a focused box, zone or arrow), and where the pointer is. Ghost boxes and
 * arrows (a proposal) can't be edited.
 */
export function useCanvasEvents(props: DiagramProps, zones: readonly DiagramZone[]): CanvasEvents {
  const { canConnect, onConnect, onDelete, onEditStart, onZoneEditStart, onEdgeEditStart } = props;
  const { onPointerMove } = props;
  const { screenToFlowPosition } = useReactFlow();
  const isEditable = (id: string) => props.nodes.some((n) => n.id === id && !n.ghost);
  const isZoneId = (id: string) => zones.some((z) => z.id === id);
  const isEditableEdge = (id: string) => props.edges.some((e) => e.id === id && !e.ghost);

  return {
    isValidConnection: ({ source, target }) => canConnect?.(source, target) ?? true,
    onConnect: ({ source, target }) => onConnect?.(source, target),
    onDelete: ({ nodes: gone, edges: goneEdges }) =>
      onDelete?.(
        gone.filter((n) => n.type !== 'zone').map((n) => n.id),
        goneEdges.map((e) => e.id),
        gone.filter((n) => n.type === 'zone').map((n) => n.id),
      ),
    onNodeDoubleClick: (_, node) => {
      if (node.type === 'zone') onZoneEditStart?.(node.id);
      else if (isEditable(node.id)) onEditStart?.(node.id);
    },
    onEdgeDoubleClick: (_, edge) => {
      if (isEditableEdge(edge.id)) onEdgeEditStart?.(edge.id);
    },
    // React Flow's wrapper around each node or edge is what gets focus; Enter bubbles up to here.
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const { target } = event;
      if (event.key !== 'Enter' || !(target instanceof Element)) return;
      const id = target.getAttribute('data-id');
      if (!id) return;
      const is = (cls: string) => target.classList.contains(cls);
      if (is('react-flow__node-box') && isEditable(id)) onEditStart?.(id);
      if (is('react-flow__node-zone') && isZoneId(id)) onZoneEditStart?.(id);
      if (is('react-flow__edge') && isEditableEdge(id)) onEdgeEditStart?.(id);
    },
    onPointerMove:
      onPointerMove &&
      ((event) => onPointerMove(screenToFlowPosition({ x: event.clientX, y: event.clientY }))),
    onPointerLeave: onPointerMove && (() => onPointerMove(null)),
  };
}
