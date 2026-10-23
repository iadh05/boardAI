// The readability debt (ADR-014): files over a readability limit when the rules arrived
// (2026-10-22). They warn instead of failing, and leave this list when fixed (ticket CI-02).
// The list only shrinks: tooling/lint/src/readabilityDebt.test.ts checks it.

/** How many files were on the list at the start. Lower it as files leave; never raise it. */
export const DEBT_AT_START = 6;

export const READABILITY_DEBT: readonly string[] = [
  // agent V2's orchestration (complexity 32, 25, 17): replaced by the harness rebuild (ADR-011,
  // ours or XState — the spike, #94), not refactored in place
  'packages/agent/src/application/reviewerV2.ts',
  'packages/agent/src/application/taskQueue.ts',
  'packages/agent/src/application/orchestrator.ts',
  // ai-gateway (complexity 25): next in CI-02
  'packages/ai-gateway/src/providers/anthropic.ts',
];
