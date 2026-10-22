import { LlmError } from '../errors.ts';
import type { LlmProvider } from '../types.ts';

// A provider with another behind it (AV2-04, D13): a hosted model first, the local one when the
// hosted can't answer. Only before the first chunk — after it, the user has started reading.

/** Calls `fire` after `ms`; returns a cancel. Injected: tests fire it by hand. */
export type FallbackTimer = (ms: number, fire: () => void) => () => void;

export type FallbackOptions = {
  /** Told why the primary didn't answer: for the log and the trace. */
  onFallback?: (error: LlmError) => void;
  /**
   * Longest wait for the primary's first chunk before the fallback answers (default 15 s). Its own
   * clock: the gateway's idle timeout aborts the call, which here would look like a cancel
   * (review of AV2-04). Keep it under the gateway's timeout.
   */
  firstChunkMs?: number;
  timer?: FallbackTimer;
};

const realTimer: FallbackTimer = (ms, fire) => {
  const handle = setTimeout(fire, ms);
  return () => clearTimeout(handle);
};

export const createFallbackProvider = (
  primary: LlmProvider,
  fallback: LlmProvider,
  options: FallbackOptions = {},
): LlmProvider => ({
  async *stream(input) {
    const call = new AbortController();
    const forward = () => call.abort();
    input.signal.addEventListener('abort', forward, { once: true });
    let silent = false;
    const firstChunkMs = options.firstChunkMs ?? 15_000;
    const cancelDeadline = (options.timer ?? realTimer)(firstChunkMs, () => {
      silent = true;
      call.abort();
    });
    let answered = false;
    try {
      for await (const chunk of primary.stream({ ...input, signal: call.signal })) {
        if (!answered) cancelDeadline();
        answered = true;
        yield chunk;
      }
      return;
    } catch (error) {
      if (answered || input.signal.aborted || !(error instanceof LlmError)) throw error;
      const reason = silent
        ? new LlmError('TIMEOUT', `The hosted model sent nothing for ${firstChunkMs / 1000} s.`)
        : error;
      if (reason.code === 'ABORTED') throw error;
      options.onFallback?.(reason);
    } finally {
      cancelDeadline();
      input.signal.removeEventListener('abort', forward);
    }
    yield* fallback.stream(input);
  },
});
