import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SendMessageDeps } from '../../../api/sendMessage.ts';
import { createBoardStore } from '../../../../board/index.ts';
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
  let id = 0;
  const board = createBoardStore({ newId: () => `b${++id}` });
  const deps: SendMessageDeps = {
    fetch: control.fetchFn,
    chat: createChatStore({ newId: () => crypto.randomUUID() }),
    currentBoard: () => ({ nodes: [], edges: [] }),
    showProposal: (p) => board.getState().setProposal(p),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Conversation deps={deps} board={board} />
    </QueryClientProvider>,
  );
  const input = screen.getByRole('textbox', { name: 'Message the assistant' });
  const log = screen.getByRole('log', { name: 'Conversation' });
  return { ...control, board, input, log, user: userEvent.setup() };
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

  it('while answering: the next question can be typed but not sent, and Stop replaces Send', async () => {
    const { input, user, fetchFn } = renderChat();

    await user.type(input, 'Review it{Enter}');
    await user.type(input, 'And the API?{Enter}');

    expect(fetchFn).toHaveBeenCalledTimes(1); // one answer at a time
    expect(input).toHaveValue('And the API?'); // kept, to send when the answer is done
    expect(input).toHaveFocus(); // the keyboard never leaves the chat
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('marks the log busy while the answer streams, so screen readers read it once', async () => {
    const { input, log, user, answer } = renderChat();

    await user.type(input, 'Review it{Enter}');
    expect(log).toHaveAttribute('aria-busy', 'true');

    answer(sse({ type: 'done' }));
    await waitFor(() => expect(log).toHaveAttribute('aria-busy', 'false'));
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
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
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

  it('shows the AI’s proposal under its answer; Accept puts it on the board', async () => {
    const { input, user, answer, board } = renderChat();
    const api = board.getState().addNode('api', { x: 0, y: 0 }) ?? '';

    await user.type(input, 'Review it{Enter}');
    answer(
      sse(
        { type: 'text', delta: 'Add a cache.' },
        {
          type: 'proposal',
          proposal: {
            id: 'p1',
            summary: 'Add cache "Redis"',
            ops: [{ op: 'addNode', nodeId: 'cache', kind: 'cache', label: 'Redis', near: api }],
          },
        },
        { type: 'done' },
      ),
    );

    const card = await screen.findByRole('region', { name: 'Proposed change' });
    expect(card).toHaveTextContent('Add cache "Redis"');
    await user.click(within(card).getByRole('button', { name: 'Accept' }));

    expect(board.getState().board.nodes.map((n) => n.label)).toContain('Redis');
    expect(screen.queryByRole('region', { name: 'Proposed change' })).not.toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveTextContent(
      'Accepted: Add cache "Redis"',
    );
  });

  it('Reject clears the proposal and leaves the board as it was', async () => {
    const { board, user } = renderChat();
    act(() =>
      board.getState().setProposal({
        id: 'p1',
        summary: 'Add cache "Redis"',
        ops: [{ op: 'addNode', nodeId: 'cache', kind: 'cache', label: 'Redis' }],
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Reject' }));

    expect(board.getState()).toMatchObject({ proposal: null, board: { nodes: [] } });
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveTextContent(
      'Rejected: Add cache "Redis"',
    );
  });
});
