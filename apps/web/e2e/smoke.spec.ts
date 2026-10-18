import { expect, test } from './fixtures.ts';

test(
  'the app loads with its header, canvas and assistant panel',
  { tag: '@smoke' },
  async ({ app }) => {
    await app.open();

    expect(await app.title()).toBe('DesignRoom');
    await expect(app.heading).toHaveText('DesignRoom');
    await expect(app.canvas).toBeVisible();
    await expect(app.assistantPanel).toBeVisible();
  },
);
