import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { canvasChanges, commitMoves, mergeEdges, mergeNodes } from '../flow/changes.ts';
import { toReactFlow, type BoxNode } from '../flow/toReactFlow.ts';
import type { DiagramEdge, DiagramNode, DiagramPosition } from '../types.ts';
import { BoxNodeView } from './BoxNodeView.tsx';
import type { DiagramRouter } from '../router/types.ts';
import { DiagramContext, type DiagramContextValue } from './DiagramContext.ts';
import { RoutedEdge } from './RoutedEdge.tsx';
import { RoutesContext } from './RoutesContext.ts';
import { useRoutes } from './useRoutes.ts';
import '../styles.css';

export type DiagramProps = {
  nodes: readonly DiagramNode[];
  edges: readonly DiagramEdge[];
  /** Accessible name of the whole diagram. */
  ariaLabel?: string;
  /** The node whose label is open for editing (controlled). */
  editingNodeId?: string | null;
  maxLabelLength?: number;
  /** Live check while dragging a new arrow; the drop target only lights up when it's allowed. */
  canConnect?: (source: string, target: string) => boolean;
  onConnect?: (source: string, target: string) => void;
  /** Called once per drag, when it ends. */
  onNodeMove?: (id: string, position: DiagramPosition) => void;
  /** Delete/Backspace on the selection: the nodes, and every edge to remove (incl. their edges). */
  onDelete?: (nodeIds: string[], edgeIds: string[]) => void;
  /** Double-click or Enter on a node: asks to edit its label. */
  onEditStart?: (id: string) => void;
  onLabelCommit?: (id: string, label: string) => void;
  /** Editing finished (saved or cancelled). */
  onEditEnd?: () => void;
  /**
   * Routes arrows around boxes. Default: libavoid, loaded on first use (simple right-angle
   * arrows until then, or if it can't load). `null`: always simple arrows.
   */
  router?: DiagramRouter | null;
  /** Panels drawn over the diagram (see DiagramPanel). */
  children?: ReactNode;
};

// Defined once, outside any component: a new object each render would remount every node.
const nodeTypes: NodeTypes = { box: BoxNodeView };
const edgeTypes: EdgeTypes = { routed: RoutedEdge };
const FIT_VIEW = { maxZoom: 1 };
const DELETE_KEYS = ['Backspace', 'Delete'];

/** An architecture diagram: boxes, arrows routed between their sides, labels. Controlled. */
export function Diagram(props: DiagramProps) {
  return (
    <ReactFlowProvider>
      <DiagramCanvas {...props} />
    </ReactFlowProvider>
  );
}

function DiagramCanvas({
  nodes: nodesProp,
  edges: edgesProp,
  ariaLabel = 'Diagram',
  editingNodeId = null,
  maxLabelLength = 100,
  canConnect,
  onConnect,
  onNodeMove,
  onDelete,
  onEditStart,
  onLabelCommit,
  onEditEnd,
  router,
  children,
}: DiagramProps) {
  // useMemo: keeps the mapped arrays stable while the props are, so the merge below runs only
  // when the app actually changed something.
  const flow = useMemo(() => toReactFlow(nodesProp, edgesProp), [nodesProp, edgesProp]);

  // Canvas-local copy: React Flow updates it during drags, selection and measuring; the props
  // are merged in when they change ("adjust state when a prop changes" — React docs).
  const [nodes, setNodes] = useState<BoxNode[]>(flow.nodes);
  const [edges, setEdges] = useState<Edge[]>(flow.edges);
  const [mergedFrom, setMergedFrom] = useState(flow);
  if (mergedFrom !== flow) {
    setMergedFrom(flow);
    setNodes((current) => mergeNodes(flow.nodes, current));
    setEdges((current) => mergeEdges(flow.edges, current));
  }

  // From the live positions, so arrows follow a node while it's dragged.
  const routes = useRoutes(nodes, edges, router);

  const onNodesChange = (changes: NodeChange<BoxNode>[]) => {
    setNodes((current) => applyNodeChanges(canvasChanges(changes), current));
    if (onNodeMove) commitMoves(changes, onNodeMove);
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(canvasChanges(changes), current));
  };

  const isEditable = (id: string) => nodesProp.some((n) => n.id === id && !n.ghost);
  // React Flow's wrapper around each node is what gets focus; Enter bubbles up to here.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { target } = event;
    if (event.key !== 'Enter' || !(target instanceof HTMLElement)) return;
    if (!target.classList.contains('react-flow__node-box')) return;
    const id = target.dataset.id;
    if (id && isEditable(id)) onEditStart?.(id);
  };

  // Every node reads this context, and a new value re-renders all of them — on every drag frame,
  // since this component re-renders then. So: a stable value that changes only with the editing
  // state, and the latest callbacks read through a ref (apps may pass inline functions).
  const callbacks = useRef({ onLabelCommit, onEditEnd });
  useLayoutEffect(() => {
    callbacks.current = { onLabelCommit, onEditEnd };
  });
  const context = useMemo<DiagramContextValue>(
    () => ({
      editingNodeId,
      maxLabelLength,
      commitLabel: (id, label) => callbacks.current.onLabelCommit?.(id, label),
      endEditing: () => callbacks.current.onEditEnd?.(),
    }),
    [editingNodeId, maxLabelLength],
  );

  return (
    <DiagramContext value={context}>
      <RoutesContext value={routes}>
        <ReactFlow
          className="dr-diagram"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          // Any side can start or end an arrow (handles on 4 sides).
          connectionMode={ConnectionMode.Loose}
          isValidConnection={({ source, target }) => canConnect?.(source, target) ?? true}
          onConnect={({ source, target }) => onConnect?.(source, target)}
          onDelete={({ nodes: gone, edges: goneEdges }) =>
            onDelete?.(
              gone.map((n) => n.id),
              goneEdges.map((e) => e.id),
            )
          }
          onNodeDoubleClick={(_, node) => {
            if (isEditable(node.id)) onEditStart?.(node.id);
          }}
          onKeyDown={onKeyDown}
          deleteKeyCode={DELETE_KEYS}
          // On an empty diagram the fit happens when the first node appears; without a cap it zooms to 2×.
          fitView
          fitViewOptions={FIT_VIEW}
          aria-label={ariaLabel}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} />
          <Controls />
          <MiniMap pannable zoomable />
          {children}
        </ReactFlow>
      </RoutesContext>
    </DiagramContext>
  );
}
