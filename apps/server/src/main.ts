import { createGateway, type LlmProvider } from '@designroom/ai-gateway';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import type { Config, Role } from './core/config.ts';
import { notFound, onError } from './core/errors.ts';
import { createLlmProvider, createRoleProviders } from './core/llm.ts';
import type { Logger } from './core/logger.ts';
import {
  countErrors,
  noErrorReporter,
  type ErrorReporter,
} from './core/observability/errorReporter.ts';
import { observeRequests } from './core/observability/telemetry.ts';
import { appendToFile, recordLlmCalls } from './core/llmCallLog.ts';
import { currentRequestId, requestContext } from './core/requestContext.ts';
import {
  createChatModule,
  createPhoenixFeedback,
  createReviewAgent,
  createReviewAgentV2,
} from './modules/chat/index.ts';
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
  const local =
    deps.llmProvider ?? createLlmProvider(deps.config.llm, (path) => readFileSync(path, 'utf8'));
  // Opt-in (LLM_CALL_LOG): every model call, exactly as sent and answered, for diagnosing the agent.
  const callLog = deps.config.llmCallLog;
  const gatewayFor = (provider: LlmProvider, model: string) => {
    const gateway = createGateway({
      provider,
      model, // names the LLM spans
      timeoutMs: deps.config.llm.timeoutMs,
      retries: 1,
      recordContent: deps.config.traceContent, // prompts and answers in spans: local Phoenix only
    });
    return callLog
      ? recordLlmCalls(gateway, {
          write: appendToFile(callLog, (error) =>
            deps.logger.warn('could not record a model call', { error: String(error) }),
          ),
          now: Date.now,
          requestId: currentRequestId,
        })
      : gateway;
  };

  // Agent V1, or V2 behind AGENT_MODE=v2 (AV2-09): a gateway per role, each hosted model with the
  // local one behind it (AV2-04).
  const roles = createRoleProviders(deps.config.roles, local, {
    onFallback: (role, error) =>
      deps.logger.warn('hosted model fell back to the local one', { role, code: error.code }),
  });
  const gatewayOf = (role: Role) =>
    gatewayFor(roles[role], deps.config.roles[role]?.model ?? deps.config.llm.model);
  const agent =
    deps.config.agent.mode === 'v2'
      ? createReviewAgentV2(
          {
            main: gatewayOf('main'),
            planner: gatewayOf('planner'),
            specialist: gatewayOf('specialist'),
            critic: gatewayOf('critic'),
          },
          {
            recordContent: deps.config.traceContent,
            critic: deps.config.agent.critic,
            criticModel: deps.config.roles.critic !== null,
          },
        )
      : createReviewAgent(gatewayFor(local, deps.config.llm.model), {
          recordContent: deps.config.traceContent,
        });

  const app = new Hono();
  app.use(observeRequests()); // first: the request's span is the parent of everything after
  app.use(requestContext(deps.logger));

  app.route('/api/health', createHealthModule().routes);
  if (deps.config.debugRoutes) app.route('/api/debug', createDebugModule().routes);
  app.route(
    '/api/chat',
    createChatModule({
      agent,
      logger: deps.logger,
      contextTokens: deps.config.llm.contextTokens,
      reporter,
      // Accept/Reject as annotations on the agent's span, when Phoenix is set (M1-26c).
      ...(deps.config.telemetry?.phoenixEndpoint
        ? {
            feedback: createPhoenixFeedback({
              endpoint: deps.config.telemetry.phoenixEndpoint,
              logger: deps.logger,
            }),
          }
        : {}),
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
