import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SendMessageDeps } from '../../../api/sendMessage.ts';
import { createChatStore } from '../../../store/chatStore.ts';
import { Conversation } from './Conversation.tsx';

const sse = (...events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

/** A fetch whose answer the test controls: `answer` sends the body, `fail` a network error. */
const controlledFetch = () => {
  let answer: (res: Response) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const fetchFn = vi.fn<typeof fetch>(
    (_url, init) =>
      new Promise<Response>((resolve, reject) => {
        answer = resolve;
        fail = reject;
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  return {
    fetchFn,
    answer: (body: string, init?: ResponseInit) => answer(new Response(body, init)),
    fail: (error: Error) => fail(error),
  };
};

const renderChat = () => {
  const control = controlledFetch();
  const deps: SendMessageDeps = {
    fetch: control.fetchFn,
    chat: createChatStore({ newId: () => crypto.randomUUID() }),
    currentBoard: () => ({ nodes: [], edges: [] }),
    showProposal: () => {},
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Conversation deps={deps} />
    </QueryClientProvider>,
  );
  const input = screen.getByRole('textbox', { name: 'Message the assistant' });
  const log = screen.getByRole('log', { name: 'Conversation' });
  return { ...control, input, log, user: userEvent.setup() };
};

describe('Conversation', () => {
  it('invites a first question while the conversation is empty', () => {
    const { log } = renderChat();
    expect(within(log).getByText(/ask the assistant to review your design/i)).toBeInTheDocument();
  });

  it('sends on Enter, shows "thinking" until the answer streams in, then shows it', async () => {
    const { input, log, user, answer } = renderChat();

    await user.type(input, 'Review my design{Enter}');

    expect(within(log).getByText('Review my design')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(within(log).getByRole('status')).toHaveTextContent(/thinking/i);

    answer(
      sse(
        { type: 'text', delta: 'Add a cache ' },
        { type: 'text', delta: 'in front of the database.' },
        { type: 'done' },
      ),
    );

    expect(
      await within(log).findByText('Add a cache in front of the database.'),
    ).toBeInTheDocument();
    expect(within(log).queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the input busy while answering, and offers Stop instead of Send', async () => {
    const { input, user } = renderChat();

    await user.type(input, 'Review it{Enter}');

    expect(input).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(input).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('does not send an empty message', async () => {
    const { input, user, fetchFn } = renderChat();
    await user.type(input, '   {Enter}');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('shows the error inline, and the chat keeps working (Ollama stopped)', async () => {
    const { input, log, user, answer } = renderChat();

    await user.type(input, 'Review it{Enter}');
    answer(
      sse(
        { type: 'error', message: "Can't reach the model — is Ollama running?" },
        { type: 'done' },
      ),
    );

    expect(await within(log).findByRole('alert')).toHaveTextContent(
      "Can't reach the model — is Ollama running?",
    );
    expect(input).toBeEnabled();
  });

  it('gives a refused message back to the input, so it can be fixed and resent', async () => {
    const { input, log, user, answer } = renderChat();

    await user.type(input, 'Review it{Enter}');
    answer(
      JSON.stringify({ error: { code: 'BOARD_TOO_LARGE', message: 'The board is too large.' } }),
      {
        status: 413,
        headers: { 'content-type': 'application/json' },
      },
    );

    expect(await within(log).findByRole('alert')).toHaveTextContent('The board is too large.');
    expect(input).toHaveValue('Review it');
    expect(within(log).queryByText('Review it')).not.toBeInTheDocument();
  });
});
