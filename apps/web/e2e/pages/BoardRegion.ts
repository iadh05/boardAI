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

  /**
   * Where a box sits on the board (diagram coordinates, the same in every tab whatever the zoom).
   * No accessible handle carries it: read from the diagram's node wrapper.
   */
  async positionOf(label: string): Promise<{ x: number; y: number }> {
    // The node's group is the diagram's node wrapper itself: its style carries the position.
    const style = (await this.node(label).getAttribute('style')) ?? '';
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(style);
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  }

  /**
   * The panel holding the toolbars, on screen. The toolbars themselves have no box of their own
   * (they flow inside the panel's), so this is their parent.
   */
  toolbarPanel(): Locator {
    return this.diagram.getByRole('toolbar', { name: 'Add a node' }).locator('xpath=..');
  }

  /** One click on the diagram's zoom-out button. */
  async zoomOut(): Promise<void> {
    await this.diagram.getByRole('button', { name: 'Zoom Out' }).click();
  }

  /** Moves the pointer over the board (others see it as a live cursor). */
  async hover(): Promise<void> {
    const box = await this.diagram.boundingBox();
    if (!box) throw new Error('the diagram is not on screen');
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  }

  /** Other people's cursors on the board, by the name they show ("Guest 42"). */
  cursors(): Locator {
    return this.diagram.getByText(/^Guest \d{2}$/);
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

  /**
   * Adds these kinds in order and connects each to the next — e.g. the M1 demo chain. A diagonal
   * staircase, so the arrows are not straight lines (a 0 px tall line never counts as visible).
   */
  async drawChain(kinds: readonly string[]): Promise<void> {
    for (const [i, kind] of kinds.entries()) {
      await this.addNode(kind);
      await this.move(kind, (i - (kinds.length - 1) / 2) * 160, (i - (kinds.length - 1) / 2) * 70);
    }
    for (const [i, kind] of kinds.slice(1).entries()) await this.connect(kinds[i] ?? '', kind);
  }

  edge(from: string, to: string): Locator {
    return this.diagram.getByRole('group', { name: `From ${from} to ${to}`, exact: true });
  }

  readonly arrowLabelInput = (): Locator =>
    this.diagram.getByRole('textbox', { name: 'Arrow label' });

  /** Adds a zone (centred on the view) and names it. */
  async addZone(name: string): Promise<void> {
    await this.diagram
      .getByRole('toolbar', { name: 'Add a node' })
      .getByRole('button', { name: 'Add Zone' })
      .click();
    await this.diagram.getByRole('textbox', { name: 'Zone label' }).fill(name);
    await this.diagram.getByRole('textbox', { name: 'Zone label' }).press('Enter');
  }

  zone(name: string): Locator {
    return this.diagram.getByRole('group', { name: `Zone: ${name}`, exact: true });
  }

  /** Drags a zone by its title, by (dx, dy) screen pixels. */
  async moveZone(name: string, dx: number, dy: number): Promise<void> {
    const box = await this.zone(name).getByText(name, { exact: true }).boundingBox();
    if (!box) throw new Error(`zone "${name}" is not on screen`);
    const x = box.x + 10;
    const y = box.y + box.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + 5, y);
    await this.page.mouse.move(x + dx, y + dy, { steps: 5 });
    await this.page.mouse.up();
  }

  arrowLabel(text: string): Locator {
    return this.diagram.getByText(text, { exact: true });
  }

  /** Opens the arrow editor, types its label, and toggles Async if asked; saves with Enter. */
  async describeArrow(from: string, to: string, label: string, opts: { async?: boolean } = {}) {
    // A straight arrow's SVG box is 0 px tall (strokes don't count), so Playwright never calls it
    // "visible". Users hit React Flow's 20 px invisible hit area: double-click the line's centre.
    const box = await this.edge(from, to).boundingBox();
    if (!box) throw new Error(`arrow ${from} → ${to} is not on screen`);
    await this.page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    if (opts.async) await this.diagram.getByRole('button', { name: 'Async' }).click();
    await this.arrowLabelInput().fill(label);
    await this.arrowLabelInput().press('Enter');
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
