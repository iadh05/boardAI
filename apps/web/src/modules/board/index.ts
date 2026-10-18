// Public API of the board module. Other modules (chat) import only from here.
import type { Proposal } from '@designroom/domain';
import { useBoardStore } from './store/boardStore.ts';

export { createBoardStore, useBoardStore } from './store/boardStore.ts';
export type { BoardActions, BoardState, BoardStore } from './store/boardStore.ts';

/** Hands an AI proposal to the board — the one way chat talks to board (chat → board). */
export const showProposal = (proposal: Proposal): void => {
  useBoardStore.getState().setProposal(proposal);
};
