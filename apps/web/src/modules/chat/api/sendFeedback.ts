import type { Proposal, ProposalFeedback } from '@designroom/domain';

// Accept/Reject goes back to the server as feedback on the review's trace (M1-26c): which
// reviews people find useful. Fire and forget — it must never slow down or bother the user, so a
// failed send is ignored. A proposal made without tracing has no ids, and nothing is sent.

export const sendFeedback = (
  fetchFn: typeof fetch,
  proposal: Proposal,
  verdict: ProposalFeedback['verdict'],
): void => {
  if (!proposal.traceId || !proposal.spanId) return;
  const feedback: ProposalFeedback = {
    traceId: proposal.traceId,
    spanId: proposal.spanId,
    verdict,
  };
  fetchFn('/api/chat/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(feedback),
    keepalive: true, // still sent if the user closes the tab right after clicking
  }).catch(() => undefined);
};
