import { createNode, MAX_LABEL_LENGTH, type Board } from '@designroom/domain';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createBoardStore } from '../../../store/boardStore.ts';
import { Canvas } from '../../canvas/index.ts';

const renderBoard = (board: Board) => {
  const store = createBoardStore({ newId: () => 'new' });
  render(
    <div style={{ width: 800, height: 600 }}>
      <Canvas store={store} />
    </div>,
  );
  // Load the board after mount: in jsdom React Flow never measures nodes present on the first
  // render, so they stay `visibility: hidden` (invisible to role queries). Browsers are fine.
  act(() => store.setState({ board }));
  return store;
};

const oneNode = (label = 'Orders DB'): Board => ({
  nodes: [{ ...createNode('db', 'database', { x: 0, y: 0 }), label }],
  edges: [],
});

/** The node (React Flow's wrapper, named after the label) — what you focus and double-click. */
const nodeShowing = (label: string) => screen.getByRole('group', { name: label });

const labelInput = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Node label' });

describe('SystemNode', () => {
  it('shows the label and an icon named after the kind', () => {
    renderBoard(oneNode());
    const node = nodeShowing('Orders DB');
    expect(within(node).getByRole('img', { name: 'Database' })).toBeInTheDocument();
  });

  it('double-click opens the label in an input with all text selected', () => {
    renderBoard(oneNode());
    fireEvent.doubleClick(nodeShowing('Orders DB'));

    const input = labelInput();
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Orders DB');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Orders DB'.length]);
  });

  it('Enter saves the new label', async () => {
    const store = renderBoard(oneNode());
    fireEvent.doubleClick(nodeShowing('Orders DB'));

    await userEvent.keyboard('Users DB{Enter}');

    expect(store.getState().board.nodes[0]?.label).toBe('Users DB');
    expect(screen.queryByRole('textbox', { name: 'Node label' })).not.toBeInTheDocument();
    expect(screen.getByText('Users DB')).toBeVisible();
  });

  it('leaving the input (blur) saves too', async () => {
    const store = renderBoard(oneNode());
    fireEvent.doubleClick(nodeShowing('Orders DB'));

    await userEvent.keyboard('Users DB');
    fireEvent.blur(labelInput());

    expect(store.getState().board.nodes[0]?.label).toBe('Users DB');
  });

  it('Escape cancels and keeps the old label', async () => {
    const store = renderBoard(oneNode());
    fireEvent.doubleClick(nodeShowing('Orders DB'));

    await userEvent.keyboard('Nope{Escape}');

    expect(store.getState().board.nodes[0]?.label).toBe('Orders DB');
    expect(screen.queryByRole('textbox', { name: 'Node label' })).not.toBeInTheDocument();
  });

  it('an empty label falls back to the kind name', async () => {
    const store = renderBoard(oneNode());
    fireEvent.doubleClick(nodeShowing('Orders DB'));

    await userEvent.clear(labelInput());
    await userEvent.keyboard('{Enter}');

    expect(store.getState().board.nodes[0]?.label).toBe('Database');
  });

  it('Backspace edits the text and never removes the node', async () => {
    const store = renderBoard(oneNode());
    fireEvent.doubleClick(nodeShowing('Orders DB'));

    await userEvent.keyboard('{End}{Backspace}{Backspace}{Delete}{Enter}');

    expect(store.getState().board.nodes).toHaveLength(1);
    expect(store.getState().board.nodes[0]?.label).toBe('Orders'); // trimmed by the domain
  });

  it('pasted tabs and line breaks become spaces instead of making the rename fail', async () => {
    const store = renderBoard(oneNode());
    fireEvent.doubleClick(nodeShowing('Orders DB'));

    await userEvent.paste('Users	DB');
    await userEvent.keyboard('{Enter}');

    expect(store.getState().board.nodes[0]?.label).toBe('Users DB');
  });

  it('after Enter or Escape, focus goes back to the node', async () => {
    renderBoard(oneNode());
    fireEvent.doubleClick(nodeShowing('Orders DB'));
    await userEvent.keyboard('Users DB{Enter}');
    expect(nodeShowing('Users DB')).toHaveFocus();

    fireEvent.doubleClick(nodeShowing('Users DB'));
    await userEvent.keyboard('{Escape}');
    expect(nodeShowing('Users DB')).toHaveFocus();
  });

  it('the input keeps labels within the domain limit', () => {
    renderBoard(oneNode());
    fireEvent.doubleClick(nodeShowing('Orders DB'));
    expect(labelInput()).toHaveAttribute('maxLength', String(MAX_LABEL_LENGTH));
  });

  it('can be renamed with the keyboard: Enter on the focused node', async () => {
    renderBoard(oneNode());
    nodeShowing('Orders DB').focus();

    await userEvent.keyboard('{Enter}');

    expect(labelInput()).toHaveFocus();
  });
});

describe('Custom nodes from the toolbar', () => {
  it('open straight into label editing', async () => {
    const store = renderBoard({ nodes: [], edges: [] });

    await userEvent.click(screen.getByRole('button', { name: 'Add Custom' }));
    await userEvent.keyboard('Payment provider{Enter}');

    expect(store.getState().board.nodes).toMatchObject([
      { kind: 'custom', label: 'Payment provider' },
    ]);
  });

  it('other kinds do not', async () => {
    renderBoard({ nodes: [], edges: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Add Cache' }));
    expect(screen.queryByRole('textbox', { name: 'Node label' })).not.toBeInTheDocument();
  });
});
