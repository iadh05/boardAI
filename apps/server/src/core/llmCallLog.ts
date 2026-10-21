import type { AiGateway, LlmMessage, LlmToolCall, Usage } from '@designroom/ai-gateway';
import { appendFile } from 'node:fs/promises';

// Every call to the model, exactly as sent and as answered (M1-28): the system prompt, the board,
// the chat, the agent's nudges — and the text and tool calls that came back. For diagnosing the
// agent: is a bad answer the prompt's fault, the model's, or our loop's? Opt-in, local file only
// (LLM_CALL_LOG): it holds boards and conversations, so it is never on by default and never sent
// anywhere. The usual logs keep only counts and timings (docs/rules/general.md).

export type LlmCallRecord = {
  time: string;
  /** The HTTP request the call served: one review = several calls with the same id. */
  requestId: string | null;
  temperature?: number;
  /** Tool names offered (their full schemas are in the code). */
  tools: string[];
  messages: LlmMessage[];
  output: { text: string; toolCalls: LlmToolCall[] };
  usage?: Usage;
  /** The call failed: what the gateway said. */
  error?: string;
  /** The caller stopped reading before the end (Stop, a leak cut, a disconnect). */
  stopped?: true;
  ms: number;
};

export type LlmCallLogDeps = {
  write: (record: LlmCallRecord) => void;
  now: () => number;
  requestId: () => string | null;
};

/** The same gateway, recording each call once it ends (however it ends). */
export const recordLlmCalls = (llm: AiGateway, deps: LlmCallLogDeps): AiGateway => ({
  async *chat(input) {
    const started = deps.now();
    const requestId = deps.requestId(); // at the first read: the stream is read inside the request's context
    let text = '';
    const toolCalls: LlmToolCall[] = [];
    let usage: Usage | undefined;
    let error: string | undefined;
    let finished = false;
    try {
      for await (const chunk of llm.chat(input)) {
        if (chunk.type === 'text') text += chunk.delta;
        else if (chunk.type === 'toolCall') toolCalls.push(chunk.call);
        else usage = chunk.usage;
        yield chunk;
      }
      finished = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      finished = true;
      throw e;
    } finally {
      deps.write({
        time: new Date(started).toISOString(),
        requestId,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        tools: (input.tools ?? []).map((t) => t.name),
        messages: input.messages,
        output: { text, toolCalls },
        ...(usage ? { usage } : {}),
        ...(error === undefined ? {} : { error }),
        ...(finished ? {} : { stopped: true as const }),
        ms: deps.now() - started,
      });
    }
  },
});

/** Appends records to a JSON Lines file; a failed write is reported, never thrown at the caller. */
export const appendToFile =
  (path: string, onError: (error: unknown) => void) => (record: LlmCallRecord) => {
    appendFile(path, `${JSON.stringify(record)}\n`).catch(onError);
  };
