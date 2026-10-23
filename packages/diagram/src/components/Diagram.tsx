import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { useState, type ReactNode } from 'react';
import type { DiagramRouter } from '../router/types.ts';
import type { DiagramEdge, DiagramNode, DiagramPosition, DiagramZone } from '../types.ts';
import { BoxNodeView } from './BoxNodeView.tsx';
import { DiagramContext } from './DiagramContext.ts';
import { EdgeEditContext } from './EdgeEditContext.ts';
import { RoutedEdge } from './RoutedEdge.tsx';
import { RoutesContext } from './RoutesContext.ts';
import { useCanvasEvents } from './useCanvasEvents.ts';
import { useCanvasNodes } from './useCanvasNodes.ts';
import { useEditContexts } from './useEditContexts.ts';
import { useFitToContent } from './useFitToContent.ts';
import { useRoutes } from './useRoutes.ts';
import { ZoneContext } from './ZoneContext.ts';
import { ZoneView } from './ZoneView.tsx';
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

/** The editing contexts' inputs, with the defaults. */
const editOptions = (p: DiagramProps) => ({
  editingNodeId: p.editingNodeId ?? null,
  maxLabelLength: p.maxLabelLength ?? 100,
  editingEdgeId: p.editingEdgeId ?? null,
  maxEdgeLabelLength: p.maxEdgeLabelLength ?? 40,
  dashedLabel: p.dashedLabel ?? 'Dashed',
  editingZoneId: p.editingZoneId ?? null,
  minZoneSize: p.minZoneSize ?? DEFAULT_MIN_ZONE,
  onZoneLabelCommit: p.onZoneLabelCommit,
  onZoneEditEnd: p.onZoneEditEnd,
  onZoneResize: p.onZoneResize,
  onLabelCommit: p.onLabelCommit,
  onEditEnd: p.onEditEnd,
  onEdgeLabelCommit: p.onEdgeLabelCommit,
  onEdgeDashedChange: p.onEdgeDashedChange,
  onEdgeEditEnd: p.onEdgeEditEnd,
});

function DiagramCanvas(props: DiagramProps) {
  const { nodes: nodesProp, edges: edgesProp, zones = NO_ZONES, fitKey, router, children } = props;
  const { ariaLabel = 'Diagram', snapGrid = 20, minimap = true } = props;
  // Decided once, at mount: did the diagram open with something to look at?
  const [fitOnOpen] = useState(() => nodesProp.length > 0 || zones.length > 0);
  const canvas = useCanvasNodes({
    nodes: nodesProp,
    edges: edgesProp,
    zones,
    onNodeMove: props.onNodeMove,
    onZoneMove: props.onZoneMove,
  });
  const routes = useRoutes(canvas.boxes, canvas.edges, router);
  const { context, edgeContext, zoneContext } = useEditContexts(editOptions(props));
  const hasContent = nodesProp.length > 0 || zones.length > 0;
  const fitAroundPanels = useFitToContent(fitKey, hasContent, fitOnOpen, FIT_VIEW);
  const events = useCanvasEvents(props, zones);

  return (
    <DiagramContext value={context}>
      <ZoneContext value={zoneContext}>
        <EdgeEditContext value={edgeContext}>
          <RoutesContext value={routes}>
            <ReactFlow
              className="dr-diagram"
              nodes={canvas.nodes}
              edges={canvas.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={canvas.onNodesChange}
              onEdgesChange={canvas.onEdgesChange}
              // Any side can start or end an arrow (handles on 4 sides).
              connectionMode={ConnectionMode.Loose}
              {...events}
              deleteKeyCode={DELETE_KEYS}
              snapToGrid={snapGrid !== null}
              snapGrid={snapGrid === null ? undefined : [snapGrid, snapGrid]}
              // No fitView here: fitAroundPanels does it (on open with content, and on fitKey), so
              // boxes never land under the app's toolbar. An empty diagram isn't fitted: the app
              // places the first box where the user can see it.
              aria-label={ariaLabel}
              minZoom={MIN_ZOOM}
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
