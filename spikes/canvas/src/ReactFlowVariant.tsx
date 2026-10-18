import {
  addEdge,
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AvoidLib } from 'libavoid-js';
// The package doesn't export its .wasm, so import it by path.
import wasmUrl from '../node_modules/libavoid-js/dist/libavoid.wasm?url';
import { createContext, useContext, useEffect, useState } from 'react';
import {
  edges as boardEdges,
  group,
  NODE_SIZE,
  nodes as boardNodes,
  type Kind,
  type SpikeEdge,
} from './board.ts';
import { KindShape } from './KindShape.tsx';

type ArchData = { kind: Kind; label: string };
type Point = { x: number; y: number };
type Routing = 'smoothstep' | 'libavoid';

// ── Nodes: SVG shape + a handle on each side ─────────────────────────────────
const SIDES = [
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
  { id: 'l', position: Position.Left },
];

function ArchNode({ data }: NodeProps<Node<ArchData>>) {
  return (
    <div>
      <KindShape kind={data.kind} label={data.label} {...NODE_SIZE} />
      {SIDES.map((s) => (
        <Handle key={s.id} id={s.id} type="source" position={s.position} className="spike-handle" />
      ))}
    </div>
  );
}

function GroupNode({ data }: NodeProps<Node<{ label: string }>>) {
  return (
    <div className="spike-group">
      <div className="spike-group-title">{data.label}</div>
    </div>
  );
}

// ── Edges: routed by libavoid (orthogonal, around boxes) ─────────────────────
const RoutesContext = createContext<Map<string, Point[]>>(new Map());

function AvoidEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, label }: EdgeProps) {
  const route = useContext(RoutesContext).get(id) ?? [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
  ];
  const path = route.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  // Label on the middle of the longest segment.
  let best = -1;
  let mid = route[0];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="spike-edge-label"
            style={{ transform: `translate(-50%,-50%) translate(${mid.x}px,${mid.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { arch: ArchNode, group: GroupNode };
const edgeTypes = { avoid: AvoidEdge };

// ── Board → React Flow ───────────────────────────────────────────────────────
const absolute = new Map(boardNodes.map((n) => [n.id, { x: n.x, y: n.y }]));
/** Built-in edges need a side on each end; pick the facing sides. */
const sides = (e: SpikeEdge): [string, string] => {
  const a = absolute.get(e.source) ?? { x: 0, y: 0 };
  const b = absolute.get(e.target) ?? { x: 0, y: 0 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ['r', 'l'] : ['l', 'r'];
  return dy > 0 ? ['b', 't'] : ['t', 'b'];
};

const initialNodes: Node[] = [
  {
    id: group.id,
    type: 'group',
    position: { x: group.x, y: group.y },
    data: { label: group.label },
    style: { width: group.width, height: group.height },
    zIndex: -1,
    selectable: false,
  },
  ...boardNodes.map(
    (n): Node => ({
      id: n.id,
      type: 'arch',
      data: { kind: n.kind, label: n.label },
      position: n.parent ? { x: n.x - group.x, y: n.y - group.y } : { x: n.x, y: n.y },
      ...(n.parent ? { parentId: n.parent, extent: 'parent' as const } : {}),
      width: NODE_SIZE.width,
      height: NODE_SIZE.height,
    }),
  ),
];

const EDGE_STYLE = { stroke: '#334155', strokeWidth: 1.75 };
const ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#334155' };

const toEdges = (routing: Routing): Edge[] =>
  boardEdges.map((e) => {
    const [sourceHandle, targetHandle] = sides(e);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      sourceHandle,
      targetHandle,
      type: routing === 'libavoid' ? 'avoid' : 'smoothstep',
      markerEnd: ARROW,
      style: { ...EDGE_STYLE, strokeDasharray: e.mode === 'async' ? '6 4' : undefined },
      labelBgPadding: [4, 2] as [number, number],
      labelStyle: { fontSize: 11, fontWeight: 600 },
    };
  });

// ── libavoid: a fresh router per change (fine at this size; incremental moves exist too) ──
let avoidReady: Promise<void> | null = null;
const loadAvoid = () => (avoidReady ??= AvoidLib.load(wasmUrl));

/* eslint-disable @typescript-eslint/no-explicit-any -- the wasm bindings are untyped enough */
function computeRoutes(nodes: Node[], edges: Edge[]): { routes: Map<string, Point[]>; ms: number } {
  const t0 = performance.now();
  const Avoid: any = AvoidLib.getInstance();
  // The real constants live under embind enums (the typings are out of date).
  const router = new Avoid.Router(Avoid.RouterFlag.OrthogonalRouting.value);
  for (const [param, value] of [
    ['shapeBufferDistance', 14],
    ['idealNudgingDistance', 10],
  ] as const) {
    try {
      router.setRoutingParameter(Avoid.RoutingParameter[param], value);
    } catch {
      // enum shape differs between builds — defaults still route
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absPos = (n: Node): Point => {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    return { x: n.position.x + (parent?.position.x ?? 0), y: n.position.y + (parent?.position.y ?? 0) };
  };
  const shapes = new Map<string, any>();
  for (const n of nodes) {
    if (n.type !== 'arch') continue; // the VPC box is a zone, not an obstacle
    const p = absPos(n);
    const rect = new Avoid.Rectangle(
      new Avoid.Point(p.x, p.y),
      new Avoid.Point(p.x + NODE_SIZE.width, p.y + NODE_SIZE.height),
    );
    const shape = new Avoid.ShapeRef(router, rect);
    // Pins in the middle of each side (dirs: up 1, down 2, left 4, right 8); the router picks.
    for (const [x, y, dir] of [
      [0.5, 0, 1],
      [1, 0.5, 8],
      [0.5, 1, 2],
      [0, 0.5, 4],
    ] as const) {
      new Avoid.ShapeConnectionPin(shape, 1, x, y, true, 0, dir);
    }
    shapes.set(n.id, shape);
  }
  const conns = edges
    .filter((e) => shapes.has(e.source) && shapes.has(e.target))
    .map(
      (e) =>
        [
          e.id,
          new Avoid.ConnRef(
            router,
            new Avoid.ConnEnd(shapes.get(e.source), 1),
            new Avoid.ConnEnd(shapes.get(e.target), 1),
          ),
        ] as const,
    );
  router.processTransaction();
  const routes = new Map<string, Point[]>();
  for (const [id, conn] of conns) {
    const line = conn.displayRoute();
    const pts: Point[] = [];
    for (let i = 0; i < line.size(); i++) pts.push({ x: line.at(i).x, y: line.at(i).y });
    routes.set(id, pts);
  }
  Avoid.destroy?.(router);
  return { routes, ms: performance.now() - t0 };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function Board({ routing, onStats }: { routing: Routing; onStats: (s: string) => void }) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(toEdges(routing));
  const [routes, setRoutes] = useState(new Map<string, Point[]>());
  const [avoidLoaded, setAvoidLoaded] = useState(false);

  useEffect(() => setEdges(toEdges(routing)), [routing, setEdges]);
  useEffect(() => {
    if (routing === 'libavoid') void loadAvoid().then(() => setAvoidLoaded(true));
    else onStats('React Flow smoothstep: no obstacle avoidance');
  }, [routing, onStats]);
  useEffect(() => {
    if (routing !== 'libavoid' || !avoidLoaded) return;
    const { routes: r, ms } = computeRoutes(nodes, edges);
    setRoutes(r);
    onStats(`libavoid: ${r.size} edges routed in ${ms.toFixed(1)} ms (on every drag frame)`);
  }, [nodes, edges, routing, avoidLoaded, onStats]);

  const onConnect = (c: Connection) =>
    setEdges((es) =>
      addEdge(
        { ...c, type: routing === 'libavoid' ? 'avoid' : 'smoothstep', markerEnd: ARROW, style: EDGE_STYLE },
        es,
      ),
    );

  return (
    <RoutesContext value={routes}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
        fitView
        snapToGrid
        snapGrid={[10, 10]}
      >
        <Background gap={20} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </RoutesContext>
  );
}

export function ReactFlowVariant({ onStats }: { onStats: (s: string) => void }) {
  const [routing, setRouting] = useState<Routing>('libavoid');
  return (
    <>
      <div className="spike-sub">
        Edges:
        {(['smoothstep', 'libavoid'] as const).map((r) => (
          <button key={r} type="button" aria-pressed={routing === r} onClick={() => setRouting(r)}>
            {r === 'smoothstep' ? 'React Flow step (built in)' : 'libavoid (routes around boxes)'}
          </button>
        ))}
      </div>
      <div className="spike-canvas">
        <ReactFlowProvider>
          <Board routing={routing} onStats={onStats} />
        </ReactFlowProvider>
      </div>
    </>
  );
}
