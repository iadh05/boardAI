import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createConnectionStore } from '../../../store/connectionStore.ts';
import { RoomStatus } from './RoomStatus.tsx';

const setup = () => {
  const store = createConnectionStore();
  store.getState().setRoom('k3x9a2b7q1zm');
  render(<RoomStatus store={store} />);
  return store;
};

describe('RoomStatus (M2-05)', () => {
  it('says whether edits reach the others', () => {
    const store = setup();
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
    act(() => store.getState().setStatus('connected'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading the board…');
    act(() => store.getState().setLoaded());
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    act(() => store.getState().setStatus('offline'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline — your edits are kept and sent when you’re back',
    );
  });

  it('copies the room link to share it', async () => {
    const user = userEvent.setup();
    setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText');

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(write).toHaveBeenCalledWith(`${window.location.origin}/room/k3x9a2b7q1zm`);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();
  });

  it('when the clipboard is refused, shows the link to copy by hand', async () => {
    const user = userEvent.setup();
    setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(screen.getByRole('textbox', { name: 'Room link' })).toHaveValue(
      `${window.location.origin}/room/k3x9a2b7q1zm`,
    );
  });
});
