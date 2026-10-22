import {
  ChatEventSchema,
  ErrorResponseSchema,
  MAX_MESSAGE_LENGTH,
  type Board,
  type Proposal,
} from '@designroom/domain';
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
  tooLong: `Messages are limited to ${MAX_MESSAGE_LENGTH.toLocaleString('en')} characters. Shorten it and send again.`,
  unreachable: "Can't reach the server. Is it running? Try again in a moment.",
  lost: 'The connection was lost before the answer finished. Try again.',
  unreadable: 'The assistant sent something we could not read. Try again.',
  rateLimited: 'Too many requests: wait a minute, then try again.',
  boardTooLarge: 'The board is too large for the assistant. Try with a smaller board.',
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** The API's error message; Nginx's own answers (429, 413) are not our JSON shape. */
const httpErrorMessage = async (res: Response) => {
  const body = ErrorResponseSchema.safeParse(await res.json().catch(() => null));
  if (body.success) return body.data.error.message;
  if (res.status === 429) return MESSAGES.rateLimited;
  if (res.status === 413) return MESSAGES.boardTooLarge;
  return `The server answered ${res.status}. Try again.`;
};

/** Streams the answer into the store; every ending leaves it settled. */
const readAnswer = async (
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  { chat, showProposal }: SendMessageDeps,
  signal?: AbortSignal,
): Promise<void> => {
  const fail = (message: string) => chat.getState().failAnswer(message);
  let failed = false;
  try {
    for await (const item of readSseJson(body)) {
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
        case 'progress':
          chat.getState().setProgress(event.data.text);
          break;
        case 'error':
          failed = true;
          fail(event.data.message);
          break;
        case 'done':
          if (!failed) chat.getState().finishAnswer();
          return;
      }
    }
  } catch (error) {
    if (isAbort(error) || signal?.aborted) return chat.getState().finishAnswer();
    return fail(MESSAGES.lost);
  }
  // The stream ended without `done`: cut off, whatever arrived before.
  if (!failed) fail(MESSAGES.lost);
};

/**
 * Sends one message. Resolves to text for the input to show again when the message was not
 * sent or the server refused it (so the user can fix and resend it), else null.
 */
export const sendMessage = async (
  text: string,
  deps: SendMessageDeps,
  signal?: AbortSignal,
): Promise<string | null> => {
  const { fetch, chat, currentBoard } = deps;
  const store = chat.getState();
  // One answer at a time: a second stream would write into the same answer.
  if (text.trim() === '' || store.streaming) return null;
  if (text.length > MAX_MESSAGE_LENGTH) {
    store.failAnswer(MESSAGES.tooLong);
    return text;
  }

  store.addUserMessage(text);
  const messages = store.history();
  store.startAnswer();

  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board: currentBoard(), messages }),
      signal,
    });
  } catch (error) {
    if (isAbort(error) || signal?.aborted) {
      chat.getState().finishAnswer();
      return null;
    }
    return chat.getState().withdrawQuestion(MESSAGES.unreachable);
  }
  // Refused before any answer: the question leaves the history, its text goes back to the input.
  if (!res.ok || !res.body) return chat.getState().withdrawQuestion(await httpErrorMessage(res));

  await readAnswer(res.body, deps, signal);
  return null;
};
