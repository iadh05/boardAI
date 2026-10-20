import { Diagram } from '@designroom/diagram';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createPresenceStore } from '../../../store/presenceStore.ts';
import { RemoteCursors } from './RemoteCursors.tsx';

const setup = () => {
  const store = createPresenceStore();
  render(
    <div style={{ width: 800, height: 600 }}>
      <Diagram nodes={[]} edges={[]}>
        <RemoteCursors store={store} />
      </Diagram>
    </div>,
  );
  return store;
};

describe('RemoteCursors (M2-06)', () => {
  it('shows each other person’s pointer with their name, where it is on the board', () => {
    const store = setup();
    act(() =>
      store.getState().setOthers([
        { id: 1, name: 'Guest 42', color: 2, cursor: { x: 100, y: 50 } },
        { id: 2, name: 'Guest 07', color: 5, cursor: null }, // pointer off the board
      ]),
    );

    expect(screen.getByText('Guest 42')).toBeInTheDocument();
    expect(screen.queryByText('Guest 07')).not.toBeInTheDocument();
  });

  it('a person who leaves takes their cursor with them', () => {
    const store = setup();
    act(() =>
      store.getState().setOthers([{ id: 1, name: 'Guest 42', color: 2, cursor: { x: 1, y: 1 } }]),
    );
    act(() => store.getState().setOthers([]));
    expect(screen.queryByText('Guest 42')).not.toBeInTheDocument();
  });
});
