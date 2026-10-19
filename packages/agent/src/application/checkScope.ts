import type { AiGateway } from '@designroom/ai-gateway';
import { readScope, scopeMessages, type Scope } from '../domain/scope.ts';

export type ScopeQuestion = {
  question: string;
  /** The assistant's last answer: "yes, do it" only makes sense next to it. */
  previousAnswer?: string;
  signal?: AbortSignal;
};

/** Longest answer we read: one word is enough, the rest is never streamed. */
const MAX_ANSWER_CHARS = 20;

/**
 * Asks the model whether the message is about the design. Fails open: if the model errs or
 * answers something unclear, the message goes through and the review prompt is the next guard —
 * a guard that blocks real design questions would be worse than one that misses an odd one.
 */
export const checkScope = async (
  llm: AiGateway,
  { question, previousAnswer, signal }: ScopeQuestion,
): Promise<Scope> => {
  let answer = '';
  try {
    for await (const chunk of llm.chat({
      messages: scopeMessages(question, previousAnswer),
      signal,
    })) {
      if (chunk.type === 'text') answer += chunk.delta;
      if (answer.length >= MAX_ANSWER_CHARS) break; // stops the call: no tokens for nothing
    }
  } catch {
    return 'in';
  }
  return readScope(answer);
};
