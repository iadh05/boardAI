import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { labelPoint, roundedPath } from '../router/geometry.ts';
import { useRoute } from './RoutesContext.ts';

/**
 * An arrow along its routed path (around boxes). Until a route exists — router still loading,
 * or no router — it falls back to a simple right-angle path between the facing sides.
 */
export function RoutedEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  label,
}: EdgeProps) {
  const route = useRoute(id);
  let path: string;
  let at: { x: number; y: number };
  if (route && route.length > 1) {
    path = roundedPath(route);
    at = labelPoint(route);
  } else {
    const [simplePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 6,
    });
    path = simplePath;
    at = { x: labelX, y: labelY };
  }

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="dr-edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
