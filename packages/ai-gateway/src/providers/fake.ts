// A provider that replays scripted answers: agent and server tests run on it, with no network
// and no GPU (docs/rules/general.md). Later the e2e runs use it too (LLM_PROVIDER=fake).

import { LlmError } from '../errors.ts';
import type { ChatInput, LlmProvider, ProviderChunk } from '../types.ts';

/** One step of a scripted answer: a chunk, a failure, or "never answer" (until cancelled). */
export type FakeStep = ProviderChunk | { type: 'error'; error: LlmError } | { type: 'hang' };

export type FakeProvider = LlmProvider & {
  /** What each call was asked, in order: tests assert on the prompt the agent built. */
  calls: ChatInput[];
};

const untilAborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    const abort = () => reject(new LlmError('ABORTED', 'The request was cancelled.'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });

/** Each call to `stream` plays the next answer of the script. */
export const createFakeProvider = (answers: FakeStep[][]): FakeProvider => {
  const remaining = [...answers];
  const calls: ChatInput[] = [];

  return {
    calls,
    async *stream({ signal, ...input }) {
      calls.push(input);
      const answer = remaining.shift();
      if (!answer) throw new Error(`Fake LLM: no scripted answer left for call ${calls.length}`);
      for (const step of answer) {
        if (step.type === 'error') throw step.error;
        if (step.type === 'hang') await untilAborted(signal);
        else yield step;
      }
    },
  };
};
