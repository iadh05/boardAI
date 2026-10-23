import { useLayoutEffect, useMemo, useRef } from 'react';
import type { DiagramContextValue } from './DiagramContext.ts';
import type { DiagramProps } from './Diagram.tsx';
import type { EdgeEditContextValue } from './EdgeEditContext.ts';
import type { ZoneContextValue } from './ZoneContext.ts';

type Callbacks = Pick<
  DiagramProps,
  | 'onZoneLabelCommit'
  | 'onZoneEditEnd'
  | 'onZoneResize'
  | 'onLabelCommit'
  | 'onEditEnd'
  | 'onEdgeLabelCommit'
  | 'onEdgeDashedChange'
  | 'onEdgeEditEnd'
>;

type Options = Callbacks & {
  editingNodeId: string | null;
  maxLabelLength: number;
  editingEdgeId: string | null;
  maxEdgeLabelLength: number;
  dashedLabel: string;
  editingZoneId: string | null;
  minZoneSize: { width: number; height: number };
};

/**
 * What the boxes, arrows and zones read to edit themselves. Every node reads these contexts, and a
 * new value re-renders all of them — on every drag frame, since the canvas re-renders then. So:
 * values that change only with the editing state, and the latest callbacks read through a ref (apps
 * may pass inline functions).
 */
export function useEditContexts({
  editingNodeId,
  maxLabelLength,
  editingEdgeId,
  maxEdgeLabelLength,
  dashedLabel,
  editingZoneId,
  minZoneSize,
  ...latest
}: Options) {
  const callbacks = useRef<Callbacks>(latest);
  useLayoutEffect(() => {
    callbacks.current = latest;
  });
  const context = useMemo<DiagramContextValue>(
    () => ({
      editingNodeId,
      maxLabelLength,
      commitLabel: (id, label) => callbacks.current.onLabelCommit?.(id, label),
      endEditing: () => callbacks.current.onEditEnd?.(),
    }),
    [editingNodeId, maxLabelLength],
  );
  const edgeContext = useMemo<EdgeEditContextValue>(
    () => ({
      editingEdgeId,
      maxLabelLength: maxEdgeLabelLength,
      dashedLabel,
      commitLabel: (id, label) => callbacks.current.onEdgeLabelCommit?.(id, label),
      setDashed: (id, dashed) => callbacks.current.onEdgeDashedChange?.(id, dashed),
      endEditing: () => callbacks.current.onEdgeEditEnd?.(),
    }),
    [editingEdgeId, maxEdgeLabelLength, dashedLabel],
  );
  const zoneContext = useMemo<ZoneContextValue>(
    () => ({
      editingZoneId,
      minSize: minZoneSize,
      commitLabel: (id, label) => callbacks.current.onZoneLabelCommit?.(id, label),
      endEditing: () => callbacks.current.onZoneEditEnd?.(),
      resize: (id, size) => callbacks.current.onZoneResize?.(id, size),
    }),
    [editingZoneId, minZoneSize],
  );
  return { context, edgeContext, zoneContext };
}
