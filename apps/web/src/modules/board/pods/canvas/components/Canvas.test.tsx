import { createNode, type Board } from '@designroom/domain';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createBoardStore } from '../../../store/boardStore.ts';
import { Canvas } from './Canvas.tsx';

const boardWithTwoNodes: Board = {
  nodes: [
    { ...createNode('api', 'api', { x: 0, y: 0 }), label: 'Orders API' },
    createNode('db', 'database', { x: 240, y: 0 }),
  ],
  edges: [{ id: 'e1', source: 'api', target: 'db' }],
};

const renderCanvas = (board: Board) => {
  const store = createBoardStore({ newId: () => 'x' });
  render(
    <div style={{ width: 800, height: 600 }}>
      <Canvas store={store} />
    </div>,
  );
  // Load the board after mount: in jsdom React Flow never measures nodes present on the first
  // render, so they (and their edges) never show. Browsers are fine.
  act(() => store.setState({ board }));
  return store;
};

describe('Canvas', () => {
  it('shows every node of the board with its label', () => {
    renderCanvas(boardWithTwoNodes);

    expect(screen.getByText('Orders API')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
  });

  it('shows a pending proposal as a ghost node marked as proposed', () => {
    const store = renderCanvas(boardWithTwoNodes);

    act(() => {
      store.getState().setProposal({
        id: 'p1',
        summary: 'Add a cache',
        ops: [{ op: 'addNode', nodeId: 'cache', kind: 'cache', label: 'Redis', near: 'api' }],
      });
    });

    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByText(/proposed/i)).toBeInTheDocument();
  });

  it('Backspace on a selected node removes it and its edges, through the store', async () => {
    const store = renderCanvas(boardWithTwoNodes);
    const label = screen.getByText('Orders API');

    // A plain click selects without a mousedown: jsdom gives mousedown a null `view`, which
    // React Flow's drag library (d3-drag) can't handle. Real browsers are fine.
    fireEvent.click(label);
    await userEvent.keyboard('{Backspace}');

    expect(store.getState().board.nodes.map((n) => n.id)).toEqual(['db']);
    expect(store.getState().board.edges).toEqual([]);
    expect(store.getState().lastError).toBeNull();
    expect(screen.queryByText('Orders API')).not.toBeInTheDocument();
  });

  it('the Delete key works too', async () => {
    const store = renderCanvas(boardWithTwoNodes);
    fireEvent.click(screen.getByText('Database'));
    await userEvent.keyboard('{Delete}');
    expect(store.getState().board.nodes.map((n) => n.id)).toEqual(['api']);
  });

  it('deleting a selected edge removes only that edge', async () => {
    const store = renderCanvas(boardWithTwoNodes);

    fireEvent.click(await screen.findByLabelText('From Orders API to Database'));
    await userEvent.keyboard('{Backspace}');

    expect(store.getState().board.edges).toEqual([]);
    expect(store.getState().board.nodes).toHaveLength(2);
  });

  it('ghost nodes cannot be deleted', async () => {
    const store = renderCanvas(boardWithTwoNodes);
    act(() => {
      store.getState().setProposal({
        id: 'p1',
        summary: 'Add a cache',
        ops: [{ op: 'addNode', nodeId: 'cache', kind: 'cache', label: 'Redis', near: 'api' }],
      });
    });

    fireEvent.click(screen.getByText('Redis'));
    await userEvent.keyboard('{Backspace}');

    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(store.getState().proposal).not.toBeNull();
  });

  it('has zoom controls', () => {
    renderCanvas(boardWithTwoNodes);
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
  });
});
