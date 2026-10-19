import type { Locator, Page } from '@playwright/test';

/** The assistant panel: conversation, the AI's proposal, the input. Actions and locators only. */
export class ChatPanel {
  readonly conversation: Locator;
  readonly proposal: Locator;
  readonly sendButton: Locator;
  private readonly input: Locator;
  private readonly stopButton: Locator;

  constructor(page: Page) {
    const panel = page.getByRole('complementary', { name: 'Assistant' });
    this.conversation = panel.getByRole('log', { name: 'Conversation' });
    this.proposal = panel.getByRole('region', { name: 'Proposed change' });
    this.input = panel.getByRole('textbox', { name: 'Message the assistant' });
    this.sendButton = panel.getByRole('button', { name: 'Send' });
    this.stopButton = panel.getByRole('button', { name: 'Stop' });
  }

  /** Stops the answer being written. */
  async stop(): Promise<void> {
    await this.stopButton.click();
  }

  async sendMessage(text: string): Promise<void> {
    await this.input.fill(text);
    await this.input.press('Enter');
  }

  async accept(): Promise<void> {
    await this.proposal.getByRole('button', { name: 'Accept' }).click();
  }

  async reject(): Promise<void> {
    await this.proposal.getByRole('button', { name: 'Reject' }).click();
  }

  /** Why the proposal could not be applied (e.g. out of date). */
  proposalProblem(): Locator {
    return this.proposal.getByRole('alert');
  }
}
