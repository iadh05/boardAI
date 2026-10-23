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
import { readBoard } from '../lib/boardDoc.ts';
import { withPlacements, type Placements } from '../lib/placement.ts';
import { bindDocument, type Binding, type Get, type Set } from './documentBinding.ts';

// The board module's single source of client state (architecture §5.3). Actions delegate every
// rule to @designroom/domain, so the UI never re-implements them. Since M2 the board itself lives
// in a shared Yjs document (ADR-010): an action computes the next board with a domain op and
// writes the difference; every change to the document — this tab's or another's — is read back
// into `board`. Components didn't change. The proposal, placements and editing state stay local.

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

/** Removes what still exists of the given boxes, arrows and zones (ids already gone are skipped). */
const removeAll = (
  board: Board,
  nodeIds: readonly string[],
  edgeIds: readonly string[],
  zoneIds: readonly string[],
): BoardResult => {
  let result: BoardResult = ok(board);
  for (const id of nodeIds)
    if (result.ok && result.value.nodes.some((n) => n.id === id))
      result = removeNode(result.value, id);
  for (const id of edgeIds)
    if (result.ok && result.value.edges.some((e) => e.id === id))
      result = removeEdge(result.value, id);
  for (const id of zoneIds)
    if (result.ok && result.value.zones?.some((z) => z.id === id))
      result = removeZone(result.value, id);
  return result;
};

type BoxAndArrowActions = Pick<
  BoardActions,
  | 'addNode'
  | 'removeNode'
  | 'connect'
  | 'labelEdge'
  | 'setEdgeMode'
  | 'removeEdge'
  | 'removeElements'
  | 'renameNode'
  | 'changeKind'
  | 'moveNode'
  | 'startEditing'
  | 'stopEditing'
>;

const boxAndArrowActions = (
  newId: () => string,
  set: Set,
  get: Get,
  { commit }: Binding,
): BoxAndArrowActions => ({
  addNode: (kind, position) => {
    const id = newId();
    return commit(addNode(get().board, createNode(id, kind, position))) ? id : null;
  },
  removeNode: (id) => {
    if (commit(removeNode(get().board, id)) && get().editingNodeId === id)
      set({ editingNodeId: null });
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
    if (!commit(removeAll(get().board, nodeIds, edgeIds, zoneIds))) return;
    const { editingNodeId } = get();
    if (editingNodeId !== null && nodeIds.includes(editingNodeId)) set({ editingNodeId: null });
  },
  renameNode: (id, label) => {
    commit(renameNode(get().board, id, label));
  },
  changeKind: (id, kind) => {
    commit(changeKind(get().board, id, kind));
  },
  moveNode: (id, position) => {
    commit(moveNode(get().board, id, position), { continuous: true });
  },
  startEditing: (id) => {
    if (get().board.nodes.some((n) => n.id === id)) set({ editingNodeId: id });
  },
  stopEditing: () => set({ editingNodeId: null }),
});

type ZoneActions = Pick<
  BoardActions,
  'addZone' | 'renameZone' | 'resizeZone' | 'moveZone' | 'startEditingZone' | 'stopEditingZone'
>;

const zoneActions = (
  newId: () => string,
  set: Set,
  get: Get,
  { commit }: Binding,
): ZoneActions => ({
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
    commit(resizeZone(get().board, id, size), { continuous: true });
  },
  moveZone: (id, position) => {
    commit(moveZone(get().board, id, position), { continuous: true });
  },
  startEditingZone: (id) => {
    if (get().board.zones?.some((z) => z.id === id)) set({ editingZoneId: id });
  },
  stopEditingZone: () => set({ editingZoneId: null }),
});

/** Missing boxes or arrows mean the board changed since the proposal; anything else, it was wrong. */
const proposalErrorText = (error: DomainError) =>
  ['NODE_NOT_FOUND', 'EDGE_NOT_FOUND', 'DUPLICATE_EDGE'].includes(error.code)
    ? `This proposal is out of date: ${error.message}`
    : `This proposal can't be applied: ${error.message}`;

const NO_PROPOSAL = { proposal: null, placements: null, proposalError: null, lastError: null };

type ProposalActions = Pick<
  BoardActions,
  'setProposal' | 'placeProposal' | 'acceptProposal' | 'rejectProposal'
>;

const proposalActions = (set: Set, get: Get, { write }: Binding): ProposalActions => ({
  setProposal: (proposal) =>
    set({ proposal, placements: null, proposalError: null, lastError: null }),
  placeProposal: (placements) => {
    if (get().proposal) set({ placements });
  },
  acceptProposal: () => {
    const { proposal, board, placements } = get();
    if (!proposal) return;
    const result = applyOps(board, proposal.ops, withPlacements(placements));
    if (!result.ok) {
      // Kept visible, so the user sees what couldn't be applied.
      set({ proposalError: proposalErrorText(result.error), lastError: null });
      return;
    }
    write(result.value, false); // the proposal is its own undo step
    set(NO_PROPOSAL);
  },
  rejectProposal: () => set(NO_PROPOSAL),
});

const undoActions = (
  set: Set,
  { history, undoState }: Binding,
): Pick<BoardActions, 'undo' | 'redo' | 'endUndoStep'> => ({
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
});

export const createBoardStore = ({
  newId,
  initialBoard = emptyBoard(),
  doc = new Y.Doc(),
}: BoardStoreDeps) =>
  create<BoardStore>()((set, get) => {
    const binding = bindDocument(doc, initialBoard, set, get);
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
      ...boxAndArrowActions(newId, set, get, binding),
      ...zoneActions(newId, set, get, binding),
      ...proposalActions(set, get, binding),
      ...undoActions(set, binding),
    };
  });

/** The app's shared board document: the room module connects it to the server (M2-05). */
export const boardDocument = new Y.Doc();

/** The app's board store. */
export const useBoardStore = createBoardStore({ newId: createId, doc: boardDocument });
