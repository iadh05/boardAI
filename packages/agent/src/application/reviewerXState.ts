import { context } from '@opentelemetry/api';
import { assign, createActor, fromPromise, setup } from 'xstate';
import type { Node, NodeContext } from '../runtime/graph.ts';
import {
  createChainNodes,
  endEvents,
  INITIAL,
  over,
  type ReviewerV2Deps,
  type ReviewerV2Event,
  type ReviewState,
} from './reviewerV2.ts';
import type { AgentInput } from './runAgent.ts';
import { markFailed, startSpan } from './telemetry.ts';

// SPIKE (ADR-011): agent V2's chain on XState v5 instead of our runtime — the same six nodes
// (createChainNodes), only the harness differs. To compare, not to merge.

type NodeName = 'scope' | 'plan' | 'tasks' | 'next' | 'architect' | 'critic';
type Step = { output: Partial<ReviewState> };
/** The state after a node, before XState's assign: what the guards must read. */
const merged = (state: ReviewState, event: Step): ReviewState => ({ ...state, ...event.output });

export const createReviewerXState = (deps: ReviewerV2Deps) => {
  const nodesFor = createChainNodes(deps);

  async function* review(input: AgentInput): AsyncIterable<ReviewerV2Event> {
    const root = startSpan('agent v2 (xstate)', 'AGENT', context.active());
    const nodes: Record<NodeName, Node<ReviewState>> = nodesFor(input, root.inside);

    // What nodes emit, read by this generator as it comes.
    const queue: unknown[] = [];
    let wake: (() => void) | undefined;
    const push = (item: unknown) => {
      queue.push(item);
      wake?.();
    };
    const ctx: NodeContext = {
      signal: input.signal ?? new AbortController().signal,
      resume: undefined,
      emit: push,
      interrupt: () => {
        throw new Error('the chain does not pause yet');
      },
    };

    const machine = setup({
      types: { context: {} as ReviewState },
      actors: {
        node: fromPromise<Partial<ReviewState>, { name: NodeName; state: ReviewState }>(
          async ({ input: { name, state } }) =>
            (await nodes[name](state, ctx)) as Partial<ReviewState>,
        ),
      },
    }).createMachine({
      id: 'review',
      context: INITIAL,
      initial: 'scope',
      states: {
        scope: {
          invoke: {
            src: 'node',
            input: ({ context: state }) => ({ name: 'scope' as const, state }),
            onDone: [
              {
                guard: ({ context: s, event }) => over(merged(s, event)),
                target: 'done',
                actions: assign(({ event }) => event.output),
              },
              { target: 'plan', actions: assign(({ event }) => event.output) },
            ],
            onError: 'failed',
          },
        },
        plan: {
          invoke: {
            src: 'node',
            input: ({ context: state }) => ({ name: 'plan' as const, state }),
            onDone: [
              {
                guard: ({ context: s, event }) => over(merged(s, event)),
                target: 'done',
                actions: assign(({ event }) => event.output),
              },
              {
                guard: ({ context: s, event }) => merged(s, event).todo.length > 0,
                target: 'tasks',
                actions: assign(({ event }) => event.output),
              },
              { target: 'architect', actions: assign(({ event }) => event.output) },
            ],
            onError: 'failed',
          },
        },
        tasks: {
          invoke: {
            src: 'node',
            input: ({ context: state }) => ({ name: 'tasks' as const, state }),
            onDone: [
              {
                guard: ({ context: s, event }) => over(merged(s, event)),
                target: 'done',
                actions: assign(({ event }) => event.output),
              },
              { target: 'next', actions: assign(({ event }) => event.output) },
            ],
            onError: 'failed',
          },
        },
        next: {
          invoke: {
            src: 'node',
            input: ({ context: state }) => ({ name: 'next' as const, state }),
            onDone: [
              {
                guard: ({ context: s, event }) => over(merged(s, event)),
                target: 'done',
                actions: assign(({ event }) => event.output),
              },
              {
                guard: ({ context: s, event }) => merged(s, event).todo.length > 0,
                target: 'tasks',
                actions: assign(({ event }) => event.output),
              },
              { target: 'architect', actions: assign(({ event }) => event.output) },
            ],
            onError: 'failed',
          },
        },
        architect: {
          invoke: {
            src: 'node',
            input: ({ context: state }) => ({ name: 'architect' as const, state }),
            onDone: [
              {
                guard: ({ context: s, event }) => over(merged(s, event)) || !deps.critic,
                target: 'done',
                actions: assign(({ event }) => event.output),
              },
              { target: 'critic', actions: assign(({ event }) => event.output) },
            ],
            onError: 'failed',
          },
        },
        critic: {
          invoke: {
            src: 'node',
            input: ({ context: state }) => ({ name: 'critic' as const, state }),
            onDone: [
              {
                guard: ({ context: s, event }) =>
                  !over(merged(s, event)) && merged(s, event).sendBack,
                target: 'architect',
                actions: assign(({ event }) => event.output),
              },
              { target: 'done', actions: assign(({ event }) => event.output) },
            ],
            onError: 'failed',
          },
        },
        done: { type: 'final' },
        failed: { type: 'final' },
      },
    });

    const actor = createActor(machine);
    let finished = false;
    actor.subscribe({
      complete: () => {
        finished = true;
        push(undefined);
      },
    });
    try {
      actor.start();
      for (;;) {
        if (queue.length === 0)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        const last = finished;
        for (const item of queue.splice(0)) if (item !== undefined) yield item as ReviewerV2Event;
        if (last) break;
      }
      const snapshot = actor.getSnapshot();
      if (snapshot.value === 'failed') {
        markFailed(root.span, 'a node failed');
        throw new Error('a node failed'); // a bug in a node, not a model failing
      }
      yield* endEvents(snapshot.context);
    } finally {
      actor.stop();
      root.span.end();
    }
  }

  return { run: (input: AgentInput): AsyncIterable<ReviewerV2Event> => review(input) };
};
