import {
  addNode,
  addZone,
  applyOps,
  changeKind,
  connect,
  createNode,
  createZone,
  emptyBoard,
  moveNode,
  moveZone,
  ok,
  labelEdge,
  removeEdge,
  setEdgeMode,
  removeNode,
  removeZone,
  renameNode,
  renameZone,
  resizeZone,
  type Board,
  type BoardResult,
  type DomainError,
  type EdgeMode,
  type NodeKind,
  type Position,
  type Proposal,
  type ZoneSize,
} from '@designroom/domain';
import * as Y from 'yjs';
import { create } from 'zustand';
import { createId } from '../../../core/lib/ids.ts';
import { BOARD_MAPS, readBoard, writeBoard } from '../lib/boardDoc.ts';
import { withPlacements, type Placements } from '../lib/placement.ts';

// The board module's single source of client state (architecture §5.3). Actions delegate every
// rule to @designroom/domain, so the UI never re-implements them. Since M2 the board itself lives
// in a shared Yjs document (ADR-010): an action computes the next board with a domain op and
// writes the difference; every change to the document — this tab's or another's — is read back
// into `board`. Components didn't change. The proposal, placements and editing state stay local.

/** Moves within this long count as one undo step (a drag). */
const UNDO_CAPTURE_MS = 500;

export type BoardState = {
  board: Board;
  /** The AI's pending proposal, shown as ghost nodes until accepted or rejected. */
  proposal: Proposal | null;
  /** Why accepting the proposal failed (e.g. the board changed under it). */
  proposalError: string | null;
  /** Where the proposal's new nodes go, decided once by the canvas: ghost and Accept agree. */
  placements: Placements | null;
  /** The last editing action that was refused, for the UI to show. */
  lastError: DomainError | null;
  /** The node whose label is open for editing. Shared by the toolbar (new Custom node) and the node pod. */
  editingNodeId: string | null;
  /** The zone whose title is open for editing (a new zone opens like this). */
  editingZoneId: string | null;
  /** This tab has a change it can undo / redo (never another person's change). */
  canUndo: boolean;
  canRedo: boolean;
};

export type BoardActions = {
  /** Returns the new node's id, or null if refused. */
  addNode: (kind: NodeKind, position: Position) => string | null;
  removeNode: (id: string) => void;
  /** Returns the new edge's id, or null if refused (self-loop, duplicate…). */
  connect: (source: string, target: string) => string | null;
  removeEdge: (id: string) => void;
  /** Names an arrow ("HTTPS"); an empty label removes the name. */
  labelEdge: (id: string, label: string) => void;
  /** Sync (the caller waits) or async (queue, events: drawn dashed). */
  setEdgeMode: (id: string, mode: EdgeMode) => void;
  /**
   * Removes nodes (with their edges) and edges in one update — what the Delete key does to a
   * selection. Ids already gone (e.g. edges removed with their node) are skipped, not reported.
   */
  removeElements: (
    nodeIds: readonly string[],
    edgeIds: readonly string[],
    zoneIds?: readonly string[],
  ) => void;
  /** Adds a zone and opens its title for naming. Returns its id, or null if refused. */
  addZone: (position: Position, size: ZoneSize) => string | null;
  renameZone: (id: string, label: string) => void;
  resizeZone: (id: string, size: ZoneSize) => void;
  /** Moves the zone and everything inside it. */
  moveZone: (id: string, position: Position) => void;
  /** Opens a zone's title for editing; ignored for unknown ids. */
  startEditingZone: (id: string) => void;
  stopEditingZone: () => void;
  renameNode: (id: string, label: string) => void;
  changeKind: (id: string, kind: NodeKind) => void;
  moveNode: (id: string, position: Position) => void;
  setProposal: (proposal: Proposal) => void;
  /** Records where the pending proposal's new nodes go; ignored without a proposal. */
  placeProposal: (placements: Placements) => void;
  acceptProposal: () => void;
  rejectProposal: () => void;
  /** Opens a node's label for editing (one node at a time); ignored for unknown ids. */
  startEditing: (id: string) => void;
  stopEditing: () => void;
  /** Reverts this tab's last change (a drag counts as one); other people's changes stay. */
  undo: () => void;
  redo: () => void;
  /** What comes next is a new undo step, even within the drag window (e.g. at the end of a drag). */
  endUndoStep: () => void;
};

export type BoardStore = BoardState & BoardActions;

export type BoardStoreDeps = {
  /** Id generator; injected so tests are deterministic. */
  newId: () => string;
  initialBoard?: Board;
  /** The shared document (a room's, in the app); a private one when absent. */
  doc?: Y.Doc;
};

export const createBoardStore = ({
  newId,
  initialBoard = emptyBoard(),
  doc = new Y.Doc(),
}: BoardStoreDeps) =>
  create<BoardStore>()((set, get) => {
    /** Marks this tab's own writes: undo tracks only these. */
    const mine = Symbol('this tab');
    const maps = BOARD_MAPS.map((name) => doc.getMap(name));
    const history = new Y.UndoManager(maps, {
      trackedOrigins: new Set([mine]),
      captureTimeout: UNDO_CAPTURE_MS,
    });

    // A starting board (tests) is written as no one's change, and only into an empty document:
    // a room's board is never mixed with another.
    const empty = (b: Board) => b.nodes.length + b.edges.length + (b.zones?.length ?? 0) === 0;
    if (!empty(initialBoard) && empty(readBoard(doc))) writeBoard(doc, emptyBoard(), initialBoard);

    /** Which boxes and zones exist: when another tab only moves things, ghosts stay put. */
    const idsOf = (b: Board) =>
      [...b.nodes.map((n) => n.id), '|', ...(b.zones ?? []).map((z) => z.id)].join(',');

    const undoState = () => ({
      canUndo: history.undoStack.length > 0,
      canRedo: history.redoStack.length > 0,
    });
    // An undo whose target someone else deleted changes nothing in the document, but still moves
    // the stacks: keep the buttons in step with them.
    history.on('stack-item-added', () => set(undoState()));
    history.on('stack-item-popped', () => set(undoState()));

    /** A local change succeeded: its read-back also clears the last error, in the same update. */
    let clearError = false;

    // Every change to the document — this tab's, another tab's, an undo — is read back here.
    const refresh = (_update: Uint8Array, origin: unknown) => {
      const board = readBoard(doc);
      const { editingNodeId, editingZoneId } = get();
      const cleared = clearError ? { lastError: null } : {};
      clearError = false;
      // A waiting proposal is placed again when this tab changed the board, or boxes came or
      // went: either may have taken one of its spots. Not on every step of someone else's drag,
      // or the ghosts would jump around while you look at them.
      const replace = origin === mine || idsOf(board) !== idsOf(get().board);
      set({
        board,
        ...cleared,
        ...(replace ? { placements: null } : {}),
        ...undoState(),
        // Someone else deleted what this tab was editing.
        ...(editingNodeId && !board.nodes.some((n) => n.id === editingNodeId)
          ? { editingNodeId: null }
          : {}),
        ...(editingZoneId && !board.zones?.some((z) => z.id === editingZoneId)
          ? { editingZoneId: null }
          : {}),
      });
    };
    doc.on('update', refresh);

    /** Commits a domain result: written to the document on success, an error on failure. */
    const commit = (result: BoardResult): boolean => {
      if (result.ok) {
        clearError = true;
        writeBoard(doc, get().board, result.value, mine);
        // Nothing changed (e.g. renamed to the same label): no read-back, clear it here.
        if (clearError) set({ lastError: null });
        clearError = false;
        return true;
      }
      set({ lastError: result.error });
      return false;
    };

    return {
      board: readBoard(doc),
      proposal: null,
      proposalError: null,
      placements: null,
      lastError: null,
      editingNodeId: null,
      editingZoneId: null,
      canUndo: false,
      canRedo: false,

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
      labelEdge: (id, label) => {
        commit(labelEdge(get().board, id, label));
      },
      setEdgeMode: (id, mode) => {
        commit(setEdgeMode(get().board, id, mode));
      },
      removeEdge: (id) => {
        commit(removeEdge(get().board, id));
      },
      removeElements: (nodeIds, edgeIds, zoneIds = []) => {
        if (nodeIds.length === 0 && edgeIds.length === 0 && zoneIds.length === 0) return;
        // Ids already gone (an edge removed with its node, a stale selection) are skipped.
        let result: BoardResult = ok(get().board);
        for (const id of nodeIds) {
          if (result.ok && result.value.nodes.some((n) => n.id === id)) {
            result = removeNode(result.value, id);
          }
        }
        for (const id of edgeIds) {
          if (result.ok && result.value.edges.some((e) => e.id === id)) {
            result = removeEdge(result.value, id);
          }
        }
        for (const id of zoneIds) {
          if (result.ok && result.value.zones?.some((z) => z.id === id)) {
            result = removeZone(result.value, id);
          }
        }
        if (!commit(result)) return;
        const { editingNodeId } = get();
        if (editingNodeId !== null && nodeIds.includes(editingNodeId)) set({ editingNodeId: null });
      },
      addZone: (position, size) => {
        const id = newId();
        if (!commit(addZone(get().board, createZone(id, position, size)))) return null;
        set({ editingZoneId: id });
        return id;
      },
      renameZone: (id, label) => {
        commit(renameZone(get().board, id, label));
      },
      resizeZone: (id, size) => {
        commit(resizeZone(get().board, id, size));
      },
      moveZone: (id, position) => {
        commit(moveZone(get().board, id, position));
      },
      startEditingZone: (id) => {
        if (get().board.zones?.some((z) => z.id === id)) set({ editingZoneId: id });
      },
      stopEditingZone: () => set({ editingZoneId: null }),
      renameNode: (id, label) => {
        commit(renameNode(get().board, id, label));
      },
      changeKind: (id, kind) => {
        commit(changeKind(get().board, id, kind));
      },
      moveNode: (id, position) => {
        commit(moveNode(get().board, id, position));
      },

      setProposal: (proposal) =>
        set({ proposal, placements: null, proposalError: null, lastError: null }),
      placeProposal: (placements) => {
        if (get().proposal) set({ placements });
      },
      acceptProposal: () => {
        const { proposal, board, placements } = get();
        if (!proposal) return;
        const result = applyOps(board, proposal.ops, withPlacements(placements));
        if (result.ok) {
          history.stopCapturing(); // the proposal is its own undo step
          writeBoard(doc, board, result.value, mine);
          history.stopCapturing();
          set({
            proposal: null,
            placements: null,
            proposalError: null,
            lastError: null,
          });
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
      rejectProposal: () =>
        set({ proposal: null, placements: null, proposalError: null, lastError: null }),

      startEditing: (id) => {
        if (get().board.nodes.some((n) => n.id === id)) set({ editingNodeId: id });
      },
      stopEditing: () => set({ editingNodeId: null }),

      // Yjs drops a step whose target is gone without any event: read the stacks after each call.
      undo: () => {
        history.undo();
        set(undoState());
      },
      redo: () => {
        history.redo();
        set(undoState());
      },
      endUndoStep: () => history.stopCapturing(),
    };
  });

/** The app's shared board document: the room module connects it to the server (M2-05). */
export const boardDocument = new Y.Doc();

/** The app's board store. */
export const useBoardStore = createBoardStore({ newId: createId, doc: boardDocument });
