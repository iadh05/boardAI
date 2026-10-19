import { demoBoard } from './data/boards.ts';
import { expect, test } from './fixtures.ts';

// The AI reviewer, end to end, on the fake model (e2e/fixtures/llm/scenarios.json): the app's
// origin → server → agent → gateway → scripted model, deterministic and without a GPU.
// The browser-side journeys need the chat UI and the ghost nodes (M1-20…M1-23).

test(
  'reviewing the demo board proposes a cache connected to the API',
  { tag: '@smoke' },
  async ({ chatApi }) => {
    const events = await chatApi.ask(demoBoard(), 'Please review my design');

    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toContain('Every read goes straight to the database');
    const proposal = events.find((e) => e.type === 'proposal');
    expect(proposal?.type === 'proposal' && proposal.proposal.summary).toBe(
      'Add cache "Cache"; connect "API" → "Cache" ("reads")',
    );
    expect(events.at(-1)).toEqual({ type: 'done' });
  },
);

test('a model outage reaches the user as a message they can act on', async ({ chatApi }) => {
  const events = await chatApi.ask(demoBoard(), 'simulate an outage');

  expect(events).toEqual([
    { type: 'error', message: "Can't reach the model — is Ollama running?" },
    { type: 'done' },
  ]);
});

test.fixme('accepting the proposal adds the cache node and its arrow — needs the chat UI (M1-23)', () => {});

test.fixme('a proposal the board has moved past says "out of date" and changes nothing — M1-23', () => {});
