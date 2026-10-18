import { expect, test } from '@playwright/test';

test('imports Playwright directly', async ({ page }) => {
  await expect(page).toHaveTitle('DesignRoom');
});
