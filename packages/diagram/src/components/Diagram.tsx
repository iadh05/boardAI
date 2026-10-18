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
import { EdgeEditContext, type EdgeEditContextValue } from './EdgeEditContext.ts';
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
  /** The arrow whose label is open for editing (controlled). */
  editingEdgeId?: string | null;
  maxEdgeLabelLength?: number;
  /** Text of the toggle that makes an arrow dashed while editing it (e.g. "Async"). */
  dashedLabel?: string;
  /** Double-click or Enter on an arrow: asks to edit it. */
  onEdgeEditStart?: (id: string) => void;
  onEdgeLabelCommit?: (id: string, label: string) => void;
  onEdgeDashedChange?: (id: string, dashed: boolean) => void;
  onEdgeEditEnd?: () => void;
  /**
   * Routes arrows around boxes. Default: libavoid, loaded on first use (simple right-angle
   * arrows until then, or if it can't load). `null`: always simple arrows.
   */
  router?: DiagramRouter | null;
  /** Grid that boxes snap to while dragged, in px (boxes line up, so arrows run straight). `null`: free. */
  snapGrid?: number | null;
  /** Show the overview map (bottom right). */
  minimap?: boolean;
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
  editingEdgeId = null,
  maxEdgeLabelLength = 40,
  dashedLabel = 'Dashed',
  onEdgeEditStart,
  onEdgeLabelCommit,
  onEdgeDashedChange,
  onEdgeEditEnd,
  router,
  snapGrid = 20,
  minimap = true,
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
  const isEditableEdge = (id: string) => edgesProp.some((e) => e.id === id && !e.ghost);
  // React Flow's wrapper around each node or edge is what gets focus; Enter bubbles up to here.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { target } = event;
    if (event.key !== 'Enter' || !(target instanceof Element)) return;
    const id = target.getAttribute('data-id');
    if (!id) return;
    if (target.classList.contains('react-flow__node-box') && isEditable(id)) onEditStart?.(id);
    if (target.classList.contains('react-flow__edge') && isEditableEdge(id)) onEdgeEditStart?.(id);
  };

  // Every node reads this context, and a new value re-renders all of them — on every drag frame,
  // since this component re-renders then. So: a stable value that changes only with the editing
  // state, and the latest callbacks read through a ref (apps may pass inline functions).
  const callbacks = useRef({
    onLabelCommit,
    onEditEnd,
    onEdgeLabelCommit,
    onEdgeDashedChange,
    onEdgeEditEnd,
  });
  useLayoutEffect(() => {
    callbacks.current = {
      onLabelCommit,
      onEditEnd,
      onEdgeLabelCommit,
      onEdgeDashedChange,
      onEdgeEditEnd,
    };
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
  const edgeContext = useMemo<EdgeEditContextValue>(
    () => ({
      editingEdgeId,
      maxLabelLength: maxEdgeLabelLength,
      dashedLabel,
      commitLabel: (id, label) => callbacks.current.onEdgeLabelCommit?.(id, label),
      setDashed: (id, dashed) => callbacks.current.onEdgeDashedChange?.(id, dashed),
      endEditing: () => callbacks.current.onEdgeEditEnd?.(),
    }),
    [editingEdgeId, maxEdgeLabelLength, dashedLabel],
  );

  return (
    <DiagramContext value={context}>
      <EdgeEditContext value={edgeContext}>
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
            onEdgeDoubleClick={(_, edge) => {
              if (isEditableEdge(edge.id)) onEdgeEditStart?.(edge.id);
            }}
            onKeyDown={onKeyDown}
            deleteKeyCode={DELETE_KEYS}
            snapToGrid={snapGrid !== null}
            snapGrid={snapGrid === null ? undefined : [snapGrid, snapGrid]}
            // On an empty diagram the fit happens when the first node appears; without a cap it zooms to 2×.
            fitView
            fitViewOptions={FIT_VIEW}
            aria-label={ariaLabel}
          >
            {/* Panels first: they come before the zoom controls when tabbing. */}
            {children}
            <Background variant={BackgroundVariant.Dots} gap={snapGrid ?? 20} />
            <Controls />
            {minimap && <MiniMap pannable zoomable />}
          </ReactFlow>
        </RoutesContext>
      </EdgeEditContext>
    </DiagramContext>
  );
}
