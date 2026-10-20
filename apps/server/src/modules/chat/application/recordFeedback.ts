import type { ProposalFeedback } from '@designroom/domain';
import { metrics } from '@opentelemetry/api';

// Accept/Reject on a proposal, recorded on the review's trace (M1-26c): which reviews people find
// useful, per trace in Phoenix and over time in Grafana — the seed of M5's eval data.

/** Where feedback goes besides the metric: Phoenix when configured (infra), nowhere otherwise. */
export type FeedbackSink = { record: (feedback: ProposalFeedback) => Promise<void> };

export const noFeedbackSink: FeedbackSink = { record: () => Promise.resolve() };

/** Built when the app is, after the telemetry SDK is registered: the counter must be a real one. */
export const createRecordFeedback = (sink: FeedbackSink) => {
  const verdicts = metrics.getMeter('@designroom/server').createCounter('proposal_feedback_total', {
    description: 'Proposals accepted or rejected by the user.',
    unit: '{proposal}',
  });
  return async (feedback: ProposalFeedback) => {
    verdicts.add(1, { verdict: feedback.verdict });
    await sink.record(feedback);
  };
};
