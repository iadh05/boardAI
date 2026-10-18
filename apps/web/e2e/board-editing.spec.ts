import { expect, test } from './fixtures.ts';

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('a new Custom node asks for its name straight away', { tag: '@smoke' }, async ({ app }) => {
  await app.board.addNode('Custom');

  await expect(app.board.labelInput).toBeFocused();
  await app.board.typeLabel('Payment provider');

  await expect(app.board.node('Payment provider')).toBeVisible();
  await expect(app.board.nodes).toHaveCount(1);
});

test('double-clicking a node renames it', async ({ app }) => {
  await app.board.addNode('Database');

  await app.board.rename('Database', 'Orders DB');

  await expect(app.board.node('Orders DB')).toBeVisible();
  await expect(app.board.node('Database')).toHaveCount(0);
});

test('three clicks on a kind give three nodes', async ({ app }) => {
  for (let i = 0; i < 3; i++) await app.board.addNode('API');

  await expect(app.board.node('API')).toHaveCount(3);
});
