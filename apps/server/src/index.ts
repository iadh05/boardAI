import { serve } from '@hono/node-server';
import { loadConfigFromProcess } from './core/config.ts';
import { createLogger } from './core/logger.ts';
import { createErrorReporter } from './core/observability/errorReporter.ts';
import { startTelemetry } from './core/observability/telemetry.ts';
import { createApp } from './main.ts';

// Starts the real server. Everything testable lives in createApp (main.ts).

const config = loadConfigFromProcess();
const logger = createLogger({ level: config.logLevel });
// Started once, before anything can fail: Sentry when SENTRY_DSN is set, else nothing.
const reporter = createErrorReporter(config.errorTracking);
// Before the app is built: its spans need the SDK in place. Off without an OTLP endpoint.
const flushTelemetry = startTelemetry(config.telemetry, logger);
const app = createApp({ config, logger, reporter });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info('server listening', {
    port: info.port,
    llm: config.llm.provider,
    errorTracking: config.errorTracking ? 'sentry' : 'off',
    telemetry: config.telemetry ? config.telemetry.endpoint : 'off',
  });
});

const stop = (signal: string) => {
  logger.info('shutting down', { signal });
  server.close();
  // Send the last batch of spans before the process exits.
  flushTelemetry().catch((error: unknown) => {
    logger.warn('could not flush traces', { error: String(error) });
  });
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
