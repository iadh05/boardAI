import { facingSides, type Side } from '../flow/toReactFlow.ts';
import type { DiagramRouter, Route, RouterBox, RouterLink } from './types.ts';

// The only file that talks to libavoid-js (ADR-004). Its bindings are typed here by hand, from
// what the wasm actually exposes (the package's own typings are out of date).

type Wrapped = { delete?: () => void };
type Point = { x: number; y: number };
type PolyLine = { size(): number; at(i: number): Point };
type Avoid = {
  Router: new (flags: number) => Wrapped & {
    setRoutingParameter(param: unknown, value: number): void;
    setRoutingOption(option: unknown, on: boolean): void;
    processTransaction(): void;
  };
  RouterFlag: { OrthogonalRouting: { value: number } };
  RoutingParameter: Record<
    'shapeBufferDistance' | 'idealNudgingDistance' | 'segmentPenalty',
    unknown
  >;
  RoutingOption: Record<'nudgeOrthogonalSegmentsConnectedToShapes', unknown>;
  Point: new (x: number, y: number) => Point;
  Rectangle: new (topLeft: Point, bottomRight: Point) => Wrapped;
  ShapeRef: new (router: unknown, polygon: unknown) => Wrapped;
  ShapeConnectionPin: new (
    shape: unknown,
    classId: number,
    x: number,
    y: number,
    proportional: boolean,
    insideOffset: number,
    directions: number,
  ) => Wrapped & { setExclusive(exclusive: boolean): void };
  ConnEnd: new (shape: unknown, classId: number) => Wrapped;
  ConnRef: new (
    router: unknown,
    source: unknown,
    target: unknown,
  ) => Wrapped & {
    displayRoute(): PolyLine;
  };
  destroy?: (obj: unknown) => void;
};

/** One connection pin per side, in the middle of it. libavoid directions: up 1, down 2, left 4, right 8. */
const PINS: Record<Side, { classId: number; x: number; y: number; direction: number }> = {
  top: { classId: 1, x: 0.5, y: 0, direction: 1 },
  right: { classId: 2, x: 1, y: 0.5, direction: 8 },
  bottom: { classId: 3, x: 0.5, y: 1, direction: 2 },
  left: { classId: 4, x: 0, y: 0.5, direction: 4 },
};

/**
 * Gap kept between routes and boxes, and between parallel routes. Small on purpose: boxes are
 * often placed close together, and two clearance zones that overlap block the way between them.
 */
const BUFFER = 8;
const NUDGE = 10;

/** Is the point on the outline of the box (not inside it, e.g. its centre)? */
const onEdge = (p: Point | undefined, b: RouterBox): boolean =>
  !!p &&
  (((p.x === b.x || p.x === b.x + b.width) && p.y >= b.y && p.y <= b.y + b.height) ||
    ((p.y === b.y || p.y === b.y + b.height) && p.x >= b.x && p.x <= b.x + b.width));

/**
 * A router backed by a loaded libavoid instance. Arrows leave and enter by the facing sides
 * (predictable, like draw.io) and go around every other box, with right angles only.
 */
export const createAvoidRouter = (instance: unknown): DiagramRouter => {
  const Avoid = instance as Avoid;

  return {
    route: (boxes: readonly RouterBox[], links: readonly RouterLink[]) => {
      // A fresh router per call: simple and fast enough (~1 ms for a board this size).
      const router = new Avoid.Router(Avoid.RouterFlag.OrthogonalRouting.value);
      router.setRoutingParameter(Avoid.RoutingParameter.shapeBufferDistance, BUFFER);
      router.setRoutingParameter(Avoid.RoutingParameter.idealNudgingDistance, NUDGE);
      router.setRoutingOption(Avoid.RoutingOption.nudgeOrthogonalSegmentsConnectedToShapes, true);

      const byId = new Map(boxes.map((b) => [b.id, b]));
      const shapes = new Map<string, Wrapped>();
      for (const b of boxes) {
        const rect = new Avoid.Rectangle(
          new Avoid.Point(b.x, b.y),
          new Avoid.Point(b.x + b.width, b.y + b.height),
        );
        const shape = new Avoid.ShapeRef(router, rect);
        for (const pin of Object.values(PINS)) {
          // Pins are exclusive by default (one arrow each): a second arrow from the same side
          // would fall back to the box centre. Several arrows may share a side.
          new Avoid.ShapeConnectionPin(
            shape,
            pin.classId,
            pin.x,
            pin.y,
            true,
            0,
            pin.direction,
          ).setExclusive(false);
        }
        shapes.set(b.id, shape);
      }

      const connections: [string, InstanceType<Avoid['ConnRef']>, RouterBox, RouterBox][] = [];
      for (const link of links) {
        const from = byId.get(link.source);
        const to = byId.get(link.target);
        const fromShape = shapes.get(link.source);
        const toShape = shapes.get(link.target);
        if (!from || !to || !fromShape || !toShape) continue;
        const [out, into] = facingSides(from, to);
        connections.push([
          link.id,
          new Avoid.ConnRef(
            router,
            new Avoid.ConnEnd(fromShape, PINS[out].classId),
            new Avoid.ConnEnd(toShape, PINS[into].classId),
          ),
          from,
          to,
        ]);
      }

      router.processTransaction();

      const routes = new Map<string, Route>();
      for (const [id, connection, from, to] of connections) {
        const line = connection.displayRoute();
        const points: Route = [];
        for (let i = 0; i < line.size(); i++) {
          const p = line.at(i);
          points.push({ x: p.x, y: p.y });
        }
        // When libavoid can't route (e.g. overlapping boxes) it silently joins the box centres.
        // Keep only proper routes, from edge to edge; the others fall back to a simple arrow.
        if (onEdge(points[0], from) && onEdge(points.at(-1), to)) routes.set(id, points);
      }

      // The router owns its shapes and connections: deleting it frees them all.
      Avoid.destroy?.(router);
      return routes;
    },
  };
};
