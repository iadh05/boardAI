// @designroom/ai-gateway — the only code that talks to LLM providers (architecture §8).
// The server builds a gateway from a provider and injects it; the agent sees only the types.

export type {
  AiGateway,
  ChatInput,
  LlmChunk,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
  ProviderChunk,
  ToolDefinition,
  Usage,
} from './types.ts';
export { LlmError, type LlmErrorCode } from './errors.ts';
export { createGateway, type GatewayOptions } from './gateway.ts';
export {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleOptions,
} from './providers/openAiCompatible.ts';
export {
  CLAUDE_MODELS,
  createAnthropicProvider,
  createSpendTracker,
  type SpendTracker,
  type AnthropicOptions,
} from './providers/anthropic.ts';
export { createFallbackProvider, type FallbackOptions } from './providers/fallback.ts';
export { createFakeProvider, type FakeProvider, type FakeStep } from './providers/fake.ts';
export {
  createScenarioProvider,
  ScenarioFileSchema,
  type ScenarioFile,
} from './providers/scenario.ts';
