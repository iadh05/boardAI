// The runtime (ADR-011, AV2-11): the orchestrator's engine. A small state graph shaped like
// LangGraph — typed state with reducers, nodes, edges, conditional edges, a checkpoint after every
// node, interrupts that pause a run and resume it with an answer, Stop, a step limit, and every
// step streamed as an event. No LangGraph dependency (the owner's call). It knows nothing about
// agents: the Planner decides what runs; this only runs it, safely.

export const END = '__end__';

/** What a node may emit while it runs (text deltas, progress): streamed as `custom` events. */
export type NodeContext = {
  signal: AbortSignal;
  /** The answer this run was resumed with, when this node paused it last time. */
  resume: unknown;
  emit: (data: unknown) => void;
  /** Pause the run here: the node runs again on resume, with `resume` set. */
  interrupt: (payload: unknown) => Interrupt;
};

const INTERRUPT = Symbol('interrupt');
export type Interrupt = { [INTERRUPT]: unknown };
const isInterrupt = (value: unknown): value is Interrupt =>
  typeof value === 'object' && value !== null && INTERRUPT in value;

export type Node<S> = (
  state: S,
  ctx: NodeContext,
) => Partial<S> | Interrupt | Promise<Partial<S> | Interrupt>;

/** How a key's update joins the state; replaced when absent (e.g. findings are appended). */
export type Reducers<S> = { [K in keyof S]?: (current: S[K], update: S[K]) => S[K] };

export type GraphEvent<S> =
  | { type: 'node_started'; node: string; step: number }
  | { type: 'custom'; node: string; data: unknown }
  | { type: 'node_done'; node: string; step: number }
  | { type: 'paused'; node: string; payload: unknown }
  | { type: 'done'; state: S }
  | { type: 'stopped'; state: S }
  | { type: 'failed'; error: string; node?: string; state?: S };

export type Checkpoint<S> = {
  /** The node that just ran. */
  after: string;
  state: S;
  /** Where the run goes next; on a pause, the node that paused (it runs again on resume). */
  next: string;
  paused?: { payload: unknown };
};

export type Checkpointer<S> = {
  save: (thread: string, checkpoint: Checkpoint<S>) => void | Promise<void>;
  latest: (thread: string) => Checkpoint<S> | undefined | Promise<Checkpoint<S> | undefined>;
};

/** In memory: one list per conversation (the Yjs room doc in M2, Postgres in M3). */
export const createMemoryCheckpointer = <S>() => {
  const threads = new Map<string, Checkpoint<S>[]>();
  return {
    save: (thread: string, checkpoint: Checkpoint<S>) => {
      threads.set(thread, [...(threads.get(thread) ?? []), checkpoint]);
    },
    latest: (thread: string) => threads.get(thread)?.at(-1),
    /** Every step of a run, for replaying it. */
    history: (thread: string) => threads.get(thread) ?? [],
  };
};

const DEFAULT_MAX_STEPS = 25; // a review is ~8 steps; a loop past this is a bug, not a plan

type Route<S> = (state: S) => string;

/** Events a node emits while it runs, read by the run loop as they come. */
const createChannel = () => {
  const items: unknown[] = [];
  let wake: (() => void) | undefined;
  return {
    push: (item: unknown) => {
      items.push(item);
      wake?.();
    },
    drain: () => items.splice(0),
    /** Resolves on the next push, or at once when something is already waiting. */
    wait: () =>
      items.length > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            wake = resolve;
          }),
  };
};

export const createGraph = <S extends object>(options: { reducers?: Reducers<S> } = {}) => {
  const nodes = new Map<string, Node<S>>();
  const routes = new Map<string, Route<S>>();
  const fixedEdges: [string, string][] = [];

  const merge = (state: S, update: Partial<S>): S => {
    const next = { ...state };
    for (const key of Object.keys(update) as (keyof S)[]) {
      const value = update[key] as S[keyof S];
      const reduce = options.reducers?.[key];
      next[key] = reduce ? reduce(state[key], value) : value;
    }
    return next;
  };

  const builder = {
    addNode: (name: string, node: Node<S>) => {
      nodes.set(name, node);
      return builder;
    },
    addEdge: (from: string, to: string) => {
      fixedEdges.push([from, to]);
      routes.set(from, () => to);
      return builder;
    },
    addConditionalEdges: (from: string, route: Route<S>) => {
      routes.set(from, route);
      return builder;
    },
    compile: ({
      start,
      checkpointer,
      maxSteps = DEFAULT_MAX_STEPS,
    }: {
      start: string;
      checkpointer?: Checkpointer<S>;
      maxSteps?: number;
    }) => {
      for (const name of [start, ...fixedEdges.flat()])
        if (name !== END && !nodes.has(name)) throw new Error(`No node "${name}" in the graph.`);

      async function* run(
        thread: string,
        from: string,
        initial: S,
        resume: unknown,
        signal: AbortSignal,
      ): AsyncIterable<GraphEvent<S>> {
        let state = initial;
        let current = from;
        let answer = resume;
        for (let step = 1; current !== END; step++) {
          if (step > maxSteps) {
            yield { type: 'failed', error: `Stopped after ${maxSteps} steps.`, state };
            return;
          }
          if (signal.aborted) {
            yield { type: 'stopped', state };
            return;
          }
          const node = nodes.get(current);
          if (!node) {
            yield { type: 'failed', error: `No node "${current}" in the graph.`, state };
            return;
          }
          yield { type: 'node_started', node: current, step };

          const channel = createChannel();
          const ctx: NodeContext = {
            signal,
            resume: answer,
            emit: (data) => channel.push(data),
            interrupt: (payload) => ({ [INTERRUPT]: payload }),
          };
          answer = undefined; // only the node that paused gets the answer
          let finished = false;
          const running = Promise.resolve()
            .then(() => node(state, ctx))
            .finally(() => {
              finished = true;
              channel.push(undefined); // wake the loop
            });
          running.catch(() => undefined); // read below
          // Stream what the node emits while it runs, then whatever came with its last breath.
          for (;;) {
            await channel.wait();
            for (const data of channel.drain())
              if (data !== undefined) yield { type: 'custom', node: current, data };
            if (finished) break;
          }
          let result: Partial<S> | Interrupt;
          try {
            result = await running;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield { type: 'failed', node: current, error: message, state };
            return;
          }

          if (isInterrupt(result)) {
            const payload = result[INTERRUPT];
            await checkpointer?.save(thread, {
              after: current,
              state,
              next: current,
              paused: { payload },
            });
            yield { type: 'paused', node: current, payload };
            return;
          }
          state = merge(state, result);
          const route = routes.get(current);
          const next = route ? route(state) : END;
          await checkpointer?.save(thread, { after: current, state, next });
          yield { type: 'node_done', node: current, step };
          if (next !== END && !nodes.has(next)) {
            yield {
              type: 'failed',
              node: current,
              error: `No node "${next}" in the graph.`,
              state,
            };
            return;
          }
          current = next;
        }
        yield { type: 'done', state };
      }

      const never = new AbortController().signal;
      return {
        /** A new run of this conversation (`thread`), from the start node. */
        stream: (thread: string, initial: S, signal: AbortSignal = never) =>
          run(thread, start, initial, undefined, signal),
        /** Continue a paused conversation: the node that paused runs again with `answer`. */
        resume: async function* (
          thread: string,
          answer: unknown,
          signal: AbortSignal = never,
        ): AsyncIterable<GraphEvent<S>> {
          const checkpoint = await checkpointer?.latest(thread);
          if (!checkpoint?.paused) {
            yield { type: 'failed', error: `Conversation "${thread}" is not paused.` };
            return;
          }
          yield* run(thread, checkpoint.next, checkpoint.state, answer, signal);
        },
      };
    },
  };
  return builder;
};
