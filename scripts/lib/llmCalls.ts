// Reading the model-call log (LLM_CALL_LOG, M1-28): shared by the viewer and the replay.

import { readFileSync } from 'node:fs';
import type { LlmCallRecord } from '../../apps/server/src/core/llmCallLog.ts';

export type { LlmCallRecord };

/** The log's records grouped by request, in the order they happened. */
export const readCalls = (file: string): Map<string, LlmCallRecord[]> => {
  const byRequest = new Map<string, LlmCallRecord[]>();
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    let record: LlmCallRecord;
    try {
      record = JSON.parse(line) as LlmCallRecord;
    } catch (error) {
      // The server may be writing the last line right now (the log is read while it runs).
      if (i === lines.length - 1) continue;
      throw new Error(`${file}: line ${i + 1} is not a record`, { cause: error });
    }
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
