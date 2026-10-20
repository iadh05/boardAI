import type { Logger } from '../../../core/logger.ts';
import type { FeedbackSink } from '../application/recordFeedback.ts';

// The feedback port on Phoenix (M1-26c): Accept/Reject becomes a human annotation on the agent's
// span (POST /v1/span_annotations, Phoenix 20.x). Fire and forget: Phoenix down must never fail
// the user's click, so a failure is a warning in the logs.

export type PhoenixFeedbackDeps = {
  /** Phoenix's base URL, e.g. http://localhost:6006 (PHOENIX_COLLECTOR_ENDPOINT). */
  endpoint: string;
  logger: Logger;
  fetch?: typeof fetch;
};

/** Phoenix is local: if it doesn't answer in 2 s, give up rather than hold the request. */
const TIMEOUT_MS = 2_000;

export const createPhoenixFeedback = ({
  endpoint,
  logger,
  fetch: fetchFn = fetch,
}: PhoenixFeedbackDeps): FeedbackSink => {
  let base = endpoint;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return {
    record: async ({ spanId, verdict }) => {
      try {
        const res = await fetchFn(`${base}/v1/span_annotations?sync=false`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: [
              {
                span_id: spanId,
                name: 'user verdict',
                annotator_kind: 'HUMAN',
                result: { label: verdict, score: verdict === 'accepted' ? 1 : 0 },
              },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) logger.warn('could not record feedback in Phoenix', { status: res.status });
      } catch (error) {
        logger.warn('could not record feedback in Phoenix', { error: String(error) });
      }
    },
  };
};
