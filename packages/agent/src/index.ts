// @designroom/agent — the AI reviewer's logic (architecture §7). The LLM gateway is injected:
// this package imports only its types, so tests run the agent on a fake model.

export {
  createAgent,
  type AgentDeps,
  type AgentEvent,
  type AgentInput,
} from './application/runAgent.ts';
export { createAliases, type Aliases } from './domain/aliases.ts';
export { boardToText } from './domain/boardToText.ts';
export { buildMessages, SYSTEM_PROMPT } from './domain/prompt.ts';
export {
  AGENT_TOOLS,
  createDraft,
  runToolCall,
  type Draft,
  type ToolCallInput,
  type ToolDeps,
  type ToolOutcome,
} from './domain/tools.ts';
