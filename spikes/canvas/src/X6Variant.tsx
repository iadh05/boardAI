import { Graph, MiniMap, Snapline, type Node } from '@antv/x6';
import { register } from '@antv/x6-react-shape';
import { useEffect, useRef } from 'react';
import { edges, group, NODE_SIZE, nodes, type Kind } from './board.ts';
import { KindShape } from './KindShape.tsx';

// X6 renders our React component inside its own SVG node (foreignObject).
function ArchNode({ node }: { node: Node }) {
  const { kind, label } = node.getData<{ kind: Kind; label: string }>();
  return <KindShape kind={kind} label={label} {...NODE_SIZE} />;
}

register({ shape: 'arch', component: ArchNode, ...NODE_SIZE });

const PORT = {
  r: 5,
  magnet: true,
  stroke: '#4f46e5',
  strokeWidth: 1.5,
  fill: '#fff',
  style: { visibility: 'hidden' },
};
const PORTS = {
  groups: Object.fromEntries(
    ['top', 'right', 'bottom', 'left'].map((side) => [side, { position: side, attrs: { circle: PORT } }]),
  ),
  items: ['top', 'right', 'bottom', 'left'].map((side) => ({ group: side })),
};

const LINE = { stroke: '#334155', strokeWidth: 1.75, targetMarker: { name: 'block', width: 9, height: 7 } };

export function X6Variant({ onStats }: { onStats: (s: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const minimap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current || !minimap.current) return;
    const t0 = performance.now();
    const graph = new Graph({
      container: container.current,
      autoResize: true,
      grid: { visible: true, size: 10 },
      panning: true,
      mousewheel: { enabled: true, modifiers: null },
      background: { color: '#f8fafc' },
      connecting: {
        // Orthogonal routing around boxes, built in. The VPC zone is not an obstacle.
        router: { name: 'manhattan', args: { padding: 14, excludeNodes: [group.id] } },
        connector: { name: 'rounded', args: { radius: 6 } },
        anchor: 'center',
        connectionPoint: 'boundary',
        allowBlank: false,
        allowLoop: false,
        allowMulti: false,
        snap: { radius: 24 },
        createEdge() {
          return this.createEdge({ attrs: { line: LINE } });
        },
      },
      embedding: { enabled: true },
    });
    graph.use(new Snapline({ enabled: true }));
    graph.use(new MiniMap({ container: minimap.current, width: 180, height: 110 }));

    const vpc = graph.addNode({
      id: group.id,
      shape: 'rect',
      x: group.x,
      y: group.y,
      width: group.width,
      height: group.height,
      zIndex: 0,
      attrs: {
        body: { fill: 'rgba(241,245,249,.6)', stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '8 5', rx: 12 },
        label: {
          text: group.label,
          refX: 12,
          refY: 10,
          textAnchor: 'start',
          textVerticalAnchor: 'top',
          fontSize: 12,
          fontWeight: 600,
          fill: '#475569',
        },
      },
    });
    for (const n of nodes) {
      const node = graph.addNode({
        id: n.id,
        shape: 'arch',
        x: n.x,
        y: n.y,
        zIndex: 2,
        data: { kind: n.kind, label: n.label },
        ports: PORTS,
      });
      if (n.parent) vpc.addChild(node);
    }
    for (const e of edges) {
      graph.addEdge({
        id: e.id,
        source: { cell: e.source },
        target: { cell: e.target },
        zIndex: 1,
        attrs: { line: { ...LINE, strokeDasharray: e.mode === 'async' ? '6 4' : undefined } },
        labels: e.label
          ? [{ attrs: { label: { text: e.label, fontSize: 11, fontWeight: 600 }, body: { fill: '#fff' } } }]
          : [],
      });
    }
    graph.zoomToFit({ padding: 30, maxScale: 1 });

    // Show the ports only when hovering a node.
    const setPorts = (node: Node, visible: boolean) =>
      node.getPorts().forEach((p) => node.setPortProp(p.id ?? '', 'attrs/circle/style/visibility', visible ? 'visible' : 'hidden'));
    graph.on('node:mouseenter', ({ node }) => setPorts(node, true));
    graph.on('node:mouseleave', ({ node }) => setPorts(node, false));

    onStats(`X6: board built and routed in ${(performance.now() - t0).toFixed(0)} ms (manhattan reroutes while dragging)`);
    return () => graph.dispose();
  }, [onStats]);

  return (
    <div className="spike-canvas">
      <div ref={container} style={{ width: '100%', height: '100%' }} />
      <div ref={minimap} className="spike-minimap" />
    </div>
  );
}
