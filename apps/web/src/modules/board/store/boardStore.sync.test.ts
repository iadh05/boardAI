import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createBoardStore } from './boardStore.ts';

// M2-03: the store reads and writes a shared Yjs document. Two stores on two docs, linked like two
// tabs through a server: every update one makes is applied to the other.

const linkedStores = () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  // Updates that came from the other doc carry this origin, so they aren't sent back.
  const REMOTE = Symbol('remote');
  docA.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(docB, u, REMOTE);
  });
  docB.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(docA, u, REMOTE);
  });
  let n = 0;
  const a = createBoardStore({ newId: () => `a${++n}`, doc: docA });
  const b = createBoardStore({ newId: () => `b${++n}`, doc: docB });
  return { a: a.getState, b: b.getState };
};

describe('board store on a shared document (M2-03)', () => {
  it('a change made in one tab appears in the other', () => {
    const { a, b } = linkedStores();
    const id = a().addNode('api', { x: 0, y: 0 });
    expect(b().board.nodes.map((n) => n.id)).toEqual([id]);

    b().renameNode(id ?? '', 'Orders API');
    expect(a().board.nodes[0]?.label).toBe('Orders API');
  });

  it('a box deleted in the other tab closes its label editor here', () => {
    const { a, b } = linkedStores();
    const id = a().addNode('api', { x: 0, y: 0 }) ?? '';
    a().startEditing(id);
    b().removeNode(id);
    expect(a().editingNodeId).toBeNull();
  });

  it('ghosts stay put while another tab only moves boxes; re-placed when boxes come or go', () => {
    const { a, b } = linkedStores();
    const id = a().addNode('api', { x: 0, y: 0 }) ?? '';
    a().setProposal({ id: 'p1', summary: 'Add cache', ops: [] });
    a().placeProposal({ n9: { x: 300, y: 0 } });

    b().moveNode(id, { x: 50, y: 50 });
    expect(a().placements).toEqual({ n9: { x: 300, y: 0 } });

    b().addNode('database', { x: 600, y: 0 });
    expect(a().placements).toBeNull();
  });

  it('the AI proposal stays in the tab that asked for it', () => {
    const { a, b } = linkedStores();
    a().setProposal({ id: 'p1', summary: 'Add cache', ops: [] });
    expect(b().proposal).toBeNull();
  });
});

describe('undo / redo — your own changes only (M2-03)', () => {
  it('undo reverts this tab’s last change; redo puts it back', () => {
    const { a } = linkedStores();
    const id = a().addNode('api', { x: 0, y: 0 }) ?? '';
    a().endUndoStep();
    a().renameNode(id, 'Orders API');

    a().undo();
    expect(a().board.nodes[0]?.label).toBe('API');
    a().redo();
    expect(a().board.nodes[0]?.label).toBe('Orders API');
  });

  it('never undoes a change made in the other tab', () => {
    const { a, b } = linkedStores();
    const id = a().addNode('api', { x: 0, y: 0 }) ?? '';
    b().renameNode(id, 'Changed in B');

    a().undo(); // undoes A's add only
    expect(b().board.nodes).toEqual([]);
    b().undo(); // B's own rename has nothing left to apply to: no error
    expect(a().board.nodes).toEqual([]);
    expect(b().canUndo).toBe(false); // the button follows the stack, even when nothing changed
  });

  it('separate actions are separate undo steps, however fast they come (found by hand, M2)', () => {
    const { a } = linkedStores();
    a().addNode('client', { x: 0, y: 0 });
    a().addNode('api', { x: 300, y: 0 }); // within the drag window of the first
    a().addNode('database', { x: 600, y: 0 });

    a().undo();
    expect(a().board.nodes.map((n) => n.kind)).toEqual(['client', 'api']);
  });

  it('a drag (many moves in a row) is one undo step', () => {
    const { a } = linkedStores();
    const id = a().addNode('api', { x: 0, y: 0 }) ?? '';
    a().endUndoStep();
    for (let x = 1; x <= 20; x++) a().moveNode(id, { x: x * 10, y: 0 });

    a().undo();
    expect(a().board.nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('says whether there is something to undo or redo', () => {
    const { a } = linkedStores();
    expect([a().canUndo, a().canRedo]).toEqual([false, false]);
    a().addNode('api', { x: 0, y: 0 });
    expect([a().canUndo, a().canRedo]).toEqual([true, false]);
    a().undo();
    expect([a().canUndo, a().canRedo]).toEqual([false, true]);
  });

  it('accepting a proposal is one undo step of its own', () => {
    const { a } = linkedStores();
    const api = a().addNode('api', { x: 0, y: 0 }) ?? '';
    a().setProposal({
      id: 'p1',
      summary: 'Add cache',
      ops: [
        { op: 'addNode', nodeId: 'n9', kind: 'cache', label: 'Cache' },
        { op: 'connect', edgeId: 'e9', source: api, target: 'n9' },
      ],
    });
    a().acceptProposal();
    expect(a().board.nodes).toHaveLength(2);

    a().undo();
    expect(a().board.nodes.map((n) => n.id)).toEqual([api]);
    expect(a().board.edges).toEqual([]);
  });
});
