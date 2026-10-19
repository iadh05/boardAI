import type { Board, Proposal } from '@designroom/domain';
import { describe, expect, it, vi } from 'vitest';
import { createChatStore } from '../store/chatStore.ts';
import { sendMessage, type SendMessageDeps } from './sendMessage.ts';

const board: Board = {
  nodes: [{ id: 'api', kind: 'api', label: 'API', position: { x: 0, y: 0 } }],
  edges: [],
};

const proposal: Proposal = {
  id: 'p1',
  summary: 'Add cache "Redis"',
  ops: [{ op: 'addNode', nodeId: 'c', kind: 'cache', label: 'Redis' }],
};

const sse = (...events: unknown[]) =>
  events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');

/** A fetch answering with this body (SSE by default), and everything the call touches. */
const setup = (body: string | (() => Promise<Response>), init: ResponseInit = { status: 200 }) => {
  let n = 0;
  const chat = createChatStore({ newId: () => `m${++n}` });
  const shown: Proposal[] = [];
  const fetchFn = vi.fn<typeof fetch>(
    typeof body === 'string' ? () => Promise.resolve(new Response(body, init)) : body,
  );
  const deps: SendMessageDeps = {
    fetch: fetchFn,
    chat,
    currentBoard: () => board,
    showProposal: (p) => shown.push(p),
  };
  return { deps, chat: () => chat.getState(), shown, fetchFn };
};

describe('sendMessage', () => {
  it('posts the board and the conversation to /api/chat', async () => {
    const { deps, fetchFn } = setup(sse({ type: 'done' }));

    await sendMessage('Review my design', deps);

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/chat');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      board,
      messages: [{ role: 'user', content: 'Review my design' }],
    });
  });

  it('streams text into the answer and hands the proposal to the board', async () => {
    const { deps, chat, shown } = setup(
      sse(
        { type: 'text', delta: 'Add ' },
        { type: 'text', delta: 'a cache.' },
        { type: 'proposal', proposal },
        { type: 'done' },
      ),
    );

    await sendMessage('Review my design', deps);

    expect(chat().messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Review my design' },
      { role: 'assistant', content: 'Add a cache.' },
    ]);
    expect(shown).toEqual([proposal]);
    expect(chat()).toMatchObject({ streaming: false, error: null });
  });

  it('shows the server’s error event to the user', async () => {
    const { deps, chat } = setup(
      sse(
        { type: 'error', message: "Can't reach the model — is Ollama running?" },
        { type: 'done' },
      ),
    );

    await sendMessage('Hi', deps);

    expect(chat()).toMatchObject({
      streaming: false,
      error: "Can't reach the model — is Ollama running?",
    });
  });

  it('does not send while an answer is still streaming', async () => {
    const { deps, chat, fetchFn } = setup(sse({ type: 'done' }));
    chat().startAnswer();

    await sendMessage('Another question', deps);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(chat().messages.filter((m) => m.role === 'user')).toEqual([]);
  });

  it('ignores an empty message', async () => {
    const { deps, chat, fetchFn } = setup(sse({ type: 'done' }));
    await sendMessage('   ', deps);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(chat().messages).toEqual([]);
  });

  it('refuses a message over the limit before sending it, saying how long it may be', async () => {
    const { deps, chat, fetchFn } = setup(sse({ type: 'done' }));

    await sendMessage('x'.repeat(4_001), deps);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(chat().messages).toEqual([]);
    expect(chat().error).toMatch(/4,000 characters/);
  });

  it('shows the message of an HTTP error', async () => {
    const body = JSON.stringify({
      error: { code: 'BOARD_TOO_LARGE', message: 'The board is too large.' },
    });
    const { deps, chat } = setup(body, {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });

    await sendMessage('Hi', deps);

    expect(chat().error).toBe('The board is too large.');
    // The question was never answered: it leaves the history, so the next send isn't refused too.
    expect(chat().history()).toEqual([]);
  });

  it('explains Nginx’s body limit, whose answer is not JSON', async () => {
    const { deps, chat } = setup('<html>413 Request Entity Too Large</html>', { status: 413 });
    await sendMessage('Hi', deps);
    expect(chat().error).toMatch(/board is too large/i);
  });

  it('explains the rate limit, whose answer comes from Nginx and is not JSON', async () => {
    const { deps, chat } = setup('<html>429 Too Many Requests</html>', { status: 429 });
    await sendMessage('Hi', deps);
    expect(chat().error).toMatch(/too many requests.*wait/i);
  });

  it('says the server is unreachable when the request fails', async () => {
    const { deps, chat } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await sendMessage('Hi', deps);
    expect(chat()).toMatchObject({
      streaming: false,
      error: expect.stringMatching(/can't reach the server/i) as unknown,
    });
  });

  it('treats a stream that ends without done as a lost connection, keeping what arrived', async () => {
    const { deps, chat } = setup(sse({ type: 'text', delta: 'Half an' }));

    await sendMessage('Hi', deps);

    expect(chat().error).toMatch(/connection was lost/i);
    expect(chat().messages.at(-1)?.content).toBe('Half an');
  });

  it('treats a connection that drops while reading as lost too', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse({ type: 'text', delta: 'Start' })));
        controller.error(new TypeError('network error'));
      },
    });
    const { deps, chat } = setup(() => Promise.resolve(new Response(stream)));

    await sendMessage('Hi', deps);

    expect(chat().error).toMatch(/connection was lost/i);
  });

  it('refuses an event it cannot read, whether broken JSON or the wrong shape', async () => {
    for (const bad of ['{not json', { type: 'surprise' }]) {
      const { deps, chat, shown } = setup(
        sse(bad, { type: 'proposal', proposal }, { type: 'done' }),
      );

      await sendMessage('Hi', deps);

      expect(chat().error).toMatch(/could not read/i);
      expect(shown).toEqual([]); // nothing after a bad event is trusted
    }
  });

  it('stops quietly when cancelled, keeping the text so far', async () => {
    const controller = new AbortController();
    const { deps, chat } = setup(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });

    await sendMessage('Hi', deps, controller.signal);

    expect(chat()).toMatchObject({ streaming: false, error: null });
  });
});
