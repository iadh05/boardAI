import type { Locator, Page } from '@playwright/test';

/** The diagram: toolbar, nodes and their label editor. Actions and locators only — specs assert. */
export class BoardRegion {
  readonly nodes: Locator;
  readonly labelInput: Locator;
  private readonly diagram: Locator;

  constructor(private readonly page: Page) {
    this.diagram = page.getByRole('application', { name: 'Diagram' });
    // Nodes and edges are both role "group"; only nodes contain a kind icon.
    this.nodes = this.diagram.getByRole('group').filter({ has: page.getByRole('img') });
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

  /** Drags a node by its icon, by (dx, dy) screen pixels. */
  async move(label: string, dx: number, dy: number): Promise<void> {
    const box = await this.node(label).getByRole('img').boundingBox();
    if (!box) throw new Error(`node "${label}" is not on screen`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    // The drag only starts on the first move, and that move's distance is not applied: start
    // with a tiny one so the node lands where asked (5 px short at most).
    await this.page.mouse.move(x + 5, y);
    await this.page.mouse.move(x + dx, y + dy, { steps: 5 });
    await this.page.mouse.up();
  }

  /** Drags from the right side of one node to the left side of another (any side works). */
  async connect(from: string, to: string): Promise<void> {
    await this.node(from)
      .getByTestId('connect-right')
      .dragTo(this.node(to).getByTestId('connect-left'));
  }

  edge(from: string, to: string): Locator {
    return this.diagram.getByRole('group', { name: `From ${from} to ${to}`, exact: true });
  }

  /** Selects a node or edge with a click and presses Delete. */
  async delete(element: Locator): Promise<void> {
    await element.click();
    await this.page.keyboard.press('Delete');
  }

  async rename(label: string, to: string): Promise<void> {
    // The icon: always inside the node, never covered by the label's own text selection.
    await this.node(label).getByRole('img').dblclick();
    await this.typeLabel(to);
  }
}
