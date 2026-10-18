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

test('draw Client → Load Balancer → API → Database', { tag: '@smoke' }, async ({ app }) => {
  const chain = ['Client', 'Load Balancer', 'API', 'Database'];
  for (const [i, kind] of chain.entries()) {
    await app.board.addNode(kind);
    // A diagonal staircase that fits the canvas (clear of the minimap in the corner).
    await app.board.move(kind, (i - 1.5) * 160, (i - 1.5) * 70);
  }

  await app.board.connect('Client', 'Load Balancer');
  await app.board.connect('Load Balancer', 'API');
  await app.board.connect('API', 'Database');

  await expect(app.board.edge('Client', 'Load Balancer')).toBeVisible();
  await expect(app.board.edge('Load Balancer', 'API')).toBeVisible();
  await expect(app.board.edge('API', 'Database')).toBeVisible();
});

test('deleting a node takes its edges with it; deleting an edge keeps the nodes', async ({
  app,
}) => {
  await app.board.addNode('API');
  await app.board.move('API', -150, 0);
  await app.board.addNode('Cache');
  await app.board.move('Cache', 150, -100);
  await app.board.addNode('Database');
  await app.board.move('Database', 150, 100);
  await app.board.connect('API', 'Cache');
  await app.board.connect('API', 'Database');

  await app.board.delete(app.board.edge('API', 'Cache'));
  await expect(app.board.edge('API', 'Cache')).toHaveCount(0);
  await expect(app.board.nodes).toHaveCount(3);

  await app.board.delete(app.board.node('API'));
  await expect(app.board.node('API')).toHaveCount(0);
  await expect(app.board.edge('API', 'Database')).toHaveCount(0);
  await expect(app.board.nodes).toHaveCount(2);
});

test('a node cannot connect to itself, and an arrow cannot be drawn twice', async ({ app }) => {
  await app.board.addNode('API');
  await app.board.move('API', -150, 0);
  await app.board.addNode('Database');
  await app.board.move('Database', 150, 0);

  await app.board.connect('API', 'API');
  await app.board.connect('API', 'Database');
  await app.board.connect('API', 'Database');

  await expect(app.board.edge('API', 'API')).toHaveCount(0);
  await expect(app.board.edge('API', 'Database')).toHaveCount(1);
});
