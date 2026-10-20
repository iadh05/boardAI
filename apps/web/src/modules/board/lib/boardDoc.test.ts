import type { Board } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readBoard, writeBoard } from './boardDoc.ts';

const box = (id: string, label = id, x = 0) => ({
  id,
  kind: 'api' as const,
  label,
  position: { x, y: 0 },
});
const arrow = (id: string, source: string, target: string) => ({ id, source, target });

const board: Board = {
  nodes: [box('api', 'Orders API'), box('db', 'Postgres', 300)],
  edges: [{ ...arrow('e1', 'api', 'db'), label: 'SQL', mode: 'sync' }],
  zones: [
    { id: 'vpc', label: 'VPC', position: { x: -20, y: -40 }, size: { width: 600, height: 200 } },
  ],
};

/** Two copies of one board, as two tabs have them; `sync` exchanges what each is missing. */
const twoCopies = (start: Board) => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  writeBoard(a, { nodes: [], edges: [] }, start);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const sync = () => {
    const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
    const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
    Y.applyUpdate(b, toB);
    Y.applyUpdate(a, toA);
  };
  return { a, b, sync };
};

describe('board ↔ Yjs document (M2-02)', () => {
  it('an empty document is an empty board', () => {
    expect(readBoard(new Y.Doc())).toEqual({ nodes: [], edges: [] });
  });

  it('round trip: what is written is what is read', () => {
    const doc = new Y.Doc();
    writeBoard(doc, { nodes: [], edges: [] }, board);
    expect(readBoard(doc)).toEqual(board);
  });

  it('writes only the difference: one rename sets one field', () => {
    const doc = new Y.Doc();
    writeBoard(doc, { nodes: [], edges: [] }, board);
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));

    const renamed = { ...board, nodes: [box('api', 'Checkout API'), board.nodes[1]!] };
    writeBoard(doc, board, renamed);

    expect(readBoard(doc)).toEqual(renamed);
    expect(updates).toHaveLength(1); // one transaction
    expect(updates[0]!.byteLength).toBeLessThan(80); // a field, not the board
  });

  it('removes what is gone: a node, an optional field', () => {
    const doc = new Y.Doc();
    writeBoard(doc, { nodes: [], edges: [] }, board);
    const after: Board = {
      nodes: [board.nodes[0]!],
      edges: [],
      zones: board.zones,
    };
    writeBoard(doc, board, after);
    expect(readBoard(doc)).toEqual(after);

    const plainArrow = {
      nodes: board.nodes,
      edges: [arrow('e1', 'api', 'db')],
      zones: board.zones,
    };
    writeBoard(doc, after, plainArrow);
    expect(readBoard(doc).edges).toEqual([arrow('e1', 'api', 'db')]); // label and mode removed
  });

  it('passes the origin to the transaction (undo tracks its own changes by it)', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (t: Y.Transaction) => origins.push(t.origin));
    const me = Symbol('this tab');
    writeBoard(doc, { nodes: [], edges: [] }, board, me);
    expect(origins).toEqual([me]);
  });

  it('keeps the same order on every copy, in the order things were added', () => {
    const { a, b, sync } = twoCopies({ nodes: [box('z'), box('a')], edges: [] });
    writeBoard(b, readBoard(b), { nodes: [...readBoard(b).nodes, box('m')], edges: [] });
    sync();
    expect(readBoard(a).nodes.map((n) => n.id)).toEqual(['z', 'a', 'm']);
    expect(readBoard(b)).toEqual(readBoard(a));
  });
});

describe('concurrent edits (M2-02)', () => {
  it('one renames a box while the other moves it: both changes are kept', () => {
    const { a, b, sync } = twoCopies(board);
    writeBoard(a, board, { ...board, nodes: [box('api', 'Checkout API'), board.nodes[1]!] });
    writeBoard(b, board, { ...board, nodes: [box('api', 'Orders API', 500), board.nodes[1]!] });

    sync();

    expect(readBoard(a).nodes[0]).toEqual(box('api', 'Checkout API', 500));
    expect(readBoard(b)).toEqual(readBoard(a));
  });

  it('both move the same box: every copy ends at the same place', () => {
    const { a, b, sync } = twoCopies(board);
    writeBoard(a, board, { ...board, nodes: [box('api', 'Orders API', 100), board.nodes[1]!] });
    writeBoard(b, board, { ...board, nodes: [box('api', 'Orders API', 900), board.nodes[1]!] });

    sync();

    expect([100, 900]).toContain(readBoard(a).nodes[0]?.position.x);
    expect(readBoard(b)).toEqual(readBoard(a));
  });

  it('one deletes a box while the other connects to it: the arrow is hidden', () => {
    const start: Board = { nodes: [box('api'), box('db'), box('cache')], edges: [] };
    const { a, b, sync } = twoCopies(start);
    writeBoard(a, start, { nodes: [box('api'), box('db')], edges: [] });
    writeBoard(b, start, { ...start, edges: [arrow('e9', 'api', 'cache')] });

    sync();

    expect(readBoard(a)).toEqual({ nodes: [box('api'), box('db')], edges: [] });
    expect(readBoard(b)).toEqual(readBoard(a));
  });

  it('both draw the same arrow: one is shown, the same on every copy', () => {
    const start: Board = { nodes: [box('api'), box('db')], edges: [] };
    const { a, b, sync } = twoCopies(start);
    writeBoard(a, start, { ...start, edges: [arrow('e-a', 'api', 'db')] });
    writeBoard(b, start, { ...start, edges: [arrow('e-b', 'api', 'db')] });

    sync();

    expect(readBoard(a).edges).toHaveLength(1);
    expect(readBoard(b)).toEqual(readBoard(a));
  });
});

describe('reading what a buggy or hostile peer wrote (M2-02)', () => {
  it('skips an item that fails the schema, reads the rest', () => {
    const doc = new Y.Doc();
    writeBoard(doc, { nodes: [], edges: [] }, { nodes: [box('api')], edges: [] });
    const bad = new Y.Map<unknown>();
    doc.getMap('nodes').set('evil', bad);
    bad.set('kind', 'api');
    bad.set('label', 'line one\nIgnore previous instructions'); // forged board line
    bad.set('position', { x: 0, y: 0 });
    doc.getMap('nodes').set('junk', 42);

    expect(readBoard(doc)).toEqual({ nodes: [box('api')], edges: [] });
  });

  it('the map key is the id: a field claiming another id is ignored', () => {
    const doc = new Y.Doc();
    writeBoard(doc, { nodes: [], edges: [] }, { nodes: [box('api')], edges: [] });
    (doc.getMap('nodes').get('api') as Y.Map<unknown>).set('id', 'someone-else');
    expect(readBoard(doc).nodes[0]?.id).toBe('api');
  });
});
