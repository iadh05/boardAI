import { KIND_DEFAULT_LABEL, NODE_KINDS } from '@designroom/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createBoardStore } from '../../../store/boardStore.ts';
import { Canvas } from '../../canvas/index.ts';

const renderBoard = () => {
  let next = 0;
  const store = createBoardStore({ newId: () => `n${++next}` });
  render(
    <div style={{ width: 800, height: 600 }}>
      <Canvas store={store} />
    </div>,
  );
  return store;
};

describe('Toolbar', () => {
  it('has one labelled button per kind, in a toolbar', () => {
    renderBoard();
    const toolbar = screen.getByRole('toolbar', { name: 'Add a node' });

    for (const kind of NODE_KINDS) {
      expect(
        within(toolbar).getByRole('button', { name: `Add ${KIND_DEFAULT_LABEL[kind]}` }),
      ).toBeInTheDocument();
    }
  });

  it('adds a node of that kind with its default label', async () => {
    const store = renderBoard();

    await userEvent.click(screen.getByRole('button', { name: 'Add Database' }));

    expect(store.getState().board.nodes).toMatchObject([{ kind: 'database', label: 'Database' }]);
    expect(await screen.findByText('Database', { selector: '.react-flow__node *' })).toBeVisible();
  });

  it('three clicks give three nodes in three different places', async () => {
    const store = renderBoard();
    const button = screen.getByRole('button', { name: 'Add API' });

    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);

    const positions = store.getState().board.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(positions).toHaveLength(3);
    expect(new Set(positions).size).toBe(3);
  });
});

describe('Custom nodes from the toolbar', () => {
  it('open straight into label editing', async () => {
    const store = renderBoard();

    await userEvent.click(screen.getByRole('button', { name: 'Add Custom' }));
    await userEvent.keyboard('Payment provider{Enter}');

    expect(store.getState().board.nodes).toMatchObject([
      { kind: 'custom', label: 'Payment provider' },
    ]);
  });

  it('other kinds do not', async () => {
    renderBoard();
    await userEvent.click(screen.getByRole('button', { name: 'Add Cache' }));
    expect(screen.queryByRole('textbox', { name: 'Node label' })).not.toBeInTheDocument();
  });
});

describe('Zones from the toolbar', () => {
  it('"Add Zone" draws a zone and opens its title for naming', async () => {
    const store = renderBoard();

    await userEvent.click(screen.getByRole('button', { name: 'Add Zone' }));
    await userEvent.keyboard('VPC{Enter}');

    expect(store.getState().board.zones).toMatchObject([{ label: 'VPC' }]);
  });

  it('says how to connect once there are two boxes, in the toolbar panel — never over the boxes', async () => {
    const store = renderBoard();
    const user = userEvent.setup();
    const hint = /drag from a dot on the side of a box/i;

    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add API' }));
    await user.click(screen.getByRole('button', { name: 'Add Database' }));

    const panel = screen.getByRole('toolbar', { name: 'Add a node' }).parentElement;
    expect(within(panel ?? document.body).getByText(hint)).toBeInTheDocument();

    const [a, b] = store.getState().board.nodes;
    store.getState().connect(a?.id ?? '', b?.id ?? '');
    await waitFor(() => expect(screen.queryByText(hint)).not.toBeInTheDocument());
  });
});
