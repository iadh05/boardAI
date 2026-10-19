import type { DiagramRect, DiagramViewport } from '@designroom/diagram';
import { useEffect } from 'react';
import { placeProposal } from '../../../lib/placement.ts';
import type { useBoardStore } from '../../../store/boardStore.ts';

/**
 * Places the AI's proposal as soon as it arrives, from what the user sees now: right of the node
 * it is near (else the middle of the view), never under the toolbar. Lives with the toolbar,
 * which knows both the view and what it covers. Placed once; ghost and Accept share the result.
 */
export const useProposalPlacement = (
  store: typeof useBoardStore,
  viewport: DiagramViewport,
  covered: () => DiagramRect[],
) => {
  const proposal = store((s) => s.proposal);
  const placed = store((s) => s.placements !== null);

  useEffect(() => {
    if (!proposal || placed) return;
    const { board, placeProposal: place } = store.getState();
    place(
      placeProposal(board, proposal.ops, {
        center: viewport.center(),
        view: viewport.bounds(),
        covered: covered(),
      }),
    );
  }, [proposal, placed, store, viewport, covered]);
};
