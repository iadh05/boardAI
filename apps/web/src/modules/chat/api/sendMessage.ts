import { ChatEventSchema, type Board, type Proposal } from '@designroom/domain';
import type { StoreApi } from 'zustand';
import { readSseJson } from '../../../core/api/readSseJson.ts';
import type { ChatStore } from '../store/chatStore.ts';

// One chat turn: post the board and the conversation, then stream the answer into the chat
// store and hand any proposal to the board (architecture §5.3). A plain function, so it is tested
// without React; useSendMessage wraps it in a React Query mutation.
// Every way it can end — done, an error event, an HTTP error, a lost connection, an unreadable
// event, a cancel — leaves the store not streaming, with a message the user can act on.

export type SendMessageDeps = {
  fetch: typeof fetch;
  chat: StoreApi<ChatStore>;
  /** The board as it is now (board module's public API). */
  currentBoard: () => Board;
  /** Shows the AI's proposal on the board (board module's public API). */
  showProposal: (proposal: Proposal) => void;
};

const MESSAGES = {
  unreachable: "Can't reach the server. Is it running? Try again in a moment.",
  lost: 'The connection was lost before the answer finished. Try again.',
  unreadable: 'The assistant sent something we could not read. Try again.',
  rateLimited: 'Too many requests: wait a minute, then try again.',
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** The server's error shape ({ error: { message } }), or a fallback for other answers. */
const httpErrorMessage = async (res: Response) => {
  if (res.status === 429) return MESSAGES.rateLimited; // from Nginx: not our JSON shape
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // not JSON
  }
  return `The server answered ${res.status}. Try again.`;
};

export const sendMessage = async (
  text: string,
  { fetch, chat, currentBoard, showProposal }: SendMessageDeps,
  signal?: AbortSignal,
): Promise<void> => {
  const store = chat.getState();
  store.addUserMessage(text);
  const messages = store.history();
  store.startAnswer();

  const fail = (message: string) => chat.getState().failAnswer(message);
  const stop = () => chat.getState().finishAnswer();

  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board: currentBoard(), messages }),
      signal,
    });
  } catch (error) {
    if (isAbort(error) || signal?.aborted) return stop();
    return fail(MESSAGES.unreachable);
  }
  if (!res.ok || !res.body) return fail(await httpErrorMessage(res));

  let failed = false;
  try {
    for await (const item of readSseJson(res.body)) {
      const event = item.ok ? ChatEventSchema.safeParse(item.value) : null;
      // Nothing after an unreadable event is trusted: stop here.
      if (!event?.success) return fail(MESSAGES.unreadable);
      switch (event.data.type) {
        case 'text':
          chat.getState().appendToAnswer(event.data.delta);
          break;
        case 'proposal':
          showProposal(event.data.proposal);
          break;
        case 'error':
          failed = true;
          fail(event.data.message);
          break;
        case 'done':
          if (!failed) stop();
          return;
      }
    }
  } catch (error) {
    if (isAbort(error) || signal?.aborted) return stop();
    return fail(MESSAGES.lost);
  }
  // The stream ended without `done`: cut off, whatever arrived before.
  if (!failed) fail(MESSAGES.lost);
};
