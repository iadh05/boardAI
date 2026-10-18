import { test as base } from '@playwright/test';
import { AppPage } from './pages/AppPage.ts';

// Specs import `test` and `expect` from here and receive page objects as fixtures
// (docs/rules/e2e.md — Page Object Model).
type Fixtures = {
  app: AppPage;
};

export const test = base.extend<Fixtures>({
  app: async ({ page }, use) => {
    await use(new AppPage(page));
  },
});

export { expect } from '@playwright/test';
