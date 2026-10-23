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
   * The `reasoning_effort` this model takes, when "none" doesn't fit it (AV2-02): gpt-oss can't
   * turn thinking off ("low"), some Gemini models refuse "none" (null: left out). Wins over
   * `disableThinking`.
   */
  reasoningEffort?: string | null;
  /**
   * Most tokens one answer may write (default 2048, ~8,000 characters: a long review fits). A
   * model stuck in a loop wrote 209k characters for 21 minutes without it (M1-31).
   */
  maxOutputTokens?: number;
  /** Injected so tests replay recorded streams without a network. */
  fetch?: typeof fetch;
};

// Only what we read. Unknown fields (Ollama's `reasoning` and `timings`, ids…) pass through.
// `index` says which call a piece belongs to when arguments arrive in pieces (OpenAI, Groq); Gemini
// sends each call whole and leaves it out. `extra_content` is Gemini's: kept, and sent back.
const ToolCallDeltaSchema = z.object({
  index: z.number().int().min(0).optional(),
  id: z.string().optional(),
  function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
  extra_content: z.record(z.string(), z.unknown()).optional(),
});

// Servers report a failure mid-stream as an event of its own (Ollama: the model runner stopped).
// Groq also ends the stream this way when it refuses a tool call's arguments (tool_use_failed).
const StreamErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string().nullish(),
    failed_generation: z.string().nullish(),
  }),
});

/**
 * The calls Groq refused (AV2-02), as the model made them: our own check then answers the model,
 * which can fix the call next round, instead of the whole answer failing. When the generation
 * can't be read, the tool's name from the message and the raw text: still rejected with a reason.
 */
const refusedCalls = (error: z.infer<typeof StreamErrorSchema>['error']): LlmToolCall[] => {
  const raw = error.failed_generation ?? '';
  const named = /parameters for tool (\w+)/.exec(error.message)?.[1] ?? 'unknown';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const list = Array.isArray(parsed) ? parsed : parsed === undefined ? [] : [parsed];
  const calls = list.flatMap((item: unknown) => {
    const call = z.object({ name: z.string(), arguments: z.unknown() }).safeParse(item);
    return call.success ? [call.data] : [];
  });
  const found = calls.length > 0 ? calls : [{ name: named, arguments: raw }];
  return found.map((call, i) => ({
    id: `refused_${i}`,
    name: call.name,
    arguments: typeof call.arguments === 'string' ? parseArguments(call.arguments) : call.arguments,
  }));
};

/**
 * The wait a 429 asks for: the retry-after header (seconds), Gemini's RetryInfo ("31s"), or the
 * message ("try again in 4.38s" or "1m2.5s" on Groq, "retry in 31.5s" on Gemini).
 */
const retryAfterOf = (
  response: Response,
  { message, retryDelay }: ProviderError,
): number | undefined => {
  const header = Number(response.headers.get('retry-after'));
  if (header > 0) return header * 1000;
  const said =
    /^()([\d.]+)(s)$/.exec(retryDelay ?? '') ??
    /(?:try again|retry) in (?:(\d+)m)?([\d.]+)\s*(ms|s)\b/i.exec(message);
  if (!said?.[2]) return undefined;
  const minutes = Number(said[1] || 0);
  return Math.ceil(minutes * 60_000 + Number(said[2]) * (said[3] === 'ms' ? 1 : 1000));
};

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

/**
 * Arguments as an object, as every server expects them back in the history: a call the model made
 * with text instead (refused, then answered by our check) is kept as `{ "_raw": text }` (AV2-02).
 */
const asObject = (args: unknown) =>
  typeof args === 'object' && args !== null && !Array.isArray(args) ? args : { _raw: args };

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
                // Back as it came (Gemini's thought signature); first, so it can never replace
                // the id the tool reply refers to.
                ...call.providerData,
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(asObject(call.arguments)) },
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

type ProviderError = { message: string; retryDelay?: string };

// OpenAI and Groq answer `{ error }`; Gemini an array of them, with a RetryInfo detail on a 429.
const ErrorBodySchema = z.object({
  error: z.object({
    message: z.string(),
    details: z.array(z.object({ retryDelay: z.string().optional() })).optional(),
  }),
});

const providerError = async (response: Response): Promise<ProviderError> => {
  const text = await response.text().catch(() => '');
  try {
    const json: unknown = JSON.parse(text);
    const { error } = ErrorBodySchema.parse(Array.isArray(json) ? json[0] : json);
    const retryDelay = error.details?.find((d) => d.retryDelay)?.retryDelay;
    return { message: error.message, ...(retryDelay ? { retryDelay } : {}) };
  } catch {
    return { message: text.slice(0, 200) || response.statusText };
  }
};

/**
 * Tool calls arrive as pieces keyed by `index` (OpenAI, Groq) or whole (Ollama, Gemini — which
 * sends no index: each such piece is a call of its own): collect, then emit.
 */
const UNINDEXED = 1_000_000;

const createToolCallCollector = () => {
  type Pending = { id: string; name: string; args: string; data?: Record<string, unknown> };
  const pending = new Map<number, Pending>();
  let unindexed = 0;
  return {
    add(delta: z.infer<typeof ToolCallDeltaSchema>) {
      // A call without an index takes a key no indexed piece can use (review of AV2-02).
      const index = delta.index ?? UNINDEXED + unindexed++;
      const call = pending.get(index) ?? { id: '', name: '', args: '' };
      call.id ||= delta.id ?? '';
      call.name += delta.function?.name ?? '';
      call.args += delta.function?.arguments ?? '';
      if (delta.extra_content) call.data = { extra_content: delta.extra_content };
      pending.set(index, call);
    },
    flush(): ProviderChunk[] {
      const calls = [...pending.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, c], i): LlmToolCall => ({
          id: c.id || `call_${index < UNINDEXED ? index : i}`, // the reply must refer to an id
          name: c.name,
          arguments: parseArguments(c.args),
          ...(c.data ? { providerData: c.data } : {}),
        }));
      pending.clear();
      unindexed = 0;
      return calls.map((call) => ({ type: 'toolCall', call }));
    },
  };
};

const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

type StreamChunk = z.infer<typeof StreamChunkSchema>;
type ToolCallCollector = ReturnType<typeof createToolCallCollector>;

/** A failed response as ours: a 429 or a 5xx may work a moment later, anything else won't. */
const responseError = async (response: Response) => {
  const failure = await providerError(response);
  const transient = response.status === 429 || response.status >= 500;
  const retryAfterMs = response.status === 429 ? retryAfterOf(response, failure) : undefined;
  return new LlmError(
    transient ? 'UNAVAILABLE' : 'BAD_REQUEST',
    `The model answered ${response.status}: ${failure.message}`,
    retryAfterMs === undefined ? undefined : { retryAfterMs },
  );
};

const unreadable = (cause: unknown) =>
  new LlmError('BAD_RESPONSE', 'The model sent a chunk we cannot read.', { cause });

/**
 * One SSE event: a chunk of the answer, or the calls Groq refused (the stream ends there; the
 * model hears why from our check next round). Any other failure the server reports is thrown.
 */
const parseEvent = (data: string): StreamChunk | { refused: LlmToolCall[] } => {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch (error) {
    throw unreadable(error);
  }
  const failed = StreamErrorSchema.safeParse(json);
  if (failed.success && failed.data.error.code === 'tool_use_failed')
    return { refused: refusedCalls(failed.data.error) };
  if (failed.success)
    throw new LlmError('UNAVAILABLE', `The model failed: ${failed.data.error.message}`);
  const parsed = StreamChunkSchema.safeParse(json);
  if (!parsed.success) throw unreadable(parsed.error);
  return parsed.data;
};

/** A chunk's text, and its tool calls once their choice is finished. */
function* chunkEvents(chunk: StreamChunk, toolCalls: ToolCallCollector): Iterable<ProviderChunk> {
  for (const choice of chunk.choices) {
    // `delta.reasoning` (thinking) is deliberately not read: it is never the answer.
    if (choice.delta?.content) yield { type: 'text', delta: choice.delta.content };
    for (const delta of choice.delta?.tool_calls ?? []) toolCalls.add(delta);
    if (choice.finish_reason) yield* toolCalls.flush();
  }
}

/** A failure while reading the answer as ours: already ours, cancelled, or the connection. */
const streamError = (error: unknown, signal: AbortSignal) => {
  if (error instanceof LlmError) return error;
  if (isAbort(error) || signal.aborted) return cancelledError(error);
  return new LlmError('UNAVAILABLE', 'The connection to the model dropped mid-answer.', {
    cause: error,
  });
};

/** The answer's SSE stream as ProviderChunks, the usage last. */
async function* readStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<ProviderChunk> {
  const toolCalls = createToolCallCollector();
  let usage: StreamChunk['usage'];
  try {
    for await (const data of readSseData(body)) {
      if (data === '[DONE]') break;
      const event = parseEvent(data);
      if ('refused' in event) {
        for (const call of event.refused) yield { type: 'toolCall', call };
        break;
      }
      yield* chunkEvents(event, toolCalls);
      // Kept, reported once at the end: Gemini repeats the running total on every chunk.
      if (event.usage) usage = event.usage;
    }
  } catch (error) {
    throw streamError(error, signal);
  }
  yield* toolCalls.flush();
  if (usage)
    yield {
      type: 'tokens',
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
    };
}

/** The `reasoning_effort` sent: the model's own, else "none" unless thinking stays on. */
const reasoningOf = (options: OpenAiCompatibleOptions) => {
  const effort =
    options.reasoningEffort !== undefined
      ? options.reasoningEffort
      : options.disableThinking === false
        ? null
        : 'none';
  return effort === null ? {} : { reasoning_effort: effort };
};

type StreamInput = Parameters<LlmProvider['stream']>[0];

const requestBody = (options: OpenAiCompatibleOptions, input: StreamInput) => ({
  model: input.model ?? options.model,
  stream: true,
  stream_options: { include_usage: true },
  ...reasoningOf(options),
  max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
  messages: input.messages.map(toWireMessage),
  ...(input.tools?.length ? { tools: input.tools.map(toWireTool) } : {}),
});

export const createOpenAiCompatibleProvider = (options: OpenAiCompatibleOptions): LlmProvider => {
  const fetchFn = options.fetch ?? fetch;
  // A loop, not /\/+$/: that regex is slow on long runs of "/" (CodeQL js/polynomial-redos).
  let base = options.baseUrl;
  while (base.endsWith('/')) base = base.slice(0, -1);
  const url = `${base}/chat/completions`;

  /** Sends the request; a network failure or a refused request becomes an LlmError. */
  const post = async (input: StreamInput) => {
    const body = requestBody(options, input);
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
    if (!response.ok || !response.body) throw await responseError(response);
    return response.body;
  };

  return {
    async *stream(input) {
      yield* readStream(await post(input), input.signal);
    },
  };
};
