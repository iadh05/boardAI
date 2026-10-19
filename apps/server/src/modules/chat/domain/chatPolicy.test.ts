import { MAX_MESSAGE_LENGTH, type ChatMessage } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { CHAT_POLICY, fitHistory, historyBudgetChars } from './chatPolicy.ts';

const msg = (role: ChatMessage['role'], length: number, tag = ''): ChatMessage => ({
  role,
  content: tag + 'x'.repeat(length - tag.length),
});

// A small model context keeps these tests' numbers readable; the real one comes from config.
const CONTEXT = 16_384;
const BUDGET_CHARS = historyBudgetChars(CONTEXT);
const chars = (messages: ChatMessage[]) => messages.reduce((n, m) => n + m.content.length, 0);

/** A long conversation of full-size messages, ending with a short question. */
const longChat = (pairs: number): ChatMessage[] => [
  ...Array.from({ length: pairs }, (_, i) => [
    msg('user', MAX_MESSAGE_LENGTH, `q${i}`),
    msg('assistant', MAX_MESSAGE_LENGTH, `a${i}`),
  ]).flat(),
  msg('user', 100, 'latest'),
];

describe('fitHistory', () => {
  it('keeps the whole chat when it fits', () => {
    const chat = [msg('user', 100), msg('assistant', 100), msg('user', 100)];
    expect(fitHistory(chat, { boardChars: 1_000, contextTokens: CONTEXT })).toEqual({
      ok: true,
      value: chat,
    });
  });

  it('drops the oldest messages first, keeping the most recent ones that fit', () => {
    const chat = longChat(10); // ~80,000 characters: far more than a 16k model can read
    const fitted = fitHistory(chat, { boardChars: 5_000, contextTokens: CONTEXT });
    if (!fitted.ok) throw new Error(fitted.error.message);

    const kept = fitted.value;
    expect(kept.length).toBeLessThan(chat.length);
    expect(kept).toEqual(chat.slice(chat.length - kept.length)); // a recent tail, in order
    expect(kept.at(-1)?.content.startsWith('latest')).toBe(true);
    expect(chars(kept) + 5_000).toBeLessThanOrEqual(BUDGET_CHARS);
    // …and one more message would not have fitted.
    const oneMore = chat.slice(chat.length - kept.length - 1);
    expect(chars(oneMore) + 5_000).toBeGreaterThan(BUDGET_CHARS - MAX_MESSAGE_LENGTH);
  });

  it('never starts the kept history with an assistant message', () => {
    // Room for the latest question and one more message, which is the assistant's answer:
    // the model would read an answer to a question it never saw, so it goes too.
    const chat = [msg('user', 4_000), msg('assistant', 4_000), msg('user', 100)];
    const fitted = fitHistory(chat, {
      boardChars: BUDGET_CHARS - 100 - 4_000 - 50,
      contextTokens: CONTEXT,
    });
    expect(fitted.ok && fitted.value.map((m) => m.role)).toEqual(['user']);
  });

  it('refuses when even the latest message and the board do not fit', () => {
    const fitted = fitHistory([msg('user', 4_000)], {
      boardChars: BUDGET_CHARS,
      contextTokens: CONTEXT,
    });
    expect(fitted).toMatchObject({ ok: false, error: { code: 'BOARD_TOO_LARGE' } });
  });

  it('leaves room in the model’s context for the prompt, tools and answer', () => {
    expect(historyBudgetChars(CONTEXT)).toBe(
      (CONTEXT - CHAT_POLICY.reservedTokens) * CHAT_POLICY.charsPerToken,
    );
  });

  it('keeps more history, and bigger boards, with a bigger context window', () => {
    const chat = longChat(10);
    const small = fitHistory(chat, { boardChars: 5_000, contextTokens: CONTEXT });
    const large = fitHistory(chat, { boardChars: 5_000, contextTokens: 131_072 });
    expect(small.ok && large.ok && large.value.length > small.value.length).toBe(true);
    expect(large.ok && large.value).toEqual(chat); // 128k: the whole conversation fits

    const bigBoard = { boardChars: BUDGET_CHARS }; // too large for 16k
    expect(fitHistory([msg('user', 100)], { ...bigBoard, contextTokens: 131_072 }).ok).toBe(true);
  });
});
