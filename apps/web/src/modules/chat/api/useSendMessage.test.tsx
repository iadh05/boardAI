import type { Board } from '@designroom/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createChatStore } from '../store/chatStore.ts';
import type { SendMessageDeps } from './sendMessage.ts';
import { useSendMessage } from './useSendMessage.ts';

const board: Board = { nodes: [], edges: [] };

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

/** A fetch whose answer the test releases, so "sending" can be observed in between. */
const pendingFetch = () => {
  let release: (res: Response) => void = () => {};
  const fetchFn = vi.fn<typeof fetch>(
    (_url, init) =>
      new Promise<Response>((resolve, reject) => {
        release = resolve;
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  return { fetchFn, release: (body: string) => release(new Response(body)) };
};

const setup = () => {
  const chat = createChatStore({ newId: () => crypto.randomUUID() });
  const { fetchFn, release } = pendingFetch();
  const deps: SendMessageDeps = {
    fetch: fetchFn,
    chat,
    currentBoard: () => board,
    showProposal: () => {},
  };
  const { result } = renderHook(() => useSendMessage(deps), { wrapper });
  return { result, chat, fetchFn, release };
};

describe('useSendMessage', () => {
  it('sends, says it is sending, and ends with the answer in the store', async () => {
    const { result, chat, release } = setup();

    act(() => result.current.send('Review my design'));
    await waitFor(() => expect(result.current.isSending).toBe(true));
    release('data: {"type":"text","delta":"Looks fine."}\n\ndata: {"type":"done"}\n\n');

    await waitFor(() => expect(result.current.isSending).toBe(false));
    expect(chat.getState().messages.at(-1)?.content).toBe('Looks fine.');
  });

  it('cancels the request in flight', async () => {
    const { result, chat, fetchFn } = setup();

    act(() => result.current.send('Review my design'));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    act(() => result.current.cancel());

    await waitFor(() => expect(result.current.isSending).toBe(false));
    expect(chat.getState()).toMatchObject({ streaming: false, error: null });
  });
});
