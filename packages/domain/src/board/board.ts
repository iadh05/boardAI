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

/** UUIDs in the app, short ids like "n9" from the agent: no whitespace, at most 64 characters. */
export const MAX_ID_LENGTH = 64;
const IdSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(/^\S+$/, 'Ids must not contain whitespace');

/** No line breaks or other control characters (see the node label below). */
const SINGLE_LINE = /^\P{Cc}*$/u;
const SINGLE_LINE_MESSAGE = 'Labels must not contain line breaks or control characters';

export const PositionSchema = z.object({
  x: z.number(), // zod rejects NaN and ±Infinity
  y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

export const BoardNodeSchema = z.object({
  id: IdSchema, // crypto.randomUUID() in the app
  kind: NodeKindSchema,
  // No line breaks or other control characters: labels are pasted into the board text the AI
  // reads, and a newline would let a label forge extra board lines (prompt injection).
  label: z.string().max(MAX_LABEL_LENGTH).regex(SINGLE_LINE, SINGLE_LINE_MESSAGE),
  position: PositionSchema,
});
export type BoardNode = z.infer<typeof BoardNodeSchema>;

/** Arrow labels name the link ("HTTPS", "gRPC", "events"): short. */
export const MAX_EDGE_LABEL_LENGTH = 40;

/** How the source calls the target: waits for an answer (sync) or not (async: queue, events). */
export const EDGE_MODES = ['sync', 'async'] as const;
export const EdgeModeSchema = z.enum(EDGE_MODES);
export type EdgeMode = z.infer<typeof EdgeModeSchema>;

export const EdgeLabelSchema = z
  .string()
  .min(1)
  .max(MAX_EDGE_LABEL_LENGTH)
  .regex(SINGLE_LINE, SINGLE_LINE_MESSAGE);

export const BoardEdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema, // BoardNode.id
  target: IdSchema, // BoardNode.id
  label: EdgeLabelSchema.optional(),
  /** Absent means sync: older boards and plain arrows stay valid without it. */
  mode: EdgeModeSchema.optional(),
});
export type BoardEdge = z.infer<typeof BoardEdgeSchema>;

/**
 * A board must be a valid graph, not just valid pieces: unique ids, every edge between two
 * existing, different nodes, at most one edge per direction. The board ops (M1-06) keep these
 * true; this check enforces them on anything that arrives from outside.
 */
export const BoardSchema = z
  .object({
    nodes: z.array(BoardNodeSchema),
    edges: z.array(BoardEdgeSchema),
  })
  .superRefine((board, ctx) => {
    const nodeIds = new Set<string>();
    board.nodes.forEach((node, index) => {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'id'],
          message: `Duplicate node id "${node.id}"`,
        });
      }
      nodeIds.add(node.id);
    });

    const edgeIds = new Set<string>();
    const connections = new Set<string>();
    board.edges.forEach((edge, index) => {
      const at = (field: string) => ['edges', index, field];
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({ code: 'custom', path: at('id'), message: `Duplicate edge id "${edge.id}"` });
      }
      edgeIds.add(edge.id);
      for (const end of ['source', 'target'] as const) {
        if (!nodeIds.has(edge[end])) {
          ctx.addIssue({
            code: 'custom',
            path: at(end),
            message: `Edge "${edge.id}" points to missing node "${edge[end]}"`,
          });
        }
      }
      if (edge.source === edge.target) {
        ctx.addIssue({
          code: 'custom',
          path: at('target'),
          message: `Edge "${edge.id}" connects a node to itself`,
        });
      }
      const connection = `${edge.source}->${edge.target}`;
      if (connections.has(connection)) {
        ctx.addIssue({
          code: 'custom',
          path: at('target'),
          message: `Edge "${edge.id}" duplicates the connection ${edge.source} → ${edge.target}`,
        });
      }
      connections.add(connection);
    });
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
