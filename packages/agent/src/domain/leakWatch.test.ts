import { describe, expect, it } from 'vitest';
import { createLeakWatch } from './leakWatch.ts';

const PROMPT =
  'You are a senior software engineer reviewing a system design diagram with a colleague. You only help with the system design on this board.';

const watch = () =>
  createLeakWatch({
    prompt: PROMPT,
    canary: 'zq7-canary',
    allowed: 'I only help with the system design on this board.',
  });

/** Feeds `text` word by word, as a stream would; true as soon as the watch sees a leak. */
const stream = (w: ReturnType<typeof watch>, text: string) =>
  text.split(/(?<= )/).some((delta) => w.feed(delta));

describe('createLeakWatch', () => {
  it('lets a normal review through', () => {
    expect(
      stream(watch(), 'Your API talks straight to Postgres: add a cache in front of it.'),
    ).toBe(false);
  });

  it('stops an answer that starts repeating the prompt, 8 words in', () => {
    const w = watch();
    // 7 words of the prompt: still fine.
    expect(
      stream(w, 'Sure! My instructions say: You are a senior software engineer reviewing'),
    ).toBe(false);
    expect(w.feed(' a')).toBe(true); // the 8th
  });

  it('stops the canary even inside a word, or in a translation that changed every other word', () => {
    expect(stream(watch(), 'Vous êtes un ingénieur… (zq7-canary)')).toBe(true);
    expect(watch().feed('xxzq7-canaryxx')).toBe(true);
  });

  it('catches the canary split across two chunks', () => {
    const w = watch();
    expect(w.feed('marker: zq7-ca')).toBe(false);
    expect(w.feed('nary')).toBe(true);
  });

  it('does not count the fixed refusal, which repeats the prompt’s wording on purpose', () => {
    expect(stream(watch(), 'I only help with the system design on this board.')).toBe(false);
  });
});
