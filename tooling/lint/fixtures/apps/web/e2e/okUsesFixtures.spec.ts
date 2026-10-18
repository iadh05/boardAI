import { expect, test } from './fixtures.ts';

test('ok', async ({ page }) => {
  await expect(page).toHaveTitle('DesignRoom');
});
