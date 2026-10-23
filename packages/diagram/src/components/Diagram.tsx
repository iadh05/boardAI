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
  useReactFlow,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { canvasChanges, commitMoves, mergeEdges, mergeNodes } from '../flow/changes.ts';
import { createZoneDrag, type DragItem } from '../flow/zoneDrag.ts';
import { toReactFlow, type BoxNode, type FlowNode } from '../flow/toReactFlow.ts';
import type { DiagramEdge, DiagramNode, DiagramPosition, DiagramZone } from '../types.ts';
import { NODE_SIZE } from './nodeSize.ts';
import { ZoneContext } from './ZoneContext.ts';
import { ZoneView } from './ZoneView.tsx';
import { BoxNodeView } from './BoxNodeView.tsx';
import type { DiagramRouter } from '../router/types.ts';
import { DiagramContext } from './DiagramContext.ts';
import { EdgeEditContext } from './EdgeEditContext.ts';
import { RoutedEdge } from './RoutedEdge.tsx';
import { RoutesContext } from './RoutesContext.ts';
import { useEditContexts } from './useEditContexts.ts';
import { useFitToContent } from './useFitToContent.ts';
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
  /**
   * Delete/Backspace on the selection: the boxes, every edge to remove (incl. the boxes' edges),
   * and the zones (a zone's boxes stay).
   */
  onDelete?: (nodeIds: string[], edgeIds: string[], zoneIds: string[]) => void;
  /** Zones (VPC, region…): titled rectangles behind the boxes. */
  zones?: readonly DiagramZone[];
  /** The zone whose title is open for editing (controlled). */
  editingZoneId?: string | null;
  minZoneSize?: { width: number; height: number };
  /** Called once per drag, when it ends. The boxes inside moved along on screen: move them too. */
  onZoneMove?: (id: string, position: DiagramPosition) => void;
  onZoneResize?: (id: string, size: { width: number; height: number }) => void;
  /** Double-click or Enter on a zone: asks to edit its title. */
  onZoneEditStart?: (id: string) => void;
  onZoneLabelCommit?: (id: string, label: string) => void;
  onZoneEditEnd?: () => void;
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
  /** Panels drawn over the diagram (see DiagramPanel), markers pinned to it (DiagramMarker). */
  children?: ReactNode;
  /**
   * Where the pointer is on the diagram (diagram coordinates), as it moves; null when it leaves.
   * For showing it to others (live cursors).
   */
  onPointerMove?: (position: DiagramPosition | null) => void;
  /**
   * Fit the view to the diagram again whenever this value changes (after its boxes are drawn).
   * For content that arrives after the diagram opened: a shared board that finished loading.
   */
  fitKey?: unknown;
};

// Defined once, outside any component: a new object each render would remount every node.
const nodeTypes: NodeTypes = { box: BoxNodeView, zone: ZoneView };
const NO_ZONES: readonly DiagramZone[] = [];
const DEFAULT_MIN_ZONE = { width: 200, height: 100 };
const edgeTypes: EdgeTypes = { routed: RoutedEdge };
/**
 * Zooming out down to a quarter, not React Flow's half: a fit on a narrow canvas must be able to
 * show the whole board (found by hand, M2) — you zoom in from there.
 */
const MIN_ZOOM = 0.25;
const FIT_VIEW = { maxZoom: 1, minZoom: MIN_ZOOM };
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
  zones: zonesProp = NO_ZONES,
  editingZoneId = null,
  minZoneSize = DEFAULT_MIN_ZONE,
  onZoneMove,
  onZoneResize,
  onZoneEditStart,
  onZoneLabelCommit,
  onZoneEditEnd,
  onPointerMove,
  fitKey,
  router,
  snapGrid = 20,
  minimap = true,
  children,
}: DiagramProps) {
  // Decided once, at mount: did the diagram open with something to look at?
  const [fitOnOpen] = useState(() => nodesProp.length > 0 || zonesProp.length > 0);
  // useMemo: keeps the mapped arrays stable while the props are, so the merge below runs only
  // when the app actually changed something.
  const flow = useMemo(
    () => toReactFlow(nodesProp, edgesProp, zonesProp),
    [nodesProp, edgesProp, zonesProp],
  );

  // Canvas-local copy: React Flow updates it during drags, selection and measuring; the props
  // are merged in when they change ("adjust state when a prop changes" — React docs).
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
  const routes = useRoutes(boxes, edges, router);

  // While a zone is dragged, what was inside it when the drag started moves along, live.
  const [zoneDrag] = useState(createZoneDrag);
  const toDragItem = (n: FlowNode): DragItem => ({
    id: n.id,
    zone: n.type === 'zone',
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? n.width ?? NODE_SIZE.width,
    height: n.measured?.height ?? n.height ?? NODE_SIZE.height,
  });

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
    const isZone = (id: string) => zonesProp.some((z) => z.id === id);
    if (onNodeMove)
      commitMoves(
        moves.filter((c) => !isZone(c.id)),
        onNodeMove,
      );
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(canvasChanges(changes), current));
  };

  const isEditable = (id: string) => nodesProp.some((n) => n.id === id && !n.ghost);
  const isZoneId = (id: string) => zonesProp.some((z) => z.id === id);
  const isEditableEdge = (id: string) => edgesProp.some((e) => e.id === id && !e.ghost);
  // React Flow's wrapper around each node or edge is what gets focus; Enter bubbles up to here.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { target } = event;
    if (event.key !== 'Enter' || !(target instanceof Element)) return;
    const id = target.getAttribute('data-id');
    if (!id) return;
    if (target.classList.contains('react-flow__node-box') && isEditable(id)) onEditStart?.(id);
    if (target.classList.contains('react-flow__node-zone') && isZoneId(id)) onZoneEditStart?.(id);
    if (target.classList.contains('react-flow__edge') && isEditableEdge(id)) onEdgeEditStart?.(id);
  };

  const { context, edgeContext, zoneContext } = useEditContexts({
    editingNodeId,
    maxLabelLength,
    editingEdgeId,
    maxEdgeLabelLength,
    dashedLabel,
    editingZoneId,
    minZoneSize,
    onZoneLabelCommit,
    onZoneEditEnd,
    onZoneResize,
    onLabelCommit,
    onEditEnd,
    onEdgeLabelCommit,
    onEdgeDashedChange,
    onEdgeEditEnd,
  });

  const { screenToFlowPosition } = useReactFlow();
  const hasContent = nodesProp.length > 0 || zonesProp.length > 0;
  const fitAroundPanels = useFitToContent(fitKey, hasContent, fitOnOpen, FIT_VIEW);

  return (
    <DiagramContext value={context}>
      <ZoneContext value={zoneContext}>
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
                  gone.filter((n) => n.type !== 'zone').map((n) => n.id),
                  goneEdges.map((e) => e.id),
                  gone.filter((n) => n.type === 'zone').map((n) => n.id),
                )
              }
              onNodeDoubleClick={(_, node) => {
                if (node.type === 'zone') onZoneEditStart?.(node.id);
                else if (isEditable(node.id)) onEditStart?.(node.id);
              }}
              onEdgeDoubleClick={(_, edge) => {
                if (isEditableEdge(edge.id)) onEdgeEditStart?.(edge.id);
              }}
              onKeyDown={onKeyDown}
              deleteKeyCode={DELETE_KEYS}
              snapToGrid={snapGrid !== null}
              snapGrid={snapGrid === null ? undefined : [snapGrid, snapGrid]}
              // No fitView here: fitAroundPanels does it (on open with content, and on fitKey), so
              // boxes never land under the app's toolbar. An empty diagram isn't fitted: the app
              // places the first box where the user can see it.
              aria-label={ariaLabel}
              minZoom={MIN_ZOOM}
              onPointerMove={
                onPointerMove &&
                ((event) =>
                  onPointerMove(screenToFlowPosition({ x: event.clientX, y: event.clientY })))
              }
              onPointerLeave={onPointerMove && (() => onPointerMove(null))}
            >
              {/* Panels first: they come before the zoom controls when tabbing. */}
              {children}
              <Background variant={BackgroundVariant.Dots} gap={snapGrid ?? 20} />
              {/* Its fit button fits around the panels too, like the fit on open (found by hand). */}
              <Controls onFitView={fitAroundPanels} />
              {minimap && <MiniMap pannable zoomable />}
            </ReactFlow>
          </RoutesContext>
        </EdgeEditContext>
      </ZoneContext>
    </DiagramContext>
  );
}
