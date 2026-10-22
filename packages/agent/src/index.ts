// @designroom/agent — the AI reviewer's logic (architecture §7). The LLM gateway is injected:
// this package imports only its types, so tests run the agent on a fake model.

export {
  createAgent,
  LEAK_STOPPED_REPLY,
  type AgentDeps,
  type AgentEvent,
  type AgentInput,
} from './application/runAgent.ts';
export { checkScope, type ScopeQuestion } from './application/checkScope.ts';
export { createAliases, type Aliases } from './domain/aliases.ts';
export { boardToText } from './domain/boardToText.ts';
export { buildMessages, REFUSAL_WORDING, SYSTEM_PROMPT } from './domain/prompt.ts';
export { OUT_OF_SCOPE_REPLY, type Scope } from './domain/scope.ts';
export {
  AGENT_TOOLS,
  createDraft,
  runToolCall,
  type Draft,
  type ToolCallInput,
  type ToolDeps,
  type ToolOutcome,
} from './domain/tools.ts';
// Agent V2 (AV2-05): the orchestrator, its task queue and the finding contract.
export {
  createOrchestrator,
  type OrchestratorDeps,
  type OrchestratorEvent,
  type OrchestratorInput,
  type Specialist,
} from './application/orchestrator.ts';
export { RULE_SPECIALISTS } from './application/specialists.ts';
export { type TaskResult, type TaskStatus, type Timer } from './application/taskQueue.ts';
export {
  FindingSchema,
  mergeFindings,
  SEVERITIES,
  type Conflict,
  type Finding,
  type MergedFinding,
  type Severity,
} from './domain/findings.ts';
export {
  MAX_TASKS,
  progressText,
  TASK_TIMEOUT_MS,
  TaskCardSchema,
  type Progress,
  type TaskCard,
} from './domain/tasks.ts';
// Agent V2's chain (AV2-07): Main, Planner, Architect.
export {
  createReviewerV2,
  type ReviewerV2Deps,
  type ReviewerV2Event,
} from './application/reviewerV2.ts';
export { FALLBACK_PLAN, makePlan, type Flow, type Plan } from './application/planner.ts';
// The Critic (AV2-08).
export { reviewProposal, type CriticVerdict } from './application/critic.ts';
// The runtime (AV2-11, ADR-011): the orchestrator's engine — state graph, checkpoints, interrupts.
export {
  createGraph,
  createMemoryCheckpointer,
  END,
  type Checkpoint,
  type Checkpointer,
  type GraphEvent,
  type Node,
  type NodeContext,
  type Reducers,
} from './runtime/graph.ts';
