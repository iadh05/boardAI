// The same architecture board for both engines: what a real system design looks like.
export type Kind =
  | 'client' | 'cdn' | 'loadBalancer' | 'api' | 'service'
  | 'cache' | 'database' | 'queue' | 'storage' | 'custom';

export type SpikeNode = { id: string; kind: Kind; label: string; x: number; y: number; parent?: string };
export type SpikeEdge = { id: string; source: string; target: string; label?: string; mode: 'sync' | 'async' };
export type SpikeGroup = { id: string; label: string; x: number; y: number; width: number; height: number };

export const NODE_SIZE = { width: 156, height: 60 };

export const group: SpikeGroup = { id: 'vpc', label: 'VPC — eu-west-1', x: 230, y: 30, width: 760, height: 470 };

export const nodes: SpikeNode[] = [
  { id: 'client', kind: 'client', label: 'Web app', x: 20, y: 230 },
  { id: 'cdn', kind: 'cdn', label: 'CDN', x: 20, y: 60 },
  { id: 'lb', kind: 'loadBalancer', label: 'Load Balancer', x: 270, y: 230, parent: 'vpc' },
  { id: 'api', kind: 'api', label: 'Orders API', x: 500, y: 230, parent: 'vpc' },
  { id: 'cache', kind: 'cache', label: 'Redis', x: 500, y: 80, parent: 'vpc' },
  { id: 'db', kind: 'database', label: 'Postgres', x: 790, y: 230, parent: 'vpc' },
  { id: 'queue', kind: 'queue', label: 'Order events', x: 500, y: 400, parent: 'vpc' },
  { id: 'worker', kind: 'service', label: 'Billing worker', x: 790, y: 400, parent: 'vpc' },
  { id: 'stripe', kind: 'custom', label: 'Stripe', x: 1060, y: 400 },
];

export const edges: SpikeEdge[] = [
  { id: 'e1', source: 'client', target: 'cdn', label: 'static', mode: 'sync' },
  { id: 'e2', source: 'client', target: 'lb', label: 'HTTPS', mode: 'sync' },
  { id: 'e3', source: 'lb', target: 'api', mode: 'sync' },
  { id: 'e4', source: 'api', target: 'cache', label: 'reads', mode: 'sync' },
  { id: 'e5', source: 'api', target: 'db', label: 'SQL', mode: 'sync' },
  { id: 'e6', source: 'api', target: 'queue', label: 'events', mode: 'async' },
  { id: 'e7', source: 'queue', target: 'worker', mode: 'async' },
  { id: 'e8', source: 'worker', target: 'stripe', label: 'HTTPS', mode: 'sync' },
  // Crosses the board: routing has to go around Orders API / Redis.
  { id: 'e9', source: 'worker', target: 'cache', label: 'invalidate', mode: 'sync' },
];
