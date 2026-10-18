import type { Locator, Page } from '@playwright/test';

/** The diagram: toolbar, nodes and their label editor. Actions and locators only — specs assert. */
export class BoardRegion {
  readonly nodes: Locator;
  readonly labelInput: Locator;
  private readonly diagram: Locator;

  constructor(page: Page) {
    this.diagram = page.getByRole('application', { name: 'Diagram' });
    this.nodes = this.diagram.getByRole('group');
    this.labelInput = this.diagram.getByRole('textbox', { name: 'Node label' });
  }

  /** `kind` as the toolbar names it: "Database", "Load Balancer", "Custom"… */
  async addNode(kind: string): Promise<void> {
    await this.diagram
      .getByRole('toolbar', { name: 'Add a node' })
      .getByRole('button', { name: `Add ${kind}` })
      .click();
  }

  node(label: string): Locator {
    return this.diagram.getByRole('group', { name: label, exact: true });
  }

  /** Types into the open label editor and saves with Enter. */
  async typeLabel(text: string): Promise<void> {
    await this.labelInput.fill(text);
    await this.labelInput.press('Enter');
  }

  async rename(label: string, to: string): Promise<void> {
    // The icon: always inside the node, never covered by the label's own text selection.
    await this.node(label).getByRole('img').dblclick();
    await this.typeLabel(to);
  }
}
