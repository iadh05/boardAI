import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup, waitFor } from 'xstate';

// SPIKE (ADR-011): the same pause-and-resume as our runtime's interrupt test, in XState v5: a
// waiting state, the snapshot persisted, restored in a new actor, resumed by an event.

type Ctx = { answer?: string; log: string[] };

const machine = setup({
  types: { context: {} as Ctx, events: {} as { type: 'ANSWER'; answer: string } },
  actors: {
    use: fromPromise<string[], string>(({ input }) => Promise.resolve([`users: ${input}`])),
  },
}).createMachine({
  context: { log: [] },
  initial: 'asking',
  states: {
    asking: {
      on: { ANSWER: { target: 'using', actions: assign({ answer: ({ event }) => event.answer }) } },
    },
    using: {
      invoke: {
        src: 'use',
        input: ({ context }) => context.answer ?? '?',
        onDone: { target: 'done', actions: assign({ log: ({ event }) => event.output }) },
      },
    },
    done: { type: 'final' },
  },
});

describe('XState: pause and resume (spike)', () => {
  it('waits for the answer, survives a restore, and resumes with it', async () => {
    const first = createActor(machine).start();
    expect(first.getSnapshot().value).toBe('asking');
    const saved = JSON.parse(JSON.stringify(first.getPersistedSnapshot())) as unknown;
    first.stop();

    // A later request: the conversation restored from its checkpoint.
    const second = createActor(machine, { snapshot: saved as never }).start();
    second.send({ type: 'ANSWER', answer: '10k' });
    const end = await waitFor(second, (s) => s.status === 'done');
    expect(end.context.log).toEqual(['users: 10k']);
  });
});
