import { describe, expect, it } from 'vitest';
import { createGraph, createMemoryCheckpointer, END, type GraphEvent } from './graph.ts';

type State = { log: string[]; count: number; answer?: string };

const initial = (): State => ({ log: [], count: 0 });
// `log` is appended to, like LangGraph's reducers; `count` and `answer` are replaced.
const reducers = { log: (a: string[], b: string[]) => [...a, ...b] };

const collect = async (events: AsyncIterable<GraphEvent<State>>) => {
  const all: GraphEvent<State>[] = [];
  for await (const event of events) all.push(event);
  return all;
};
const nodesRun = (events: GraphEvent<State>[]) =>
  events.filter((e) => e.type === 'node_started').map((e) => e.node);
const last = (events: GraphEvent<State>[]) => events.at(-1);
/** The run's last event is a failure whose message matches. */
const failedWith = (events: GraphEvent<State>[], message: RegExp) => {
  const end = last(events);
  expect(end?.type).toBe('failed');
  expect(end?.type === 'failed' ? end.error : '').toMatch(message);
};

describe('state graph', () => {
  it('runs nodes along the edges and merges what each returns into the state', async () => {
    const graph = createGraph<State>({ reducers })
      .addNode('a', () => ({ log: ['a'], count: 1 }))
      .addNode('b', (s) => ({ log: ['b'], count: s.count + 1 }))
      .addEdge('a', 'b')
      .addEdge('b', END)
      .compile({ start: 'a' });

    const events = await collect(graph.stream('t1', initial()));

    expect(nodesRun(events)).toEqual(['a', 'b']);
    expect(last(events)).toEqual({ type: 'done', state: { log: ['a', 'b'], count: 2 } });
  });

  it('follows a conditional edge chosen from the state', async () => {
    const graph = createGraph<State>({ reducers })
      .addNode('decide', () => ({ count: 7 }))
      .addNode('big', () => ({ log: ['big'] }))
      .addNode('small', () => ({ log: ['small'] }))
      .addConditionalEdges('decide', (s) => (s.count > 5 ? 'big' : 'small'))
      .addEdge('big', END)
      .addEdge('small', END)
      .compile({ start: 'decide' });

    expect(nodesRun(await collect(graph.stream('t1', initial())))).toEqual(['decide', 'big']);
  });

  it('refuses to compile an edge to a node that does not exist', () => {
    const graph = createGraph<State>({ reducers })
      .addNode('a', () => ({}))
      .addEdge('a', 'missing');
    expect(() => graph.compile({ start: 'a' })).toThrow(/missing/);
  });

  it('fails the run when a conditional edge names an unknown node', async () => {
    const graph = createGraph<State>({ reducers })
      .addNode('a', () => ({}))
      .addConditionalEdges('a', () => 'nowhere')
      .compile({ start: 'a' });

    failedWith(await collect(graph.stream('t1', initial())), /nowhere/);
  });

  it('stops a loop that never ends at the step limit', async () => {
    const graph = createGraph<State>({ reducers })
      .addNode('spin', (s) => ({ count: s.count + 1 }))
      .addEdge('spin', 'spin')
      .compile({ start: 'spin', maxSteps: 5 });

    const events = await collect(graph.stream('t1', initial()));
    expect(nodesRun(events)).toHaveLength(5);
    failedWith(events, /5 steps/);
  });

  it('streams what a node emits while it runs, between its start and its end', async () => {
    const graph = createGraph<State>({ reducers })
      .addNode('talk', async (_s, ctx) => {
        ctx.emit({ text: 'hello' });
        await Promise.resolve();
        ctx.emit({ text: 'world' });
        return {};
      })
      .addEdge('talk', END)
      .compile({ start: 'talk' });

    const events = await collect(graph.stream('t1', initial()));
    expect(events.map((e) => e.type)).toEqual([
      'node_started',
      'custom',
      'custom',
      'node_done',
      'done',
    ]);
    expect(events.filter((e) => e.type === 'custom').map((e) => e.data)).toEqual([
      { text: 'hello' },
      { text: 'world' },
    ]);
  });

  it('keeps what a node emits even when it finishes at once', async () => {
    const graph = createGraph<State>({ reducers })
      .addNode('quick', (_s, ctx) => {
        ctx.emit('one');
        ctx.emit('two');
        return {};
      })
      .addEdge('quick', END)
      .compile({ start: 'quick' });

    const events = await collect(graph.stream('t1', initial()));
    expect(events.filter((e) => e.type === 'custom').map((e) => e.data)).toEqual(['one', 'two']);
  });

  it('saves a checkpoint after every node', async () => {
    const checkpointer = createMemoryCheckpointer<State>();
    const graph = createGraph<State>({ reducers })
      .addNode('a', () => ({ log: ['a'] }))
      .addNode('b', () => ({ log: ['b'] }))
      .addEdge('a', 'b')
      .addEdge('b', END)
      .compile({ start: 'a', checkpointer });

    await collect(graph.stream('t1', initial()));

    expect(checkpointer.history('t1').map((c) => [c.after, c.state.log])).toEqual([
      ['a', ['a']],
      ['b', ['a', 'b']],
    ]);
  });

  it('pauses on an interrupt and resumes the same node with the answer', async () => {
    const checkpointer = createMemoryCheckpointer<State>();
    const graph = createGraph<State>({ reducers })
      .addNode('ask', (_s, ctx) =>
        ctx.resume === undefined
          ? ctx.interrupt({ question: 'How many users?' })
          : { answer: typeof ctx.resume === 'string' ? ctx.resume : '?' },
      )
      .addNode('use', (s) => ({ log: [`users: ${s.answer ?? '?'}`] }))
      .addEdge('ask', 'use')
      .addEdge('use', END)
      .compile({ start: 'ask', checkpointer });

    const first = await collect(graph.stream('t1', initial()));
    expect(last(first)).toEqual({
      type: 'paused',
      node: 'ask',
      payload: { question: 'How many users?' },
    });

    const second = await collect(graph.resume('t1', '10k'));
    expect(nodesRun(second)).toEqual(['ask', 'use']);
    expect(last(second)).toMatchObject({ type: 'done', state: { log: ['users: 10k'] } });
  });

  it('refuses to resume a thread that is not paused', async () => {
    const graph = createGraph<State>({ reducers })
      .addNode('a', () => ({}))
      .addEdge('a', END)
      .compile({ start: 'a', checkpointer: createMemoryCheckpointer<State>() });

    failedWith(await collect(graph.resume('nope', 'x')), /not paused/);
  });

  it('stops before the next node when the signal is aborted, and says so', async () => {
    const stop = new AbortController();
    const graph = createGraph<State>({ reducers })
      .addNode('a', () => {
        stop.abort();
        return { log: ['a'] };
      })
      .addNode('b', () => ({ log: ['b'] }))
      .addEdge('a', 'b')
      .addEdge('b', END)
      .compile({ start: 'a' });

    const events = await collect(graph.stream('t1', initial(), stop.signal));
    expect(nodesRun(events)).toEqual(['a']);
    expect(last(events)).toEqual({ type: 'stopped', state: { log: ['a'], count: 0 } });
  });

  it('reports a node that throws as a failed run, with the state so far', async () => {
    const graph = createGraph<State>({ reducers })
      .addNode('a', () => ({ log: ['a'] }))
      .addNode('boom', () => {
        throw new Error('model down');
      })
      .addEdge('a', 'boom')
      .addEdge('boom', END)
      .compile({ start: 'a' });

    expect(last(await collect(graph.stream('t1', initial())))).toEqual({
      type: 'failed',
      node: 'boom',
      error: 'model down',
      state: { log: ['a'], count: 0 },
    });
  });
});
