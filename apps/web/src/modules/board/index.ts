// Public API of the board module. Other modules (chat) import only from here.
import type { Board, Proposal } from '@designroom/domain';
import { useBoardStore } from './store/boardStore.ts';

export { Canvas as BoardCanvas } from './pods/canvas/index.ts';
export { boardDocument, createBoardStore, useBoardStore } from './store/boardStore.ts';
export type { BoardActions, BoardState, BoardStore } from './store/boardStore.ts';

/** Hands an AI proposal to the board — the one way chat talks to board (chat → board). */
export const showProposal = (proposal: Proposal): void => {
  useBoardStore.getState().setProposal(proposal);
};

/** The board as it is now — what the chat sends to the AI with each message. */
export const currentBoard = (): Board => useBoardStore.getState().board;
