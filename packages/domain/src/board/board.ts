import { z } from 'zod';

// The board model — the contract between the web app, the server and the AI (architecture §4.1).
// Each type is inferred from its schema, so the TS type and the runtime check can't drift apart.

/** Node kinds the app knows about. The agent and (later) the simulator understand these. */
export const KNOWN_KINDS = [
  'client',
  'cdn',
  'loadBalancer',
  'api',
  'service',
  'cache',
  'database',
  'queue',
  'storage',
] as const;

/** Known kinds plus `custom`: a box the user names freely (the label is its only description). */
export const NODE_KINDS = [...KNOWN_KINDS, 'custom'] as const;

export const NodeKindSchema = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** Labels are short names; the cap also keeps what we send to the LLM small. */
export const MAX_LABEL_LENGTH = 100;

const IdSchema = z.string().min(1);

export const PositionSchema = z.object({
  x: z.number(), // zod rejects NaN and ±Infinity
  y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

export const BoardNodeSchema = z.object({
  id: IdSchema, // crypto.randomUUID() in the app
  kind: NodeKindSchema,
  label: z.string().max(MAX_LABEL_LENGTH),
  position: PositionSchema,
});
export type BoardNode = z.infer<typeof BoardNodeSchema>;

export const BoardEdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema, // BoardNode.id
  target: IdSchema, // BoardNode.id
});
export type BoardEdge = z.infer<typeof BoardEdgeSchema>;

export const BoardSchema = z.object({
  nodes: z.array(BoardNodeSchema),
  edges: z.array(BoardEdgeSchema),
});
export type Board = z.infer<typeof BoardSchema>;

/**
 * Label a new node gets, and the fallback when a label is cleared.
 * `Record<NodeKind, …>` makes the compiler insist on an entry for every kind.
 */
export const KIND_DEFAULT_LABEL: Record<NodeKind, string> = {
  client: 'Client',
  cdn: 'CDN',
  loadBalancer: 'Load Balancer',
  api: 'API',
  service: 'Service',
  cache: 'Cache',
  database: 'Database',
  queue: 'Queue',
  storage: 'Storage',
  custom: 'Custom',
};
