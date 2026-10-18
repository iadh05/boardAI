import {
  addNode,
  applyOps,
  changeKind,
  connect,
  createNode,
  emptyBoard,
  moveNode,
  removeEdge,
  removeNode,
  renameNode,
  type Board,
  type BoardResult,
  type DomainError,
  type NodeKind,
  type Position,
  type Proposal,
} from '@designroom/domain';
import { create } from 'zustand';
import { createId } from '../../../core/lib/ids.ts';

// The board module's single source of client state (architecture §5.3). Actions delegate every
// rule to @designroom/domain, so the UI never re-implements them. In M2 the same actions will
// write to a Yjs document instead — components won't notice.

export type BoardState = {
  board: Board;
  /** The AI's pending proposal, shown as ghost nodes until accepted or rejected. */
  proposal: Proposal | null;
  /** Why accepting the proposal failed (e.g. the board changed under it). */
  proposalError: string | null;
  /** The last editing action that was refused, for the UI to show. */
  lastError: DomainError | null;
  /** The node whose label is open for editing. Shared by the toolbar (new Custom node) and the node pod. */
  editingNodeId: string | null;
};

export type BoardActions = {
  /** Returns the new node's id, or null if refused. */
  addNode: (kind: NodeKind, position: Position) => string | null;
  removeNode: (id: string) => void;
  /** Returns the new edge's id, or null if refused (self-loop, duplicate…). */
  connect: (source: string, target: string) => string | null;
  removeEdge: (id: string) => void;
  renameNode: (id: string, label: string) => void;
  changeKind: (id: string, kind: NodeKind) => void;
  moveNode: (id: string, position: Position) => void;
  setProposal: (proposal: Proposal) => void;
  acceptProposal: () => void;
  rejectProposal: () => void;
  /** Opens a node's label for editing (one node at a time); ignored for unknown ids. */
  startEditing: (id: string) => void;
  stopEditing: () => void;
};

export type BoardStore = BoardState & BoardActions;

export type BoardStoreDeps = {
  /** Id generator; injected so tests are deterministic. */
  newId: () => string;
  initialBoard?: Board;
};

export const createBoardStore = ({ newId, initialBoard = emptyBoard() }: BoardStoreDeps) =>
  create<BoardStore>()((set, get) => {
    /** Commits a domain result: new board on success, unchanged board + error on failure. */
    const commit = (result: BoardResult): boolean => {
      if (result.ok) {
        set({ board: result.value, lastError: null });
        return true;
      }
      set({ lastError: result.error });
      return false;
    };

    return {
      board: initialBoard,
      proposal: null,
      proposalError: null,
      lastError: null,
      editingNodeId: null,

      addNode: (kind, position) => {
        const id = newId();
        return commit(addNode(get().board, createNode(id, kind, position))) ? id : null;
      },
      removeNode: (id) => {
        if (commit(removeNode(get().board, id)) && get().editingNodeId === id) {
          set({ editingNodeId: null });
        }
      },
      connect: (source, target) => {
        const id = newId();
        return commit(connect(get().board, id, source, target)) ? id : null;
      },
      removeEdge: (id) => {
        commit(removeEdge(get().board, id));
      },
      renameNode: (id, label) => {
        commit(renameNode(get().board, id, label));
      },
      changeKind: (id, kind) => {
        commit(changeKind(get().board, id, kind));
      },
      moveNode: (id, position) => {
        commit(moveNode(get().board, id, position));
      },

      setProposal: (proposal) => set({ proposal, proposalError: null, lastError: null }),
      acceptProposal: () => {
        const { proposal, board } = get();
        if (!proposal) return;
        const result = applyOps(board, proposal.ops);
        if (result.ok) {
          set({ board: result.value, proposal: null, proposalError: null, lastError: null });
          return;
        }
        // Keep the proposal visible so the user sees what couldn't be applied. Missing nodes or
        // edges mean the board changed since the proposal; anything else, the proposal was wrong.
        const outOfDate = ['NODE_NOT_FOUND', 'EDGE_NOT_FOUND', 'DUPLICATE_EDGE'].includes(
          result.error.code,
        );
        set({
          proposalError: outOfDate
            ? `This proposal is out of date: ${result.error.message}`
            : `This proposal can't be applied: ${result.error.message}`,
          lastError: null,
        });
      },
      rejectProposal: () => set({ proposal: null, proposalError: null, lastError: null }),

      startEditing: (id) => {
        if (get().board.nodes.some((n) => n.id === id)) set({ editingNodeId: id });
      },
      stopEditing: () => set({ editingNodeId: null }),
    };
  });

/** The app's board store. */
export const useBoardStore = createBoardStore({ newId: createId });
