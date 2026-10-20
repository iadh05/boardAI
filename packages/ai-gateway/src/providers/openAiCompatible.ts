// Any API that speaks OpenAI's Chat Completions format: Ollama today (M1-15), Azure OpenAI or
// others later. Translates our messages to the wire format and the SSE stream back into
// ProviderChunks. Timeouts and retries are the gateway's job, not this file's.

import { z } from 'zod';
import { cancelledError, LlmError } from '../errors.ts';
import { readSseData } from '../sse.ts';
import type {
  LlmMessage,
  LlmProvider,
  LlmToolCall,
  ProviderChunk,
  ToolDefinition,
} from '../types.ts';

export type OpenAiCompatibleOptions = {
  /** e.g. http://localhost:11434/v1 */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Send `reasoning_effort: "none"` (default true): thinking models answer straight away. */
  disableThinking?: boolean;
  /**
   * Most tokens one answer may write (default 2048, ~8,000 characters: a long review fits). A
   * model stuck in a loop wrote 209k characters for 21 minutes without it (M1-31).
   */
  maxOutputTokens?: number;
  /** Injected so tests replay recorded streams without a network. */
  fetch?: typeof fetch;
};

// Only what we read. Unknown fields (Ollama's `reasoning` and `timings`, ids…) pass through.
const ToolCallDeltaSchema = z.object({
  index: z.number().int().min(0),
  id: z.string().optional(),
  function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
});

// Servers report a failure mid-stream as an event of its own (Ollama: the model runner stopped).
const StreamErrorSchema = z.object({ error: z.object({ message: z.string() }) });

const StreamChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z
        .object({
          content: z.string().nullish(),
          tool_calls: z.array(ToolCallDeltaSchema).nullish(),
        })
        .optional(),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).nullish(),
});

const toWireMessage = (message: LlmMessage) => {
  switch (message.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      };
    default:
      return { role: message.role, content: message.content };
  }
};

const toWireTool = (tool: ToolDefinition) => ({
  type: 'function',
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
});

const parseArguments = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // the caller's schema rejects it and the model gets told why
  }
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const providerMessage = async (response: Response) => {
  const text = await response.text().catch(() => '');
  try {
    const parsed = z.object({ error: z.object({ message: z.string() }) }).parse(JSON.parse(text));
    return parsed.error.message;
  } catch {
    return text.slice(0, 200) || response.statusText;
  }
};

/** Tool calls arrive as pieces keyed by `index` (OpenAI) or whole (Ollama): collect, then emit. */
const createToolCallCollector = () => {
  const pending = new Map<number, { id: string; name: string; args: string }>();
  return {
    add(delta: z.infer<typeof ToolCallDeltaSchema>) {
      const call = pending.get(delta.index) ?? { id: '', name: '', args: '' };
      call.id ||= delta.id ?? '';
      call.name += delta.function?.name ?? '';
      call.args += delta.function?.arguments ?? '';
      pending.set(delta.index, call);
    },
    flush(): ProviderChunk[] {
      const calls = [...pending.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, c]): LlmToolCall => ({
          id: c.id || `call_${index}`, // the reply to the call must refer to an id
          name: c.name,
          arguments: parseArguments(c.args),
        }));
      pending.clear();
      return calls.map((call) => ({ type: 'toolCall', call }));
    },
  };
};

const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

export const createOpenAiCompatibleProvider = (options: OpenAiCompatibleOptions): LlmProvider => {
  const fetchFn = options.fetch ?? fetch;
  // A loop, not /\/+$/: that regex is slow on long runs of "/" (CodeQL js/polynomial-redos).
  let base = options.baseUrl;
  while (base.endsWith('/')) base = base.slice(0, -1);
  const url = `${base}/chat/completions`;

  return {
    async *stream(input) {
      const body = {
        model: input.model ?? options.model,
        stream: true,
        stream_options: { include_usage: true },
        ...(options.disableThinking === false ? {} : { reasoning_effort: 'none' }),
        max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        messages: input.messages.map(toWireMessage),
        ...(input.tools?.length ? { tools: input.tools.map(toWireTool) } : {}),
      };

      let response: Response;
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: input.signal,
        });
      } catch (error) {
        if (isAbort(error) || input.signal.aborted) throw cancelledError(error);
        throw new LlmError(
          'UNAVAILABLE',
          `Can't reach the model at ${options.baseUrl} — is Ollama running?`,
          { cause: error },
        );
      }

      if (response.ok && !response.body)
        throw new LlmError('BAD_RESPONSE', `The model answered ${response.status} with no body.`);
      if (!response.ok || !response.body) {
        const message = await providerMessage(response);
        const transient = response.status === 429 || response.status >= 500;
        throw new LlmError(
          transient ? 'UNAVAILABLE' : 'BAD_REQUEST',
          `The model answered ${response.status}: ${message}`,
        );
      }

      const toolCalls = createToolCallCollector();
      try {
        for await (const data of readSseData(response.body)) {
          if (data === '[DONE]') break;
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch (error) {
            throw new LlmError('BAD_RESPONSE', 'The model sent a chunk we cannot read.', {
              cause: error,
            });
          }
          const failed = StreamErrorSchema.safeParse(json);
          if (failed.success)
            throw new LlmError('UNAVAILABLE', `The model failed: ${failed.data.error.message}`);
          const parsed = StreamChunkSchema.safeParse(json);
          if (!parsed.success)
            throw new LlmError('BAD_RESPONSE', 'The model sent a chunk we cannot read.', {
              cause: parsed.error,
            });
          const chunk = parsed.data;
          for (const choice of chunk.choices) {
            // `delta.reasoning` (thinking) is deliberately not read: it is never the answer.
            if (choice.delta?.content) yield { type: 'text', delta: choice.delta.content };
            for (const delta of choice.delta?.tool_calls ?? []) toolCalls.add(delta);
            if (choice.finish_reason) yield* toolCalls.flush();
          }
          if (chunk.usage)
            yield {
              type: 'tokens',
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            };
        }
      } catch (error) {
        if (error instanceof LlmError) throw error;
        if (isAbort(error) || input.signal.aborted) throw cancelledError(error);
        throw new LlmError('UNAVAILABLE', 'The connection to the model dropped mid-answer.', {
          cause: error,
        });
      }
      yield* toolCalls.flush();
    },
  };
};
