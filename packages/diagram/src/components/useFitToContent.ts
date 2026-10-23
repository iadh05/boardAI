import { useNodesInitialized, useReactFlow, useStoreApi } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { fitPadding } from '../flow/fitPadding.ts';

/** How far a fit may zoom: in up to 1, out down to `minZoom`. */
type FitOptions = { maxZoom: number; minZoom: number };

/**
 * Fits the view to the diagram, around the panels drawn over it (the app's toolbar…): once drawn
 * when the diagram opened with content, again whenever `fitKey` changes. An empty diagram isn't
 * fitted: the app places the first box where the user can see it. Returns the fit itself, for the
 * zoom controls' fit button.
 */
export function useFitToContent(
  fitKey: unknown,
  hasContent: boolean,
  fitOnOpen: boolean,
  fitOptions: FitOptions,
) {
  const { fitView } = useReactFlow();
  // fitKey changed: fit once the boxes are measured (React Flow can't fit what it hasn't drawn).
  const nodesDrawn = useNodesInitialized();
  const flowStore = useStoreApi();
  const fitFor = useRef(fitKey);
  // Opening with content: fit once drawn (React Flow's own fit-on-open ignores the panels).
  const fitPending = useRef(fitOnOpen);

  /** Fits the diagram to the part of the pane no panel covers. */
  const fitAroundPanels = () => {
    const pane = flowStore.getState().domNode;
    if (!pane) return void fitView(fitOptions);
    const box = pane.getBoundingClientRect();
    const panels = [...pane.querySelectorAll('.react-flow__panel')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height };
    });
    const pad = fitPadding({ width: box.width, height: box.height }, panels);
    void fitView({
      ...fitOptions,
      padding: {
        top: `${pad.top}px`,
        right: `${pad.right}px`,
        bottom: `${pad.bottom}px`,
        left: `${pad.left}px`,
      },
    });
  };
  useEffect(() => {
    if (fitKey === fitFor.current) return;
    fitFor.current = fitKey;
    // Nothing to show yet: no fit later either, or the view would jump when someone adds the first
    // box — under the hand of whoever is working on the board.
    fitPending.current = hasContent;
  }, [fitKey, hasContent]);
  useEffect(() => {
    if (!fitPending.current || !nodesDrawn) return;
    fitPending.current = false;
    fitAroundPanels();
  });
  return fitAroundPanels;
}
