import { z } from 'zod';
import { LOG_LEVELS, type LogLevel } from './logger.ts';

// The only file that reads the environment (docs/rules/backend.md). Validated at startup: a bad
// setting stops the server with a clear message, instead of failing later on some request.

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LLM_PROVIDER: z.enum(['openai-compatible', 'fake']).default('openai-compatible'),
    LLM_BASE_URL: z.url().optional(),
    LLM_MODEL: z.string().min(1).default('qwen3.5:9b'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
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
  | { provider: 'openai-compatible'; baseUrl: string; model: string }
  | { provider: 'fake'; model: string };

export type Config = { port: number; llm: LlmConfig; logLevel: LogLevel };

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
      ? { provider: 'fake', model: e.LLM_MODEL }
      : { provider: 'openai-compatible', baseUrl: e.LLM_BASE_URL, model: e.LLM_MODEL };
  return { port: e.PORT, llm, logLevel: e.LOG_LEVEL };
};

/** The server's real configuration. */
export const loadConfigFromProcess = (): Config => loadConfig(process.env);
