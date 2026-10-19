import { test as base } from '@playwright/test';
import { ChatApi } from './api/ChatApi.ts';
import { AppPage } from './pages/AppPage.ts';

// Specs import `test` and `expect` from here and receive page objects as fixtures
// (docs/rules/e2e.md — Page Object Model).
type Fixtures = {
  app: AppPage;
  chatApi: ChatApi;
};

export const test = base.extend<Fixtures>({
  app: async ({ page }, use) => {
    await use(new AppPage(page));
  },
  chatApi: async ({ request }, use) => {
    await use(new ChatApi(request));
  },
});

export { expect } from '@playwright/test';
