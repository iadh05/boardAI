import type { Proposal } from '@designroom/domain';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBoardStore } from './boardStore.ts';

// Each test gets its own store (no shared state to reset) with predictable ids.
const setup = () => {
  let next = 0;
  const store = createBoardStore({ newId: () => `id${++next}` });
  return { store, state: () => store.getState() };
};

let store: ReturnType<typeof setup>['store'];
let state: ReturnType<typeof setup>['state'];

beforeEach(() => {
  ({ store, state } = setup());
});

/** api → db on the board, ids "api"/"db"-like via the id generator. */
const seedApiAndDb = () => {
  const api = state().addNode('api', { x: 0, y: 0 });
  const db = state().addNode('database', { x: 240, y: 0 });
  if (!api || !db) throw new Error('seed failed');
  return { api, db };
};

describe('boardStore — editing', () => {
  it('starts with an empty board and no proposal', () => {
    expect(state().board).toEqual({ nodes: [], edges: [] });
    expect(state().proposal).toBeNull();
    expect(state().lastError).toBeNull();
  });

  it('addNode adds a node with a generated id and returns that id', () => {
    const id = state().addNode('cache', { x: 10, y: 20 });

    expect(id).toBe('id1');
    expect(state().board.nodes).toEqual([
      { id: 'id1', kind: 'cache', label: 'Cache', position: { x: 10, y: 20 } },
    ]);
  });

  it('connect links two nodes and returns the edge id', () => {
    const { api, db } = seedApiAndDb();

    const edgeId = state().connect(api, db);

    expect(state().board.edges).toEqual([{ id: edgeId, source: api, target: db }]);
  });

  it('removeNode removes the node and its edges', () => {
    const { api, db } = seedApiAndDb();
    state().connect(api, db);

    state().removeNode(api);

    expect(state().board.nodes.map((n) => n.id)).toEqual([db]);
    expect(state().board.edges).toEqual([]);
  });

  it('removeEdge removes only the edge', () => {
    const { api, db } = seedApiAndDb();
    const edgeId = state().connect(api, db);
    if (!edgeId) throw new Error('connect failed');

    state().removeEdge(edgeId);

    expect(state().board.edges).toEqual([]);
    expect(state().board.nodes).toHaveLength(2);
  });

  it('renameNode, changeKind and moveNode update the node', () => {
    const { db } = seedApiAndDb();

    state().renameNode(db, 'Orders DB');
    state().changeKind(db, 'storage');
    state().moveNode(db, { x: 5, y: 6 });

    expect(state().board.nodes.find((n) => n.id === db)).toEqual({
      id: db,
      kind: 'storage',
      label: 'Orders DB',
      position: { x: 5, y: 6 },
    });
  });

  it('a failing domain op leaves the board unchanged and records the error', () => {
    const { api } = seedApiAndDb();
    const before = state().board;

    const edgeId = state().connect(api, api); // self-loop

    expect(edgeId).toBeNull();
    expect(state().board).toBe(before); // same object: nothing changed
    expect(state().lastError?.code).toBe('SELF_LOOP');
  });

  it('a successful action clears the previous error', () => {
    const { api, db } = seedApiAndDb();
    state().connect(api, api);

    state().connect(api, db);

    expect(state().lastError).toBeNull();
  });
});

describe('boardStore — proposals', () => {
  const proposalFor = (apiId: string): Proposal => ({
    id: 'p1',
    summary: 'Add a cache in front of the database',
    ops: [
      { op: 'addNode', nodeId: 'cache', kind: 'cache', label: 'Redis', near: apiId },
      { op: 'connect', edgeId: 'e-cache', source: apiId, target: 'cache' },
    ],
  });

  it('accepting puts each new node exactly where it was placed (where its ghost was)', () => {
    const { api } = seedApiAndDb();
    state().setProposal(proposalFor(api));

    state().placeProposal({ cache: { x: 640, y: 320 } });
    state().acceptProposal();

    expect(state().board.nodes.find((n) => n.id === 'cache')?.position).toEqual({ x: 640, y: 320 });
  });

  it('a board change while a proposal waits asks for it to be placed again (its spot may be taken)', () => {
    const { api } = seedApiAndDb();
    state().setProposal(proposalFor(api));
    state().placeProposal({ cache: { x: 640, y: 320 } });

    state().addNode('queue', { x: 640, y: 320 }); // right where the cache would go

    expect(state().placements).toBeNull();
  });

  it('a new proposal starts unplaced; placing without a proposal does nothing', () => {
    const { api } = seedApiAndDb();
    state().placeProposal({ cache: { x: 1, y: 1 } });
    expect(state().placements).toBeNull();

    state().setProposal(proposalFor(api));
    state().placeProposal({ cache: { x: 640, y: 320 } });
    state().setProposal({ ...proposalFor(api), id: 'p2' });

    expect(state().placements).toBeNull();
  });

  it('setProposal stores it without touching the board', () => {
    const { api } = seedApiAndDb();
    const before = state().board;

    state().setProposal(proposalFor(api));

    expect(state().proposal?.id).toBe('p1');
    expect(state().board).toBe(before);
  });

  it('acceptProposal applies all its operations and clears it', () => {
    const { api } = seedApiAndDb();
    state().setProposal(proposalFor(api));

    state().acceptProposal();

    expect(state().board.nodes.find((n) => n.id === 'cache')?.label).toBe('Redis');
    expect(state().board.edges).toContainEqual({ id: 'e-cache', source: api, target: 'cache' });
    expect(state().proposal).toBeNull();
    expect(state().proposalError).toBeNull();
  });

  it('acceptProposal when the board changed under it: nothing applied, proposalError set', () => {
    const { api } = seedApiAndDb();
    state().setProposal(proposalFor(api));
    state().removeNode(api); // the proposal's "near" and "source" node is gone
    const before = state().board;

    state().acceptProposal();

    expect(state().board).toBe(before);
    expect(state().proposal?.id).toBe('p1'); // still visible, so the user sees what failed
    expect(state().proposalError).toMatch(/out of date/i);
  });

  it('rejectProposal clears the proposal and its error', () => {
    const { api } = seedApiAndDb();
    state().setProposal(proposalFor(api));
    state().removeNode(api);
    state().acceptProposal();

    state().rejectProposal();

    expect(state().proposal).toBeNull();
    expect(state().proposalError).toBeNull();
  });

  it('a new proposal replaces the old one and clears its error', () => {
    const { api } = seedApiAndDb();
    state().setProposal(proposalFor(api));
    state().removeNode(api);
    state().acceptProposal();

    state().setProposal({ ...proposalFor('db-gone'), id: 'p2' });

    expect(state().proposal?.id).toBe('p2');
    expect(state().proposalError).toBeNull();
  });

  it('calls a proposal the model got wrong "invalid", not "out of date"', () => {
    const { api } = seedApiAndDb();
    // Reuses an existing node id: this could never have applied.
    state().setProposal({
      id: 'p1',
      summary: 'Add a database',
      ops: [{ op: 'addNode', nodeId: api, kind: 'database', label: 'DB' }],
    });

    state().acceptProposal();

    expect(state().proposalError).toMatch(/can't be applied/i);
    expect(state().proposalError).not.toMatch(/out of date/i);
  });

  it('proposal actions clear a stale editing error', () => {
    const { api } = seedApiAndDb();
    state().connect(api, api); // refused → lastError set
    state().setProposal(proposalFor(api));

    state().acceptProposal();

    expect(state().lastError).toBeNull();
  });

  it('acceptProposal without a proposal does nothing', () => {
    const before = state().board;
    state().acceptProposal();
    expect(state().board).toBe(before);
  });
});

describe('boardStore — removeElements (what the Delete key removes)', () => {
  it('removes nodes with their edges, and edges, in one update', () => {
    const { api, db } = seedApiAndDb();
    const cache = state().addNode('cache', { x: 0, y: 120 });
    if (!cache) throw new Error('seed failed');
    const apiToDb = state().connect(api, db);
    const apiToCache = state().connect(api, cache);
    let updates = 0;
    const unsubscribe = store.subscribe(() => updates++);

    state().removeElements([db], [apiToCache ?? '']);

    unsubscribe();
    expect(state().board.nodes.map((n) => n.id)).toEqual([api, cache]);
    expect(state().board.edges).toEqual([]);
    expect(apiToDb).not.toBeNull();
    expect(updates).toBe(1);
  });

  it('skips edges already removed with their node — no error', () => {
    const { api, db } = seedApiAndDb();
    const edge = state().connect(api, db);

    // React Flow lists a deleted node's edges too.
    state().removeElements([db], [edge ?? '']);

    expect(state().board.edges).toEqual([]);
    expect(state().lastError).toBeNull();
  });

  it('skips nodes that are already gone, and still removes the rest', () => {
    const { api, db } = seedApiAndDb();

    state().removeElements(['gone', db], []);

    expect(state().board.nodes.map((n) => n.id)).toEqual([api]);
    expect(state().lastError).toBeNull();
  });

  it('ends label editing when the edited node is removed', () => {
    const { api } = seedApiAndDb();
    state().startEditing(api);
    state().removeElements([api], []);
    expect(state().editingNodeId).toBeNull();
  });

  it('does nothing for an empty selection', () => {
    seedApiAndDb();
    const before = state().board;
    state().removeElements([], []);
    expect(state().board).toBe(before);
  });
});

describe('boardStore — arrow label and mode', () => {
  it('labels an arrow and makes it async', () => {
    const { api, db } = seedApiAndDb();
    const edge = state().connect(api, db) ?? '';

    state().labelEdge(edge, 'events');
    state().setEdgeMode(edge, 'async');

    expect(state().board.edges[0]).toMatchObject({ label: 'events', mode: 'async' });
  });

  it('records a refused label as the last error', () => {
    const { api, db } = seedApiAndDb();
    const edge = state().connect(api, db) ?? '';

    state().labelEdge(edge, 'x'.repeat(41));

    expect(state().lastError?.code).toBe('INVALID_LABEL');
    expect(state().board.edges[0]).not.toHaveProperty('label');
  });
});

describe('boardStore — zones', () => {
  it('adds a zone (opened for naming), renames, resizes and moves it with what is inside', () => {
    const api = state().addNode('api', { x: 40, y: 60 }) ?? '';
    const zone = state().addZone({ x: 0, y: 0 }, { width: 600, height: 300 }) ?? '';
    expect(state().editingZoneId).toBe(zone);

    state().renameZone(zone, 'VPC');
    state().stopEditingZone();
    state().resizeZone(zone, { width: 640, height: 320 });
    state().moveZone(zone, { x: 100, y: 0 });

    expect(state().board.zones).toEqual([
      { id: zone, label: 'VPC', position: { x: 100, y: 0 }, size: { width: 640, height: 320 } },
    ]);
    expect(state().board.nodes.find((n) => n.id === api)?.position).toEqual({ x: 140, y: 60 });
    expect(state().editingZoneId).toBeNull();
  });

  it('startEditingZone opens a known zone, and ignores unknown ids', () => {
    const zone = state().addZone({ x: 0, y: 0 }, { width: 600, height: 300 }) ?? '';
    state().stopEditingZone();

    state().startEditingZone('nope');
    expect(state().editingZoneId).toBeNull();
    state().startEditingZone(zone);
    expect(state().editingZoneId).toBe(zone);
  });

  it('removeElements removes zones too, keeping their boxes', () => {
    const api = state().addNode('api', { x: 40, y: 60 }) ?? '';
    const zone = state().addZone({ x: 0, y: 0 }, { width: 600, height: 300 }) ?? '';

    state().removeElements([], [], [zone]);

    expect(state().board.zones).toEqual([]);
    expect(state().board.nodes.map((n) => n.id)).toEqual([api]);
  });
});

describe('boardStore — label editing', () => {
  it('nobody is editing at first', () => {
    expect(state().editingNodeId).toBeNull();
  });

  it('startEditing marks one node as being edited; stopEditing ends it', () => {
    const { api } = seedApiAndDb();

    state().startEditing(api);
    expect(state().editingNodeId).toBe(api);

    state().stopEditing();
    expect(state().editingNodeId).toBeNull();
  });

  it('only one node is edited at a time', () => {
    const { api, db } = seedApiAndDb();
    state().startEditing(api);
    state().startEditing(db);
    expect(state().editingNodeId).toBe(db);
  });

  it('ignores startEditing for a node that does not exist', () => {
    state().startEditing('ghost');
    expect(state().editingNodeId).toBeNull();
  });

  it('removing the edited node ends the editing', () => {
    const { api } = seedApiAndDb();
    state().startEditing(api);
    state().removeNode(api);
    expect(state().editingNodeId).toBeNull();
  });
});

it('works as a React hook: a component re-renders when its slice changes', () => {
  const { result } = renderHook(() => store((s) => s.board.nodes.length));
  expect(result.current).toBe(0);

  act(() => {
    state().addNode('api', { x: 0, y: 0 });
  });

  expect(result.current).toBe(1);
});
