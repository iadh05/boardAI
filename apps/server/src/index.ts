import { serve } from '@hono/node-server';
import { loadConfigFromProcess } from './core/config.ts';
import { createLogger } from './core/logger.ts';
import { createErrorReporter } from './core/observability/errorReporter.ts';
import { createApp } from './main.ts';

// Starts the real server. Everything testable lives in createApp (main.ts).

const config = loadConfigFromProcess();
const logger = createLogger({ level: config.logLevel });
// Started once, before anything can fail: Sentry when SENTRY_DSN is set, else nothing.
const reporter = createErrorReporter(config.errorTracking);
const app = createApp({ config, logger, reporter });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info('server listening', {
    port: info.port,
    llm: config.llm.provider,
    errorTracking: config.errorTracking ? 'sentry' : 'off',
  });
});

const stop = (signal: string) => {
  logger.info('shutting down', { signal });
  server.close();
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
