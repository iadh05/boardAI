// The levels of scripts/ladder-eval.ts: each one harder than the last, on a bigger board. A level is
// a flawed core (the problem the answer must find) inside healthy subsystems (service, cache,
// database with its replica) that add scale and must NOT draw changes: the needle grows harder to
// see as the haystack grows. Data only; the scoring of each level is its `pass`.

import type { AgentOp, Board, ChatMessage, NodeKind } from '../../packages/domain/src/index.ts';
import { boardOf, type Run } from './realModel.ts';

type Box = [NodeKind, string];
type Arrow = [string, string, string?, 'async'?];

export type Level = {
  level: number;
  name: string;
  /** What is wrong, in one line: for the report, never shown to the agent. */
  problem: string;
  /** Healthy subsystems added around the core (4 boxes each), times the run's --scale. */
  padding: number;
  core: { boxes: Box[]; arrows: Arrow[]; hub: string };
  /** The conversation: the last message is the user's question. */
  messages: ChatMessage[];
  pass: (run: Run) => boolean;
};

const SUBSYSTEMS = [
  'Catalog',
  'Search',
  'Users',
  'Notifications',
  'Billing',
  'Reviews',
  'Inventory',
  'Shipping',
  'Recommendations',
  'Analytics',
  'Media',
  'Pricing',
  'Reports',
  'Coupons',
  'Wishlist',
  'Loyalty',
];

/** n healthy subsystems, each called by `hub`: service → cache, service → db → replica. */
const healthy = (n: number, hub: string): { boxes: Box[]; arrows: Arrow[] } => {
  const names = Array.from({ length: n }, (_, i) => {
    const base = SUBSYSTEMS[i % SUBSYSTEMS.length] ?? 'Extra';
    return i < SUBSYSTEMS.length ? base : `${base} ${Math.floor(i / SUBSYSTEMS.length) + 1}`;
  });
  return {
    boxes: names.flatMap((s): Box[] => [
      ['service', `${s} service`],
      ['cache', `${s} cache`],
      ['database', `${s} DB`],
      ['database', `${s} DB replica`],
    ]),
    arrows: names.flatMap((s): Arrow[] => [
      [hub, `${s} service`],
      [`${s} service`, `${s} cache`],
      [`${s} service`, `${s} DB`],
      [`${s} DB`, `${s} DB replica`, 'replication', 'async'],
    ]),
  };
};

/** The level's board at a scale: the core plus `padding × scale` healthy subsystems. */
export const boardFor = (level: Level, scale: number): Board => {
  const pad = healthy(level.padding * scale, level.core.hub);
  return boardOf([...level.core.boxes, ...pad.boxes], [...level.core.arrows, ...pad.arrows]).board;
};

const says = (run: Run, ...patterns: RegExp[]) => patterns.every((p) => p.test(run.text));
const adds = (ops: AgentOp[], kind: NodeKind) =>
  ops.some((op) => op.op === 'addNode' && op.kind === kind);
const user = (content: string): ChatMessage[] => [{ role: 'user', content }];

const SPOF = /single point|spof|only one|one (instance|copy)|no (replica|redundan|second|backup)/i;
const DIRECT_DB =
  /(browser|client|front.?end)[^.]{0,120}(database|\bdb\b)|direct(ly)? (access|read|connect|reach)|bypass/i;
const LATENCY = /cdn|multi.?region|us.?(east|west|region)|read replica|edge|geo/i;
/** The one worker, in words: "a single Payment worker", "a second worker", "two or more workers". */
const ONE_WORKER =
  /single (payment )?worker|one (payment )?worker|second (payment )?worker|(two|2) or more (payment )?workers/i;
/** A new region: compute or data placed in the US. A CDN is not a region (an edge cache). */
const NEW_REGION = /\bus\b|us-(east|west)|region/i;
const REGION_KINDS: readonly NodeKind[] = ['api', 'service', 'database', 'loadBalancer'];

export const LEVELS: Level[] = [
  {
    level: 1,
    name: 'missing-cache',
    problem: 'every read hits the database; the user says reads are slow',
    padding: 0,
    core: {
      boxes: [
        ['client', 'Web app'],
        ['api', 'Catalog API'],
        ['database', 'Postgres'],
      ],
      arrows: [
        ['Web app', 'Catalog API'],
        ['Catalog API', 'Postgres'],
      ],
      hub: 'Catalog API',
    },
    messages: user('Reads are slow: every page load queries Postgres. Review my design.'),
    pass: (r) => adds(r.ops, 'cache'),
  },
  {
    level: 2,
    name: 'one-api-instance',
    problem: 'one API instance, no load balancer, 10k concurrent users',
    padding: 1,
    core: {
      boxes: [
        ['client', 'Mobile app'],
        ['api', 'Orders API'],
        ['database', 'Orders DB'],
        ['database', 'Orders DB replica'],
      ],
      arrows: [
        ['Mobile app', 'Orders API'],
        ['Orders API', 'Orders DB'],
        ['Orders DB', 'Orders DB replica', 'replication', 'async'],
      ],
      hub: 'Orders API',
    },
    messages: user('We expect 10,000 concurrent users at launch. Review my design.'),
    pass: (r) => adds(r.ops, 'loadBalancer') || says(r, /load.?balanc/i, SPOF),
  },
  {
    level: 3,
    name: 'hidden-spof',
    problem: 'two APIs behind a load balancer, but one worker drains the only queue',
    padding: 3,
    core: {
      boxes: [
        ['client', 'Web app'],
        ['loadBalancer', 'Load balancer'],
        ['api', 'API 1'],
        ['api', 'API 2'],
        ['queue', 'Jobs queue'],
        ['service', 'Payment worker'],
        ['database', 'Payments DB'],
        ['database', 'Payments DB replica'],
      ],
      arrows: [
        ['Web app', 'Load balancer'],
        ['Load balancer', 'API 1'],
        ['Load balancer', 'API 2'],
        ['API 1', 'Jobs queue', 'charge', 'async'],
        ['API 2', 'Jobs queue', 'charge', 'async'],
        ['Jobs queue', 'Payment worker', 'charge', 'async'],
        ['Payment worker', 'Payments DB'],
        ['Payments DB', 'Payments DB replica', 'replication', 'async'],
      ],
      hub: 'API 1',
    },
    messages: user('Where can this design go down completely?'),
    pass: (r) => says(r, /payment worker|worker/i) && (says(r, SPOF) || says(r, ONE_WORKER)),
  },
  {
    level: 4,
    name: 'dual-write',
    problem: 'saved to Postgres then published to Kafka: an order event can be lost',
    padding: 6,
    core: {
      boxes: [
        ['client', 'Shop'],
        ['loadBalancer', 'Load balancer'],
        ['api', 'Orders API'],
        ['database', 'Orders DB'],
        ['database', 'Orders DB replica'],
        ['queue', 'Kafka'],
        ['service', 'Payments'],
        ['service', 'Emails'],
      ],
      arrows: [
        ['Shop', 'Load balancer'],
        ['Load balancer', 'Orders API'],
        ['Orders API', 'Orders DB', 'save order'],
        ['Orders DB', 'Orders DB replica', 'replication', 'async'],
        ['Orders API', 'Kafka', 'order created', 'async'],
        ['Kafka', 'Payments', 'order created', 'async'],
        ['Kafka', 'Emails', 'order created', 'async'],
      ],
      hub: 'Orders API',
    },
    messages: user(
      'Sometimes a customer is never charged, though the order exists. What is going on?',
    ),
    pass: (r) =>
      says(r, /outbox|transactional|dual.?write|atomic|change data capture|\bcdc\b|debezium/i),
  },
  {
    level: 5,
    name: 'two-problems-and-a-budget',
    problem: 'the browser reads the cards DB directly AND US users are far; $200/month',
    padding: 10,
    core: {
      boxes: [
        ['client', 'Browser'],
        ['loadBalancer', 'Load balancer'],
        ['api', 'Payments API (eu-west)'],
        ['database', 'Cards DB (eu-west)'],
        ['database', 'Cards DB replica'],
      ],
      arrows: [
        ['Browser', 'Load balancer'],
        ['Load balancer', 'Payments API (eu-west)'],
        ['Browser', 'Cards DB (eu-west)', 'balance reads'],
        ['Payments API (eu-west)', 'Cards DB (eu-west)'],
        ['Cards DB (eu-west)', 'Cards DB replica', 'replication', 'async'],
      ],
      hub: 'Payments API (eu-west)',
    },
    messages: user(
      'Half our users are in the US and complain about slow pages. Budget: $200 a month. Review my design: what must change first?',
    ),
    pass: (r) => says(r, DIRECT_DB) && says(r, LATENCY),
  },
  {
    level: 6,
    name: 'follow-up-pushback',
    problem: 'level 5, a turn later: the user refuses a second region; the cheapest safe fix',
    padding: 15,
    core: {
      boxes: [
        ['client', 'Browser'],
        ['loadBalancer', 'Load balancer'],
        ['api', 'Payments API (eu-west)'],
        ['database', 'Cards DB (eu-west)'],
        ['database', 'Cards DB replica'],
      ],
      arrows: [
        ['Browser', 'Load balancer'],
        ['Load balancer', 'Payments API (eu-west)'],
        ['Browser', 'Cards DB (eu-west)', 'balance reads'],
        ['Payments API (eu-west)', 'Cards DB (eu-west)'],
        ['Cards DB (eu-west)', 'Cards DB replica', 'replication', 'async'],
      ],
      hub: 'Payments API (eu-west)',
    },
    messages: [
      { role: 'user', content: 'Half our users are in the US. Review my design.' },
      {
        role: 'assistant',
        content:
          'Two things: the browser reads the Cards DB directly, and every US request crosses the Atlantic. I would add a US region with its own API and a read replica.',
      },
      {
        role: 'user',
        content:
          'A second region is too expensive for us. What is the cheapest change that fixes the worst problem?',
      },
    ],
    // The worst problem is the exposed database, not latency; no new region proposed (a CDN is fine).
    pass: (r) =>
      says(r, DIRECT_DB) &&
      !r.ops.some(
        (op) => op.op === 'addNode' && REGION_KINDS.includes(op.kind) && NEW_REGION.test(op.label),
      ),
  },
];
