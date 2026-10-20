import { expect, test } from './fixtures.ts';

// M2 journeys: two people (two separate browsers) in one room, synced through the server.

test.beforeEach(async ({ app, other }) => {
  await app.open();
  await expect(app.connection).toHaveText('Connected');
  await other.openRoom(app.roomLink());
  await expect(other.connection).toHaveText('Connected');
});

test('an edit in one tab appears in the other', { tag: '@smoke' }, async ({ app, other }) => {
  await app.board.addNode('Database');
  await expect(other.board.node('Database')).toBeVisible();

  await other.board.rename('Database', 'Orders DB');
  await expect(app.board.node('Orders DB')).toBeVisible();
});

test('both move the same box at once: it ends in the same place for both', async ({
  app,
  other,
}) => {
  await app.board.addNode('API');
  await expect(other.board.node('API')).toBeVisible();

  await Promise.all([app.board.move('API', 200, 0), other.board.move('API', 0, 150)]);

  await expect
    .poll(async () => {
      const [mine, theirs] = await Promise.all([
        app.board.positionOf('API'),
        other.board.positionOf('API'),
      ]);
      return JSON.stringify(mine) === JSON.stringify(theirs);
    })
    .toBe(true);
});

test('edits made offline reach the others when the connection comes back', async ({
  app,
  other,
}) => {
  await other.setOffline(true);
  await expect(other.connection).toContainText('Offline');

  await other.board.addNode('Cache'); // works offline: the edit is kept locally
  await expect(other.board.node('Cache')).toBeVisible();
  await expect(app.board.node('Cache')).toHaveCount(0);

  await other.setOffline(false);
  await expect(app.board.node('Cache')).toBeVisible();
});

test('undo takes back only your own change', async ({ app, other }) => {
  await app.board.addNode('Queue');
  await expect(other.board.node('Queue')).toBeVisible();
  await other.board.addNode('Storage');
  await expect(app.board.node('Storage')).toBeVisible();

  await app.undo(); // takes back the Queue, not the other person's Storage

  await expect(other.board.node('Queue')).toHaveCount(0);
  await expect(other.board.node('Storage')).toBeVisible();
});

test('joining a room with a board shows the whole board (found by hand, M2)', async ({
  app,
  other,
}) => {
  for (const kind of ['Client', 'Load Balancer', 'API', 'Database', 'Cache', 'Queue'])
    await app.board.addNode(kind);

  await other.openRoom(app.roomLink()); // a fresh page, joining a room that has a board
  for (const label of ['Client', 'Load Balancer', 'API', 'Database', 'Cache', 'Queue'])
    await expect(other.board.node(label)).toBeInViewport();
});

test('on a narrow screen, the board that arrives is not hidden under the toolbar (found by hand)', async ({
  app,
  other,
}) => {
  const chain = ['Client', 'API', 'Database'];
  for (const kind of chain) await app.board.addNode(kind);
  // A tall, narrow board — a chain drawn top to bottom: a plain fit uses the whole height, so
  // its top box lands under the toolbar. Zoomed out, so the drags cover twice the distance.
  await app.board.zoomOut();
  const api = await app.board.positionOf('API');
  const client = await app.board.positionOf('Client');
  const database = await app.board.positionOf('Database');
  await app.board.move('Client', (api.x - client.x) / 2, -200);
  await app.board.move('Database', (api.x - database.x) / 2, 200);

  // The desktop layout at its narrowest (below 768 px the page stacks, as on a phone): a canvas
  // ~410 px wide, where the toolbar wraps onto several rows.
  await other.resize(800, 860);
  await other.openRoom(app.roomLink());

  const panel = await other.board.toolbarPanel().boundingBox();
  if (!panel) throw new Error('the toolbar is not on screen');
  for (const label of chain) {
    await expect(other.board.node(label)).toBeInViewport();
    const box = await other.board.node(label).boundingBox();
    const overlaps =
      !!box &&
      box.x < panel.x + panel.width &&
      box.x + box.width > panel.x &&
      box.y < panel.y + panel.height &&
      box.y + box.height > panel.y;
    expect(overlaps, `${label} is under the toolbar`).toBe(false);
  }
});

test('each person sees the other’s cursor', async ({ app, other }) => {
  await app.board.hover();
  await expect(other.board.cursors()).toHaveCount(1);
});
