import { describe, expect, it } from 'vitest';
import type { Board, BoardNode, NodeKind } from './board.ts';
import { checkDesign, oneOfAKindJob } from './designChecks.ts';

/** A board from boxes (id = label) and arrows between them, by label. */
const boardOf = (boxes: [NodeKind, string][], arrows: [string, string][] = []): Board => ({
  nodes: boxes.map(([kind, label]): BoardNode => ({
    id: label,
    kind,
    label,
    position: { x: 0, y: 0 },
  })),
  edges: arrows.map(([source, target], i) => ({ id: `e${i}`, source, target })),
});

const rulesOf = (board: Board) => checkDesign(board).map((f) => f.rule);

describe('checkDesign (M1-30, M1-32)', () => {
  it('a well-built chain has no findings', () => {
    const board = boardOf(
      [
        ['client', 'Web'],
        ['loadBalancer', 'LB'],
        ['api', 'API'],
        ['cache', 'Redis'],
        ['database', 'Postgres (primary + replica)'],
      ],
      [
        ['Web', 'LB'],
        ['LB', 'API'],
        ['API', 'Redis'],
        ['API', 'Postgres (primary + replica)'],
      ],
    );
    expect(checkDesign(board)).toEqual([]);
  });

  it('an empty board has no findings', () => {
    expect(checkDesign({ nodes: [], edges: [] })).toEqual([]);
  });

  describe('no cache', () => {
    it('an API that reads a database with no cache next to it, naming both boxes', () => {
      const board = boardOf(
        [
          ['api', 'Orders API'],
          ['database', 'Postgres (replicated)'],
        ],
        [['Orders API', 'Postgres (replicated)']],
      );
      expect(checkDesign(board)).toEqual([
        expect.objectContaining({
          rule: 'no-cache',
          nodeIds: ['Orders API', 'Postgres (replicated)'],
        }),
      ]);
    });

    it('counts a cache by its label too ("Redis" as a custom box)', () => {
      const board = boardOf(
        [
          ['api', 'API'],
          ['custom', 'Redis'],
          ['database', 'DB cluster'],
        ],
        [
          ['API', 'Redis'],
          ['API', 'DB cluster'],
        ],
      );
      expect(rulesOf(board)).not.toContain('no-cache');
    });

    // Review of M1-32: the job words hid a cache drawn as a service ("… cache service").
    it('counts a cache drawn as a service: "Redis cache service"', () => {
      const board = boardOf(
        [
          ['api', 'API'],
          ['service', 'Redis cache service'],
          ['database', 'DB cluster'],
        ],
        [
          ['API', 'Redis cache service'],
          ['API', 'DB cluster'],
        ],
      );
      expect(rulesOf(board)).not.toContain('no-cache');
    });

    it('a back-end service writing to its database is not flagged: only the API read path', () => {
      const board = boardOf(
        [
          ['service', 'Trip Service'],
          ['database', 'Trips DB (sharded)'],
        ],
        [['Trip Service', 'Trips DB (sharded)']],
      );
      expect(rulesOf(board)).not.toContain('no-cache');
    });
  });

  describe('single database', () => {
    it('one database with nothing that says it has a copy', () => {
      const board = boardOf(
        [
          ['service', 'Orders'],
          ['database', 'Postgres'],
        ],
        [['Orders', 'Postgres']],
      );
      expect(checkDesign(board)).toEqual([
        expect.objectContaining({ rule: 'single-database', nodeIds: ['Postgres'] }),
      ]);
    });

    it.each([
      'Postgres (primary + replica)',
      'DB cluster',
      'Trips DB (sharded by city)',
      'Aurora multi-AZ',
    ])('a label that says it is redundant is enough: %s', (label) => {
      const board = boardOf([['database', label]]);
      expect(rulesOf(board)).not.toContain('single-database');
    });

    // Review of M1-32: "primary" alone says nothing about a copy.
    it('"Primary DB" alone still has one copy', () => {
      expect(rulesOf(boardOf([['database', 'Primary DB']]))).toContain('single-database');
    });

    it('another database linked to it is not a replica unless it says so', () => {
      const board = boardOf(
        [
          ['database', 'Orders DB'],
          ['database', 'Analytics warehouse (replicated)'],
        ],
        [['Orders DB', 'Analytics warehouse (replicated)']],
      );
      expect(checkDesign(board)).toEqual([
        expect.objectContaining({ rule: 'single-database', nodeIds: ['Orders DB'] }),
      ]);
    });

    it('a replica drawn as its own box, connected to it, is enough', () => {
      const board = boardOf(
        [
          ['database', 'Postgres'],
          ['database', 'Read replica'],
        ],
        [['Postgres', 'Read replica']],
      );
      expect(rulesOf(board)).not.toContain('single-database');
    });
  });

  describe('no load balancer', () => {
    it('a client calling an API directly', () => {
      const board = boardOf(
        [
          ['client', 'Mobile app'],
          ['api', 'Orders API'],
        ],
        [['Mobile app', 'Orders API']],
      );
      expect(checkDesign(board)).toEqual([
        expect.objectContaining({
          rule: 'no-load-balancer',
          nodeIds: ['Mobile app', 'Orders API'],
        }),
      ]);
    });

    it('a client calling a CDN, or going through a load balancer, is fine', () => {
      const board = boardOf(
        [
          ['client', 'App'],
          ['cdn', 'CDN'],
          ['loadBalancer', 'Gateway'],
          ['service', 'Rides'],
        ],
        [
          ['App', 'CDN'],
          ['App', 'Gateway'],
          ['Gateway', 'Rides'],
        ],
      );
      expect(rulesOf(board)).not.toContain('no-load-balancer');
    });
  });

  describe('unconnected', () => {
    it('a box no arrow touches, when the board has others', () => {
      const board = boardOf(
        [
          ['api', 'API'],
          ['cache', 'Redis'],
          ['queue', 'Jobs'],
        ],
        [['API', 'Redis']],
      );
      expect(checkDesign(board)).toEqual([
        expect.objectContaining({ rule: 'unconnected', nodeIds: ['Jobs'] }),
      ]);
    });

    it('a lone box on the board is just a start, not a finding', () => {
      expect(checkDesign(boardOf([['cache', 'Redis']]))).toEqual([]);
    });
  });

  describe('duplicate', () => {
    it('two boxes doing a one-of-a-kind job (a RabbitMQ next to Kafka)', () => {
      const board = boardOf(
        [
          ['queue', 'Kafka'],
          ['custom', 'RabbitMQ broker'],
        ],
        [['Kafka', 'RabbitMQ broker']],
      );
      expect(checkDesign(board)).toEqual([
        expect.objectContaining({ rule: 'duplicate', nodeIds: ['Kafka', 'RabbitMQ broker'] }),
      ]);
    });

    it('a box that works with the queue is not a second queue', () => {
      const board = boardOf(
        [
          ['queue', 'Kafka'],
          ['service', 'Kafka consumer'],
        ],
        [['Kafka', 'Kafka consumer']],
      );
      expect(rulesOf(board)).not.toContain('duplicate');
    });
  });

  it('every finding says the problem and the fix', () => {
    const board = boardOf(
      [
        ['client', 'App'],
        ['api', 'API'],
        ['database', 'DB'],
      ],
      [
        ['App', 'API'],
        ['API', 'DB'],
      ],
    );
    const findings = checkDesign(board);
    expect(findings.map((f) => f.rule)).toEqual([
      'no-load-balancer',
      'no-cache',
      'single-database',
    ]);
    for (const f of findings) {
      expect(f.problem).not.toBe('');
      expect(f.fix).not.toBe('');
    }
  });
});

describe('oneOfAKindJob', () => {
  it.each([
    ['queue', 'Orders', 'queue'],
    ['custom', 'RabbitMQ', 'queue'],
    ['storage', 'Analytics cache', 'cache'],
    ['service', 'Order queue worker', undefined],
    ['api', 'Orders API', undefined],
  ] as const)('%s "%s" → %s', (kind, label, job) => {
    expect(oneOfAKindJob(kind, label)).toBe(job);
  });
});
