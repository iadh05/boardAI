import type { Locator, Page } from '@playwright/test';

/** The whole app: header, canvas area and assistant panel. Locators only — specs assert. */
export class AppPage {
  readonly heading: Locator;
  readonly canvas: Locator;
  readonly assistantPanel: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
    this.canvas = page.getByRole('main');
    this.assistantPanel = page.getByRole('complementary', { name: 'Assistant' });
  }

  async open(): Promise<void> {
    await this.page.goto('/');
  }

  title(): Promise<string> {
    return this.page.title();
  }
}
