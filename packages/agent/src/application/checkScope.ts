import type { AiGateway } from '@designroom/ai-gateway';
import { readScope, scopeMessages, type Scope } from '../domain/scope.ts';

export type ScopeQuestion = {
  question: string;
  /** The assistant's last answer: "yes, do it" only makes sense next to it. */
  previousAnswer?: string;
  signal?: AbortSignal;
};

/** Longest answer we read: the verdict word, maybe wrapped ("Classification: OTHER"). */
const MAX_ANSWER_CHARS = 40;
/**
 * Once the model has started answering, how long it may take to say the verdict. Counted from
 * the first word, not the request: a cold model takes ~16 s to load, and that is not a stall.
 */
const VERDICT_GRACE_MS = 2_000;

/**
 * Asks the model whether the message is about the design. Fails open: if the model errs, stalls
 * or answers something unclear, the message goes through and the review prompt is the next guard
 * — a guard that blocks real design questions would be worse than one that misses an odd one.
 */
export const checkScope = async (
  llm: AiGateway,
  { question, previousAnswer, signal }: ScopeQuestion,
): Promise<Scope> => {
  const stalled = new AbortController();
  let grace: ReturnType<typeof setTimeout> | undefined;
  let answer = '';
  try {
    const messages = scopeMessages(question, previousAnswer);
    const callSignal = signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal;
    for await (const chunk of llm.chat({ messages, signal: callSignal })) {
      if (chunk.type !== 'text') continue;
      answer += chunk.delta;
      grace ??= setTimeout(() => stalled.abort(), VERDICT_GRACE_MS);
      // Stop as soon as the verdict is readable (or enough was said): no tokens for nothing.
      if (/\b(design|other)\b/i.test(answer) || answer.length >= MAX_ANSWER_CHARS) break;
    }
  } catch {
    return readScope(answer); // stalled or failed: whatever was said, else fail open
  } finally {
    clearTimeout(grace);
  }
  return readScope(answer);
};
