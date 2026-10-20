import { test as base } from '@playwright/test';
import { ChatApi } from './api/ChatApi.ts';
import { AppPage } from './pages/AppPage.ts';

// Specs import `test` and `expect` from here and receive page objects as fixtures
// (docs/rules/e2e.md — Page Object Model).
type Fixtures = {
  app: AppPage;
  chatApi: ChatApi;
  /**
   * A second person, in a separate browser context (M2). Not a second tab of the same browser:
   * tabs could share state locally, and a test must prove the server synced it.
   */
  other: AppPage;
};

export const test = base.extend<Fixtures>({
  app: async ({ page }, use) => {
    await use(new AppPage(page));
  },
  other: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext(baseURL ? { baseURL } : {});
    await use(new AppPage(await context.newPage()));
    await context.close();
  },
  chatApi: async ({ request }, use) => {
    await use(new ChatApi(request));
  },
});

export { expect } from '@playwright/test';
