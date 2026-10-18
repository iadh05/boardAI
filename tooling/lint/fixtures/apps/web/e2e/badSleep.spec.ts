import { test } from './fixtures.ts';

test('sleeps', async ({ page }) => {
  await page.waitForTimeout(500);
});
