import {
  createAnthropicProvider,
  createSpendTracker,
  createFallbackProvider,
  createOpenAiCompatibleProvider,
  createScenarioProvider,
  ScenarioFileSchema,
  type LlmError,
  type LlmProvider,
  type ScenarioFile,
  type SpendTracker,
} from '@designroom/ai-gateway';
import { ROLES, type LlmConfig, type Role, type RoleModel } from './config.ts';

// Which model the server talks to, from config: Ollama (or any OpenAI-compatible API), or the
// fake model playing scripted conversations — the e2e runs in CI, which has no GPU (M1-19b).

/** Without a file, the fake model still answers: with how to give it one. */
const NO_SCENARIOS: ScenarioFile = {
  scenarios: [
    {
      name: 'no-scenario-file',
      when: '',
      rounds: [
        [
          {
            type: 'text',
            delta:
              '(fake model) No scenarios loaded: set LLM_SCENARIO_FILE (see apps/server/.env.example).',
          },
        ],
      ],
    },
  ],
};

const loadScenarios = (path: string, readFile: (path: string) => string): ScenarioFile => {
  try {
    return ScenarioFileSchema.parse(JSON.parse(readFile(path)));
  } catch (error) {
    // Fail at startup, naming the file: better than a server whose chat fails later.
    throw new Error(`LLM_SCENARIO_FILE "${path}" is not a valid scenario file: ${String(error)}`, {
      cause: error,
    });
  }
};

/** `readFile` is injected: the composition root passes the real one, tests a fake. */
export const createLlmProvider = (
  llm: LlmConfig,
  readFile: (path: string) => string,
): LlmProvider =>
  llm.provider === 'openai-compatible'
    ? createOpenAiCompatibleProvider({ baseUrl: llm.baseUrl, model: llm.model })
    : createScenarioProvider(
        llm.scenarioFile ? loadScenarios(llm.scenarioFile, readFile) : NO_SCENARIOS,
      );

const OPENAI_COMPATIBLE_URLS = {
  groq: 'https://api.groq.com/openai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
} as const;

/** One hosted model, as its provider speaks (AV2-02, AV2-03). */
const hostedProvider = (
  spec: RoleModel,
  spend: SpendTracker,
  fetchFn?: typeof fetch,
): LlmProvider => {
  const injected = fetchFn ? { fetch: fetchFn } : {};
  if (spec.provider === 'claude')
    return createAnthropicProvider({
      apiKey: spec.apiKey,
      model: spec.model,
      spend,
      ...(spec.thinking ? { thinking: { effort: 'medium' } } : {}),
      ...injected,
    });
  // Thinking off as each model takes it: gpt-oss can't turn it off; some Gemini refuse "none".
  const off = spec.provider === 'gemini' ? null : spec.model.includes('gpt-oss') ? 'low' : 'none';
  return createOpenAiCompatibleProvider({
    baseUrl: OPENAI_COMPATIBLE_URLS[spec.provider],
    model: spec.model,
    apiKey: spec.apiKey,
    reasoningEffort: spec.thinking ? 'medium' : off,
    ...injected,
  });
};

export type RoleProviderDeps = {
  /** Told when a hosted role couldn't answer and the local model did: for the log. */
  onFallback?: (role: Role, error: LlmError) => void;
  /** Injected in tests: the hosted calls never reach the network. */
  fetch?: typeof fetch;
};

/**
 * A provider per agent role (AV2-04, D13): the role's hosted model with the local one behind it,
 * or the local one alone. The local model answers whenever the hosted can't (offline, rate-limited,
 * silent, budget spent): a request never fails because a hosted model is down. One Claude budget
 * for all roles: the daily cap is the cap, however many roles use Claude (review of AV2-04).
 */
export const createRoleProviders = (
  roles: Record<Role, RoleModel | null>,
  local: LlmProvider,
  deps: RoleProviderDeps = {},
): Record<Role, LlmProvider> => {
  const spend = createSpendTracker();
  return Object.fromEntries(
    ROLES.map((role) => {
      const spec = roles[role];
      if (!spec) return [role, local];
      const hosted = hostedProvider(spec, spend, deps.fetch);
      return [
        role,
        createFallbackProvider(hosted, local, {
          onFallback: (error) => deps.onFallback?.(role, error),
        }),
      ];
    }),
  ) as Record<Role, LlmProvider>;
};
