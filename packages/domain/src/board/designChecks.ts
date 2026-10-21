import type { Board, BoardNode, NodeKind } from './board.ts';

// Design checks (M1-30, M1-32): the flaws code can see every time, so a 9B model doesn't have to.
// The agent calls them as its check_design tool and explains each finding against the
// requirements: the rules find, the model judges and proposes. Pure; each finding names its boxes.
// Labels count as much as kinds: people draw "Redis" as a custom box, "Postgres (replica)" as text.

export type DesignRule =
  'no-load-balancer' | 'no-cache' | 'single-database' | 'duplicate' | 'unconnected';

export type DesignFinding = {
  rule: DesignRule;
  /** The boxes involved, in reading order (for a link: from, to). */
  nodeIds: string[];
  problem: string;
  fix: string;
};

/**
 * Kinds a design needs once: a second one is a duplicate (M1-29: a RabbitMQ queue next to Kafka).
 * The words catch the same thing added as a custom or service box ("RabbitMQ broker").
 */
const ONE_OF_A_KIND: Partial<Record<NodeKind, RegExp>> = {
  queue: /\b(queue|kafka|rabbit ?mq|broker|sqs|event (bus|stream)|pub ?\/? ?sub)\b/i,
  cache: /\b(cache|redis|memcached)\b/i,
  loadBalancer: /\b(load ?balancer)\b/i,
  cdn: /\bcdn\b/i,
};

/** A box that works *with* a queue or cache, not one: "Order queue worker", "Kafka consumer". */
const ROLE = /\b(worker|consumer|processor|service|warmer|api)\b/i;
const JOBS = Object.keys(ONE_OF_A_KIND) as NodeKind[];

/**
 * Which one-of-a-kind job a box does: its kind, or what its label names whatever its kind (a
 * custom "Kafka", a storage "Analytics cache"). None for the boxes around it.
 */
export const oneOfAKindJob = (kind: NodeKind, label: string): NodeKind | undefined => {
  if (kind in ONE_OF_A_KIND) return kind;
  if (ROLE.test(label)) return undefined;
  return JOBS.find((job) => ONE_OF_A_KIND[job]?.test(label));
};

/** A label that says the database has more than one copy. */
const REDUNDANT =
  /\b(replicas?|replicated|replication|cluster|shard(s|ed|ing)?|multi[- ]?az|primary|standby|failover|ha)\b/i;

const neighbours = (board: Board, id: string): BoardNode[] => {
  const ids = new Set(
    board.edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])),
  );
  return board.nodes.filter((n) => ids.has(n.id));
};

const linked = (board: Board, a: string, b: string) =>
  board.edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));

const noLoadBalancer = (board: Board): DesignFinding[] =>
  board.edges.flatMap((e) => {
    const from = board.nodes.find((n) => n.id === e.source);
    const to = board.nodes.find((n) => n.id === e.target);
    return from?.kind === 'client' && (to?.kind === 'api' || to?.kind === 'service')
      ? [
          {
            rule: 'no-load-balancer' as const,
            nodeIds: [from.id, to.id],
            problem: 'the client calls it directly: one instance, no load balancer',
            fix: 'a load balancer (kind loadBalancer) between them, and a second instance',
          },
        ]
      : [];
  });

const noCache = (board: Board): DesignFinding[] =>
  board.nodes
    .filter((n) => n.kind === 'api')
    .filter(
      (api) => !neighbours(board, api.id).some((n) => oneOfAKindJob(n.kind, n.label) === 'cache'),
    )
    .flatMap((api) =>
      neighbours(board, api.id)
        .filter((n) => n.kind === 'database')
        .map((db) => ({
          rule: 'no-cache' as const,
          nodeIds: [api.id, db.id],
          problem: 'every read goes straight to the database: no cache in front',
          fix: 'a cache (kind cache) connected to the API',
        })),
    );

const singleDatabase = (board: Board): DesignFinding[] =>
  board.nodes
    .filter((n) => n.kind === 'database' && !REDUNDANT.test(n.label))
    .filter(
      (db) =>
        !board.nodes.some(
          (other) =>
            other.kind === 'database' && other.id !== db.id && linked(board, db.id, other.id),
        ),
    )
    .map((db) => ({
      rule: 'single-database' as const,
      nodeIds: [db.id],
      problem: 'one copy of the data: a single point of failure',
      fix: 'a replica (kind database) connected to it, or rename it to say it is replicated',
    }));

const duplicates = (board: Board): DesignFinding[] =>
  JOBS.flatMap((job) => {
    const doing = board.nodes.filter((n) => oneOfAKindJob(n.kind, n.label) === job);
    return doing.length > 1
      ? [
          {
            rule: 'duplicate' as const,
            nodeIds: doing.map((n) => n.id),
            problem: `${doing.length} boxes do the same job (${job})`,
            fix: 'keep one: connect everything to it, and say in words which one to remove',
          },
        ]
      : [];
  });

const unconnected = (board: Board): DesignFinding[] =>
  board.nodes.length < 2
    ? []
    : board.nodes
        .filter((n) => !board.edges.some((e) => e.source === n.id || e.target === n.id))
        .map((n) => ({
          rule: 'unconnected' as const,
          nodeIds: [n.id],
          problem: 'no arrow touches it',
          fix: 'connect it to the boxes it works with',
        }));

/** Every finding, from the front of the system to the back. */
export const checkDesign = (board: Board): DesignFinding[] => [
  ...noLoadBalancer(board),
  ...noCache(board),
  ...singleDatabase(board),
  ...duplicates(board),
  ...unconnected(board),
];
