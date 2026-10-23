// The readability debt (ADR-014): files over a readability limit when the rules arrived
// (2026-10-22). They warn instead of failing, and leave this list when fixed (ticket CI-02).
// The list only shrinks: tooling/lint/src/readabilityDebt.test.ts checks it.

/** How many files were on the list at the start. Lower it as files leave; never raise it. */
export const DEBT_AT_START = 15;

export const READABILITY_DEBT: readonly string[] = [
  // agent: the worst first (cognitive complexity 106, 32, 32, 25, 17)
  'packages/agent/src/application/runAgent.ts',
  'packages/agent/src/application/reviewerV2.ts',
  'packages/agent/src/domain/tools.ts',
  'packages/agent/src/application/taskQueue.ts',
  'packages/agent/src/application/orchestrator.ts',
  // ai-gateway
  'packages/ai-gateway/src/providers/openAiCompatible.ts',
  'packages/ai-gateway/src/providers/anthropic.ts',
  'packages/ai-gateway/src/gateway.ts',
  // domain, diagram
  'packages/domain/src/board/critique.ts',
  // apps
  'apps/server/src/modules/chat/application/reviewBoard.ts',
  'apps/server/src/modules/collaboration/infra/yjsRoom.ts',
  // scripts
  'scripts/red-team.ts',
  'scripts/review-samples.ts',
  'scripts/show-llm-calls.ts',
  'scripts/spike-tool-call.ts',
];
