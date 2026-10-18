import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { labelPoint, roundedPath } from '../router/geometry.ts';
import { EdgeEditor } from './EdgeEditor.tsx';
import { useEdgeEditContext } from './EdgeEditContext.ts';
import { useRoute } from './RoutesContext.ts';

/** What <Diagram> puts on each edge for drawing and editing. */
export type RoutedEdgeData = { dashed: boolean; ghost: boolean };

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
  data,
}: EdgeProps) {
  const route = useRoute(id);
  const edit = useEdgeEditContext();
  const { dashed = false, ghost = false } = (data ?? {}) as Partial<RoutedEdgeData>;
  const editing = edit.editingEdgeId === id && !ghost;
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
      {(label || editing) && (
        <EdgeLabelRenderer>
          <div
            className={editing ? 'dr-edge-label is-editing' : 'dr-edge-label'}
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
          >
            {editing ? (
              <EdgeEditor
                label={typeof label === 'string' ? label : ''}
                dashed={dashed}
                dashedLabel={edit.dashedLabel}
                maxLength={edit.maxLabelLength}
                onCommit={(text) => {
                  edit.commitLabel(id, text);
                  edit.endEditing();
                }}
                onCancel={edit.endEditing}
                onDashedChange={(next) => edit.setDashed(id, next)}
              />
            ) : (
              label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
