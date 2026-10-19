// What every LLM call needs, whatever the provider (architecture §8): an idle timeout, retries
// with backoff, cancellation, and one usage report per call. Model routing, fallback providers
// and the cost guard (M4) will live here too.

import { context, type Context } from '@opentelemetry/api';
import { cancelledError, LlmError } from './errors.ts';
import { createLlmMetrics, recordFailure, startLlmSpan, usageAttributes } from './telemetry.ts';
import type { AiGateway, ChatInput, LlmChunk, LlmProvider } from './types.ts';

export type GatewayOptions = {
  provider: LlmProvider;
  /** The provider's default model: names the LLM spans of calls that don't pick one. */
  model?: string;
  /** Longest silence allowed between two chunks — like Nginx's proxy_read_timeout. */
  timeoutMs: number;
  /** Extra attempts after a transient failure, made only before the answer started. */
  retries: number;
  /** First wait before retrying; doubles each time. Default 500 ms. */
  backoffMs?: number;
  /** Injected for tests: no test reads the system clock (docs/rules/general.md). */
  now?: () => number;
  /** Waits `ms`, or ends early when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const sleepUnlessAborted = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

/** Yields from `source`, failing with TIMEOUT (and aborting the call) after `ms` of silence. */
async function* withIdleTimeout<T>(source: AsyncIterable<T>, ms: number, call: AbortController) {
  const iterator = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const silence = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          call.abort();
          reject(new LlmError('TIMEOUT', `The model sent nothing for ${ms / 1000} s.`));
        }, ms);
      });
      const next = iterator.next();
      next.catch(() => undefined); // if the timer wins, the cancelled read must not go unhandled
      try {
        const result = await Promise.race([next, silence]);
        if (result.done) return;
        yield result.value;
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    await iterator.return?.().catch(() => undefined);
  }
}

export const createGateway = (options: GatewayOptions): AiGateway => {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? sleepUnlessAborted;
  const backoffMs = options.backoffMs ?? 500;
  const metered = createLlmMetrics();

  /** The call itself: retries, timeout, cancellation, usage. */
  async function* call(input: ChatInput): AsyncIterable<LlmChunk> {
    const started = now();
    let firstTokenAt: number | null = null;

    for (let attempt = 1; ; attempt++) {
      if (input.signal?.aborted) throw cancelledError();
      // One controller per attempt: aborted by the caller, the timeout, or when we stop.
      const call = new AbortController();
      const forward = () => call.abort();
      input.signal?.addEventListener('abort', forward, { once: true });
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const stream = options.provider.stream({ ...input, signal: call.signal });
        for await (const chunk of withIdleTimeout(stream, options.timeoutMs, call)) {
          if (chunk.type === 'tokens') {
            inputTokens += chunk.inputTokens;
            outputTokens += chunk.outputTokens;
            continue;
          }
          firstTokenAt ??= now();
          yield chunk;
        }
        yield {
          type: 'usage',
          usage: {
            inputTokens,
            outputTokens,
            latencyMs: now() - started,
            timeToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - started,
            attempts: attempt,
          },
        };
        return;
      } catch (error) {
        if (input.signal?.aborted) throw cancelledError(error);
        // Retry only before the answer started: once text reached the user, a retry repeats it.
        const answered = firstTokenAt !== null;
        const retry =
          error instanceof LlmError && error.transient && !answered && attempt <= options.retries;
        if (!retry) throw error;
      } finally {
        call.abort(); // stopped early, failed or done: the model has nothing left to do
        input.signal?.removeEventListener('abort', forward);
      }
      await sleep(backoffMs * 2 ** (attempt - 1), input.signal);
    }
  }

  /** The call inside its span, ended however the stream ends: done, failed, or abandoned. */
  async function* traced(input: ChatInput, parent: Context): AsyncIterable<LlmChunk> {
    const model = input.model ?? options.model;
    const span = startLlmSpan(model, parent);
    const started = now();
    try {
      for await (const chunk of call(input)) {
        if (chunk.type === 'usage') {
          span.setAttributes(usageAttributes(chunk.usage));
          metered.succeeded(model ?? 'unknown', chunk.usage);
        }
        yield chunk;
      }
    } catch (error) {
      recordFailure(span, error);
      metered.failed(model ?? 'unknown', error, now() - started);
      throw error;
    } finally {
      span.end();
    }
  }

  return {
    // Not an async generator itself: a generator's body runs on its first read, in the reader's
    // context. Reading the active context here, at the call, makes the span a child of the caller's
    // (the agent round), wherever the stream is read from.
    chat: (input) => traced(input, context.active()),
  };
};
