import type { DiagramPosition } from '../types.ts';

/** A box the router must route around, in diagram coordinates. */
export type RouterBox = { id: string; x: number; y: number; width: number; height: number };
/** An arrow to route, and the sides it should leave and enter by. */
export type RouterLink = { id: string; source: string; target: string };
/** Points of an orthogonal route, from source to target. */
export type Route = DiagramPosition[];

/** Anything that can route arrows around boxes. `<Diagram router>` takes one. */
export type DiagramRouter = {
  route: (boxes: readonly RouterBox[], links: readonly RouterLink[]) => Map<string, Route>;
};
