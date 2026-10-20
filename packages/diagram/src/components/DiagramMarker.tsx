import { useStore, ViewportPortal } from '@xyflow/react';
import type { ReactNode } from 'react';
import type { DiagramPosition } from '../types.ts';

export type DiagramMarkerProps = {
  /** Where on the diagram (diagram coordinates: it stays on the same spot when you pan or zoom). */
  position: DiagramPosition;
  /** Drawn with its top-left corner at `position`, at the same size whatever the zoom. */
  children: ReactNode;
};

/**
 * Something pinned to a spot of the diagram that isn't part of it: another person's cursor, a
 * note marker. Not clickable, never in the way. Render it as a child of <Diagram>.
 */
export function DiagramMarker({ position, children }: DiagramMarkerProps) {
  const zoom = useStore((s) => s.transform[2]);
  return (
    <ViewportPortal>
      <div
        className="dr-diagram-marker"
        style={{
          position: 'absolute',
          transform: `translate(${position.x}px, ${position.y}px) scale(${1 / zoom})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
          zIndex: 1000,
        }}
      >
        {children}
      </div>
    </ViewportPortal>
  );
}
