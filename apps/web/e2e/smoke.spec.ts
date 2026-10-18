import { expect, test } from '@playwright/test';

test('the app loads with its header, canvas and assistant panel', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('DesignRoom');
  await expect(page.getByRole('heading', { level: 1, name: 'DesignRoom' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Assistant' })).toBeVisible();
});
