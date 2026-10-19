import {
  createOpenAiCompatibleProvider,
  createScenarioProvider,
  ScenarioFileSchema,
  type LlmProvider,
  type ScenarioFile,
} from '@designroom/ai-gateway';
import type { LlmConfig } from './config.ts';

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
