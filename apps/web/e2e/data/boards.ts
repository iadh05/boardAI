import type { Board } from '@designroom/domain';

// Test boards, built in the open so a spec shows what it starts from (docs/rules/e2e.md).

/** The M1 demo: Client → Load Balancer → API → Database, with no cache. The model sees the
 * nodes as n1…n4 in this order — the fake model's "missing-cache" scenario relies on it. */
export const demoBoard = (): Board => {
  const kinds = ['client', 'loadBalancer', 'api', 'database'] as const;
  const labels = ['Client', 'Load Balancer', 'API', 'Database'];
  const nodes = kinds.map((kind, i) => ({
    id: `demo-${kind}`,
    kind,
    label: labels[i] ?? kind,
    position: { x: i * 300, y: 0 },
  }));
  const edges = nodes.slice(1).map((target, i) => ({
    id: `demo-edge-${i}`,
    source: nodes[i]?.id ?? '',
    target: target.id,
  }));
  return { nodes, edges };
};
