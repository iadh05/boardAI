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

  it('gives an empty AI label the kind default, like a user rename', () => {
    const result = unwrap(applyOps(board(), [{ ...addCache, label: '   ' }]));
    expect(result.nodes.find((n) => n.id === 'cache')?.label).toBe('Cache');
  });

  it('does not stack two new nodes placed near the same node', () => {
    const addQueue: AgentOp = {
      op: 'addNode',
      nodeId: 'queue',
      kind: 'queue',
      label: 'Jobs',
      near: 'api',
    };
    const result = unwrap(applyOps(board(), [addCache, addQueue]));
    const cache = result.nodes.find((n) => n.id === 'cache')?.position;
    const queue = result.nodes.find((n) => n.id === 'queue')?.position;
    expect(cache).toBeDefined();
    expect(queue).not.toEqual(cache);
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

  it('names the operation that failed validation', () => {
    const ops = [addCache, { ...connectApiToCache, source: '' }] as AgentOp[];
    const result = applyOps(board(), ops);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } });
    expect(result.ok ? '' : result.error.message).toMatch(/operation 2/i);
  });

  it('applies the kind first, then an explicit label — even one that looks like a default', () => {
    // "API" is the default label of the *old* kind; the AI asked for it explicitly, so it stays.
    const result = unwrap(
      applyOps(board(), [{ op: 'updateNode', nodeId: 'api', kind: 'cache', label: 'API' }]),
    );
    expect(result.nodes.find((n) => n.id === 'api')).toMatchObject({ kind: 'cache', label: 'API' });
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

describe('applyOps — arrows with meaning', () => {
  it('a connect op can carry a label and say the call is async', () => {
    const result = unwrap(
      applyOps(board(), [
        addCache,
        {
          op: 'connect',
          edgeId: 'e3',
          source: 'api',
          target: 'cache',
          label: 'reads',
          mode: 'async',
        },
      ]),
    );
    expect(result.edges.find((e) => e.id === 'e3')).toMatchObject({
      label: 'reads',
      mode: 'async',
    });
  });

  it('rejects an unknown mode from the AI', () => {
    expect(
      AgentOpSchema.safeParse({
        op: 'connect',
        edgeId: 'e3',
        source: 'a',
        target: 'b',
        mode: 'later',
      }).success,
    ).toBe(false);
  });
});
