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
  /** The room's connection badge in the header (M2): "Connected", "Offline…". */
  readonly connection: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
    this.connection = page.getByRole('banner').getByRole('status');
    this.canvas = page.getByRole('main');
    this.assistantPanel = page.getByRole('complementary', { name: 'Assistant' });
    this.board = new BoardRegion(page);
    this.chat = new ChatPanel(page);
  }

  async open(): Promise<void> {
    await this.page.goto('/');
  }

  /** Opens a room by its link, as someone it was shared with would. */
  async openRoom(link: string): Promise<void> {
    await this.page.goto(link);
  }

  /** The link of the room this page is in (what "Copy link" shares). */
  roomLink(): string {
    return this.page.url();
  }

  /** Cuts this browser off the network, or brings it back (M2: offline editing). */
  async setOffline(offline: boolean): Promise<void> {
    await this.page.context().setOffline(offline);
  }

  /** Undo / Redo of this person's own changes (the History toolbar). */
  async undo(): Promise<void> {
    await this.page
      .getByRole('toolbar', { name: 'History' })
      .getByRole('button', { name: 'Undo' })
      .click();
  }

  title(): Promise<string> {
    return this.page.title();
  }
}
