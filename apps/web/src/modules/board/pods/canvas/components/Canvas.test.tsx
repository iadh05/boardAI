import { createNode, type Board } from '@designroom/domain';
import { act, render, screen } from '@testing-library/react';
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
  const store = createBoardStore({ newId: () => 'x', initialBoard: board });
  render(
    <div style={{ width: 800, height: 600 }}>
      <Canvas store={store} />
    </div>,
  );
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

  it('has zoom controls', () => {
    renderCanvas(boardWithTwoNodes);
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
  });
});
