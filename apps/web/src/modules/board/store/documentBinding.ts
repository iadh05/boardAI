import { emptyBoard, type Board, type BoardResult } from '@designroom/domain';
import * as Y from 'yjs';
import type { StoreApi } from 'zustand';
import { BOARD_MAPS, readBoard, writeBoard } from '../lib/boardDoc.ts';
import type { BoardState, BoardStore } from './boardStore.ts';

// The board store's link to the shared Yjs document (ADR-010): every write goes through commit, every
// change — this tab's, another's, an undo — is read back into the store, and the undo stacks follow.

/** Moves within this long count as one undo step (a drag). */
const UNDO_CAPTURE_MS = 500;

export type Set = StoreApi<BoardStore>['setState'];
export type Get = StoreApi<BoardStore>['getState'];

/** Which boxes and zones exist: when another tab only moves things, ghosts stay put. */
const idsOf = (b: Board) =>
  [...b.nodes.map((n) => n.id), '|', ...(b.zones ?? []).map((z) => z.id)].join(',');

const isEmpty = (b: Board) => b.nodes.length + b.edges.length + (b.zones?.length ?? 0) === 0;

/** Editing state that points at something another tab deleted is let go. */
const staleEditing = (board: Board, s: BoardState): Partial<BoardState> => ({
  ...(s.editingNodeId && !board.nodes.some((n) => n.id === s.editingNodeId)
    ? { editingNodeId: null }
    : {}),
  ...(s.editingZoneId && !board.zones?.some((z) => z.id === s.editingZoneId)
    ? { editingZoneId: null }
    : {}),
});

/** The store's link to the shared document: commits, the read-back, and the undo stacks. */
export const bindDocument = (doc: Y.Doc, initialBoard: Board, set: Set, get: Get) => {
  /** Marks this tab's own writes: undo tracks only these. */
  const mine = Symbol('this tab');
  const history = new Y.UndoManager(
    BOARD_MAPS.map((name) => doc.getMap(name)),
    { trackedOrigins: new Set([mine]), captureTimeout: UNDO_CAPTURE_MS },
  );
  // A starting board (tests) is written as no one's change, and only into an empty document:
  // a room's board is never mixed with another.
  if (!isEmpty(initialBoard) && isEmpty(readBoard(doc)))
    writeBoard(doc, emptyBoard(), initialBoard);

  // The buttons follow the stacks: read back with every document change (refresh), and after each
  // undo / redo (one whose target someone else deleted changes nothing in the document).
  const undoState = () => ({
    canUndo: history.undoStack.length > 0,
    canRedo: history.redoStack.length > 0,
  });
  /** A local change succeeded: its read-back also clears the last error, in the same update. */
  let clearError = false;

  // Every change to the document — this tab's, another tab's, an undo — is read back here.
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    const board = readBoard(doc);
    const cleared = clearError ? { lastError: null } : {};
    clearError = false;
    // A waiting proposal is placed again when this tab changed the board, or boxes came or went:
    // either may have taken one of its spots. Not on every step of someone else's drag, or the
    // ghosts would jump around while you look at them.
    const replace = origin === mine || idsOf(board) !== idsOf(get().board);
    set({
      board,
      ...cleared,
      ...(replace ? { placements: null } : {}),
      ...undoState(),
      ...staleEditing(board, get()),
    });
  });

  /** Writes a board as this tab's change, as its own undo step. */
  const write = (next: Board, continuous: boolean) => {
    if (!continuous) history.stopCapturing();
    writeBoard(doc, get().board, next, mine);
    if (!continuous) history.stopCapturing();
  };

  /**
   * Commits a domain result: written to the document on success, an error on failure. Each action
   * is its own undo step; only `continuous` ones (the steps of a drag or a resize) merge within the
   * capture window. Without this, three boxes added in a second undid together.
   */
  const commit = (result: BoardResult, { continuous = false } = {}): boolean => {
    if (!result.ok) {
      set({ lastError: result.error });
      return false;
    }
    clearError = true;
    write(result.value, continuous);
    // Nothing changed (e.g. renamed to the same label): no read-back, clear it here.
    if (clearError) set({ lastError: null });
    clearError = false;
    return true;
  };

  return { history, undoState, write, commit };
};

export type Binding = ReturnType<typeof bindDocument>;
