import { demoBoard } from './data/boards.ts';
import { expect, test } from './fixtures.ts';

// The AI reviewer, end to end, on the fake model (e2e/fixtures/llm/scenarios.json): the app's
// origin → server → agent → gateway → scripted model, deterministic and without a GPU.

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

/** The M1 demo: the model sees Client, Load Balancer, API, Database as n1…n4. */
const DEMO = ['Client', 'Load Balancer', 'API', 'Database'];

test(
  'accepting the proposal adds the cache node and its arrow',
  { tag: '@smoke' },
  async ({ app }) => {
    await app.open();
    await app.board.drawChain(DEMO);

    await app.chat.sendMessage('Please review my design');

    await expect(app.chat.conversation).toContainText('Every read goes straight to the database');
    await expect(app.chat.proposal).toContainText('Add cache "Cache"');
    await expect(app.board.node('Proposed: Cache')).toBeVisible(); // a ghost until accepted

    await app.chat.accept();

    await expect(app.board.node('Cache')).toBeVisible();
    await expect(app.board.node('Proposed: Cache')).toHaveCount(0);
    // Attached, not "visible": the cache sits right of the API, so the arrow is a straight line
    // whose box is 0 px tall — Playwright never calls that visible (seen in M1-12).
    await expect(app.board.edge('API', 'Cache')).toBeAttached();
    await expect(app.chat.proposal).toHaveCount(0);
  },
);

test('a proposal the board has moved past says "out of date" and changes nothing', async ({
  app,
}) => {
  await app.open();
  await app.board.drawChain(DEMO);
  await app.chat.sendMessage('Please review my design');
  await expect(app.board.node('Proposed: Cache')).toBeVisible();

  await app.board.delete(app.board.node('API')); // the proposal connects the cache to it

  await app.chat.accept();
  await expect(app.chat.proposalProblem()).toContainText('out of date');
  await expect(app.board.node('Cache')).toHaveCount(0);

  await app.chat.reject();
  await expect(app.chat.proposal).toHaveCount(0);
});

test('Stop ends an answer that is taking too long, without an error', async ({ app }) => {
  await app.open();

  await app.chat.sendMessage('Please take your time');
  await expect(app.chat.conversation).toContainText('Let me think about this carefully');

  await app.chat.stop();

  await expect(app.chat.sendButton).toBeVisible(); // ready for the next question
  await expect(app.chat.conversation.getByRole('alert')).toHaveCount(0);
});
