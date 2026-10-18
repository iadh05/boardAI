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
  ) => Wrapped;
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

/** Gap kept between routes and boxes, and between parallel routes. */
const BUFFER = 14;
const NUDGE = 10;

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
          new Avoid.ShapeConnectionPin(shape, pin.classId, pin.x, pin.y, true, 0, pin.direction);
        }
        shapes.set(b.id, shape);
      }

      const connections: [string, InstanceType<Avoid['ConnRef']>][] = [];
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
        ]);
      }

      router.processTransaction();

      const routes = new Map<string, Route>();
      for (const [id, connection] of connections) {
        const line = connection.displayRoute();
        const points: Route = [];
        for (let i = 0; i < line.size(); i++) {
          const p = line.at(i);
          points.push({ x: p.x, y: p.y });
        }
        routes.set(id, points);
      }

      // The router owns its shapes and connections: deleting it frees them all.
      Avoid.destroy?.(router);
      return routes;
    },
  };
};
