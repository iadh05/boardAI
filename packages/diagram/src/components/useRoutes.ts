import type { Edge } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import type { BoxNode } from '../flow/toReactFlow.ts';
import { loadAvoidRouter } from '../router/loadAvoid.ts';
import type { DiagramRouter, Route } from '../router/types.ts';
import { NODE_SIZE } from './nodeSize.ts';

/**
 * Routes for every edge, from the canvas's live node positions (so arrows follow a drag).
 * `router`: a given router, `null` for simple edges, or `undefined` for the default (libavoid,
 * loaded lazily; until it's ready — or if it fails — edges are drawn simply).
 */
export function useRoutes(
  nodes: readonly BoxNode[],
  edges: readonly Edge[],
  router: DiagramRouter | null | undefined,
): ReadonlyMap<string, Route> | null {
  const [loaded, setLoaded] = useState<DiagramRouter | null>(null);

  useEffect(() => {
    if (router !== undefined) return;
    let live = true;
    loadAvoidRouter().then(
      (r) => {
        if (live) setLoaded(r);
      },
      // The wasm couldn't load (offline, blocked): keep the simple edges.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [router]);

  const active = router === undefined ? loaded : router;

  return useMemo(() => {
    if (!active) return null;
    const boxes = nodes.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: n.measured?.width ?? NODE_SIZE.width,
      height: n.measured?.height ?? NODE_SIZE.height,
    }));
    return active.route(boxes, edges);
  }, [active, nodes, edges]);
}
