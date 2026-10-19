import { MAX_MESSAGES } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { createChatStore } from './chatStore.ts';

// Each test gets its own store with predictable ids (docs/rules/frontend.md).
const setup = () => {
  let next = 0;
  const store = createChatStore({ newId: () => `m${++next}` });
  return () => store.getState();
};

describe('chatStore', () => {
  it('starts empty, not streaming, without an error', () => {
    const state = setup();
    expect(state()).toMatchObject({ messages: [], streaming: false, error: null });
  });

  it('adds the user’s message and clears the last error', () => {
    const state = setup();
    state().failAnswer('Old error');

    state().addUserMessage('Review my design');

    expect(state().messages).toEqual([{ id: 'm1', role: 'user', content: 'Review my design' }]);
    expect(state().error).toBeNull();
  });

  it('streams the answer into one assistant message', () => {
    const state = setup();
    state().addUserMessage('Review it');

    state().startAnswer();
    expect(state().streaming).toBe(true);
    state().appendToAnswer('Add ');
    state().appendToAnswer('a cache.');
    state().finishAnswer();

    expect(state().messages.at(-1)).toEqual({
      id: 'm2',
      role: 'assistant',
      content: 'Add a cache.',
    });
    expect(state().streaming).toBe(false);
  });

  it('records an error, keeps the partial answer, and stops streaming', () => {
    const state = setup();
    state().addUserMessage('Review it');
    state().startAnswer();
    state().appendToAnswer('Half an');

    state().failAnswer("Can't reach the model — is Ollama running?");

    expect(state()).toMatchObject({
      streaming: false,
      error: "Can't reach the model — is Ollama running?",
    });
    expect(state().messages.at(-1)?.content).toBe('Half an');
  });

  it('drops an answer that never got any text', () => {
    const state = setup();
    state().addUserMessage('Review it');
    state().startAnswer();

    state().failAnswer('Too many requests.');

    expect(state().messages.map((m) => m.role)).toEqual(['user']);
  });

  it('gives the history to send: no empty answers, at most the contract’s limit', () => {
    const state = setup();
    for (let i = 0; i < MAX_MESSAGES + 5; i++) {
      state().addUserMessage(`q${i}`);
      state().startAnswer();
      state().appendToAnswer(`a${i}`);
      state().finishAnswer();
    }
    state().addUserMessage('latest');
    state().startAnswer(); // the empty answer being streamed is not history

    const history = state().history();

    // The last 50 start with an answer (they alternate and end with a question): it goes too.
    expect(history).toHaveLength(MAX_MESSAGES - 1);
    expect(history.at(-1)).toEqual({ role: 'user', content: 'latest' });
    expect(history[0]?.role).toBe('user'); // never start with an answer to an unseen question
  });
});
