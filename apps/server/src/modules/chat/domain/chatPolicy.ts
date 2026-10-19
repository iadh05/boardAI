import { fail, ok, type ChatMessage, type Result } from '@designroom/domain';

// The chat's rules (architecture §6.1): pure, no I/O. They protect the model's context window.
// If the prompt is longer than the context, Ollama silently drops its start — the system prompt
// and the tool rules — and the model goes off the rails without any error (M1-18 review).

const CONTEXT_TOKENS = 16_384; // designroom-qwen's num_ctx (infra/ollama/Modelfile)
// System prompt + tool definitions (~1,000 tokens), up to 5 rounds of tool results, and the answer.
const RESERVED_TOKENS = 4_000;

export const CHAT_POLICY = {
  contextTokens: CONTEXT_TOKENS,
  /** What the board listing and the chat history may use together. */
  historyBudgetTokens: CONTEXT_TOKENS - RESERVED_TOKENS,
  /** Rough size of a token in English text — good enough for a budget, no tokenizer needed. */
  charsPerToken: 4,
  /** Model calls per request: a model that keeps calling tools is stopped (agent loop). */
  maxRounds: 5,
} as const;

export type ChatPolicyErrorCode = 'BOARD_TOO_LARGE';

/**
 * The most recent messages that fit next to the board in the model's context. The latest message
 * is always kept; the kept history never starts with an assistant message.
 */
export const fitHistory = (
  messages: readonly ChatMessage[],
  { boardChars }: { boardChars: number },
): Result<ChatMessage[], ChatPolicyErrorCode> => {
  let room = CHAT_POLICY.historyBudgetTokens * CHAT_POLICY.charsPerToken - boardChars;
  let start = messages.length;
  while (start > 0) {
    const size = messages[start - 1]?.content.length ?? 0;
    if (size > room) break;
    room -= size;
    start--;
  }
  if (start === messages.length)
    return fail(
      'BOARD_TOO_LARGE',
      'The board and your message are too large for the assistant to read. Try a smaller board.',
    );
  while (start < messages.length - 1 && messages[start]?.role === 'assistant') start++;
  return ok(messages.slice(start));
};
