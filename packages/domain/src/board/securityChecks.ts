import type { Board, NodeKind } from './board.ts';

// The Security specialist's rules (AV2-06): what code can see on the board every time. Like the
// design checks, pure and naming their boxes; the agent explains them against the requirements.

export type SecurityRule = 'client-to-data' | 'no-edge';

export type SecurityFinding = {
  rule: SecurityRule;
  /** For a link: from, to. */
  nodeIds: string[];
  severity: 'warn' | 'critical';
  problem: string;
  fix: string;
};

const DATA_STORES: ReadonlySet<NodeKind> = new Set(['database', 'cache', 'storage', 'queue']);
const SERVICES: ReadonlySet<NodeKind> = new Set(['api', 'service']);

export const checkSecurity = (board: Board): SecurityFinding[] =>
  board.edges.flatMap((e): SecurityFinding[] => {
    const from = board.nodes.find((n) => n.id === e.source);
    const to = board.nodes.find((n) => n.id === e.target);
    if (from?.kind !== 'client' || !to) return [];
    if (DATA_STORES.has(to.kind))
      return [
        {
          rule: 'client-to-data',
          nodeIds: [from.id, to.id],
          severity: 'critical',
          problem: 'the client reaches a data store directly: its credentials ship with the app',
          fix: 'only an API reads and writes it; the client calls the API',
        },
      ];
    if (SERVICES.has(to.kind))
      return [
        {
          rule: 'no-edge',
          nodeIds: [from.id, to.id],
          severity: 'warn',
          problem: 'no gateway in front: nothing checks, limits or logs calls at the edge',
          fix: 'an API gateway or load balancer (kind loadBalancer) in front, with auth and rate limits',
        },
      ];
    return [];
  });
