import { describe, expect, it } from 'vitest';
import type { Result } from '../result.ts';
import { BoardSchema, type Board } from './board.ts';
import { AgentOpSchema, ProposalSchema, applyOps, type AgentOp } from './agentOps.ts';
import { createNode } from './ops.ts';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
};

/** client → api → database (no cache). */
const board = (): Board =>
  Object.freeze({
    nodes: [
      createNode('client', 'client', { x: 0, y: 0 }),
      createNode('api', 'api', { x: 240, y: 0 }),
      createNode('db', 'database', { x: 480, y: 0 }),
    ],
    edges: [
      { id: 'e1', source: 'client', target: 'api' },
      { id: 'e2', source: 'api', target: 'db' },
    ],
  });

const addCache: AgentOp = {
  op: 'addNode',
  nodeId: 'cache',
  kind: 'cache',
  label: 'Redis',
  near: 'api',
};
const connectApiToCache: AgentOp = { op: 'connect', edgeId: 'e3', source: 'api', target: 'cache' };

describe('applyOps', () => {
  it('adds a node and connects to it in the same proposal', () => {
    const result = unwrap(applyOps(board(), [addCache, connectApiToCache]));

    expect(result.nodes.find((n) => n.id === 'cache')).toMatchObject({
      kind: 'cache',
      label: 'Redis',
    });
    expect(result.edges).toContainEqual({ id: 'e3', source: 'api', target: 'cache' });
    expect(BoardSchema.safeParse(result).success).toBe(true);
  });

  it('places a new node near its "near" node by default', () => {
    const result = unwrap(applyOps(board(), [addCache]));
    const api = result.nodes.find((n) => n.id === 'api');
    const cache = result.nodes.find((n) => n.id === 'cache');
    expect(cache?.position.x).toBeGreaterThan(api?.position.x ?? Infinity);
  });

  it('uses the placement function it is given', () => {
    const result = unwrap(applyOps(board(), [addCache], { placeNode: () => ({ x: 7, y: 9 }) }));
    expect(result.nodes.find((n) => n.id === 'cache')?.position).toEqual({ x: 7, y: 9 });
  });

  it('is all-or-nothing: if op 2 of 3 fails, nothing is applied', () => {
    const before = board();
    const result = applyOps(before, [
      addCache,
      { op: 'connect', edgeId: 'e3', source: 'api', target: 'nope' },
      { op: 'updateNode', nodeId: 'db', label: 'Orders DB' },
    ]);

    expect(result).toMatchObject({ ok: false, error: { code: 'NODE_NOT_FOUND' } });
    expect(before.nodes).toHaveLength(3); // input untouched (and frozen)
  });

  it('says which operation failed', () => {
    const result = applyOps(board(), [
      addCache,
      { op: 'connect', edgeId: 'e3', source: 'api', target: 'nope' },
    ]);
    expect(result.ok ? '' : result.error.message).toMatch(/operation 2 \(connect\)/i);
  });

  it('updates a node label and kind', () => {
    const result = unwrap(
      applyOps(board(), [{ op: 'updateNode', nodeId: 'db', label: 'Orders DB', kind: 'storage' }]),
    );
    expect(result.nodes.find((n) => n.id === 'db')).toMatchObject({
      label: 'Orders DB',
      kind: 'storage',
    });
  });

  it('rejects updateNode on an unknown node', () => {
    expect(applyOps(board(), [{ op: 'updateNode', nodeId: 'nope', label: 'X' }])).toMatchObject({
      ok: false,
      error: { code: 'NODE_NOT_FOUND' },
    });
  });

  it('rejects an addNode whose "near" node does not exist', () => {
    expect(applyOps(board(), [{ ...addCache, near: 'nope' }])).toMatchObject({
      ok: false,
      error: { code: 'NODE_NOT_FOUND' },
    });
  });

  it('rejects malformed operations (they come from an LLM)', () => {
    const bogus = [{ op: 'deleteNode', nodeId: 'api' }] as unknown as AgentOp[];
    expect(applyOps(board(), bogus)).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } });
  });

  it('rejects an empty list of operations', () => {
    expect(applyOps(board(), [])).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } });
  });
});

describe('AgentOpSchema', () => {
  it('has no delete operation — the AI can add and change, never remove', () => {
    expect(AgentOpSchema.safeParse({ op: 'removeNode', nodeId: 'api' }).success).toBe(false);
  });

  it('rejects an updateNode that changes nothing', () => {
    expect(AgentOpSchema.safeParse({ op: 'updateNode', nodeId: 'api' }).success).toBe(false);
  });
});

describe('ProposalSchema', () => {
  const proposal = {
    id: 'p1',
    summary: 'Add a cache in front of the database',
    ops: [addCache, connectApiToCache],
  };

  it('accepts a valid proposal', () => {
    expect(ProposalSchema.parse(proposal)).toEqual(proposal);
  });

  it('rejects a proposal without operations', () => {
    expect(ProposalSchema.safeParse({ ...proposal, ops: [] }).success).toBe(false);
  });

  it('accepts an optional traceId', () => {
    expect(ProposalSchema.safeParse({ ...proposal, traceId: 'abc123' }).success).toBe(true);
  });
});
