import { describe, expect, it } from 'vitest';
import type { Board, BoardNode, NodeKind } from './board.ts';
import { checkSecurity } from './securityChecks.ts';

// The Security specialist's rules (AV2-06): what code can see on the board every time.

const boardOf = (boxes: [NodeKind, string][], arrows: [string, string][] = []): Board => ({
  nodes: boxes.map(([kind, label]): BoardNode => ({
    id: label,
    kind,
    label,
    position: { x: 0, y: 0 },
  })),
  edges: arrows.map(([source, target], i) => ({ id: `e${i}`, source, target })),
});

describe('checkSecurity', () => {
  it('a client that talks straight to a data store: critical, naming both', () => {
    const board = boardOf(
      [
        ['client', 'Mobile app'],
        ['database', 'Postgres'],
      ],
      [['Mobile app', 'Postgres']],
    );
    expect(checkSecurity(board)).toEqual([
      expect.objectContaining({
        rule: 'client-to-data',
        nodeIds: ['Mobile app', 'Postgres'],
        severity: 'critical',
      }),
    ]);
  });

  it.each(['cache', 'storage', 'queue'] as const)('a %s is a data store too', (kind) => {
    const board = boardOf(
      [
        ['client', 'Web'],
        [kind, 'Store'],
      ],
      [['Web', 'Store']],
    );
    expect(checkSecurity(board).map((f) => f.rule)).toEqual(['client-to-data']);
  });

  it('a client calling an API with no gateway or load balancer in front: no edge to check calls', () => {
    const board = boardOf(
      [
        ['client', 'Web'],
        ['api', 'Orders API'],
      ],
      [['Web', 'Orders API']],
    );
    expect(checkSecurity(board)).toEqual([
      expect.objectContaining({
        rule: 'no-edge',
        nodeIds: ['Web', 'Orders API'],
        severity: 'warn',
      }),
    ]);
  });

  it('a well-built path (client → gateway → API → database) is clean', () => {
    const board = boardOf(
      [
        ['client', 'Web'],
        ['loadBalancer', 'API Gateway'],
        ['api', 'Orders API'],
        ['database', 'Postgres'],
      ],
      [
        ['Web', 'API Gateway'],
        ['API Gateway', 'Orders API'],
        ['Orders API', 'Postgres'],
      ],
    );
    expect(checkSecurity(board)).toEqual([]);
  });

  it('a client fetching assets from a CDN is fine', () => {
    const board = boardOf(
      [
        ['client', 'Web'],
        ['cdn', 'CDN'],
      ],
      [['Web', 'CDN']],
    );
    expect(checkSecurity(board)).toEqual([]);
  });
});
