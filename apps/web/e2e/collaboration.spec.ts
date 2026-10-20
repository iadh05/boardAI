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

test('each person sees the other’s cursor', async ({ app, other }) => {
  await app.board.hover();
  await expect(other.board.cursors()).toHaveCount(1);
});
