import { MAX_MESSAGES, type ChatMessage } from '@designroom/domain';
import { create } from 'zustand';
import { createId } from '../../../core/lib/ids.ts';

// The chat module's client state (architecture §5.3): the conversation as the user sees it,
// whether an answer is streaming, and the last error. In M1 it lives only in memory: a refresh
// starts a new conversation (persistence comes with M2).

export type ChatEntry = {
  id: string;
  role: ChatMessage['role'];
  content: string;
  /** A note from the app on the user's behalf ("Accepted: …"), shown small, sent to the model. */
  note?: true;
};

export type ChatState = {
  messages: ChatEntry[];
  /** An answer is arriving: the input waits, a "stop" can cancel it. */
  streaming: boolean;
  /** What went wrong with the last answer, written for the user. */
  error: string | null;
  /** Where agent V2's specialists are (AV2-09), until the answer's first word. */
  progress: string | null;
};

export type ChatActions = {
  addUserMessage: (content: string) => void;
  /** Opens an empty assistant message that the stream fills. */
  startAnswer: () => void;
  appendToAnswer: (delta: string) => void;
  setProgress: (text: string) => void;
  finishAnswer: () => void;
  /** Ends the answer with an error; keeps any text already received. */
  failAnswer: (message: string) => void;
  /**
   * The server refused the question before answering: it leaves the conversation (or every later
   * request would carry it and be refused too). Returns its text, for the input to show again.
   */
  withdrawQuestion: (message: string) => string;
  /** Records what the user decided about a proposal, so the model knows on the next turn. */
  addNote: (content: string) => void;
  /** The conversation to send with the next request (the chat contract's shape and limit). */
  history: () => ChatMessage[];
};

export type ChatStore = ChatState & ChatActions;

export type ChatStoreDeps = {
  /** Message ids (React keys); injected so tests are deterministic. */
  newId: () => string;
};

/** Removes the last message if it is an answer that never got any text. */
const withoutEmptyAnswer = (messages: ChatEntry[]) => {
  const last = messages.at(-1);
  return last?.role === 'assistant' && last.content === '' ? messages.slice(0, -1) : messages;
};

export const createChatStore = ({ newId }: ChatStoreDeps) =>
  create<ChatStore>()((set, get) => ({
    messages: [],
    streaming: false,
    error: null,
    progress: null,

    addUserMessage: (content) =>
      set((s) => ({
        messages: [...s.messages, { id: newId(), role: 'user', content }],
        error: null,
      })),

    addNote: (content) =>
      set((s) => ({
        messages: [...s.messages, { id: newId(), role: 'user', content, note: true }],
      })),

    startAnswer: () =>
      set((s) => ({
        messages: [...s.messages, { id: newId(), role: 'assistant', content: '' }],
        streaming: true,
        error: null,
        progress: null,
      })),

    appendToAnswer: (delta) =>
      set((s) => {
        const last = s.messages.at(-1);
        if (last?.role !== 'assistant') return s;
        return {
          messages: [...s.messages.slice(0, -1), { ...last, content: last.content + delta }],
          progress: null, // the answer has started: it speaks for itself
        };
      }),

    setProgress: (text) => set({ progress: text }),

    finishAnswer: () =>
      set((s) => ({ messages: withoutEmptyAnswer(s.messages), streaming: false, progress: null })),

    failAnswer: (message) =>
      set((s) => ({
        messages: withoutEmptyAnswer(s.messages),
        streaming: false,
        error: message,
        progress: null,
      })),

    withdrawQuestion: (message) => {
      const messages = withoutEmptyAnswer(get().messages);
      const question = messages.at(-1);
      const withdrawn = question?.role === 'user' ? question.content : '';
      set({
        messages: withdrawn ? messages.slice(0, -1) : messages,
        streaming: false,
        error: message,
      });
      return withdrawn;
    },

    history: () => {
      const sent = get()
        .messages.filter((m) => m.content !== '')
        .map(({ role, content }) => ({ role, content }))
        .slice(-MAX_MESSAGES);
      // Trimming may leave an answer first; the model would read an answer to an unseen question.
      return sent[0]?.role === 'assistant' ? sent.slice(1) : sent;
    },
  }));

/** The app's one chat store. */
export const useChatStore = createChatStore({ newId: createId });
