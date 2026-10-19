// The gateway's own vocabulary (architecture §8). Providers translate their wire format into
// these types, so the agent never sees OpenAI, Ollama or Azure shapes — swapping provider is one
// adapter. Nothing here knows about boards: the gateway knows LLMs, not DesignRoom.

/** A call the model asked for. `arguments` is the parsed JSON, or the raw text if it wasn't
 * valid JSON — the caller validates it with its own schema and can tell the model what's wrong. */
export type LlmToolCall = { id: string; name: string; arguments: unknown };

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/** A tool the model may call; `parameters` is a JSON Schema object. */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** Measured once per call, after the last chunk. */
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  /** From the request to the last chunk, retries included. */
  latencyMs: number;
  /** From the request to the first text or tool call; null when the answer was empty. */
  timeToFirstTokenMs: number | null;
  /** Attempts made: 1 when the first one worked. */
  attempts: number;
};

export type LlmChunk =
  | { type: 'text'; delta: string }
  | { type: 'toolCall'; call: LlmToolCall }
  | { type: 'usage'; usage: Usage };

export type ChatInput = {
  messages: LlmMessage[];
  tools?: ToolDefinition[];
  /** Overrides the provider's default model. */
  model?: string;
  /** Aborts the call: the client went away, nobody wants the answer (docs/rules/backend.md). */
  signal?: AbortSignal;
};

/** The only door to LLMs. Ends with exactly one `usage` chunk, or throws an `LlmError`. */
export type AiGateway = {
  chat(input: ChatInput): AsyncIterable<LlmChunk>;
};

/** What a provider yields: the answer, plus token counts the gateway turns into `Usage`. */
export type ProviderChunk =
  | { type: 'text'; delta: string }
  | { type: 'toolCall'; call: LlmToolCall }
  | { type: 'tokens'; inputTokens: number; outputTokens: number };

/** One LLM API. Throws `LlmError` for failures it recognises; the gateway handles the rest. */
export type LlmProvider = {
  stream(input: ChatInput & { signal: AbortSignal }): AsyncIterable<ProviderChunk>;
};
