import { serve } from '@hono/node-server';
import { loadConfigFromProcess } from './core/config.ts';
import { createLogger } from './core/logger.ts';
import { createErrorReporter } from './core/observability/errorReporter.ts';
import { startTelemetry } from './core/observability/telemetry.ts';
import { createApp, createRealtime } from './main.ts';

// Starts the real server. Everything testable lives in createApp (main.ts).

const config = loadConfigFromProcess();
// The SDK reports its own trouble to stdout only: through the OTLP log exporter, a failed log
// export would report itself again, forever (M1-26d).
const stdoutOnly = createLogger({ level: config.logLevel });
// Before the app is built: its spans need the SDK in place. Off without an OTLP endpoint.
const telemetry = startTelemetry(config.telemetry, stdoutOnly);
// The app's logger: stdout, and Loki when telemetry is on.
const logger = createLogger({
  level: config.logLevel,
  ...(telemetry.logSink ? { sink: telemetry.logSink } : {}),
});
// Started once, before anything can fail: Sentry when SENTRY_DSN is set, else nothing.
const reporter = createErrorReporter(config.errorTracking);
const app = createApp({ config, logger, reporter });
const realtime = createRealtime({ logger });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info('server listening', {
    port: info.port,
    llm: config.llm.provider,
    errorTracking: config.errorTracking ? 'sentry' : 'off',
    telemetry: config.telemetry ? config.telemetry.endpoint : 'off',
  });
});

// WebSocket upgrades (/ws/rooms/:id) go to the rooms, not to Hono.
server.on('upgrade', realtime.handleUpgrade);

const stop = (signal: string) => {
  logger.info('shutting down', { signal });
  realtime.close(); // open WebSockets would keep server.close() waiting forever
  server.close();
  // Send the last batch of spans before the process exits.
  telemetry.flush().catch((error: unknown) => {
    stdoutOnly.warn('could not flush telemetry', { error: String(error) });
  });
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
