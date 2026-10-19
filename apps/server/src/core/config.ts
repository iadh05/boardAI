import { z } from 'zod';
import { LOG_LEVELS, type LogLevel } from './logger.ts';

// The only file that reads the environment (docs/rules/backend.md). Validated at startup: a bad
// setting stops the server with a clear message, instead of failing later on some request.

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LLM_PROVIDER: z.enum(['openai-compatible', 'fake']).default('openai-compatible'),
    LLM_BASE_URL: z.url().optional(),
    LLM_MODEL: z.string().min(1).default('designroom-qwen'), // infra/ollama/Modelfile
    // Longest silence from the model; the first call after a pause waits ~20 s for Ollama to load it.
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    // Error tracking (Sentry): off when unset, so tests and offline work need nothing.
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.string().min(1).default('development'),
    // The fake model's scripted conversations (JSON): e2e runs and offline work (M1-19b).
    LLM_SCENARIO_FILE: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER !== 'fake' && !env.LLM_BASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_BASE_URL'],
        message: 'is required (e.g. http://localhost:11434/v1 for Ollama)',
      });
    }
  });

export type LlmConfig =
  | { provider: 'openai-compatible'; baseUrl: string; model: string; timeoutMs: number }
  | { provider: 'fake'; model: string; timeoutMs: number; scenarioFile?: string };

export type Config = {
  port: number;
  llm: LlmConfig;
  logLevel: LogLevel;
  /** Null: error tracking is off. */
  errorTracking: { dsn: string; environment: string } | null;
};

/** Parses an environment: process.env in production, a plain object in tests. */
export const loadConfig = (env: Record<string, string | undefined>): Config => {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment (see apps/server/.env.example):\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  const llm: LlmConfig =
    e.LLM_PROVIDER === 'fake' || !e.LLM_BASE_URL
      ? {
          provider: 'fake',
          model: e.LLM_MODEL,
          timeoutMs: e.LLM_TIMEOUT_MS,
          ...(e.LLM_SCENARIO_FILE ? { scenarioFile: e.LLM_SCENARIO_FILE } : {}),
        }
      : {
          provider: 'openai-compatible',
          baseUrl: e.LLM_BASE_URL,
          model: e.LLM_MODEL,
          timeoutMs: e.LLM_TIMEOUT_MS,
        };
  const errorTracking = e.SENTRY_DSN
    ? { dsn: e.SENTRY_DSN, environment: e.SENTRY_ENVIRONMENT }
    : null;
  return { port: e.PORT, llm, logLevel: e.LOG_LEVEL, errorTracking };
};

/** The server's real configuration. */
export const loadConfigFromProcess = (): Config => loadConfig(process.env);
