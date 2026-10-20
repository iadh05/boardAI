// Reading the model-call log (LLM_CALL_LOG, M1-28): shared by the viewer and the replay.

import { readFileSync } from 'node:fs';
import type { LlmCallRecord } from '../../apps/server/src/core/llmCallLog.ts';

export type { LlmCallRecord };

/** The log's records grouped by request, in the order they happened. */
export const readCalls = (file: string): Map<string, LlmCallRecord[]> => {
  const byRequest = new Map<string, LlmCallRecord[]>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as LlmCallRecord;
    const key = record.requestId ?? '(no request)';
    byRequest.set(key, [...(byRequest.get(key) ?? []), record]);
  }
  return byRequest;
};

/** One request's calls: the given id, or the last request in the log. */
export const callsOf = (file: string, requestId?: string) => {
  const all = readCalls(file);
  const id = requestId ?? [...all.keys()].at(-1);
  const calls = id === undefined ? undefined : all.get(id);
  if (!id || !calls) throw new Error(`No request ${requestId ?? ''} in ${file}`);
  return { id, calls };
};

/** A flag's value from argv: `--name value`. */
export const flag = (args: readonly string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
