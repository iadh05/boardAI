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
  await app.board.drawChain(['Client', 'Load Balancer', 'API', 'Database']);

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

test('an arrow can say what it is and be made async', async ({ app }) => {
  await app.board.addNode('API');
  await app.board.addNode('Queue');
  await app.board.connect('API', 'Queue');

  await app.board.describeArrow('API', 'Queue', 'order events', { async: true });

  await expect(app.board.edge('API', 'Queue')).toHaveCount(1);
  await expect(app.board.arrowLabel('order events')).toBeVisible();
});

test(
  'a zone groups boxes: moving it carries the boxes inside',
  { tag: '@smoke' },
  async ({ app }) => {
    await app.board.addNode('API'); // centre of the view: inside the zone
    await app.board.addNode('Database'); // to its right: outside the zone
    await app.board.addZone('VPC');
    const apiBefore = await app.board.node('API').boundingBox();
    const dbBefore = await app.board.node('Database').boundingBox();

    await app.board.moveZone('VPC', -140, 100);

    await expect(app.board.zone('VPC')).toBeVisible();
    await expect
      .poll(async () => (await app.board.node('API').boundingBox())?.y)
      .toBeGreaterThan((apiBefore?.y ?? 0) + 50);
    expect((await app.board.node('Database').boundingBox())?.y).toBe(dbBefore?.y);
  },
);

// Found by hand (noted 2026-10-20): the fit-view button used React Flow's plain fit, which ignores
// the toolbar floating over the canvas — on a narrow screen the top box landed under it.
test('the fit-view button keeps the board clear of the toolbar', async ({ app }) => {
  const chain = ['Client', 'API', 'Database'];
  for (const kind of chain) await app.board.addNode(kind);
  // A tall, narrow board — a chain drawn top to bottom — on the narrowest desktop layout, where
  // the toolbar wraps onto several rows.
  await app.board.zoomOut();
  const api = await app.board.positionOf('API');
  const client = await app.board.positionOf('Client');
  const database = await app.board.positionOf('Database');
  await app.board.move('Client', (api.x - client.x) / 2, -200);
  await app.board.move('Database', (api.x - database.x) / 2, 200);
  await app.resize(800, 860);

  await app.board.fitView();

  const panel = await app.board.toolbarPanel().boundingBox();
  if (!panel) throw new Error('the toolbar is not on screen');
  for (const label of chain) {
    await expect(app.board.node(label)).toBeInViewport();
    const box = await app.board.node(label).boundingBox();
    const overlaps =
      !!box &&
      box.x < panel.x + panel.width &&
      box.x + box.width > panel.x &&
      box.y < panel.y + panel.height &&
      box.y + box.height > panel.y;
    expect(overlaps, `${label} is under the toolbar`).toBe(false);
  }
});
