// @vitest-environment node
// Routing quality, tested with the real libavoid wasm — no browser needed (ADR-004).
import { createRequire } from 'node:module';
import path from 'node:path';
import { AvoidLib } from 'libavoid-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DiagramPosition } from '../types.ts';
import { createAvoidRouter } from './avoid.ts';
import type { DiagramRouter, Route, RouterBox } from './types.ts';

let router: DiagramRouter;

beforeAll(async () => {
  // The Node build reads the .wasm from disk.
  const entry = createRequire(import.meta.url).resolve('libavoid-js');
  await AvoidLib.load(path.join(path.dirname(entry), 'libavoid.wasm'));
  router = createAvoidRouter(AvoidLib.getInstance());
});

const box = (id: string, x: number, y: number): RouterBox => ({ id, x, y, width: 160, height: 60 });

const isOrthogonal = (route: Route) =>
  route.every((p, i) => {
    const prev = route[i - 1];
    return !prev || p.x === prev.x || p.y === prev.y;
  });

/** Does the polyline pass through the inside of the box? */
const crosses = (route: Route, b: RouterBox) =>
  route.some((p, i) => {
    const prev = route[i - 1];
    if (!prev) return false;
    const [x1, x2] = [Math.min(prev.x, p.x), Math.max(prev.x, p.x)];
    const [y1, y2] = [Math.min(prev.y, p.y), Math.max(prev.y, p.y)];
    return x1 < b.x + b.width && x2 > b.x && y1 < b.y + b.height && y2 > b.y;
  });

/** Is the point on the outline of the box (not inside it, e.g. its centre)? */
const onEdge = (p: DiagramPosition | undefined, b: RouterBox | undefined) =>
  !!p &&
  !!b &&
  (((p.x === b.x || p.x === b.x + b.width) && p.y >= b.y && p.y <= b.y + b.height) ||
    ((p.y === b.y || p.y === b.y + b.height) && p.x >= b.x && p.x <= b.x + b.width));

const first = (route: Route | undefined): DiagramPosition | undefined => route?.[0];
const last = (route: Route | undefined): DiagramPosition | undefined => route?.at(-1);

describe('createAvoidRouter', () => {
  it('links side by side: leaves from the right edge, arrives at the left edge', () => {
    const routes = router.route(
      [box('a', 0, 0), box('b', 300, 0)],
      [{ id: 'e', source: 'a', target: 'b' }],
    );
    const route = routes.get('e');

    expect(first(route)).toEqual({ x: 160, y: 30 });
    expect(last(route)).toEqual({ x: 300, y: 30 });
  });

  it('a box above the other: leaves from the bottom, arrives at the top', () => {
    const route = router
      .route([box('a', 0, 0), box('b', 0, 300)], [{ id: 'e', source: 'a', target: 'b' }])
      .get('e');

    expect(first(route)).toEqual({ x: 80, y: 60 });
    expect(last(route)).toEqual({ x: 80, y: 300 });
  });

  it('goes around a box in the way, with right angles only', () => {
    const blocker = box('b', 300, 0);
    const route = router
      .route([box('a', 0, 0), blocker, box('c', 600, 0)], [{ id: 'e', source: 'a', target: 'c' }])
      .get('e');

    expect(route).toBeDefined();
    expect(crosses(route ?? [], blocker)).toBe(false);
    expect(isOrthogonal(route ?? [])).toBe(true);
  });

  it('routes every link of a busy board orthogonally, around every other box', () => {
    const boxes = [
      box('lb', 0, 200),
      box('api', 300, 200),
      box('cache', 300, 0),
      box('db', 600, 200),
      box('q', 300, 400),
      box('worker', 600, 400),
    ];
    const links = [
      { id: 'e1', source: 'lb', target: 'api' },
      { id: 'e2', source: 'api', target: 'cache' },
      { id: 'e3', source: 'api', target: 'db' },
      { id: 'e4', source: 'api', target: 'q' },
      { id: 'e5', source: 'q', target: 'worker' },
      { id: 'e6', source: 'worker', target: 'cache' },
    ];

    const routes = router.route(boxes, links);

    const byId = new Map(boxes.map((b) => [b.id, b]));
    for (const link of links) {
      const route = routes.get(link.id) ?? [];
      expect(isOrthogonal(route), link.id).toBe(true);
      expect(onEdge(first(route), byId.get(link.source)), `${link.id} starts on an edge`).toBe(
        true,
      );
      expect(onEdge(last(route), byId.get(link.target)), `${link.id} ends on an edge`).toBe(true);
      for (const other of boxes) {
        if (other.id === link.source || other.id === link.target) continue;
        expect(crosses(route, other), `${link.id} crosses ${other.id}`).toBe(false);
      }
    }
  });

  it('several arrows can leave the same side: each starts on the edge of the box, none from its centre', () => {
    const a = box('a', 0, 0);
    const routes = router.route(
      [a, box('b', 300, 0), box('c', 300, 200)],
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'a', target: 'c' },
      ],
    );

    for (const id of ['e1', 'e2']) {
      expect(first(routes.get(id))?.x, id).toBe(a.x + a.width);
      expect(isOrthogonal(routes.get(id) ?? []), id).toBe(true);
    }
  });

  it('routes boxes placed close together (a small gap) from edge to edge', () => {
    const a = box('a', 0, 0);
    const b = box('b', 184, 0); // 24 px apart
    const route = router.route([a, b], [{ id: 'e', source: 'a', target: 'b' }]).get('e');

    expect(first(route)).toEqual({ x: 160, y: 30 });
    expect(last(route)).toEqual({ x: 184, y: 30 });
  });

  it('gives no route when boxes are too close to route between (the edge falls back)', () => {
    // 10 px apart: the clearance zones overlap, and libavoid would silently join the centres.
    const routes = router.route(
      [box('a', 0, 0), box('b', 170, 0)],
      [{ id: 'e', source: 'a', target: 'b' }],
    );
    expect(routes.has('e')).toBe(false);
  });

  it('skips links whose ends are not on the board', () => {
    const routes = router.route([box('a', 0, 0)], [{ id: 'e', source: 'a', target: 'gone' }]);
    expect(routes.has('e')).toBe(false);
  });

  it('can route again and again (a fresh router each time, nothing leaks)', () => {
    for (let i = 0; i < 50; i++) {
      router.route([box('a', i, 0), box('b', 300, 0)], [{ id: 'e', source: 'a', target: 'b' }]);
    }
    const route = router.route(
      [box('a', 0, 0), box('b', 300, 0)],
      [{ id: 'e', source: 'a', target: 'b' }],
    );
    expect(first(route.get('e'))).toEqual({ x: 160, y: 30 });
  });
});
