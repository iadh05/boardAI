import { LlmError } from '../errors.ts';
import type { LlmProvider } from '../types.ts';

// A provider with another behind it (AV2-04, D13): a hosted model first, the local one when the
// hosted can't answer. Only before the first chunk — after it, the user has started reading.

export type FallbackOptions = {
  /** Told why the primary didn't answer: for the log and the trace. */
  onFallback?: (error: LlmError) => void;
};

export const createFallbackProvider = (
  primary: LlmProvider,
  fallback: LlmProvider,
  options: FallbackOptions = {},
): LlmProvider => ({
  async *stream(input) {
    let answered = false;
    try {
      for await (const chunk of primary.stream(input)) {
        answered = true;
        yield chunk;
      }
      return;
    } catch (error) {
      const fallsBack =
        error instanceof LlmError && error.code !== 'ABORTED' && !answered && !input.signal.aborted;
      if (!fallsBack) throw error;
      options.onFallback?.(error);
    }
    yield* fallback.stream(input);
  },
});
