// Claude through the official SDK (AV2-03). Claude speaks its own Messages API, not the OpenAI
// format: the SDK parses its stream and follows its changes (the thinking settings moved a lot in
// 2026). Retries and timeouts stay the gateway's job, so the SDK's own retries are off. The owner's
// rule: Haiku and Sonnet only, with a daily budget so the $100 cap can't be blown by a loop.

import Anthropic from '@anthropic-ai/sdk';
import { cancelledError, LlmError } from '../errors.ts';
import type {
  LlmMessage,
  LlmProvider,
  LlmToolCall,
  ProviderChunk,
  ToolDefinition,
} from '../types.ts';

/** $ per million tokens, input / output (prompts under 100K tokens), 2026-10. */
const PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
} as const;
type ClaudeModel = keyof typeof PRICES;
export const CLAUDE_MODELS = Object.keys(PRICES) as ClaudeModel[];

const isClaudeModel = (model: string): model is ClaudeModel => model in PRICES;

export type AnthropicOptions = {
  apiKey: string;
  model: string;
  /** Thinking on, with this effort; off by default (the specialists' setting, D13). */
  thinking?: { effort: 'low' | 'medium' | 'high' };
  /** Most tokens one answer may write (default 2048, as for the other providers). */
  maxOutputTokens?: number;
  /** Spend per day in $, counted from each call's usage (default 5): past it, calls are refused. */
  dailyBudgetUsd?: number;
  /** Injected for tests: the budget's day comes from it (docs/rules/general.md). */
  now?: () => number;
  /** Injected so tests replay recorded streams through the real SDK, without a network. */
  fetch?: typeof fetch;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Thinking off as each model takes it: Haiku "disabled", Sonnet 5.5 only "between_tools". */
const thinkingOf = (model: ClaudeModel, thinking: AnthropicOptions['thinking']) =>
  thinking
    ? { thinking: { type: 'adaptive' as const }, output_config: { effort: thinking.effort } }
    : {
        thinking:
          model === 'claude-sonnet-5-5'
            ? { type: 'between_tools' as const }
            : { type: 'disabled' as const },
        output_config: { effort: 'low' as const },
      };

/** Arguments as an object, as the API expects a tool_use input (text kept under `_raw`). */
const asObject = (args: unknown): Record<string, unknown> =>
  typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : { _raw: args };

/**
 * Our messages as Claude's: the system prompt apart; an assistant turn's text and tool calls as
 * blocks; tool results as one user turn (all results of a turn together), and a user message
 * right after them (the format error) as a text block in that same turn.
 */
const toClaude = (messages: readonly LlmMessage[]) => {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const wire: Anthropic.MessageParam[] = [];
  const openUserBlocks = () => {
    const last = wire.at(-1);
    return last?.role === 'user' && Array.isArray(last.content) ? last.content : undefined;
  };
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const result: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      const blocks = openUserBlocks();
      if (blocks) blocks.push(result);
      else wire.push({ role: 'user', content: [result] });
    } else if (message.role === 'user') {
      const blocks = openUserBlocks();
      if (blocks) blocks.push({ type: 'text', text: message.content });
      else wire.push({ role: 'user', content: message.content });
    } else if (message.role === 'assistant') {
      const calls = message.toolCalls ?? [];
      // Claude refuses an empty text block: a turn with nothing said is a placeholder.
      const text = message.content.trim() ? message.content : calls.length ? '' : '(no answer)';
      wire.push({
        role: 'assistant',
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...calls.map((call) => ({
            type: 'tool_use' as const,
            id: call.id,
            name: call.name,
            input: asObject(call.arguments),
          })),
        ],
      });
    }
  }
  return { system, messages: wire };
};

const toClaudeTool = (tool: ToolDefinition): Anthropic.Tool => ({
  name: tool.name,
  description: tool.description,
  input_schema: { type: 'object', ...tool.parameters },
});

/** SDK errors as ours: the gateway retries the transient ones, the agent tells the user. */
const toLlmError = (error: unknown, signal: AbortSignal): LlmError => {
  if (error instanceof LlmError) return error;
  if (error instanceof Anthropic.APIUserAbortError || signal.aborted) return cancelledError(error);
  if (error instanceof Anthropic.APIConnectionError)
    return new LlmError('UNAVAILABLE', "Can't reach Claude's API.", { cause: error });
  if (error instanceof Anthropic.RateLimitError) {
    const seconds = Number(error.headers.get('retry-after'));
    return new LlmError('UNAVAILABLE', `Claude answered 429: ${error.message}`, {
      cause: error,
      ...(seconds > 0 ? { retryAfterMs: seconds * 1000 } : {}),
    });
  }
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : 0;
    const message = `Claude answered ${status}: ${error.message}`;
    // 529 is "overloaded": a moment later it may work.
    if (status >= 500) return new LlmError('UNAVAILABLE', message, { cause: error });
    return new LlmError('BAD_REQUEST', message, { cause: error });
  }
  return new LlmError('BAD_RESPONSE', "Claude's answer could not be read.", { cause: error });
};

export const createAnthropicProvider = (options: AnthropicOptions): LlmProvider => {
  const { model } = options;
  if (!isClaudeModel(model))
    throw new Error(
      `Claude model "${model}" is not allowed: use one of ${CLAUDE_MODELS.join(', ')}.`,
    );
  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: 0, // the gateway retries, with its own rules (before the first chunk only)
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const now = options.now ?? (() => Date.now());
  const budget = options.dailyBudgetUsd ?? 5;
  const spent = { day: -1, usd: 0 };
  const today = () => {
    const day = Math.floor(now() / DAY_MS);
    if (day !== spent.day) Object.assign(spent, { day, usd: 0 });
    return spent;
  };

  return {
    async *stream(input) {
      if (input.signal.aborted) throw cancelledError();
      if (today().usd >= budget)
        throw new LlmError(
          'BAD_REQUEST',
          `Today's Claude budget ($${budget}) is spent: the local model answers until tomorrow.`,
        );
      const { system, messages } = toClaude(input.messages);
      const price = PRICES[model];
      try {
        const stream = client.messages.stream(
          {
            model,
            max_tokens: options.maxOutputTokens ?? 2048,
            ...(system ? { system } : {}),
            messages,
            ...(input.tools?.length ? { tools: input.tools.map(toClaudeTool) } : {}),
            ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
            ...thinkingOf(model, options.thinking),
          },
          { signal: input.signal },
        );
        for await (const event of stream)
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
            yield { type: 'text', delta: event.delta.text };
        const message = await stream.finalMessage();
        today().usd +=
          (message.usage.input_tokens * price.input + message.usage.output_tokens * price.output) /
          1e6;
        if (message.stop_reason === 'refusal')
          throw new LlmError('BAD_RESPONSE', 'Claude declined to answer this request.');
        // A tool input cut off at the token limit may parse but be incomplete: not run.
        if (message.stop_reason !== 'max_tokens')
          for (const block of message.content)
            if (block.type === 'tool_use') {
              const call: LlmToolCall = { id: block.id, name: block.name, arguments: block.input };
              yield { type: 'toolCall', call } satisfies ProviderChunk;
            }
        yield {
          type: 'tokens',
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        };
      } catch (error) {
        throw toLlmError(error, input.signal);
      }
    },
  };
};
