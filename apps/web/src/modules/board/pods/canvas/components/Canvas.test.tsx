import { createNode, MAX_LABEL_LENGTH, type Board } from '@designroom/domain';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createBoardStore } from '../../../store/boardStore.ts';
import { Canvas } from './Canvas.tsx';

// The diagram's own behaviour is tested in @designroom/diagram. These tests check the wiring:
// what the board store holds is drawn, and what the user does reaches the store.

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

const node = (name: string) => screen.getByRole('group', { name });
const labelInput = () => screen.getByRole('textbox', { name: 'Node label' });

describe('Canvas — drawing the board', () => {
  it('shows every node with its label and an icon naming its kind', () => {
    renderCanvas(boardWithTwoNodes);

    expect(node('Orders API')).toHaveTextContent('Orders API');
    expect(screen.getByRole('img', { name: 'API' })).toBeInTheDocument();
    expect(node('Database')).toBeInTheDocument();
    expect(screen.getByLabelText('From Orders API to Database')).toBeInTheDocument();
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

    expect(node('Proposed: Redis')).toHaveTextContent(/proposed/i);
  });

  it('an empty board says how to start', () => {
    renderCanvas({ nodes: [], edges: [] });
    expect(screen.getByText(/add a component from the toolbar/i)).toBeInTheDocument();
  });

  it('the hint goes away once there is something on the board', () => {
    renderCanvas(boardWithTwoNodes);
    expect(screen.queryByText(/add a component from the toolbar/i)).not.toBeInTheDocument();
  });

  it('with boxes but no arrows yet, says how to connect them', () => {
    renderCanvas({ ...boardWithTwoNodes, edges: [] });
    expect(screen.getByText(/drag from a dot on the side of a box/i)).toBeInTheDocument();
  });

  it('the connect hint goes away once there is an arrow', () => {
    renderCanvas(boardWithTwoNodes);
    expect(screen.queryByText(/drag from a dot on the side of a box/i)).not.toBeInTheDocument();
  });

  it('has zoom controls', () => {
    renderCanvas(boardWithTwoNodes);
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
  });
});

describe('Canvas — deleting through the store', () => {
  // A plain click selects without a mousedown: jsdom gives mousedown a null `view`, which
  // React Flow's drag library (d3-drag) can't handle. Real browsers are fine.
  it('Backspace on a selected node removes it and its edges', async () => {
    const store = renderCanvas(boardWithTwoNodes);

    fireEvent.click(screen.getByText('Orders API'));
    await userEvent.keyboard('{Backspace}');

    expect(store.getState().board.nodes.map((n) => n.id)).toEqual(['db']);
    expect(store.getState().board.edges).toEqual([]);
    expect(store.getState().lastError).toBeNull();
  });

  it('the Delete key works too', async () => {
    const store = renderCanvas(boardWithTwoNodes);
    fireEvent.click(within(node('Database')).getByText('Database'));
    await userEvent.keyboard('{Delete}');
    expect(store.getState().board.nodes.map((n) => n.id)).toEqual(['api']);
  });

  it('deleting a selected edge removes only that edge', async () => {
    const store = renderCanvas(boardWithTwoNodes);

    fireEvent.click(screen.getByLabelText('From Orders API to Database'));
    await userEvent.keyboard('{Backspace}');

    expect(store.getState().board.edges).toEqual([]);
    expect(store.getState().board.nodes).toHaveLength(2);
  });
});

describe('Canvas — renaming through the store', () => {
  it('double-click, type, Enter: the store gets the new label', async () => {
    const store = renderCanvas(boardWithTwoNodes);

    fireEvent.doubleClick(node('Database'));
    await userEvent.keyboard('Users DB{Enter}');

    expect(store.getState().board.nodes[1]?.label).toBe('Users DB');
    expect(store.getState().editingNodeId).toBeNull();
  });

  it('an empty label falls back to the kind name (domain rule)', async () => {
    const store = renderCanvas(boardWithTwoNodes);

    fireEvent.doubleClick(node('Orders API'));
    await userEvent.clear(labelInput());
    await userEvent.keyboard('{Enter}');

    expect(store.getState().board.nodes[0]?.label).toBe('API');
  });

  it('the input keeps labels within the domain limit', () => {
    renderCanvas(boardWithTwoNodes);
    fireEvent.doubleClick(node('Database'));
    expect(labelInput()).toHaveAttribute('maxLength', String(MAX_LABEL_LENGTH));
  });
});

describe('Canvas — arrows', () => {
  it('double-click an arrow, type a label, make it async: the store gets both', async () => {
    const store = renderCanvas(boardWithTwoNodes);

    fireEvent.doubleClick(screen.getByLabelText('From Orders API to Database'));
    await userEvent.click(screen.getByRole('button', { name: 'Async' }));
    await userEvent.click(screen.getByRole('textbox', { name: 'Arrow label' }));
    await userEvent.keyboard('events{Enter}');

    expect(store.getState().board.edges[0]).toMatchObject({ label: 'events', mode: 'async' });
  });
});
