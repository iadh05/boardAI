import { createGateway, type LlmProvider } from '@designroom/ai-gateway';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import type { Config } from './core/config.ts';
import { notFound, onError } from './core/errors.ts';
import { createLlmProvider } from './core/llm.ts';
import type { Logger } from './core/logger.ts';
import {
  countErrors,
  noErrorReporter,
  type ErrorReporter,
} from './core/observability/errorReporter.ts';
import { observeRequests } from './core/observability/telemetry.ts';
import { appendToFile, recordLlmCalls } from './core/llmCallLog.ts';
import { currentRequestId, requestContext } from './core/requestContext.ts';
import { createChatModule, createReviewAgent } from './modules/chat/index.ts';
import { createCollaborationModule } from './modules/collaboration/index.ts';
import { createDebugModule } from './modules/debug/index.ts';
import { createHealthModule } from './modules/health/index.ts';

// The composition root (architecture §6): builds every dependency and hands it to the modules.
// Nothing else creates dependencies, so tests build this same app with fakes.

export type AppDeps = {
  config: Config;
  logger: Logger;
  /** Replaces the provider chosen by config: tests script the model's answers. */
  llmProvider?: LlmProvider;
  /** Error tracking (Sentry), started once in index.ts; none in tests. */
  reporter?: ErrorReporter;
};

export const createApp = (deps: AppDeps) => {
  // Every bug is counted (overview dashboard, alert), then reported (GlitchTip, when a DSN is set).
  const reporter = countErrors(deps.reporter ?? noErrorReporter);
  const gateway = createGateway({
    provider:
      deps.llmProvider ?? createLlmProvider(deps.config.llm, (path) => readFileSync(path, 'utf8')),
    model: deps.config.llm.model, // names the LLM spans
    timeoutMs: deps.config.llm.timeoutMs,
    retries: 1,
  });
  // Opt-in (LLM_CALL_LOG): every model call, exactly as sent and answered, for diagnosing the agent.
  const callLog = deps.config.llmCallLog;
  const llm = callLog
    ? recordLlmCalls(gateway, {
        write: appendToFile(callLog, (error) =>
          deps.logger.warn('could not record a model call', { error: String(error) }),
        ),
        now: Date.now,
        requestId: currentRequestId,
      })
    : gateway;

  const app = new Hono();
  app.use(observeRequests()); // first: the request's span is the parent of everything after
  app.use(requestContext(deps.logger));

  app.route('/api/health', createHealthModule().routes);
  if (deps.config.debugRoutes) app.route('/api/debug', createDebugModule().routes);
  app.route(
    '/api/chat',
    createChatModule({
      agent: createReviewAgent(llm),
      logger: deps.logger,
      contextTokens: deps.config.llm.contextTokens,
      reporter,
    }).routes,
  );

  app.notFound(notFound);
  app.onError(onError(deps.logger, reporter));
  return app;
};

/**
 * The live part (M2): rooms over WebSocket. Separate from the Hono app because upgrades come from
 * the Node server itself — index.ts hands them over with `server.on('upgrade', …)`.
 */
export const createRealtime = (deps: Pick<AppDeps, 'logger'>) =>
  createCollaborationModule({ logger: deps.logger });
