import { createGateway, type LlmProvider } from '@designroom/ai-gateway';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import type { Config } from './core/config.ts';
import { notFound, onError } from './core/errors.ts';
import { createLlmProvider } from './core/llm.ts';
import type { Logger } from './core/logger.ts';
import { requestContext } from './core/requestContext.ts';
import { createChatModule, createReviewAgent } from './modules/chat/index.ts';
import { createHealthModule } from './modules/health/index.ts';

// The composition root (architecture §6): builds every dependency and hands it to the modules.
// Nothing else creates dependencies, so tests build this same app with fakes.

export type AppDeps = {
  config: Config;
  logger: Logger;
  /** Replaces the provider chosen by config: tests script the model's answers. */
  llmProvider?: LlmProvider;
};

export const createApp = (deps: AppDeps) => {
  const llm = createGateway({
    provider:
      deps.llmProvider ?? createLlmProvider(deps.config.llm, (path) => readFileSync(path, 'utf8')),
    timeoutMs: deps.config.llm.timeoutMs,
    retries: 1,
  });

  const app = new Hono();
  app.use(requestContext(deps.logger));

  app.route('/api/health', createHealthModule().routes);
  app.route(
    '/api/chat',
    createChatModule({ agent: createReviewAgent(llm), logger: deps.logger }).routes,
  );

  app.notFound(notFound);
  app.onError(onError(deps.logger));
  return app;
};
