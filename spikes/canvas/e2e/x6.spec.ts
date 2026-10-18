import { expect, test, type Page } from '@playwright/test';

// D-0: can our e2e style (role locators, web-first assertions, no sleeps) drive X6?
const node = (page: Page, label: string) => page.getByRole('group', { name: label, exact: true });
const edge = (page: Page, from: string, to: string) =>
  page.getByRole('group', { name: `From ${from} to ${to}`, exact: true });

async function connect(page: Page, from: string, to: string) {
  await node(page, from).hover(); // ports appear on hover
  await node(page, from).getByTestId('port-right').dragTo(node(page, to));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /AntV X6/ }).click();
  await expect(node(page, 'Postgres')).toBeVisible();
});

test('all nodes and edges have accessible names', async ({ page }) => {
  await expect(page.getByRole('group')).toHaveCount(9 + 9);
  await expect(edge(page, 'Orders API', 'Postgres')).toBeVisible();
});

test('dragging a node moves it and its edges follow', async ({ page }) => {
  const before = await node(page, 'Postgres').boundingBox();
  const route = await edge(page, 'Orders API', 'Postgres').locator('path').first().getAttribute('d');
  if (!before) throw new Error('no box');

  await page.mouse.move(before.x + 20, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + 20, before.y + before.height / 2 + 100, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => (await node(page, 'Postgres').boundingBox())?.y).toBeGreaterThan(before.y + 50);
  await expect(edge(page, 'Orders API', 'Postgres').locator('path').first()).not.toHaveAttribute('d', route ?? '');
});

test('dragging from a port to another node connects them', async ({ page }) => {
  await connect(page, 'CDN', 'Redis');
  await expect(edge(page, 'CDN', 'Redis')).toHaveCount(1);
});

test('a second arrow between the same nodes is refused', async ({ page }) => {
  await connect(page, 'Orders API', 'Postgres');
  await expect(edge(page, 'Orders API', 'Postgres')).toHaveCount(1);
});

test('Delete removes the selected node and its edges', async ({ page }) => {
  await node(page, 'Stripe').click();
  await page.keyboard.press('Delete');

  await expect(node(page, 'Stripe')).toHaveCount(0);
  await expect(edge(page, 'Billing worker', 'Stripe')).toHaveCount(0);
  await expect(node(page, 'Billing worker')).toBeVisible();
});
