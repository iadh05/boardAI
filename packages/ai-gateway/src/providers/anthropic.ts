// Claude through the official SDK (AV2-03). Claude speaks its own Messages API, not the OpenAI
// format: the SDK parses its stream and follows its changes (the thinking settings moved a lot in
// 2026). Retries and timeouts stay the gateway's job, so the SDK's own retries are off. The owner's
// rule: Haiku and Sonnet only, with a daily budget so the $100 cap can't be blown by a loop.

import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODELS, HOSTED_PROVIDERS, MODELS } from '../catalogue.ts';
import { cancelledError, LlmError } from '../errors.ts';
import type {
  LlmMessage,
  LlmProvider,
  LlmToolCall,
  ProviderChunk,
  ToolDefinition,
} from '../types.ts';

/** A Claude model the catalogue lists, with what this provider needs from its entry. */
const profileOf = (model: string) => {
  const profile = MODELS[model];
  if (profile?.provider !== 'claude' || !profile.priceUsdPerM || !profile.claudeThinkingOff)
    return undefined;
  return { price: profile.priceUsdPerM, thinkingOff: profile.claudeThinkingOff };
};
type ClaudeProfile = NonNullable<ReturnType<typeof profileOf>>;

export type AnthropicOptions = {
  apiKey: string;
  model: string;
  /** Thinking on, with this effort; off by default (the specialists' setting, D13). */
  thinking?: { effort: 'low' | 'medium' | 'high' };
  /** Most tokens one answer may write (default 2048, as for the other providers). */
  maxOutputTokens?: number;
  /**
   * The day's spend, shared by every Claude provider it is given to (one budget, not one per
   * role). By default each provider gets its own: `dailyBudgetUsd` (default 5) and `now`.
   */
  spend?: SpendTracker;
  dailyBudgetUsd?: number;
  /** Injected for tests: the budget's day comes from it (docs/rules/general.md). */
  now?: () => number;
  /** Injected so tests replay recorded streams through the real SDK, without a network. */
  fetch?: typeof fetch;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export type SpendTracker = {
  /** True while today's spend is under the budget. */
  allows(): boolean;
  add(usd: number): void;
  readonly dailyUsd: number;
};

/** Spend per day in $ (a UTC day), counted from each call's usage. */
export const createSpendTracker = ({
  dailyUsd = 5,
  now = () => Date.now(),
}: { dailyUsd?: number; now?: () => number } = {}): SpendTracker => {
  const spent = { day: -1, usd: 0 };
  const today = () => {
    const day = Math.floor(now() / DAY_MS);
    if (day !== spent.day) Object.assign(spent, { day, usd: 0 });
    return spent;
  };
  return {
    allows: () => today().usd < dailyUsd,
    add: (usd) => {
      today().usd += usd;
    },
    dailyUsd,
  };
};

/** Thinking off as the catalogue says each model takes it (Sonnet 5.5 only "between_tools"). */
const thinkingOf = (profile: ClaudeProfile, thinking: AnthropicOptions['thinking']) =>
  thinking
    ? { thinking: { type: 'adaptive' as const }, output_config: { effort: thinking.effort } }
    : { thinking: { type: profile.thinkingOff }, output_config: { effort: 'low' as const } };

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
      // The thinking blocks this turn came with, first and unchanged (preserved thinking).
      const thinking = calls.flatMap((call) => {
        const blocks = call.providerData?.claudeBlocks;
        return Array.isArray(blocks) ? (blocks as Anthropic.ContentBlockParam[]) : [];
      });
      wire.push({
        role: 'assistant',
        content: [
          ...thinking,
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
  const defaultProfile = profileOf(model);
  if (!defaultProfile)
    throw new Error(
      `Claude model "${model}" is not allowed: use one of ${CLAUDE_MODELS.join(', ')}.`,
    );
  const client = new Anthropic({
    baseURL: HOSTED_PROVIDERS.claude.baseUrl,
    apiKey: options.apiKey,
    maxRetries: 0, // the gateway retries, with its own rules (before the first chunk only)
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const spend =
    options.spend ??
    createSpendTracker({
      ...(options.dailyBudgetUsd === undefined ? {} : { dailyUsd: options.dailyBudgetUsd }),
      ...(options.now ? { now: options.now } : {}),
    });

  return {
    async *stream(input) {
      if (input.signal.aborted) throw cancelledError();
      if (!spend.allows())
        throw new LlmError(
          'BAD_REQUEST',
          `Today's Claude budget ($${spend.dailyUsd}) is spent: the local model answers until tomorrow.`,
        );
      const { system, messages } = toClaude(input.messages);
      // The call's model when the catalogue allows it, else the provider's own.
      const asked = input.model ? profileOf(input.model) : undefined;
      const chosen = asked && input.model ? input.model : model;
      const profile = asked ?? defaultProfile;
      const { price } = profile;
      // Tokens as they are reported, counted in `finally`: a call cut off or abandoned was billed.
      const used = { input: 0, output: 0 };
      try {
        // No temperature: Haiku and Sonnet 5.5 refuse any but the default (review of AV2-03).
        const stream = client.messages.stream(
          {
            model: chosen,
            max_tokens: options.maxOutputTokens ?? 2048,
            ...(system ? { system } : {}),
            messages,
            ...(input.tools?.length ? { tools: input.tools.map(toClaudeTool) } : {}),
            ...thinkingOf(profile, options.thinking),
          },
          { signal: input.signal },
        );
        for await (const event of stream) {
          if (event.type === 'message_start') used.input = event.message.usage.input_tokens;
          else if (event.type === 'message_delta') used.output = event.usage.output_tokens;
          else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
            yield { type: 'text', delta: event.delta.text };
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === 'refusal')
          throw new LlmError('BAD_RESPONSE', 'Claude declined to answer this request.');
        // Thinking blocks go back with the tool calls they came before (opaque to the agent).
        const thinking = message.content.filter(
          (b) => b.type === 'thinking' || b.type === 'redacted_thinking',
        );
        // A tool input cut off at the token limit may parse but be incomplete: not run.
        const calls =
          message.stop_reason === 'max_tokens'
            ? []
            : message.content.flatMap((b) => (b.type === 'tool_use' ? [b] : []));
        for (const [i, block] of calls.entries()) {
          const call: LlmToolCall = {
            id: block.id,
            name: block.name,
            arguments: block.input,
            ...(i === 0 && thinking.length ? { providerData: { claudeBlocks: thinking } } : {}),
          };
          yield { type: 'toolCall', call } satisfies ProviderChunk;
        }
        yield { type: 'tokens', inputTokens: used.input, outputTokens: used.output };
      } catch (error) {
        throw toLlmError(error, input.signal);
      } finally {
        spend.add((used.input * price.input + used.output * price.output) / 1e6);
      }
    },
  };
};
