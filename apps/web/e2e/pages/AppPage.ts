import type { Locator, Page } from '@playwright/test';
import { BoardRegion } from './BoardRegion.ts';
import { ChatPanel } from './ChatPanel.ts';

/** The whole app: header, canvas area and assistant panel. Locators only — specs assert. */
export class AppPage {
  readonly heading: Locator;
  readonly canvas: Locator;
  readonly assistantPanel: Locator;
  readonly board: BoardRegion;
  readonly chat: ChatPanel;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
    this.canvas = page.getByRole('main');
    this.assistantPanel = page.getByRole('complementary', { name: 'Assistant' });
    this.board = new BoardRegion(page);
    this.chat = new ChatPanel(page);
  }

  async open(): Promise<void> {
    await this.page.goto('/');
  }

  title(): Promise<string> {
    return this.page.title();
  }
}
