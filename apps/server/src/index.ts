import { serve } from '@hono/node-server';
import { loadConfigFromProcess } from './core/config.ts';
import { createLogger } from './core/logger.ts';
import { createErrorReporter } from './core/observability/errorReporter.ts';
import { startTracing } from './core/observability/tracing.ts';
import { createApp } from './main.ts';

// Starts the real server. Everything testable lives in createApp (main.ts).

const config = loadConfigFromProcess();
const logger = createLogger({ level: config.logLevel });
// Started once, before anything can fail: Sentry when SENTRY_DSN is set, else nothing.
const reporter = createErrorReporter(config.errorTracking);
// Before the app is built: its spans need the SDK in place. Off without an OTLP endpoint.
const flushTraces = startTracing(config.tracing, logger);
const app = createApp({ config, logger, reporter });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info('server listening', {
    port: info.port,
    llm: config.llm.provider,
    errorTracking: config.errorTracking ? 'sentry' : 'off',
    tracing: config.tracing ? config.tracing.endpoint : 'off',
  });
});

const stop = (signal: string) => {
  logger.info('shutting down', { signal });
  server.close();
  // Send the last batch of spans before the process exits.
  flushTraces().catch((error: unknown) => {
    logger.warn('could not flush traces', { error: String(error) });
  });
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
