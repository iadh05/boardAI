import { applyOps, MAX_OPS_PER_PROPOSAL, type Board } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, createDraft, MAX_NEW_BOXES, runToolCall, type Draft } from './tools.ts';

const board: Board = {
  nodes: [
    { id: 'uuid-api', kind: 'api', label: 'API', position: { x: 0, y: 0 } },
    { id: 'uuid-db', kind: 'database', label: 'Postgres', position: { x: 300, y: 0 } },
  ],
  edges: [{ id: 'e1', source: 'uuid-api', target: 'uuid-db' }],
};

/** Ids the agent hands out, predictable for the test. */
const ids = () => {
  let n = 0;
  return { newId: () => `new-${++n}` };
};

const call = (name: string, args: unknown) => ({ name, arguments: args });

describe('add_node', () => {
  it('adds the node to the draft under a new id chosen by the agent, and records the op', () => {
    const { draft, ok, reply } = runToolCall(
      createDraft(board),
      call('add_node', { kind: 'cache', label: 'Redis', near: 'n1' }),
      ids(),
    );

    expect(ok).toBe(true);
    expect(reply).toBe('added n3 [cache] "Redis"');
    expect(draft.ops).toEqual([
      { op: 'addNode', nodeId: 'new-1', kind: 'cache', label: 'Redis', near: 'uuid-api' },
    ]);
    expect(draft.board.nodes.map((n) => n.id)).toContain('new-1');
    expect(draft.aliases.nodeId('n3')).toBe('new-1');
  });

  it('ignores an id the model tries to choose itself', () => {
    const { draft } = runToolCall(
      createDraft(board),
      call('add_node', { kind: 'cache', label: 'Redis', nodeId: 'cache' }),
      ids(),
    );
    expect(draft.ops[0]).toMatchObject({ nodeId: 'new-1' });
  });

  it(`refuses a box beyond ${MAX_NEW_BOXES} per proposal, saying to keep the most important`, () => {
    const deps = ids();
    let draft: Draft = createDraft(board);
    for (const [kind, label] of [
      ['cache', 'Redis'],
      ['queue', 'Queue'],
      ['database', 'Replica'],
    ]) {
      draft = runToolCall(draft, call('add_node', { kind, label }), deps).draft;
    }

    const fourth = runToolCall(draft, call('add_node', { kind: 'cdn', label: 'CDN' }), deps);

    expect(fourth.ok).toBe(false);
    expect(fourth.reply).toMatch(/at most 3 new boxes/i);
    expect(fourth.draft.ops.filter((op) => op.op === 'addNode')).toHaveLength(3);
    // Connecting and renaming still work: a fix needs its arrows.
    const connected = runToolCall(
      fourth.draft,
      call('connect_nodes', { source: 'n1', target: 'n3' }),
      deps,
    );
    expect(connected.ok).toBe(true);
  });
});

// M1-29: on the Uber board, Qwen added a RabbitMQ queue next to Kafka (4/10 runs had a duplicate),
// even right after writing "adding a second queue would over-engineer". The prompt says never;
// the tool makes it hold, and tells the model what to do instead.
describe('add_node: no second queue, cache, load balancer or CDN', () => {
  const withKafka: Board = {
    nodes: [
      ...board.nodes,
      { id: 'uuid-kafka', kind: 'queue', label: 'Event stream (Kafka)', position: { x: 0, y: 0 } },
    ],
    edges: board.edges,
  };

  it('refuses a box of a kind already on the board, naming the one to use', () => {
    const { ok, reply, draft } = runToolCall(
      createDraft(withKafka),
      call('add_node', { kind: 'queue', label: 'RabbitMQ' }),
      ids(),
    );

    expect(ok).toBe(false);
    expect(reply).toContain('n3 [queue] "Event stream (Kafka)"');
    expect(reply).toMatch(/connect to it/i);
    expect(draft.ops).toEqual([]);
  });

  it('sees through the kind: a custom or service box named after one counts too', () => {
    const custom = runToolCall(
      createDraft(withKafka),
      call('add_node', { kind: 'custom', label: 'RabbitMQ broker' }),
      ids(),
    );
    const service = runToolCall(
      createDraft(withKafka),
      call('add_node', { kind: 'service', label: 'Notifications queue' }),
      ids(),
    );

    expect(custom.ok).toBe(false);
    expect(service.ok).toBe(false);
  });

  it('counts boxes added earlier in the same proposal', () => {
    const deps = ids();
    const first = runToolCall(
      createDraft(board),
      call('add_node', { kind: 'cache', label: 'Redis' }),
      deps,
    );
    const second = runToolCall(
      first.draft,
      call('add_node', { kind: 'cache', label: 'Memcached' }),
      deps,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reply).toContain('n3 [cache] "Redis"');
  });

  it('lets other kinds repeat: a second database or service is a normal fix', () => {
    const replica = runToolCall(
      createDraft(withKafka),
      call('add_node', { kind: 'database', label: 'Postgres replica' }),
      ids(),
    );
    const worker = runToolCall(
      createDraft(withKafka),
      call('add_node', { kind: 'service', label: 'Order worker' }),
      ids(),
    );

    expect(replica.ok).toBe(true);
    expect(worker.ok).toBe(true);
  });

  // Review of #70: a worker that consumes the queue is a normal fix, not a second queue.
  it('a worker, consumer or service named after the queue it reads is not a duplicate', () => {
    for (const label of ['Order queue worker', 'Kafka consumer', 'Cache warmer service']) {
      const added = runToolCall(
        createDraft(withKafka),
        call('add_node', { kind: 'service', label }),
        ids(),
      );
      expect(added.ok, label).toBe(true);
    }
  });

  // Review of #70: people draw named products as custom boxes.
  it('sees an existing custom box named Kafka as the queue', () => {
    const customKafka: Board = {
      nodes: [
        ...board.nodes,
        { id: 'uuid-kafka', kind: 'custom', label: 'Kafka', position: { x: 0, y: 0 } },
      ],
      edges: board.edges,
    };
    const second = runToolCall(
      createDraft(customKafka),
      call('add_node', { kind: 'queue', label: 'RabbitMQ' }),
      ids(),
    );

    expect(second.ok).toBe(false);
    expect(second.reply).toContain('"Kafka"');
  });

  // Measured on the Uber board: a storage box labelled "…Cache" went through next to Redis.
  it('reads the label whatever the kind', () => {
    const withRedis: Board = {
      nodes: [
        ...board.nodes,
        { id: 'uuid-redis', kind: 'cache', label: 'Redis GEO', position: { x: 0, y: 0 } },
      ],
      edges: board.edges,
    };
    const storage = runToolCall(
      createDraft(withRedis),
      call('add_node', { kind: 'storage', label: 'Trip Analytics Cache' }),
      ids(),
    );

    expect(storage.ok).toBe(false);
  });
});

describe('connect_nodes', () => {
  it('connects to a node added earlier in the same run', () => {
    const deps = ids();
    const added = runToolCall(
      createDraft(board),
      call('add_node', { kind: 'cache', label: 'Redis' }),
      deps,
    );
    const { draft, ok, reply } = runToolCall(
      added.draft,
      call('connect_nodes', { source: 'n1', target: 'n3', label: 'reads', mode: 'sync' }),
      deps,
    );

    expect(ok).toBe(true);
    expect(reply).toBe('connected n1 -> n3');
    expect(draft.ops[1]).toEqual({
      op: 'connect',
      edgeId: 'new-2',
      source: 'uuid-api',
      target: 'new-1',
      label: 'reads',
      mode: 'sync',
    });
  });

  it('reports a rule the board enforces, such as a duplicate arrow', () => {
    const { ok, reply, draft } = runToolCall(
      createDraft(board),
      call('connect_nodes', { source: 'n1', target: 'n2' }),
      ids(),
    );
    expect(ok).toBe(false);
    expect(reply).toBe('connect_nodes failed: n1 → n2 is already connected');
    expect(draft.ops).toEqual([]);
  });
});

describe('error messages', () => {
  it('translate whole ids only, never parts of other words or ids', () => {
    const short: Board = {
      nodes: [
        { id: 'a', kind: 'api', label: 'API', position: { x: 0, y: 0 } },
        { id: 'api', kind: 'database', label: 'DB', position: { x: 300, y: 0 } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'api' }],
    };
    const { reply } = runToolCall(
      createDraft(short),
      call('connect_nodes', { source: 'n1', target: 'n2' }),
      ids(),
    );
    expect(reply).toBe('connect_nodes failed: n1 → n2 is already connected');
  });
});

describe('update_node', () => {
  it('renames a node and changes its kind', () => {
    const { draft, ok, reply } = runToolCall(
      createDraft(board),
      call('update_node', { nodeId: 'n1', label: 'Orders API', kind: 'service' }),
      ids(),
    );
    expect(ok).toBe(true);
    expect(reply).toBe('updated n1 [service] "Orders API"');
    expect(draft.ops).toEqual([
      { op: 'updateNode', nodeId: 'uuid-api', label: 'Orders API', kind: 'service' },
    ]);
  });

  it('refuses an update that changes nothing', () => {
    const { ok, reply } = runToolCall(
      createDraft(board),
      call('update_node', { nodeId: 'n1' }),
      ids(),
    );
    expect(ok).toBe(false);
    expect(reply).toBe('update_node failed: updateNode must change the label or the kind');
  });
});

describe('mistakes the model makes', () => {
  const failsWith = (draft: Draft, name: string, args: unknown, message: RegExp) => {
    const outcome = runToolCall(draft, call(name, args), ids());
    expect(outcome.ok).toBe(false);
    expect(outcome.reply).toMatch(message);
    expect(outcome.draft).toBe(draft); // nothing recorded, nothing changed
  };

  it('an unknown node id: lists the ids that exist', () => {
    failsWith(
      createDraft(board),
      'connect_nodes',
      { source: 'n1', target: 'n9' },
      /no node "n9".*n1 to n2/i,
    );
    failsWith(
      createDraft(board),
      'add_node',
      { kind: 'cache', label: 'x', near: 'uuid-api' },
      /no node "uuid-api"/i,
    );
    failsWith(createDraft(board), 'connect_nodes', { source: 'n7', target: 'n1' }, /no node "n7"/i);
    failsWith(createDraft(board), 'update_node', { nodeId: 'n5', label: 'x' }, /no node "n5"/i);
  });

  it('bad or missing arguments: says which field is wrong', () => {
    failsWith(createDraft(board), 'add_node', { kind: 'firewall', label: 'WAF' }, /kind/);
    failsWith(createDraft(board), 'add_node', { label: 'x' }, /kind/);
    failsWith(
      createDraft(board),
      'connect_nodes',
      { source: 'n1', target: 'n2', mode: 'later' },
      /mode/,
    );
  });

  it('bad arguments for update_node and connect_nodes', () => {
    failsWith(createDraft(board), 'update_node', { label: 'x' }, /nodeId/);
    failsWith(createDraft(board), 'connect_nodes', { source: 'n1' }, /target/);
  });

  it('arguments that are not a JSON object', () => {
    failsWith(createDraft(board), 'add_node', '{kind: cache', /JSON object/);
  });

  it('a label the board refuses: says which field', () => {
    const outcome = runToolCall(
      createDraft(board),
      call('add_node', { kind: 'cache', label: 'x'.repeat(150) }),
      ids(),
    );
    expect(outcome.reply).toMatch(/^add_node failed: label: /);
  });

  it('a label the board refuses (line break)', () => {
    failsWith(createDraft(board), 'add_node', { kind: 'cache', label: 'a\nb' }, /line break/i);
  });

  it('a tool that does not exist: lists the real ones', () => {
    failsWith(
      createDraft(board),
      'delete_node',
      { nodeId: 'n1' },
      /unknown tool.*add_node, update_node, connect_nodes/i,
    );
  });

  it('too many changes for one proposal', () => {
    const deps = ids();
    let draft = createDraft(board);
    // Renames, not new boxes: those stop at MAX_NEW_BOXES long before this limit.
    for (let i = 0; i < MAX_OPS_PER_PROPOSAL; i++)
      draft = runToolCall(draft, call('update_node', { nodeId: 'n1', label: `S${i}` }), deps).draft;
    expect(draft.ops).toHaveLength(MAX_OPS_PER_PROPOSAL);

    failsWith(draft, 'add_node', { kind: 'cache', label: 'one more' }, /already has 20 changes/);
  });
});

describe('the tool list', () => {
  it('offers add, update, connect and no_change — and nothing that deletes', () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(names).toEqual(['add_node', 'update_node', 'connect_nodes', 'no_change']);
    expect(names.some((n) => /delete|remove/.test(n))).toBe(false);
  });

  it('describes flat arguments as JSON Schema, with node kinds spelled out', () => {
    const addNode = AGENT_TOOLS.find((t) => t.name === 'add_node');
    expect(addNode?.parameters).toMatchObject({ type: 'object', required: ['kind', 'label'] });
    const kinds = (addNode?.parameters.properties as { kind: { enum: string[] } }).kind.enum;
    expect(kinds).toEqual(expect.arrayContaining(['cache', 'queue', 'custom']));
    expect(addNode?.parameters).not.toHaveProperty('$schema');
  });

  it('records ops that the browser can apply to the original board', () => {
    const deps = ids();
    let draft = createDraft(board);
    draft = runToolCall(
      draft,
      call('add_node', { kind: 'cache', label: 'Redis', near: 'n1' }),
      deps,
    ).draft;
    draft = runToolCall(draft, call('connect_nodes', { source: 'n1', target: 'n3' }), deps).draft;

    const applied = applyOps(board, draft.ops);
    expect(applied.ok).toBe(true);
  });
});

describe('no_change (M1-31)', () => {
  it('records nothing and hands back the reason', () => {
    const outcome = runToolCall(
      createDraft(board),
      call('no_change', { reason: 'The design fits the load.' }),
      ids(),
    );

    expect(outcome).toMatchObject({ ok: true, noChange: 'The design fits the load.' });
    expect(outcome.draft.ops).toEqual([]);
  });

  it('needs a reason', () => {
    const outcome = runToolCall(createDraft(board), call('no_change', { reason: '' }), ids());
    expect(outcome.ok).toBe(false);
    expect(outcome.reply).toMatch(/reason/);
  });
});
